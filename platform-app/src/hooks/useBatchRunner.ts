/**
 * useBatchRunner — wires the pure batch runner (lib/batchGenerationRunner.ts)
 * to tRPC mutations, the client image generation queue and S3 persistence.
 *
 * The view creates/loads a batch via tRPC and then hands the PENDING items to
 * `enqueueItems`, which schedules one queue job per item (respecting
 * MAX_CONCURRENT_IMAGE_JOBS). Status is written back to the DB so the run
 * survives a refresh; `resume` simply re-enqueues whatever is still PENDING.
 */

"use client";

import { useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useGenerationQueueStore } from "@/store/generationQueueStore";
import { persistImageToS3 } from "@/utils/imageUpload";
import { getModelById } from "@/lib/ai-models";
import { parseGenerationError } from "@/lib/parseGenerationError";
import {
    processBatchItem,
    type BatchGenerationConfig,
    type BatchItemRef,
    type ProcessItemDeps,
} from "@/lib/batchGenerationRunner";

export function useBatchRunner(projectId: string) {
    const utils = trpc.useUtils();
    const updateItemMutation = trpc.batch.updateItem.useMutation();
    const saveAssetMutation = trpc.asset.saveGeneratedImage.useMutation();
    const enqueue = useGenerationQueueStore((s) => s.enqueue);

    // Batches the user cancelled this session — checked before each item runs
    // so already-queued jobs short-circuit to SKIPPED instead of spending a
    // generation.
    const cancelledRef = useRef<Set<string>>(new Set());

    const fetchJson = useCallback(
        async (endpoint: string, body: Record<string, unknown>) => {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            return res.json();
        },
        [],
    );

    const buildDeps = useCallback(
        (batchId: string): ProcessItemDeps => ({
            fetchJson,
            persist: (url, pid) => persistImageToS3(url, pid),
            saveAsset: async (args) => {
                await saveAssetMutation.mutateAsync({
                    projectId: args.projectId,
                    url: args.url,
                    prompt: args.prompt,
                    model: args.model,
                    source: "multi-generation",
                });
            },
            updateItem: async (args) => {
                await updateItemMutation.mutateAsync(args);
            },
            costForModel: (model) => getModelById(model)?.costPerRun ?? 0,
            isCancelled: () => cancelledRef.current.has(batchId),
            describeError: (e) => parseGenerationError(e),
        }),
        [fetchJson, saveAssetMutation, updateItemMutation],
    );

    /** Schedule queue jobs for the given items of a batch. */
    const enqueueItems = useCallback(
        (
            batchId: string,
            items: BatchItemRef[],
            config: BatchGenerationConfig,
            sessionId?: string,
        ) => {
            cancelledRef.current.delete(batchId);
            const deps = buildDeps(batchId);
            // Per-call token keeps queue job ids unique across re-runs / retries
            // so the queue badge never patches a stale entry.
            const runToken = Math.random().toString(36).slice(2, 8);

            for (const item of items) {
                enqueue(
                    {
                        id: `batch-${batchId}-${item.id}-${runToken}`,
                        projectId,
                        surface: "multi",
                        sessionId,
                        prompt: config.prompt,
                        imageCount: config.countPerItem,
                    },
                    async () => {
                        try {
                            await processBatchItem(deps, item, config);
                        } finally {
                            await Promise.all([
                                utils.batch.getById.invalidate({ batchId }),
                                utils.asset.listByProject.invalidate({
                                    projectId,
                                }),
                            ]);
                        }
                    },
                );
            }
        },
        [enqueue, projectId, buildDeps, utils],
    );

    /** Mark a batch cancelled so queued items skip instead of generating. */
    const cancel = useCallback((batchId: string) => {
        cancelledRef.current.add(batchId);
    }, []);

    return { enqueueItems, cancel };
}
