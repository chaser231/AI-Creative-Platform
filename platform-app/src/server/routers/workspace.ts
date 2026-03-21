/**
 * Workspace Router
 *
 * CRUD operations for workspaces, membership management, brand identity,
 * and RBAC (Role-Based Access Control).
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";

// ─── RBAC HELPERS ────────────────────────────────────────

/** Role hierarchy: higher index = higher privilege */
const ROLE_HIERARCHY = ["VIEWER", "USER", "CREATOR", "ADMIN"] as const;
type Role = (typeof ROLE_HIERARCHY)[number];

function roleIndex(role: string): number {
  return ROLE_HIERARCHY.indexOf(role as Role);
}

/**
 * Check that the current user has at least `minRole` in the given workspace.
 * Returns the membership record.
 * Throws FORBIDDEN if insufficient role or NOT a member.
 */
async function requireRole(
  prisma: any,
  userId: string,
  workspaceId: string,
  minRole: Role
) {
  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId, workspaceId },
    },
  });

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Вы не являетесь участником этого воркспейса",
    });
  }

  if (roleIndex(membership.role) < roleIndex(minRole)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Требуется роль ${minRole} или выше`,
    });
  }

  return membership;
}

// ─── ROUTER ──────────────────────────────────────────────

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

    return memberships.map((m: { workspace: any; role: string }) => ({
      ...m.workspace,
      role: m.role,
    }));
  }),

  /** List ALL workspaces (for onboarding / team selection) */
  listAll: protectedProcedure.query(async ({ ctx }) => {
    const workspaces = await ctx.prisma.workspace.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        businessUnit: true,
        _count: { select: { members: true, projects: true } },
      },
    });

    // Also get user's current memberships to mark joined ones
    const memberships = await ctx.prisma.workspaceMember.findMany({
      where: { userId: ctx.user.id },
      select: { workspaceId: true },
    });
    const joinedIds = new Set(memberships.map((m: { workspaceId: string }) => m.workspaceId));

    return workspaces.map((ws: any) => ({
      ...ws,
      memberCount: ws._count.members,
      projectCount: ws._count.projects,
      isJoined: joinedIds.has(ws.id),
    }));
  }),

  /** Join a workspace */
  join: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Check if already a member
      const existing = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: ctx.user.id,
            workspaceId: input.workspaceId,
          },
        },
      });

      if (existing) {
        return { success: true, alreadyMember: true };
      }

      await ctx.prisma.workspaceMember.create({
        data: {
          userId: ctx.user.id,
          workspaceId: input.workspaceId,
          role: "CREATOR",
        },
      });

      return { success: true, alreadyMember: false };
    }),

  /** Leave a workspace */
  leave: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.workspaceMember.deleteMany({
        where: {
          userId: ctx.user.id,
          workspaceId: input.workspaceId,
        },
      });

      return { success: true };
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

  /** Update brand identity (colors, fonts, TOV, logo) — ADMIN only */
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
      await requireRole(ctx.prisma, ctx.user.id, input.workspaceId, "ADMIN");

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
      // Any member can view the team
      await requireRole(ctx.prisma, ctx.user.id, input.workspaceId, "VIEWER");

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

  /** Update a member's role — ADMIN only */
  updateMemberRole: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        memberId: z.string(),
        role: z.enum(["ADMIN", "CREATOR", "USER", "VIEWER"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireRole(ctx.prisma, ctx.user.id, input.workspaceId, "ADMIN");

      // Prevent self-demotion (so there's always at least one admin)
      const target = await ctx.prisma.workspaceMember.findUnique({
        where: { id: input.memberId },
      });

      if (!target || target.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (target.userId === ctx.user.id && input.role !== "ADMIN") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Нельзя понизить свою собственную роль",
        });
      }

      await ctx.prisma.workspaceMember.update({
        where: { id: input.memberId },
        data: { role: input.role },
      });

      return { success: true };
    }),

  /** Remove a member from workspace — ADMIN only */
  removeMember: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        memberId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireRole(ctx.prisma, ctx.user.id, input.workspaceId, "ADMIN");

      const target = await ctx.prisma.workspaceMember.findUnique({
        where: { id: input.memberId },
      });

      if (!target || target.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Can't remove yourself
      if (target.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Нельзя удалить самого себя. Используйте «Покинуть команду»",
        });
      }

      await ctx.prisma.workspaceMember.delete({
        where: { id: input.memberId },
      });

      return { success: true };
    }),

  /** Get public workspace info for invite page (no auth required) */
  getInviteInfo: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const workspace = await ctx.prisma.workspace.findUnique({
        where: { slug: input.slug },
        select: {
          id: true,
          name: true,
          slug: true,
          businessUnit: true,
          _count: { select: { members: true, projects: true } },
        },
      });

      if (!workspace) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return {
        ...workspace,
        memberCount: workspace._count.members,
        projectCount: workspace._count.projects,
      };
    }),
});
