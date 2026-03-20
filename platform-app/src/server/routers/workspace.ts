/**
 * Workspace Router
 *
 * CRUD operations for workspaces and brand identity management.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";

export const workspaceRouter = createTRPCRouter({
  /** List workspaces the current user is a member of */
  list: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.prisma.workspaceMember.findMany({
      where: { userId: ctx.user.id },
      include: {
        workspace: true,
      },
      orderBy: { workspace: { name: "asc" } },
    });

    return memberships.map((m) => ({
      ...m.workspace,
      role: m.role,
    }));
  }),

  /** Get workspace by ID (with membership check) */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: ctx.user.id,
            workspaceId: input.id,
          },
        },
        include: { workspace: true },
      });

      if (!membership) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found or access denied",
        });
      }

      return { ...membership.workspace, role: membership.role };
    }),

  /** Get workspace by slug */
  getBySlug: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const workspace = await ctx.prisma.workspace.findUnique({
        where: { slug: input.slug },
      });

      if (!workspace) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Check membership
      const membership = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: ctx.user.id,
            workspaceId: workspace.id,
          },
        },
      });

      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return { ...workspace, role: membership.role };
    }),

  /** Create a new workspace */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
        businessUnit: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const workspace = await ctx.prisma.workspace.create({
        data: {
          ...input,
          members: {
            create: {
              userId: ctx.user.id,
              role: "ADMIN",
            },
          },
        },
      });

      return workspace;
    }),

  /** Update brand identity (colors, fonts, TOV, logo) */
  updateBrandIdentity: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        colors: z.any().optional(),
        fonts: z.any().optional(),
        toneOfVoice: z.string().optional(),
        logoUrl: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check admin role
      const membership = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: ctx.user.id,
            workspaceId: input.workspaceId,
          },
        },
      });

      if (!membership || membership.role !== "ADMIN") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only workspace admins can update brand identity",
        });
      }

      const { workspaceId, ...data } = input;
      const workspace = await ctx.prisma.workspace.update({
        where: { id: workspaceId },
        data,
      });

      return workspace;
    }),

  /** List workspace members */
  listMembers: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const members = await ctx.prisma.workspaceMember.findMany({
        where: { workspaceId: input.workspaceId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: { joinedAt: "asc" },
      });

      return members;
    }),
});
