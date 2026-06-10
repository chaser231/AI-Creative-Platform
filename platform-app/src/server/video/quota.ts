/**
 * Video generation quota logic (server-only).
 *
 * Daily per-user limits per model. The source of truth for limits is the
 * VideoModelQuota table; rows are lazily seeded from tier defaults
 * (lib/video-quotas.ts) on first read so admins always see the full model
 * list in the panel and can edit limits without a deploy.
 *
 * Usage counting is a plain `count()` over VideoJob — non-FAILED jobs
 * created since UTC midnight. No counters to keep in sync; failed
 * generations are not charged against the user.
 */

import { prisma } from "@/server/db";
import { VIDEO_MODEL_REGISTRY, getVideoModelById } from "@/lib/video-models";
import { VIDEO_TIER_DEFAULT_DAILY_LIMITS } from "@/lib/video-quotas";

export interface VideoQuotaState {
    modelId: string;
    enabled: boolean;
    /** null = unlimited */
    dailyLimit: number | null;
    usedToday: number;
    /** null = unlimited */
    remaining: number | null;
    /** UTC midnight after which the counter resets (ISO). */
    resetAt: string;
}

export function startOfUtcDay(now = new Date()): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function nextUtcMidnight(now = new Date()): Date {
    const start = startOfUtcDay(now);
    return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Ensure every registry model has a VideoModelQuota row (seeded from tier
 * defaults). Idempotent and cheap: a single findMany + createMany(skipDuplicates).
 */
export async function ensureQuotaRows(): Promise<void> {
    const existing = await prisma.videoModelQuota.findMany({ select: { modelId: true } });
    const have = new Set(existing.map((q) => q.modelId));
    const missing = VIDEO_MODEL_REGISTRY.filter((m) => !have.has(m.id));
    if (missing.length === 0) return;
    await prisma.videoModelQuota.createMany({
        data: missing.map((m) => ({
            modelId: m.id,
            dailyLimit: VIDEO_TIER_DEFAULT_DAILY_LIMITS[m.tier],
            enabled: true,
        })),
        skipDuplicates: true,
    });
}

/** Quota state for one user across all registry models (for the picker UI). */
export async function getQuotaStatesForUser(userId: string): Promise<VideoQuotaState[]> {
    await ensureQuotaRows();
    const [quotas, usage] = await Promise.all([
        prisma.videoModelQuota.findMany(),
        prisma.videoJob.groupBy({
            by: ["modelId"],
            where: {
                userId,
                createdAt: { gte: startOfUtcDay() },
                status: { not: "FAILED" },
            },
            _count: { _all: true },
        }),
    ]);
    const usedByModel = new Map(usage.map((u) => [u.modelId, u._count._all]));
    const resetAt = nextUtcMidnight().toISOString();

    return VIDEO_MODEL_REGISTRY.map((m) => {
        const quota = quotas.find((q) => q.modelId === m.id);
        const dailyLimit = quota?.dailyLimit ?? VIDEO_TIER_DEFAULT_DAILY_LIMITS[m.tier];
        const usedToday = usedByModel.get(m.id) ?? 0;
        return {
            modelId: m.id,
            enabled: quota?.enabled ?? true,
            dailyLimit,
            usedToday,
            remaining: dailyLimit === null ? null : Math.max(0, dailyLimit - usedToday),
            resetAt,
        };
    });
}

export interface QuotaCheckResult {
    allowed: boolean;
    reason?: "model-disabled" | "quota-exceeded";
    dailyLimit: number | null;
    usedToday: number;
    remaining: number | null;
    resetAt: string;
}

/** Check whether `userId` may start one more generation with `modelId`. */
export async function checkVideoQuota(userId: string, modelId: string): Promise<QuotaCheckResult> {
    const model = getVideoModelById(modelId);
    if (!model) {
        throw new Error(`Unknown video model: ${modelId}`);
    }
    await ensureQuotaRows();
    const quota = await prisma.videoModelQuota.findUnique({ where: { modelId } });
    const dailyLimit = quota?.dailyLimit ?? VIDEO_TIER_DEFAULT_DAILY_LIMITS[model.tier];
    const resetAt = nextUtcMidnight().toISOString();

    if (quota && !quota.enabled) {
        return { allowed: false, reason: "model-disabled", dailyLimit, usedToday: 0, remaining: 0, resetAt };
    }

    if (dailyLimit === null) {
        return { allowed: true, dailyLimit, usedToday: 0, remaining: null, resetAt };
    }

    const usedToday = await prisma.videoJob.count({
        where: {
            userId,
            modelId,
            createdAt: { gte: startOfUtcDay() },
            status: { not: "FAILED" },
        },
    });

    const remaining = Math.max(0, dailyLimit - usedToday);
    if (remaining <= 0) {
        return { allowed: false, reason: "quota-exceeded", dailyLimit, usedToday, remaining: 0, resetAt };
    }
    return { allowed: true, dailyLimit, usedToday, remaining, resetAt };
}
