/**
 * Batch Router — "Мульти-генерация" durable state.
 *
 * A BatchGeneration row is the source of truth for a batch run (prompt, model,
 * shared settings snapshot and aggregate progress). The browser orchestrates
 * the actual per-item generation through the client-side image queue
 * (lib/imageGenerationQueue.ts) and writes each item's status back here via
 * `updateItem`, so a partially completed batch survives a refresh.
 *
 * Generation itself never runs in tRPC — it goes through the existing REST
 * endpoints (/api/ai/generate, /api/ai/image-edit). This router only persists
 * intent and progress.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import type { BatchGeneration, BatchGenerationItem } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { assertProjectAccess, type AuthzCtx } from "@/server/authz/guards";
import { MAX_BATCH_ITEMS } from "@/lib/generation-limits";

// ─── Input schemas ───────────────────────────────────────

const batchModeSchema = z.enum(["img2img", "t2i"]);
const itemStatusSchema = z.enum([
    "PENDING",
    "RUNNING",
    "COMPLETED",
    "FAILED",
    "SKIPPED",
]);
const batchStatusSchema = z.enum([
    "DRAFT",
    "RUNNING",
    "PAUSED",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
]);
const sourceTypeSchema = z.enum(["upload", "zip", "yadisk", "url"]);

const newItemSchema = z.object({
    sourceUrl: z.string().url(),
    sourceType: sourceTypeSchema.default("upload"),
    sourceName: z.string().max(512).optional(),
});

// Settings are stored as an opaque snapshot consumed only by the client
// runner. We keep the shape loose on purpose so adding a knob doesn't require
// a migration; the known keys are documented on the Prisma model.
const settingsSchema = z.record(z.string(), z.unknown());

// ─── Views (parse Json columns into typed shapes for the client) ─────

function itemView(item: BatchGenerationItem) {
    return {
        id: item.id,
        batchId: item.batchId,
        index: item.index,
        sourceType: item.sourceType,
        sourceUrl: item.sourceUrl,
        sourceName: item.sourceName,
        status: item.status,
        resultUrls: Array.isArray(item.resultUrls)
            ? (item.resultUrls as unknown[]).filter(
                  (u): u is string => typeof u === "string",
              )
            : [],
        error: item.error,
        costUnits: item.costUnits,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
    };
}

function batchView(
    batch: BatchGeneration & { items?: BatchGenerationItem[] },
) {
    return {
        id: batch.id,
        projectId: batch.projectId,
        workspaceId: batch.workspaceId,
        sessionId: batch.sessionId,
        name: batch.name,
        status: batch.status,
        mode: batch.mode,
        model: batch.model,
        prompt: batch.prompt,
        settings:
            batch.settings && typeof batch.settings === "object"
                ? (batch.settings as Record<string, unknown>)
                : null,
        totalItems: batch.totalItems,
        completedItems: batch.completedItems,
        failedItems: batch.failedItems,
        costUnits: batch.costUnits,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
        items: batch.items ? batch.items.map(itemView) : undefined,
    };
}

// ─── Access helper ───────────────────────────────────────

/**
 * Load a batch and assert the caller can access its project's workspace.
 * `minRole` "USER" gates mutations, "VIEWER" gates reads.
 */
async function loadBatchWithAccess(
    ctx: AuthzCtx,
    batchId: string,
    minRole: "VIEWER" | "USER",
): Promise<BatchGeneration> {
    const batch = await ctx.prisma.batchGeneration.findUnique({
        where: { id: batchId },
    });
    if (!batch) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Батч не найден" });
    }
    await assertProjectAccess(ctx, batch.projectId, minRole);
    return batch;
}

/**
 * Recompute aggregate progress counters from the batch's items and flip the
 * batch to COMPLETED once nothing is left PENDING/RUNNING. Called after every
 * item write so the dashboard / progress bar stay consistent without the
 * client having to track them.
 */
