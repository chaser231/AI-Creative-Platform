/**
 * Project Router
 *
 * CRUD operations for projects, canvas state persistence, and versioning.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  collectS3KeysFromAssets,
  collectS3KeysFromCanvasState,
  deleteS3Objects,
} from "../utils/s3-cleanup";
import { assertProjectAccess, assertVersionAccess, assertWorkspaceAccess } from "../authz/guards";

/** Role hierarchy for comparisons */
const ROLE_RANK: Record<string, number> = { VIEWER: 0, USER: 1, CREATOR: 2, ADMIN: 3 };

async function checkRole(prisma: PrismaClient, userId: string, workspaceId: string, minRole: string) {
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!membership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Вы не являетесь участником этого воркспейса" });
  }
  if ((ROLE_RANK[membership.role] ?? 0) < (ROLE_RANK[minRole] ?? 0)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Требуется роль ${minRole} или выше` });
  }
  return membership;
}

export const projectRouter = createTRPCRouter({
  /** List projects in a workspace */
  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        onlyMine: z.boolean().optional(),
        status: z
          .enum(["DRAFT", "IN_PROGRESS", "REVIEW", "PUBLISHED", "ARCHIVED"])
          .optional(),
        goal: z.enum(["banner", "text", "video", "photo"]).optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Must be at least VIEWER in this workspace
      await checkRole(ctx.prisma, ctx.user.id, input.workspaceId, "VIEWER");

      const projects = await ctx.prisma.project.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.onlyMine && { createdById: ctx.user.id }),
          ...(input.status && { status: input.status }),
          ...(input.goal && { goal: input.goal }),
          ...(input.search && {
            name: { contains: input.search, mode: "insensitive" as const },
          }),
        },
        select: {
          id: true,
          name: true,
          status: true,
          goal: true,
          thumbnail: true,
          createdAt: true,
          updatedAt: true,
          createdBy: {
            select: { id: true, name: true, avatarUrl: true },
          },
        },
        orderBy: { updatedAt: "desc" },
      });

      // Photo-generation projects don't render on a canvas, so they never
      // populate `thumbnail` via the canvas auto-save path. Back-fill the
      // preview from the most recent generated asset so dashboard cards
      // show an image instead of a placeholder icon.
      const photoProjectIds = projects
        .filter((p) => p.goal === "photo" && !p.thumbnail)
        .map((p) => p.id);

      if (photoProjectIds.length > 0) {
        const recentAssets = await ctx.prisma.asset.findMany({
          where: {
            projectId: { in: photoProjectIds },
            type: "IMAGE",
          },
          select: { projectId: true, url: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        });

        const thumbnailByProject = new Map<string, string>();
        for (const a of recentAssets) {
          if (a.projectId && !thumbnailByProject.has(a.projectId)) {
            thumbnailByProject.set(a.projectId, a.url);
          }
        }

        return projects.map((p) => {
          if (p.goal === "photo" && !p.thumbnail) {
            const url = thumbnailByProject.get(p.id);
            if (url) return { ...p, thumbnail: url };
          }
          return p;
        });
      }

      return projects;
    }),

  /** Get project by ID (metadata only — canvasState is loaded separately via loadState) */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.id);
      const project = await ctx.prisma.project.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          name: true,
          status: true,
          goal: true,
          thumbnail: true,
          createdAt: true,
          updatedAt: true,
          workspaceId: true,
          createdById: true,
          createdBy: {
            select: { id: true, name: true, avatarUrl: true },
          },
        },
      });

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return project;
    }),

  /** Create a new project */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        workspaceId: z.string(),
        goal: z.enum(["banner", "text", "video", "photo"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Must be at least CREATOR to create projects
      await checkRole(ctx.prisma, ctx.user.id, input.workspaceId, "CREATOR");

      const project = await ctx.prisma.project.create({
        data: {
          name: input.name,
          goal: input.goal,
          workspaceId: input.workspaceId,
          createdById: ctx.user.id,
        },
      });

      return project;
    }),

  /** Update project metadata */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        status: z
          .enum(["DRAFT", "IN_PROGRESS", "REVIEW", "PUBLISHED", "ARCHIVED"])
          .optional(),
        thumbnail: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await assertProjectAccess(ctx, id);
      // Check: must be CREATOR in workspace, OR the project owner
      const project = await ctx.prisma.project.findUnique({ where: { id } });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      if (project.createdById !== ctx.user.id) {
        await checkRole(ctx.prisma, ctx.user.id, project.workspaceId, "CREATOR");
      }

      const updated = await ctx.prisma.project.update({
        where: { id },
        data,
      });

      return updated;
    }),

  /** Delete a project (with S3 storage cleanup) */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.id);
      // Check: must be CREATOR in workspace, OR the project owner
      const project = await ctx.prisma.project.findUnique({
        where: { id: input.id },
        select: { id: true, createdById: true, workspaceId: true, canvasState: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      if (project.createdById !== ctx.user.id) {
        await checkRole(ctx.prisma, ctx.user.id, project.workspaceId, "CREATOR");
      }

      // ── S3 cleanup: collect all S3 keys before cascade-deleting DB records ──
      try {
        const assets = await ctx.prisma.asset.findMany({
          where: { projectId: input.id },
          select: { url: true },
        });

        const s3Keys = [
          ...collectS3KeysFromAssets(assets),
          ...collectS3KeysFromCanvasState(project.canvasState),
        ];

        if (s3Keys.length > 0) {
          await deleteS3Objects(s3Keys);
        }
      } catch (cleanupErr) {
        // Non-blocking: log but proceed with DB deletion
        console.error("[project.delete] S3 cleanup failed:", cleanupErr);
      }

      await ctx.prisma.project.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  /**
   * Save canvas state (auto-save).
   *
   * Optimistic locking (MF-3):
   *   - Caller SHOULD pass the `version` value it last observed (via
   *     `loadState` or the previous `saveState` response) as `expectedVersion`.
   *   - If the current DB row has a different `version`, the caller is working
   *     on stale state and we throw `CONFLICT` — the client is expected to
   *     refetch and reconcile (MF-3 keeps it simple: no auto-retry).
   *   - `version` is always incremented on successful writes so other tabs
   *     detect the change on their next save attempt.
   *   - Legacy callers that omit `expectedVersion` fall back to last-wins
   *     (but still bump the version so newer clients stay in sync).
   */
  saveState: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        canvasState: z.object({
          layers: z.array(z.any()),
          masterComponents: z.array(z.any()).optional(),
          componentInstances: z.array(z.any()).optional(),
          resizes: z.any().optional(),
          artboardProps: z.any().optional(),
          canvasWidth: z.number().optional(),
          canvasHeight: z.number().optional(),
          palette: z.any().optional(),
        }),
        thumbnail: z.string().nullable().optional(),
        expectedVersion: z.number().int().nonnegative().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.id, "USER");
      // Drop inline base64 thumbnails that would bloat the DB row and may
      // have already exceeded the 3.5 MB Serverless Container request limit.
      let thumbnail = input.thumbnail;
      if (thumbnail && thumbnail.startsWith("data:") && thumbnail.length > 200_000) {
        console.warn(`[saveState] project ${input.id}: dropping oversized base64 thumbnail (${(thumbnail.length / 1024).toFixed(0)} KB)`);
        thumbnail = null;
      }

      const data = {
        canvasState: input.canvasState,
        ...(thumbnail !== undefined && { thumbnail }),
        status: "IN_PROGRESS" as const,
        version: { increment: 1 },
      };

      if (typeof input.expectedVersion === "number") {
        try {
          const project = await ctx.prisma.project.update({
            where: { id: input.id, version: input.expectedVersion },
            data,
            select: { updatedAt: true, version: true },
          });
          return { success: true, updatedAt: project.updatedAt, version: project.version };
        } catch (err) {
          // P2025 = "Record to update not found" — either id or version mismatch.
          // Since access was already asserted above, a NOT_FOUND here means
          // the version predicate failed → concurrent write wins.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
            const current = await ctx.prisma.project.findUnique({
              where: { id: input.id },
              select: { version: true, updatedAt: true },
            });
            throw new TRPCError({
              code: "CONFLICT",
              message: "version mismatch",
              cause: {
                expectedVersion: input.expectedVersion,
                currentVersion: current?.version ?? null,
                updatedAt: current?.updatedAt ?? null,
              },
            });
          }
          throw err;
        }
      }

      const project = await ctx.prisma.project.update({
        where: { id: input.id },
        data,
        select: { updatedAt: true, version: true },
      });
      return { success: true, updatedAt: project.updatedAt, version: project.version };
    }),

  /**
   * Load canvas state.
   *
   * MF-3: response is now `{ canvasState, version }` — the client must feed
   * `version` into the next `saveState` as `expectedVersion` to engage
   * optimistic locking. Older clients that read a plain canvas object will
   * need a small migration (see `useLoadCanvasState`).
   */
  loadState: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.id);
      const project = await ctx.prisma.project.findUnique({
        where: { id: input.id },
        select: { canvasState: true, version: true },
      });

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Yandex Cloud Serverless Containers has a 3.5 MB response limit.
      // Strip inline base64 image sources that inflated the payload
      // (they should have been migrated to S3; this is a safety net).
      const MAX_RESPONSE_BYTES = 3_200_000; // leave 300 KB headroom for tRPC envelope
      const state = project.canvasState as Record<string, unknown> | null;
      if (state) {
        const raw = JSON.stringify(state);
        if (raw.length > MAX_RESPONSE_BYTES) {
          console.warn(`[loadState] project ${input.id}: canvasState is ${(raw.length / 1024 / 1024).toFixed(2)} MB — stripping inline base64`);
          const stripBase64 = (layers: any[]) =>
            layers.map((l: any) => {
              if (l.type === "image" && typeof l.src === "string" && l.src.startsWith("data:")) {
                return { ...l, src: "" };
              }
              return l;
            });
          if (Array.isArray(state.layers)) {
            state.layers = stripBase64(state.layers as any[]);
          }
          if (Array.isArray(state.resizes)) {
            state.resizes = (state.resizes as any[]).map((r: any) => ({
              ...r,
              layerSnapshot: Array.isArray(r.layerSnapshot) ? stripBase64(r.layerSnapshot) : r.layerSnapshot,
            }));
          }
        }
      }

      return { canvasState: project.canvasState, version: project.version };
    }),

  /** Create a version snapshot */
  createVersion: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        label: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId, "USER");
      // Get current project state
      const project = await ctx.prisma.project.findUnique({
        where: { id: input.projectId },
        select: { canvasState: true },
      });

      if (!project || !project.canvasState) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No canvas state to version",
        });
      }

      // Get next version number
      const lastVersion = await ctx.prisma.projectVersion.findFirst({
        where: { projectId: input.projectId },
        orderBy: { version: "desc" },
        select: { version: true },
      });

      const version = await ctx.prisma.projectVersion.create({
        data: {
          projectId: input.projectId,
          version: (lastVersion?.version ?? 0) + 1,
          label: input.label,
          canvasState: project.canvasState,
          createdBy: ctx.user.id,
        },
      });

      return version;
    }),

  /** List versions for a project */
  listVersions: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const versions = await ctx.prisma.projectVersion.findMany({
        where: { projectId: input.projectId },
        select: {
          id: true,
          version: true,
          label: true,
          createdAt: true,
          createdBy: true,
        },
        orderBy: { version: "desc" },
      });

      return versions;
    }),

  /** Restore a version */
  restoreVersion: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        versionId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId, "USER");
      const __v = await assertVersionAccess(ctx, input.versionId, "write");
      if (__v.projectId !== input.projectId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Версия не принадлежит этому проекту" });
      }
      const version = await ctx.prisma.projectVersion.findUnique({
        where: { id: input.versionId },
        select: { canvasState: true },
      });

      if (!version) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // MF-3: bump `version` so any open editor tab detects the restore on
      // its next save attempt and refetches instead of silently overwriting.
      await ctx.prisma.project.update({
        where: { id: input.projectId },
        data: {
          canvasState: version.canvasState ?? undefined,
          version: { increment: 1 },
        },
      });

      return { success: true };
    }),

  /** Add project to favorites */
  favorite: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      // Upsert to avoid duplicates
      await ctx.prisma.favoriteProject.upsert({
        where: {
          userId_projectId: {
            userId: ctx.user.id,
            projectId: input.projectId,
          },
        },
        update: {},
        create: {
          userId: ctx.user.id,
          projectId: input.projectId,
        },
      });
      return { success: true };
    }),

  /** Remove project from favorites */
  unfavorite: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      await ctx.prisma.favoriteProject.deleteMany({
        where: {
          userId: ctx.user.id,
          projectId: input.projectId,
        },
      });
      return { success: true };
    }),

  /** List user's favorite projects */
  listFavorites: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceAccess(ctx, input.workspaceId);
      const favorites = await ctx.prisma.favoriteProject.findMany({
        where: {
          userId: ctx.user.id,
          project: { workspaceId: input.workspaceId },
        },
        include: {
          project: {
            select: { id: true, name: true, status: true, updatedAt: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      return favorites.map((f: { project: { id: string; name: string; status: string; updatedAt: Date } }) => f.project);
    }),
});
