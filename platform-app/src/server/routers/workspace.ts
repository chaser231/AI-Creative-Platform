/**
 * Workspace Router
 *
 * CRUD operations for workspaces, membership management, brand identity,
 * join requests, and RBAC (Role-Based Access Control).
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

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
  prisma: PrismaClient,
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

    return memberships.map((m) => ({
      ...m.workspace,
      role: m.role,
    }));
  }),

  /** List ALL visible workspaces (for browse/discover) */
  listAll: protectedProcedure.query(async ({ ctx }) => {
    // SUPER_ADMIN sees all workspaces; others see only VISIBLE
    const user = await ctx.prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: { role: true },
    });
    const isSuperAdmin = user?.role === "SUPER_ADMIN";

    const workspaces = await ctx.prisma.workspace.findMany({
      where: isSuperAdmin ? {} : { visibility: "VISIBLE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        businessUnit: true,
        visibility: true,
        joinPolicy: true,
        logoUrl: true,
        _count: { select: { members: true, projects: true } },
      },
    });

    // Also get user's current memberships and pending requests
    const [memberships, pendingRequests] = await Promise.all([
      ctx.prisma.workspaceMember.findMany({
        where: { userId: ctx.user.id },
        select: { workspaceId: true },
      }),
      ctx.prisma.joinRequest.findMany({
        where: { userId: ctx.user.id, status: "PENDING" },
        select: { workspaceId: true },
      }),
    ]);
    const joinedIds = new Set(memberships.map((m: { workspaceId: string }) => m.workspaceId));
    const pendingIds = new Set(pendingRequests.map((r: { workspaceId: string }) => r.workspaceId));

    return workspaces.map((ws: { id: string; name: string; slug: string; businessUnit: string; visibility: string; joinPolicy: string; logoUrl: string | null; _count: { members: number; projects: number } }) => ({
      ...ws,
      memberCount: ws._count.members,
      projectCount: ws._count.projects,
      isJoined: joinedIds.has(ws.id),
      hasPendingRequest: pendingIds.has(ws.id),
    }));
  }),

  /** Join a workspace (respects joinPolicy) */
  join: protectedProcedure
    .input(z.object({
      workspaceId: z.string(),
      viaInvite: z.boolean().optional(), // true when coming from /invite/[slug]
    }))
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
        return { success: true, alreadyMember: true, status: "joined" as const };
      }

      // Get workspace join policy
      const workspace = await ctx.prisma.workspace.findUnique({
        where: { id: input.workspaceId },
        select: { joinPolicy: true, visibility: true },
      });

      if (!workspace) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Воркспейс не найден" });
      }

      // Invite links always allow direct join
      if (input.viaInvite) {
        await ctx.prisma.workspaceMember.create({
          data: {
            userId: ctx.user.id,
            workspaceId: input.workspaceId,
            role: "CREATOR",
          },
        });
        // Clean up any pending request
        await ctx.prisma.joinRequest.deleteMany({
          where: { userId: ctx.user.id, workspaceId: input.workspaceId },
        });
        return { success: true, alreadyMember: false, status: "joined" as const };
      }

      // Respect join policy
      switch (workspace.joinPolicy) {
        case "OPEN":
          await ctx.prisma.workspaceMember.create({
            data: {
              userId: ctx.user.id,
              workspaceId: input.workspaceId,
              role: "CREATOR",
            },
          });
          return { success: true, alreadyMember: false, status: "joined" as const };

        case "REQUEST":
          // Create a join request
          const existingRequest = await ctx.prisma.joinRequest.findUnique({
            where: {
              userId_workspaceId: {
                userId: ctx.user.id,
                workspaceId: input.workspaceId,
              },
            },
          });
          if (existingRequest) {
            return { success: true, alreadyMember: false, status: "already_requested" as const };
          }
          await ctx.prisma.joinRequest.create({
            data: {
              userId: ctx.user.id,
              workspaceId: input.workspaceId,
            },
          });
          return { success: true, alreadyMember: false, status: "requested" as const };

        case "INVITE_ONLY":
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Этот воркспейс доступен только по приглашению",
          });

        default:
          throw new TRPCError({ code: "BAD_REQUEST" });
      }
    }),

  /** Send a join request with optional message */
  requestJoin: protectedProcedure
    .input(z.object({
      workspaceId: z.string(),
      message: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check not already member
      const membership = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: { userId: ctx.user.id, workspaceId: input.workspaceId },
        },
      });
      if (membership) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Вы уже участник этого воркспейса" });
      }

      // Upsert request
      const request = await ctx.prisma.joinRequest.upsert({
        where: {
          userId_workspaceId: { userId: ctx.user.id, workspaceId: input.workspaceId },
        },
        create: {
          userId: ctx.user.id,
          workspaceId: input.workspaceId,
          message: input.message,
        },
        update: {
          status: "PENDING",
          message: input.message,
        },
      });

      return request;
    }),

  /** List pending join requests for a workspace (ADMIN only) */
  listJoinRequests: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireRole(ctx.prisma, ctx.user.id, input.workspaceId, "ADMIN");

      const requests = await ctx.prisma.joinRequest.findMany({
        where: { workspaceId: input.workspaceId, status: "PENDING" },
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return requests;
    }),

  /** Handle a join request (approve/reject) — ADMIN only */
  handleJoinRequest: protectedProcedure
    .input(z.object({
      requestId: z.string(),
      action: z.enum(["approve", "reject"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const request = await ctx.prisma.joinRequest.findUnique({
        where: { id: input.requestId },
      });
      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      await requireRole(ctx.prisma, ctx.user.id, request.workspaceId, "ADMIN");

      if (input.action === "approve") {
        // Add as member
        await ctx.prisma.workspaceMember.create({
          data: {
            userId: request.userId,
            workspaceId: request.workspaceId,
            role: "CREATOR",
          },
        });
        await ctx.prisma.joinRequest.update({
          where: { id: input.requestId },
          data: { status: "APPROVED" },
        });
      } else {
        await ctx.prisma.joinRequest.update({
          where: { id: input.requestId },
          data: { status: "REJECTED" },
        });
      }

      return { success: true };
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
        visibility: z.enum(["VISIBLE", "HIDDEN"]).optional(),
        joinPolicy: z.enum(["OPEN", "REQUEST", "INVITE_ONLY"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { visibility, joinPolicy, ...rest } = input;
      const workspace = await ctx.prisma.workspace.create({
        data: {
          ...rest,
          ...(visibility && { visibility }),
          ...(joinPolicy && { joinPolicy }),
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

  /** Update workspace settings — ADMIN only */
  update: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        name: z.string().min(1).max(100).optional(),
        slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/).optional(),
        businessUnit: z.string().optional(),
        visibility: z.enum(["VISIBLE", "HIDDEN"]).optional(),
        joinPolicy: z.enum(["OPEN", "REQUEST", "INVITE_ONLY"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireRole(ctx.prisma, ctx.user.id, input.workspaceId, "ADMIN");

      const { workspaceId, ...data } = input;

      // Check slug uniqueness if changing
      if (data.slug) {
        const existing = await ctx.prisma.workspace.findUnique({
          where: { slug: data.slug },
        });
        if (existing && existing.id !== workspaceId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Такой slug уже занят",
          });
        }
      }

      const workspace = await ctx.prisma.workspace.update({
        where: { id: workspaceId },
        data,
      });

      return workspace;
    }),

  /** Delete workspace — ADMIN only */
  delete: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireRole(ctx.prisma, ctx.user.id, input.workspaceId, "ADMIN");

      await ctx.prisma.workspace.delete({
        where: { id: input.workspaceId },
      });

      return { success: true };
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
          logoUrl: true,
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
