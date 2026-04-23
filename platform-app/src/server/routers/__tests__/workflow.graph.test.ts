/**
 * Phase 2 — tRPC workflowRouter graph procedures.
 *
 * Exercises `saveGraph` / `loadGraph` and the `list` `includeLegacy` flag
 * against a hand-rolled Prisma mock. We reuse the same pattern as
 * `project.saveState.test.ts`: stub NextAuth/S3 side effects, inject a
 * custom `ctx.prisma` via `createCallerFactory`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";

vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/utils/s3-cleanup", () => ({
    collectS3KeysFromAssets: () => [],
    collectS3KeysFromCanvasState: () => [],
    deleteS3Objects: async () => {},
}));

import { createCallerFactory } from "@/server/trpc";
import { workflowRouter } from "@/server/routers/workflow";
import { emptyWorkflowGraph } from "@/lib/workflow/graphSchema";
import type { WorkflowGraph } from "@/server/workflow/types";

type WorkflowRow = {
    id: string;
    workspaceId: string;
    createdById: string;
    name: string;
    description: string;
    steps: unknown;
    graph: WorkflowGraph | null;
    isTemplate: boolean;
    createdAt: Date;
    updatedAt: Date;
};

function makePrismaMock(opts: {
    userId: string;
    workspaceId: string;
    memberRole?: "VIEWER" | "USER" | "CREATOR" | "OWNER" | "ADMIN" | null;
    rows?: WorkflowRow[];
}) {
    const rows: WorkflowRow[] = opts.rows ? [...opts.rows] : [];
    const memberRole = opts.memberRole === undefined ? "CREATOR" : opts.memberRole;

    const aIWorkflow = {
        findMany: vi.fn(
            async ({
                where,
            }: {
                where: {
                    workspaceId: string;
                    graph?: { not: unknown };
                    OR?: unknown;
                };
            }) => {
                const filterGraphNotNull = where.graph !== undefined;
                return rows
                    .filter((r) => r.workspaceId === where.workspaceId)
                    .filter((r) => (filterGraphNotNull ? r.graph !== null : true));
            },
        ),
        findUnique: vi.fn(
            async ({ where }: { where: { id: string } }) =>
                rows.find((r) => r.id === where.id) ?? null,
        ),
        update: vi.fn(
            async ({
                where,
                data,
            }: {
                where: { id: string };
                data: Record<string, unknown>;
                select?: Record<string, boolean>;
            }) => {
                const idx = rows.findIndex((r) => r.id === where.id);
                if (idx === -1) {
                    throw new Prisma.PrismaClientKnownRequestError(
                        "Record to update not found.",
                        { code: "P2025", clientVersion: "test" },
                    );
                }
                if (typeof data.name === "string") rows[idx].name = data.name;
                if (typeof data.description === "string") rows[idx].description = data.description;
                if ("graph" in data) rows[idx].graph = data.graph as WorkflowGraph | null;
                rows[idx].updatedAt = new Date();
                return { id: rows[idx].id };
            },
        ),
        create: vi.fn(
            async ({
                data,
            }: {
                data: {
                    name: string;
                    description: string;
                    steps: unknown;
                    graph: unknown;
                    workspaceId: string;
                    createdById: string;
                };
            }) => {
                const id = `wf-${rows.length + 1}`;
                const now = new Date();
                const row: WorkflowRow = {
                    id,
                    workspaceId: data.workspaceId,
                    createdById: data.createdById,
                    name: data.name,
                    description: data.description,
                    steps: data.steps,
                    graph: (data.graph as WorkflowGraph) ?? null,
                    isTemplate: false,
                    createdAt: now,
                    updatedAt: now,
                };
                rows.push(row);
                return { id };
            },
        ),
    };

    const workspaceMember = {
        findUnique: vi.fn(async () =>
            memberRole
                ? {
                      userId: opts.userId,
                      workspaceId: opts.workspaceId,
                      role: memberRole,
                      id: "m1",
                      joinedAt: new Date(),
                  }
                : null,
        ),
    };

    return {
        prisma: { aIWorkflow, workspaceMember },
        rows,
    };
}

function makeCtx(
    prisma: ReturnType<typeof makePrismaMock>["prisma"],
    userId: string,
) {
    const user = { id: userId, name: "t", email: "t@t", image: null };
    return {
        prisma: prisma as unknown as import("@prisma/client").PrismaClient,
        user,
        session: { user, expires: "" },
        headers: new Headers(),
    };
}

const makeCaller = createCallerFactory(workflowRouter);

describe("workflowRouter — graph procedures", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("saveGraph creates a new workflow with graph non-null when no workflowId", async () => {
        const { prisma, rows } = makePrismaMock({ userId: "u1", workspaceId: "w1" });
        const caller = makeCaller(makeCtx(prisma, "u1"));

        const res = await caller.saveGraph({
            workspaceId: "w1",
            name: "My Graph",
            graph: emptyWorkflowGraph(),
        });

        expect(res.id).toBe("wf-1");
        expect(rows).toHaveLength(1);
        expect(rows[0].graph).toEqual(emptyWorkflowGraph());
        expect(rows[0].steps).toEqual([]);
        expect(rows[0].createdById).toBe("u1");
    });

    it("saveGraph with workflowId updates the existing row", async () => {
        const existing: WorkflowRow = {
            id: "wf-existing",
            workspaceId: "w1",
            createdById: "u1",
            name: "Old",
            description: "",
            steps: [],
            graph: emptyWorkflowGraph(),
            isTemplate: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const { prisma, rows } = makePrismaMock({
            userId: "u1",
            workspaceId: "w1",
            rows: [existing],
        });
        const caller = makeCaller(makeCtx(prisma, "u1"));

        const newGraph: WorkflowGraph = {
            version: 1,
            nodes: [
                {
                    id: "n1",
                    type: "imageInput",
                    position: { x: 0, y: 0 },
                    data: { params: {} },
                },
            ],
            edges: [],
        };
        const res = await caller.saveGraph({
            workspaceId: "w1",
            workflowId: "wf-existing",
            name: "Updated",
            graph: newGraph,
        });

        expect(res.id).toBe("wf-existing");
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe("Updated");
        expect(rows[0].graph).toEqual(newGraph);
    });

    it("saveGraph without workspace membership → FORBIDDEN", async () => {
        const { prisma } = makePrismaMock({
            userId: "u1",
            workspaceId: "w1",
            memberRole: null,
        });
        const caller = makeCaller(makeCtx(prisma, "u1"));

        await expect(
            caller.saveGraph({
                workspaceId: "w1",
                name: "Nope",
                graph: emptyWorkflowGraph(),
            }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<TRPCError>);
    });

    it("loadGraph returns graph for graph-mode workflow", async () => {
        const graph: WorkflowGraph = {
            version: 1,
            nodes: [],
            edges: [],
        };
        const { prisma } = makePrismaMock({
            userId: "u1",
            workspaceId: "w1",
            memberRole: "USER",
            rows: [
                {
                    id: "wf-1",
                    workspaceId: "w1",
                    createdById: "u1",
                    name: "X",
                    description: "",
                    steps: [],
                    graph,
                    isTemplate: false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ],
        });
        const caller = makeCaller(makeCtx(prisma, "u1"));

        const res = await caller.loadGraph({ id: "wf-1" });
        expect(res.id).toBe("wf-1");
        expect(res.graph).toEqual(graph);
    });

    it("loadGraph returns graph: null for legacy workflow (does not throw)", async () => {
        const { prisma } = makePrismaMock({
            userId: "u1",
            workspaceId: "w1",
            memberRole: "USER",
            rows: [
                {
                    id: "wf-legacy",
                    workspaceId: "w1",
                    createdById: "u1",
                    name: "Legacy",
                    description: "",
                    steps: [{ kind: "old" }],
                    graph: null,
                    isTemplate: false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ],
        });
        const caller = makeCaller(makeCtx(prisma, "u1"));

        const res = await caller.loadGraph({ id: "wf-legacy" });
        expect(res.graph).toBeNull();
    });

    it("list({includeLegacy:false}) excludes graph-null rows; with true includes them", async () => {
        const rows: WorkflowRow[] = [
            {
                id: "wf-graph",
                workspaceId: "w1",
                createdById: "u1",
                name: "Graph one",
                description: "",
                steps: [],
                graph: emptyWorkflowGraph(),
                isTemplate: false,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "wf-legacy",
                workspaceId: "w1",
                createdById: "u1",
                name: "Legacy",
                description: "",
                steps: [{ kind: "old" }],
                graph: null,
                isTemplate: false,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ];
        const { prisma } = makePrismaMock({
            userId: "u1",
            workspaceId: "w1",
            memberRole: "USER",
            rows,
        });
        const caller = makeCaller(makeCtx(prisma, "u1"));

        const onlyGraph = await caller.list({ workspaceId: "w1" });
        expect(onlyGraph.map((r) => r.id).sort()).toEqual(["wf-graph"]);

        const all = await caller.list({ workspaceId: "w1", includeLegacy: true });
        expect(all.map((r) => r.id).sort()).toEqual(["wf-graph", "wf-legacy"]);
    });
});
