import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
    prisma: {
        videoModelQuota: {
            findMany: vi.fn(),
            findUnique: vi.fn(),
            createMany: vi.fn(),
        },
        videoJob: {
            count: vi.fn(),
            groupBy: vi.fn(),
        },
    },
}));

import { prisma } from "@/server/db";
import {
    checkVideoQuota,
    ensureQuotaRows,
    getQuotaStatesForUser,
    nextUtcMidnight,
    startOfUtcDay,
} from "../quota";
import { VIDEO_MODEL_REGISTRY } from "@/lib/video-models";
import { VIDEO_TIER_DEFAULT_DAILY_LIMITS } from "@/lib/video-quotas";

const mockedPrisma = vi.mocked(prisma, true);

function seedAllQuotaRows() {
    mockedPrisma.videoModelQuota.findMany.mockResolvedValue(
        VIDEO_MODEL_REGISTRY.map((m) => ({
            id: `q-${m.id}`,
            modelId: m.id,
            dailyLimit: VIDEO_TIER_DEFAULT_DAILY_LIMITS[m.tier],
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        })),
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    seedAllQuotaRows();
    mockedPrisma.videoJob.groupBy.mockResolvedValue([] as never);
    mockedPrisma.videoJob.count.mockResolvedValue(0);
});

describe("startOfUtcDay / nextUtcMidnight", () => {
    it("computes UTC day boundaries", () => {
        const now = new Date("2026-06-10T15:42:11.000Z");
        expect(startOfUtcDay(now).toISOString()).toBe("2026-06-10T00:00:00.000Z");
        expect(nextUtcMidnight(now).toISOString()).toBe("2026-06-11T00:00:00.000Z");
    });
});

describe("ensureQuotaRows", () => {
    it("creates rows only for models missing from the table", async () => {
        const [first, ...rest] = VIDEO_MODEL_REGISTRY;
        mockedPrisma.videoModelQuota.findMany.mockResolvedValueOnce(
            rest.map((m) => ({
                id: `q-${m.id}`,
                modelId: m.id,
                dailyLimit: null,
                enabled: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            })),
        );
        await ensureQuotaRows();
        expect(mockedPrisma.videoModelQuota.createMany).toHaveBeenCalledWith({
            data: [
                {
                    modelId: first.id,
                    dailyLimit: VIDEO_TIER_DEFAULT_DAILY_LIMITS[first.tier],
                    enabled: true,
                },
            ],
            skipDuplicates: true,
        });
    });

    it("is a no-op when all rows exist", async () => {
        await ensureQuotaRows();
        expect(mockedPrisma.videoModelQuota.createMany).not.toHaveBeenCalled();
    });
});

describe("checkVideoQuota", () => {
    const premiumModel = VIDEO_MODEL_REGISTRY.find((m) => m.tier === "premium")!;
    const standardModel = VIDEO_MODEL_REGISTRY.find((m) => m.tier === "standard")!;

    it("throws on unknown model", async () => {
        await expect(checkVideoQuota("u1", "no-such-model")).rejects.toThrow(/Unknown video model/);
    });

    it("allows unlimited models without counting jobs", async () => {
        mockedPrisma.videoModelQuota.findUnique.mockResolvedValue({
            id: "q",
            modelId: standardModel.id,
            dailyLimit: null,
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const res = await checkVideoQuota("u1", standardModel.id);
        expect(res.allowed).toBe(true);
        expect(res.remaining).toBeNull();
        expect(mockedPrisma.videoJob.count).not.toHaveBeenCalled();
    });

    it("blocks disabled models regardless of usage", async () => {
        mockedPrisma.videoModelQuota.findUnique.mockResolvedValue({
            id: "q",
            modelId: premiumModel.id,
            dailyLimit: 10,
            enabled: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const res = await checkVideoQuota("u1", premiumModel.id);
        expect(res.allowed).toBe(false);
        expect(res.reason).toBe("model-disabled");
    });

    it("allows when under the daily limit and reports remaining", async () => {
        mockedPrisma.videoModelQuota.findUnique.mockResolvedValue({
            id: "q",
            modelId: premiumModel.id,
            dailyLimit: 10,
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        mockedPrisma.videoJob.count.mockResolvedValue(7);
        const res = await checkVideoQuota("u1", premiumModel.id);
        expect(res).toMatchObject({ allowed: true, dailyLimit: 10, usedToday: 7, remaining: 3 });
        // Usage query counts only non-FAILED jobs since UTC midnight for this user+model.
        expect(mockedPrisma.videoJob.count).toHaveBeenCalledWith({
            where: expect.objectContaining({
                userId: "u1",
                modelId: premiumModel.id,
                status: { not: "FAILED" },
            }),
        });
    });

    it("blocks when the daily limit is exhausted", async () => {
        mockedPrisma.videoModelQuota.findUnique.mockResolvedValue({
            id: "q",
            modelId: premiumModel.id,
            dailyLimit: 10,
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        mockedPrisma.videoJob.count.mockResolvedValue(10);
        const res = await checkVideoQuota("u1", premiumModel.id);
        expect(res).toMatchObject({
            allowed: false,
            reason: "quota-exceeded",
            remaining: 0,
            usedToday: 10,
        });
    });

    it("blocks at limit 0 (admin fully disabled generation)", async () => {
        mockedPrisma.videoModelQuota.findUnique.mockResolvedValue({
            id: "q",
            modelId: premiumModel.id,
            dailyLimit: 0,
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const res = await checkVideoQuota("u1", premiumModel.id);
        expect(res.allowed).toBe(false);
        expect(res.reason).toBe("quota-exceeded");
    });

    it("falls back to tier defaults when no quota row exists", async () => {
        mockedPrisma.videoModelQuota.findUnique.mockResolvedValue(null);
        mockedPrisma.videoJob.count.mockResolvedValue(0);
        const res = await checkVideoQuota("u1", premiumModel.id);
        expect(res.dailyLimit).toBe(VIDEO_TIER_DEFAULT_DAILY_LIMITS.premium);
    });
});

describe("getQuotaStatesForUser", () => {
    it("returns a state per registry model with per-user usage applied", async () => {
        const premiumModel = VIDEO_MODEL_REGISTRY.find((m) => m.tier === "premium")!;
        mockedPrisma.videoJob.groupBy.mockResolvedValue([
            { modelId: premiumModel.id, _count: { _all: 4 } },
        ] as never);

        const states = await getQuotaStatesForUser("u1");
        expect(states).toHaveLength(VIDEO_MODEL_REGISTRY.length);

        const premiumState = states.find((s) => s.modelId === premiumModel.id)!;
        const limit = VIDEO_TIER_DEFAULT_DAILY_LIMITS.premium!;
        expect(premiumState.usedToday).toBe(4);
        expect(premiumState.remaining).toBe(limit - 4);

        const untouched = states.find((s) => s.modelId !== premiumModel.id)!;
        expect(untouched.usedToday).toBe(0);
    });
});
