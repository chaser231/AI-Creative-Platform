/**
 * Admin Router — Super-Admin Dashboard
 *
 * All procedures require SUPER_ADMIN global role.
 * Provides cross-workspace analytics and user management.
 */

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, superAdminProcedure } from "../trpc";
import { getModelById } from "@/lib/ai-models";

export const adminRouter = createTRPCRouter({
  /** Aggregate platform statistics */
  stats: superAdminProcedure.query(async ({ ctx }) => {
    const [
      totalUsers,
      totalWorkspaces,
      totalProjects,
      totalTemplates,
      // Fetch all tracked messages (with model) to compute accurate counts & costs
      trackedMessages,
    ] = await Promise.all([
      ctx.prisma.user.count(),
      ctx.prisma.workspace.count(),
      ctx.prisma.project.count(),
      ctx.prisma.template.count(),
      ctx.prisma.aIMessage.findMany({
        where: {
          role: "assistant",
          model: { not: null },
        },
        select: { model: true, costUnits: true },
      }),
    ]);

    // Compute total cost using registry prices (same logic as aiCostAnalytics)
    let totalAICost = 0;
    for (const msg of trackedMessages) {
      const modelEntry = getModelById(msg.model ?? "");
      totalAICost += modelEntry?.costPerRun ?? (msg.costUnits ?? 0);
    }

    return {
      totalUsers,
      totalWorkspaces,
      totalProjects,
      totalTemplates,
      totalAIGenerations: trackedMessages.length,
      totalAICost,
    };
  }),

  /** List all users with computed counts */
  users: superAdminProcedure
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const { search, limit = 50, offset = 0 } = input || {};

      const where: Prisma.UserWhereInput = search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {};

      const [users, total] = await Promise.all([
        ctx.prisma.user.findMany({
          where,
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
            createdAt: true,
            _count: {
              select: {
                memberships: true,
                projects: true,
                aiSessions: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }),
        ctx.prisma.user.count({ where }),
      ]);

      // Get per-user AI generation count & cost
      // Use separate queries per user for simplicity + type safety
      const userIds = users.map(user => user.id);

      // Get all sessions for these users in one query
      const userSessions = userIds.length > 0
        ? await ctx.prisma.aISession.findMany({
            where: { userId: { in: userIds } },
            select: { id: true, userId: true },
          })
        : [];

      const sessionIds = userSessions.map(s => s.id);
      const sessionUserMap = new Map<string, string>();
      userSessions.forEach(s => sessionUserMap.set(s.id, s.userId));

      // Get message stats for all these sessions
      const messageStats = sessionIds.length > 0
        ? await ctx.prisma.aIMessage.findMany({
            where: {
              sessionId: { in: sessionIds },
              role: "assistant",
              model: { not: null },
            },
            select: {
              sessionId: true,
              model: true,
              costUnits: true,
            },
          })
        : [];

      // Aggregate into per-user counts
      const userGenMap = new Map<string, { count: number; cost: number }>();
      for (const msg of messageStats) {
        const userId = sessionUserMap.get(msg.sessionId);
        if (!userId) continue;
        const existing = userGenMap.get(userId) ?? { count: 0, cost: 0 };
        const modelEntry = getModelById(msg.model ?? "");
        existing.count += 1;
        existing.cost += modelEntry?.costPerRun ?? (msg.costUnits ?? 0);
        userGenMap.set(userId, existing);
      }

      const enrichedUsers = users.map(user => ({
        ...user,
        aiGenerations: userGenMap.get(user.id)?.count ?? 0,
        aiCost: userGenMap.get(user.id)?.cost ?? 0,
      }));

      return { users: enrichedUsers, total };
    }),

  /** List all workspaces with computed counts */
  workspaces: superAdminProcedure.query(async ({ ctx }) => {
    const workspaces = await ctx.prisma.workspace.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        businessUnit: true,
        createdAt: true,
        _count: {
          select: {
            members: true,
            projects: true,
            templates: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return workspaces;
  }),

  /** AI cost analytics — breakdown by model, user, workspace */
  aiCostAnalytics: superAdminProcedure
    .input(
      z.object({
        dateFrom: z.string().optional(), // ISO date string
        dateTo: z.string().optional(),   // ISO date string
      }).optional()
    )
    .query(async ({ ctx, input }) => {
    // Build date filter
    const dateFilter: Record<string, Date> = {};
    if (input?.dateFrom) dateFilter.gte = new Date(input.dateFrom);
    if (input?.dateTo) {
      const to = new Date(input.dateTo);
      to.setHours(23, 59, 59, 999); // include the entire day
      dateFilter.lte = to;
    }
    const createdAtFilter = Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {};

    // Fetch all assistant messages with a model (cost-bearing actions)
    const allMessages = await ctx.prisma.aIMessage.findMany({
      where: {
        role: "assistant",
        model: { not: null },
        ...createdAtFilter,
      },
      select: {
        model: true,
        costUnits: true,
        session: {
          select: {
            userId: true,
            projectId: true,
            user: { select: { name: true, email: true } },
            project: {
              select: {
                name: true,
                workspaceId: true,
                workspace: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    // Aggregate by model
    const modelAgg = new Map<string, { count: number; cost: number }>();
    // Aggregate by user
    const userAgg = new Map<string, { name: string; email: string; count: number; cost: number }>();
    // Aggregate by project
    const projectAgg = new Map<string, { name: string; workspaceName: string; count: number; cost: number }>();
    // Aggregate by workspace
    const wsAgg = new Map<string, { name: string; count: number; cost: number }>();

    for (const msg of allMessages) {
      const session = msg.session;
      const rawModel = msg.model ?? "unknown";
      // Normalize model name: resolve slug → id (e.g. "google/nano-banana-pro" → "nano-banana-pro")
      const modelEntry = getModelById(rawModel);
      const model = modelEntry?.id ?? rawModel;
      // ALWAYS use registry cost as the source of truth — stored costUnits may have stale pricing
      const cost = modelEntry?.costPerRun ?? (msg.costUnits ?? 0);

      // Model
      const mEntry = modelAgg.get(model) ?? { count: 0, cost: 0 };
      mEntry.count += 1;
      mEntry.cost += cost;
      modelAgg.set(model, mEntry);

      // User
      const uid = session.userId;
      const uEntry = userAgg.get(uid) ?? { name: session.user.name ?? "—", email: session.user.email ?? "", count: 0, cost: 0 };
      uEntry.count += 1;
      uEntry.cost += cost;
      userAgg.set(uid, uEntry);

      // Project
      const pid = session.projectId;
      const pEntry = projectAgg.get(pid) ?? {
        name: session.project.name ?? "—",
        workspaceName: session.project.workspace?.name ?? "—",
        count: 0,
        cost: 0,
      };
      pEntry.count += 1;
      pEntry.cost += cost;
      projectAgg.set(pid, pEntry);

      // Workspace
      const wid = session.project.workspaceId;
      if (wid) {
        const wEntry = wsAgg.get(wid) ?? { name: session.project.workspace?.name ?? "—", count: 0, cost: 0 };
        wEntry.count += 1;
        wEntry.cost += cost;
        wsAgg.set(wid, wEntry);
      }
    }

    return {
      byModel: Array.from(modelAgg.entries())
        .map(([model, d]) => ({ model, ...d }))
        .sort((a, b) => b.count - a.count),
      byUser: Array.from(userAgg.entries())
        .map(([id, d]) => ({ id, ...d }))
        .sort((a, b) => b.cost - a.cost),
      byProject: Array.from(projectAgg.entries())
        .map(([id, d]) => ({ id, ...d }))
        .sort((a, b) => b.cost - a.cost),
      byWorkspace: Array.from(wsAgg.entries())
        .map(([id, d]) => ({ id, ...d }))
        .sort((a, b) => b.cost - a.cost),
    };
  }),

  /** Update user's global role */
  updateUserRole: superAdminProcedure
    .input(
      z.object({
        userId: z.string(),
        role: z.enum(["SUPER_ADMIN", "USER"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Prevent self-demotion
      if (input.userId === ctx.user.id && input.role !== "SUPER_ADMIN") {
        throw new (await import("@trpc/server")).TRPCError({
          code: "BAD_REQUEST",
          message: "Нельзя снять роль супер-администратора с самого себя",
        });
      }

      // Ensure at least one SUPER_ADMIN remains
      if (input.role === "USER") {
        const adminCount = await ctx.prisma.user.count({ where: { role: "SUPER_ADMIN" } });
        if (adminCount <= 1) {
          throw new (await import("@trpc/server")).TRPCError({
            code: "BAD_REQUEST",
            message: "Должен остаться хотя бы один супер-администратор",
          });
        }
      }

      const user = await ctx.prisma.user.update({
        where: { id: input.userId },
        data: { role: input.role },
        select: { id: true, name: true, role: true },
      });

      return user;
    }),
});
