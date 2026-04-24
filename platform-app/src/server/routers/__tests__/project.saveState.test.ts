/**
 * MF-3: optimistic locking for Project.canvasState.
 *
 * These tests exercise the tRPC `project.saveState` / `project.loadState`
 * procedures against a hand-rolled Prisma mock. We deliberately avoid
 * `@prisma/client` factory helpers and just fake the exact methods the
 * router touches — the goal is to verify the control flow around
 * `expectedVersion`, not to re-test Prisma itself.
 *
 * Covered:
 *   1. saveState with matching `expectedVersion` → success; version bumps.
 *   2. saveState with stale `expectedVersion` → TRPCError CONFLICT carrying
 *      the current server version; no data is overwritten.
 *   3. saveState without `expectedVersion` → legacy last-wins; version still
 *      bumps so other clients notice on their next save.
 *   4. loadState returns `{ canvasState, version }` so clients can seed the
 *      next `expectedVersion` without a second round-trip.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";

// Stub NextAuth + Prisma module-level side effects so importing the router
// does not pull in `next/server` (which vitest can't resolve in a Node env)
// or instantiate an S3Client. The router itself never touches these stubs;
// it only calls through the `ctx.prisma` we inject below.
// vi.mock is auto-hoisted above the static imports below.
vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/utils/s3-cleanup", () => ({
  collectS3KeysFromAssets: () => [],
  collectS3KeysFromCanvasState: () => [],
  deleteS3Objects: async () => {},
}));

import { createCallerFactory } from "@/server/trpc";
import { projectRouter } from "@/server/routers/project";

// ─── Types ────────────────────────────────────────────────
type ProjectRow = {
  id: string;
  workspaceId: string;
  createdById: string;
  version: number;
  canvasState: Record<string, unknown> | null;
  updatedAt: Date;
  thumbnail: string | null;
  status: string;
};

// ─── Prisma mock factory ──────────────────────────────────
function makePrismaMock(initial: ProjectRow) {
  const row: ProjectRow = { ...initial };

  const project = {
    findUnique: vi.fn(
      async ({ where }: { where: { id: string }; select?: Record<string, boolean> }) => {
        if (where.id !== row.id) return null;
        return { ...row };
      },
    ),
    // Mirrors Prisma's behaviour for `update`:
    //   where: { id, version } → throws P2025 if no row matches all predicates.
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string; version?: number };
        data: Record<string, unknown>;
      }) => {
        const idMatches = where.id === row.id;
        const versionMatches =
          where.version === undefined || where.version === row.version;
        if (!idMatches || !versionMatches) {
          throw new Prisma.PrismaClientKnownRequestError(
            "Record to update not found.",
            { code: "P2025", clientVersion: "test" },
          );
        }

        if (data.version && typeof data.version === "object") {
          const v = data.version as { increment?: number };
          if (typeof v.increment === "number") row.version += v.increment;
        } else if (typeof data.version === "number") {
          row.version = data.version;
        }

        if ("canvasState" in data) {
          row.canvasState = data.canvasState as Record<string, unknown> | null;
        }
        if ("thumbnail" in data) {
          row.thumbnail = (data.thumbnail as string | null) ?? null;
        }
        if ("status" in data && typeof data.status === "string") {
          row.status = data.status;
        }
        row.updatedAt = new Date();
        return { ...row };
      },
    ),
  };

  // USER membership is enough: `assertProjectAccess` with "USER" passes,
  // which is exactly what saveState requires.
  const workspaceMember = {
    findUnique: vi.fn(async () => ({
      userId: "u1",
      workspaceId: "w1",
      role: "USER" as const,
      id: "m1",
      joinedAt: new Date(),
    })),
  };

  // Unused tables referenced by other procedures — stubbed so accidental
  // cross-procedure calls fail loudly instead of silently returning undefined.
  const reject = () => {
    throw new Error("prisma mock: unexpected call");
  };
  const projectVersion = {
    findFirst: vi.fn(reject),
    findUnique: vi.fn(reject),
    create: vi.fn(reject),
  };
  const favoriteProject = {
    upsert: vi.fn(reject),
    deleteMany: vi.fn(reject),
    findMany: vi.fn(reject),
  };
  const asset = { findMany: vi.fn(reject) };

  return {
    prisma: { project, workspaceMember, projectVersion, favoriteProject, asset },
    row,
  };
}

const SAMPLE_CANVAS = {
  layers: [{ id: "l1", type: "rect", x: 0, y: 0, width: 10, height: 10 }],
};

const SAMPLE_CANVAS_WITH_PALETTE = {
  ...SAMPLE_CANVAS,
  palette: {
    colors: [{ id: "c1", type: "color", name: "Brand", value: "#FFCC00" }],
    backgrounds: [
      {
        id: "bg1",
        type: "background",
        name: "Hero",
        value: {
          kind: "image",
          src: "https://storage.yandexcloud.net/acp-assets/templates/bg.png",
          fit: "cover",
          focusX: 0.5,
          focusY: 0.5,
        },
      },
    ],
  },
};

// Context shape expected by TRPCContext. The real one adds NextAuth session
// and request headers — for router-level tests we only need the three fields
// the procedures actually touch (`prisma`, `user`, `session`). `headers` is
// there to satisfy the TRPCContext type, not because any procedure reads it.
function makeCtx(prisma: ReturnType<typeof makePrismaMock>["prisma"], userId: string) {
  const user = { id: userId, name: "t", email: "t@t", image: null };
  return {
    prisma: prisma as unknown as import("@prisma/client").PrismaClient,
    user,
    session: { user, expires: "" },
    headers: new Headers(),
    authSessionUnavailable: false,
    authRecoveryStatus: null,
  };
}

const makeCaller = createCallerFactory(projectRouter);

describe("project.saveState (MF-3 optimistic locking)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("succeeds and bumps version when expectedVersion matches", async () => {
    const { prisma, row } = makePrismaMock({
      id: "p1",
      workspaceId: "w1",
      createdById: "u1",
      version: 3,
      canvasState: { layers: [] },
      updatedAt: new Date("2026-04-22T00:00:00Z"),
      thumbnail: null,
      status: "DRAFT",
    });
    const caller = makeCaller(makeCtx(prisma, "u1"));

    const res = await caller.saveState({
      id: "p1",
      canvasState: SAMPLE_CANVAS,
      expectedVersion: 3,
    });

    expect(res.success).toBe(true);
    expect(res.version).toBe(4);
    expect(row.version).toBe(4);
    expect(row.canvasState).toEqual(SAMPLE_CANVAS);
    // Guarded update path must include the version predicate.
    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1", version: 3 },
      }),
    );
  });

  it("throws CONFLICT with current server version when expectedVersion is stale", async () => {
    const { prisma, row } = makePrismaMock({
      id: "p1",
      workspaceId: "w1",
      createdById: "u1",
      version: 7, // server moved ahead
      canvasState: { layers: [] },
      updatedAt: new Date("2026-04-22T00:00:00Z"),
      thumbnail: null,
      status: "DRAFT",
    });
    const caller = makeCaller(makeCtx(prisma, "u1"));

    let caught: unknown = null;
    try {
      await caller.saveState({
        id: "p1",
        canvasState: SAMPLE_CANVAS,
        expectedVersion: 3, // stale
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe("CONFLICT");
    // No mutation must have landed.
    expect(row.version).toBe(7);
    expect(row.canvasState).toEqual({ layers: [] });
    const cause = (caught as TRPCError).cause as
      | { expectedVersion?: number; currentVersion?: number }
      | undefined;
    expect(cause?.expectedVersion).toBe(3);
    expect(cause?.currentVersion).toBe(7);
  });

  it("falls back to last-wins when expectedVersion is omitted, but still bumps version", async () => {
    const { prisma, row } = makePrismaMock({
      id: "p1",
      workspaceId: "w1",
      createdById: "u1",
      version: 5,
      canvasState: { layers: [] },
      updatedAt: new Date("2026-04-22T00:00:00Z"),
      thumbnail: null,
      status: "DRAFT",
    });
    const caller = makeCaller(makeCtx(prisma, "u1"));

    const res = await caller.saveState({
      id: "p1",
      canvasState: SAMPLE_CANVAS,
    });

    expect(res.success).toBe(true);
    expect(res.version).toBe(6);
    expect(row.version).toBe(6);
    // Legacy path must NOT carry a version predicate, otherwise concurrent
    // writers would see false-positive conflicts.
    const updateMock = prisma.project.update as unknown as {
      mock: { calls: Array<[{ where: { id: string; version?: number } }]> };
    };
    const callArg = updateMock.mock.calls.at(-1)?.[0];
    expect(callArg?.where).toEqual({ id: "p1" });
  });

  it("persists palette data instead of stripping it from canvasState", async () => {
    const { prisma, row } = makePrismaMock({
      id: "p1",
      workspaceId: "w1",
      createdById: "u1",
      version: 2,
      canvasState: { layers: [] },
      updatedAt: new Date("2026-04-22T00:00:00Z"),
      thumbnail: null,
      status: "DRAFT",
    });
    const caller = makeCaller(makeCtx(prisma, "u1"));

    await caller.saveState({
      id: "p1",
      canvasState: SAMPLE_CANVAS_WITH_PALETTE,
      expectedVersion: 2,
    });

    expect(row.canvasState).toEqual(SAMPLE_CANVAS_WITH_PALETTE);
  });
});

describe("project.loadState (MF-3 returns version)", () => {
  it("returns { canvasState, version } so clients can seed expectedVersion", async () => {
    const { prisma } = makePrismaMock({
      id: "p1",
      workspaceId: "w1",
      createdById: "u1",
      version: 11,
      canvasState: SAMPLE_CANVAS,
      updatedAt: new Date("2026-04-22T00:00:00Z"),
      thumbnail: null,
      status: "DRAFT",
    });
    const caller = makeCaller(makeCtx(prisma, "u1"));

    const res = await caller.loadState({ id: "p1" });

    expect(res).toEqual({ canvasState: SAMPLE_CANVAS, version: 11 });
  });
});