async function recomputeBatchProgress(
    ctx: AuthzCtx,
    batchId: string,
): Promise<BatchGeneration> {
    const items = await ctx.prisma.batchGenerationItem.findMany({
        where: { batchId },
        select: { status: true, costUnits: true },
    });

    let completed = 0;
    let failed = 0;
    let pendingOrRunning = 0;
    let cost = 0;
    for (const it of items) {
        if (it.status === "COMPLETED") completed += 1;
        else if (it.status === "FAILED") failed += 1;
        else if (it.status === "PENDING" || it.status === "RUNNING")
            pendingOrRunning += 1;
        cost += it.costUnits ?? 0;
    }

    const current = await ctx.prisma.batchGeneration.findUnique({
        where: { id: batchId },
        select: { status: true },
    });

    // Only auto-advance an actively running batch; never resurrect a
    // CANCELLED/PAUSED one from a late item write.
    const nextStatus =
        current?.status === "RUNNING" && pendingOrRunning === 0
            ? "COMPLETED"
            : undefined;

    return ctx.prisma.batchGeneration.update({
        where: { id: batchId },
        data: {
            completedItems: completed,
            failedItems: failed,
            costUnits: cost,
            ...(nextStatus ? { status: nextStatus } : {}),
        },
    });
}

// ─── Router ──────────────────────────────────────────────

