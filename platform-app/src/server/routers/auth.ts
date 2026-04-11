/**
 * Auth Router
 *
 * Provides session info to the client.
 * Actual authentication flow is handled by NextAuth route handlers.
 */

import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "../trpc";
import { getModelById } from "@/lib/ai-models";

export const authRouter = createTRPCRouter({
  /** Get current session info */
  getSession: publicProcedure.query(({ ctx }) => {
    return ctx.session;
  }),

  /** Get current user with workspace memberships */
  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: ctx.user.id },
      include: {
        memberships: {
          include: {
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
                businessUnit: true,
                logoUrl: true,
              },
            },
          },
        },
        accounts: {
          select: {
            provider: true,
          },
        },
      },
    });

    return user;
  }),

  /** Update current user's profile */
  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100).optional(),
        avatarUrl: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl;

      const user = await ctx.prisma.user.update({
        where: { id: ctx.user.id },
        data,
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          email: true,
        },
      });

      return user;
    }),

  /** Get current user's AI usage statistics */
  myStats: protectedProcedure.query(async ({ ctx }) => {
    // Get all sessions for this user
    const sessions = await ctx.prisma.aISession.findMany({
      where: { userId: ctx.user.id },
      select: { id: true },
    });

    const sessionIds = sessions.map(s => s.id);

    if (sessionIds.length === 0) {
      return {
        totalGenerations: 0,
        totalCost: 0,
        topModels: [],
      };
    }

    // Get all assistant messages with models
    const messages = await ctx.prisma.aIMessage.findMany({
      where: {
        sessionId: { in: sessionIds },
        role: "assistant",
        model: { not: null },
      },
      select: {
        model: true,
        costUnits: true,
      },
    });

    // Aggregate
    let totalCost = 0;
    const modelAgg = new Map<string, { count: number; cost: number }>();

    for (const msg of messages) {
      const modelEntry = getModelById(msg.model ?? "");
      const cost = modelEntry?.costPerRun ?? (msg.costUnits ?? 0);
      totalCost += cost;

      const modelId = modelEntry?.id ?? msg.model ?? "unknown";
      const modelName = modelEntry?.label ?? modelId;
      const existing = modelAgg.get(modelName) ?? { count: 0, cost: 0 };
      existing.count += 1;
      existing.cost += cost;
      modelAgg.set(modelName, existing);
    }

    const topModels = Array.from(modelAgg.entries())
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalGenerations: messages.length,
      totalCost,
      topModels,
    };
  }),
});
