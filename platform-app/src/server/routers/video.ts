/**
 * Video Router — async video generation support procedures.
 *
 * Generation itself goes through REST (/api/ai/video/generate + jobs poll)
 * because tRPC batching is a poor fit for long-poll flows. This router
 * covers everything around it: quota visibility for the picker, job-list
 * restore after reload, and the admin quota panel.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure, superAdminProcedure } from "../trpc";
import { assertProjectAccess } from "@/server/authz/guards";
import { getQuotaStatesForUser, ensureQuotaRows, startOfUtcDay } from "@/server/video/quota";
import { toVideoJobView } from "@/server/video/jobs";
import { VIDEO_MODEL_REGISTRY } from "@/lib/video-models";
import { VIDEO_TIER_DEFAULT_DAILY_LIMITS } from "@/lib/video-quotas";

export const videoRouter = createTRPCRouter({
    /** Remaining daily quota per model for the current user (model picker badges). */
    myQuotas: protectedProcedure.query(async ({ ctx }) => {
        return getQuotaStatesForUser(ctx.user.id);
    }),

    /**
     * Jobs for a project — lets the workspace restore pending generations
     * after a page reload (the client resumes polling active ones).
     */
    listJobs: protectedProcedure
        .input(z.object({
            projectId: z.string(),
            limit: z.number().min(1).max(100).default(50),
        }))
        .query(async ({ ctx, input }) => {
            await assertProjectAccess(ctx, input.projectId, "VIEWER");
            const jobs = await ctx.prisma.videoJob.findMany({
                where: { projectId: input.projectId },
                orderBy: { createdAt: "desc" },
                take: input.limit,
            });
            return jobs.map(toVideoJobView);
        }),

    // ─── Admin: quota management ────────────────────────────────────────

    /** All models with current limits + today's global usage (admin panel). */
    listQuotas: superAdminProcedure.query(async ({ ctx }) => {
        await ensureQuotaRows();
        const [quotas, usage] = await Promise.all([
            ctx.prisma.videoModelQuota.findMany(),
            ctx.prisma.videoJob.groupBy({
                by: ["modelId"],
                where: { createdAt: { gte: startOfUtcDay() }, status: { not: "FAILED" } },
                _count: { _all: true },
            }),
        ]);
        const usedByModel = new Map(usage.map((u) => [u.modelId, u._count._all]));
        return VIDEO_MODEL_REGISTRY.map((m) => {
            const quota = quotas.find((q) => q.modelId === m.id);
            return {
                modelId: m.id,
                label: m.label,
                tier: m.tier,
                pricePerSecondUsd: m.pricePerSecondUsd,
                dailyLimit: quota?.dailyLimit ?? VIDEO_TIER_DEFAULT_DAILY_LIMITS[m.tier],
                enabled: quota?.enabled ?? true,
                usedToday: usedByModel.get(m.id) ?? 0,
            };
        });
    }),

    /** Update a model's daily limit / enabled flag. */
    updateQuota: superAdminProcedure
        .input(z.object({
            modelId: z.string(),
            dailyLimit: z.number().int().min(0).nullable(),
            enabled: z.boolean(),
        }))
        .mutation(async ({ ctx, input }) => {
            if (!VIDEO_MODEL_REGISTRY.some((m) => m.id === input.modelId)) {
                throw new Error(`Unknown video model: ${input.modelId}`);
            }
            return ctx.prisma.videoModelQuota.upsert({
                where: { modelId: input.modelId },
                create: { modelId: input.modelId, dailyLimit: input.dailyLimit, enabled: input.enabled },
                update: { dailyLimit: input.dailyLimit, enabled: input.enabled },
            });
        }),

    /** Aggregate video generation stats for the admin dashboard KPIs. */
    stats: superAdminProcedure.query(async ({ ctx }) => {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const [today, week, completed] = await Promise.all([
            ctx.prisma.videoJob.count({ where: { createdAt: { gte: startOfUtcDay() }, status: { not: "FAILED" } } }),
            ctx.prisma.videoJob.count({ where: { createdAt: { gte: weekAgo }, status: { not: "FAILED" } } }),
            ctx.prisma.videoJob.aggregate({
                where: { status: "COMPLETED" },
                _count: { _all: true },
                _sum: { costUnits: true },
            }),
        ]);
        return {
            jobsToday: today,
            jobsThisWeek: week,
            totalCompleted: completed._count._all,
            totalCostUsd: completed._sum.costUnits ?? 0,
        };
    }),
});
