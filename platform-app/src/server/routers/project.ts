/**
 * Project Router
 *
 * CRUD operations for projects, canvas state persistence, and versioning.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

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

      return projects;
    }),

  /** Get project by ID */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: input.id },
        include: {
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
        goal: z.string(),
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

  /** Delete a project */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Check: must be CREATOR in workspace, OR the project owner
      const project = await ctx.prisma.project.findUnique({ where: { id: input.id } });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      if (project.createdById !== ctx.user.id) {
        await checkRole(ctx.prisma, ctx.user.id, project.workspaceId, "CREATOR");
      }

      await ctx.prisma.project.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  /** Save canvas state (auto-save) */
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
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.update({
        where: { id: input.id },
        data: {
          canvasState: input.canvasState,
          status: "IN_PROGRESS",
        },
      });

      return { success: true, updatedAt: project.updatedAt };
    }),

  /** Load canvas state */
  loadState: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: input.id },
        select: { canvasState: true },
      });

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return project.canvasState;
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
      const version = await ctx.prisma.projectVersion.findUnique({
        where: { id: input.versionId },
        select: { canvasState: true },
      });

      if (!version) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      await ctx.prisma.project.update({
        where: { id: input.projectId },
        data: { canvasState: version.canvasState ?? undefined },
      });

      return { success: true };
    }),

  /** Add project to favorites */
  favorite: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
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