export const batchRouter = createTRPCRouter({
    /** Create a batch with its initial items. Defaults to RUNNING so the
     * client can immediately start orchestrating; pass status DRAFT to stage. */
    create: protectedProcedure
        .input(
            z.object({
                projectId: z.string(),
                sessionId: z.string().optional(),
                name: z.string().max(200).optional(),
                mode: batchModeSchema,
                model: z.string().min(1),
                prompt: z.string().max(8000).default(""),
                settings: settingsSchema.optional(),
                status: z.enum(["DRAFT", "RUNNING"]).default("RUNNING"),
                items: z.array(newItemSchema).min(1).max(MAX_BATCH_ITEMS),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const { project } = await assertProjectAccess(
                ctx,
                input.projectId,
                "USER",
            );

            const batch = await ctx.prisma.batchGeneration.create({
                data: {
                    userId: ctx.user.id,
                    workspaceId: project.workspaceId,
                    projectId: input.projectId,
                    sessionId: input.sessionId,
                    name: input.name,
                    status: input.status,
                    mode: input.mode,
                    model: input.model,
                    prompt: input.prompt,
                    settings:
                        input.settings === undefined
                            ? undefined
                            : (input.settings as Prisma.InputJsonValue),
                    totalItems: input.items.length,
                    items: {
                        create: input.items.map((it, i) => ({
                            index: i,
                            sourceUrl: it.sourceUrl,
                            sourceType: it.sourceType,
                            sourceName: it.sourceName,
                        })),
                    },
                },
                include: { items: { orderBy: { index: "asc" } } },
            });

            return batchView(batch);
        }),

    /** Full batch with items — used to hydrate the view and resume a run. */
    getById: protectedProcedure
        .input(z.object({ batchId: z.string() }))
        .query(async ({ ctx, input }) => {
            await loadBatchWithAccess(ctx, input.batchId, "VIEWER");
            const batch = await ctx.prisma.batchGeneration.findUnique({
                where: { id: input.batchId },
                include: { items: { orderBy: { index: "asc" } } },
            });
            if (!batch) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Батч не найден",
                });
            }
            return batchView(batch);
        }),

    /** Recent batches for a project (no items) — sidebar / history list. */
    listByProject: protectedProcedure
        .input(
            z.object({
                projectId: z.string(),
                limit: z.number().min(1).max(100).default(30),
            }),
        )
        .query(async ({ ctx, input }) => {
            await assertProjectAccess(ctx, input.projectId, "VIEWER");
            const batches = await ctx.prisma.batchGeneration.findMany({
                where: { projectId: input.projectId },
                orderBy: { createdAt: "desc" },
                take: input.limit,
            });
            return batches.map((b) => batchView(b));
        }),

    /** Append more items to an existing batch (continues the index sequence). */
    addItems: protectedProcedure
        .input(
            z.object({
                batchId: z.string(),
                items: z.array(newItemSchema).min(1).max(MAX_BATCH_ITEMS),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const batch = await loadBatchWithAccess(ctx, input.batchId, "USER");
            const existing = await ctx.prisma.batchGenerationItem.count({
                where: { batchId: batch.id },
            });
            if (existing + input.items.length > MAX_BATCH_ITEMS) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: `Лимит ${MAX_BATCH_ITEMS} изображений на батч`,
                });
            }

            await ctx.prisma.batchGenerationItem.createMany({
                data: input.items.map((it, i) => ({
                    batchId: batch.id,
                    index: existing + i,
                    sourceUrl: it.sourceUrl,
                    sourceType: it.sourceType,
                    sourceName: it.sourceName,
                })),
            });
            await ctx.prisma.batchGeneration.update({
                where: { id: batch.id },
                data: { totalItems: existing + input.items.length },
            });

            const updated = await ctx.prisma.batchGeneration.findUnique({
                where: { id: batch.id },
                include: { items: { orderBy: { index: "asc" } } },
            });
            return batchView(updated!);
        }),

    /** Remove one item (e.g. before a run starts). */
    removeItem: protectedProcedure
        .input(z.object({ itemId: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const item = await ctx.prisma.batchGenerationItem.findUnique({
                where: { id: input.itemId },
            });
            if (!item) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Элемент не найден",
                });
            }
            await loadBatchWithAccess(ctx, item.batchId, "USER");
            await ctx.prisma.batchGenerationItem.delete({
                where: { id: item.id },
            });
            const remaining = await ctx.prisma.batchGenerationItem.count({
                where: { batchId: item.batchId },
            });
            await ctx.prisma.batchGeneration.update({
                where: { id: item.batchId },
                data: { totalItems: remaining },
            });
            return recomputeBatchProgress(ctx, item.batchId).then(batchView);
        }),

    /**
     * Write back an item's status + results from the client runner. Recomputes
     * the batch's aggregate counters and auto-completes the batch when the last
     * item finishes.
     */
    updateItem: protectedProcedure
        .input(
            z.object({
                itemId: z.string(),
                status: itemStatusSchema,
                resultUrls: z.array(z.string().url()).optional(),
                error: z.string().max(2000).nullable().optional(),
                costUnits: z.number().nonnegative().nullable().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const item = await ctx.prisma.batchGenerationItem.findUnique({
                where: { id: input.itemId },
            });
            if (!item) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Элемент не найден",
                });
            }
            await loadBatchWithAccess(ctx, item.batchId, "USER");

            await ctx.prisma.batchGenerationItem.update({
                where: { id: item.id },
                data: {
                    status: input.status,
                    ...(input.resultUrls !== undefined
                        ? { resultUrls: input.resultUrls }
                        : {}),
                    ...(input.error !== undefined
                        ? { error: input.error }
                        : {}),
                    ...(input.costUnits !== undefined
                        ? { costUnits: input.costUnits }
                        : {}),
                },
            });

            const batch = await recomputeBatchProgress(ctx, item.batchId);
            const refreshed = await ctx.prisma.batchGenerationItem.findUnique({
                where: { id: item.id },
            });
            return { batch: batchView(batch), item: itemView(refreshed!) };
        }),

    /** Change the batch lifecycle status (run / pause / cancel / complete). */
    setStatus: protectedProcedure
        .input(
            z.object({
                batchId: z.string(),
                status: batchStatusSchema,
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const batch = await loadBatchWithAccess(ctx, input.batchId, "USER");

            // Cancelling a run drops any not-yet-started items so the progress
            // bar settles and the client stops enqueuing them.
            if (input.status === "CANCELLED") {
                await ctx.prisma.batchGenerationItem.updateMany({
                    where: { batchId: batch.id, status: "PENDING" },
                    data: { status: "SKIPPED" },
                });
            }

            await ctx.prisma.batchGeneration.update({
                where: { id: batch.id },
                data: { status: input.status },
            });
            return recomputeBatchProgress(ctx, batch.id).then((b) =>
                batchView(b),
            );
        }),

    /** Reset all FAILED items back to PENDING and re-arm the batch. */
    retryFailed: protectedProcedure
        .input(z.object({ batchId: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const batch = await loadBatchWithAccess(ctx, input.batchId, "USER");
            await ctx.prisma.batchGenerationItem.updateMany({
                where: { batchId: batch.id, status: "FAILED" },
                data: { status: "PENDING", error: null },
            });
            await ctx.prisma.batchGeneration.update({
                where: { id: batch.id },
                data: { status: "RUNNING" },
            });
            const updated = await ctx.prisma.batchGeneration.findUnique({
                where: { id: batch.id },
                include: { items: { orderBy: { index: "asc" } } },
            });
            // Refresh counters too (failed → 0 once moved back to pending).
            await recomputeBatchProgress(ctx, batch.id);
            return batchView(updated!);
        }),

    /** Delete a batch (cascades to its items). */
    delete: protectedProcedure
        .input(z.object({ batchId: z.string() }))
        .mutation(async ({ ctx, input }) => {
            await loadBatchWithAccess(ctx, input.batchId, "USER");
            await ctx.prisma.batchGeneration.delete({
                where: { id: input.batchId },
            });
            return { success: true };
        }),
});
