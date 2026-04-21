/**
 * Workspace Router
 *
 * CRUD operations for workspaces, membership management, brand identity,
 * join requests, and RBAC (Role-Based Access Control).
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { getModelById } from "@/lib/ai-models";
import { assertWorkspaceAccess } from "@/server/authz/guards";

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
      await assertWorkspaceAccess(ctx, input.workspaceId, "ADMIN");

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

      await assertWorkspaceAccess(ctx, request.workspaceId, "ADMIN");

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

  /** Leave a workspace — with admin reassignment if needed */
  leave: protectedProcedure
    .input(z.object({
      workspaceId: z.string(),
      newAdminId: z.string().optional(), // required if user is last admin
    }))
    .mutation(async ({ ctx, input }) => {
      const membership = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: { userId: ctx.user.id, workspaceId: input.workspaceId },
        },
      });
      if (!membership) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Вы не являетесь участником" });
      }

      // If leaving user is an ADMIN, check if there are other admins
      if (membership.role === "ADMIN") {
        const otherAdmins = await ctx.prisma.workspaceMember.count({
          where: {
            workspaceId: input.workspaceId,
            role: "ADMIN",
            userId: { not: ctx.user.id },
          },
        });

        if (otherAdmins === 0) {
          // No other admins — must assign a new one
          if (!input.newAdminId) {
            // Check how many members remain
            const totalMembers = await ctx.prisma.workspaceMember.count({
              where: { workspaceId: input.workspaceId },
            });
            if (totalMembers <= 1) {
              // Last member — just delete workspace
              await ctx.prisma.workspace.delete({ where: { id: input.workspaceId } });
              return { success: true, workspaceDeleted: true };
            }
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Вы единственный администратор. Назначьте нового админа перед уходом.",
            });
          }
          // Promote the specified user to ADMIN
          await ctx.prisma.workspaceMember.updateMany({
            where: {
              userId: input.newAdminId,
              workspaceId: input.workspaceId,
            },
            data: { role: "ADMIN" },
          });
        }
      }

      await ctx.prisma.workspaceMember.delete({
        where: { id: membership.id },
      });

      return { success: true, workspaceDeleted: false };
    }),

  /** Get workspace by ID (with membership check) */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await assertWorkspaceAccess(ctx, input.id);
      const workspace = await ctx.prisma.workspace.findUnique({
        where: { id: input.id },
      });

      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace not found or access denied",
        });
      }

      return { ...workspace, role: membership.role };
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

      const membership = await assertWorkspaceAccess(ctx, workspace.id);

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
        logoUrl: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceAccess(ctx, input.workspaceId, "ADMIN");

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
      await assertWorkspaceAccess(ctx, input.workspaceId, "ADMIN");

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
      await assertWorkspaceAccess(ctx, input.workspaceId, "ADMIN");

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
      await assertWorkspaceAccess(ctx, input.workspaceId);

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
      // SUPER_ADMIN can change roles in any workspace
      const globalUser = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: { role: true },
      });
      const isSuperAdmin = globalUser?.role === "SUPER_ADMIN";

      if (!isSuperAdmin) {
        await assertWorkspaceAccess(ctx, input.workspaceId, "ADMIN");
      }

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
      await assertWorkspaceAccess(ctx, input.workspaceId, "ADMIN");

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

  /** SUPER_ADMIN: promote self to ADMIN in any workspace (join if needed) */
  selfPromoteAdmin: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify SUPER_ADMIN
      const globalUser = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: { role: true },
      });
      if (globalUser?.role !== "SUPER_ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Требуются права супер-администратора" });
      }

      // Upsert membership as ADMIN
      await ctx.prisma.workspaceMember.upsert({
        where: {
          userId_workspaceId: { userId: ctx.user.id, workspaceId: input.workspaceId },
        },
        update: { role: "ADMIN" },
        create: { userId: ctx.user.id, workspaceId: input.workspaceId, role: "ADMIN" },
      });

      return { success: true };
    }),

  /** Workspace statistics — any member can view */
  stats: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceAccess(ctx, input.workspaceId);

      const [projectCount, memberCount, templateCount, trackedMessages] = await Promise.all([
        ctx.prisma.project.count({ where: { workspaceId: input.workspaceId } }),
        ctx.prisma.workspaceMember.count({ where: { workspaceId: input.workspaceId } }),
        ctx.prisma.template.count({ where: { workspaceId: input.workspaceId } }),
        // AI stats: get all messages from sessions tied to projects in this workspace
        ctx.prisma.aIMessage.findMany({
          where: {
            role: "assistant",
            model: { not: null },
            session: {
              project: { workspaceId: input.workspaceId },
            },
          },
          select: { model: true, costUnits: true },
        }),
      ]);

      // Count formats by counting resizes in canvasState
      // Canvas structure: { resizes: [{id, name, width, height}, ...], layers: [...], ... }
      const projects = await ctx.prisma.project.findMany({
        where: { workspaceId: input.workspaceId },
        select: { canvasState: true },
      });
      let formatCount = 0;
      for (const p of projects) {
        if (p.canvasState && typeof p.canvasState === "object") {
          const state = p.canvasState as { resizes?: Array<{ id?: string }> };
          if (Array.isArray(state.resizes)) {
            // Each entry in resizes is a format (including master)
            formatCount += state.resizes.length;
          }
        }
      }

      // Compute AI cost
      let totalAICost = 0;
      for (const msg of trackedMessages) {
        const modelEntry = getModelById(msg.model ?? "");
        totalAICost += modelEntry?.costPerRun ?? (msg.costUnits ?? 0);
      }

      return {
        projectCount,
        memberCount,
        templateCount,
        formatCount,
        aiGenerations: trackedMessages.length,
        totalAICost,
      };
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
