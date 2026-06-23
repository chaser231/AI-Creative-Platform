"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, RefreshCw, StopCircle, Layers } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { usePhotoStore } from "@/store/photoStore";
import { useBatchRunner } from "@/hooks/useBatchRunner";
import { useStylePresets } from "@/hooks/useStylePresets";
import { getImagePresetPromptSuffixForModel } from "@/lib/stylePresets";
import type { LoraWeight } from "@/lib/ai-providers";
import type {
    BatchGenerationConfig,
    BatchMode,
} from "@/lib/batchGenerationRunner";
import type { ImportedSource } from "@/utils/multiGenImport";
import { exportBatchResultsZip } from "@/utils/batchExport";
import { MultiGenSourcePanel } from "./MultiGenSourcePanel";
import { MultiGenInputGrid, type InputCell } from "./MultiGenInputGrid";
import { MultiGenProgressBar } from "./MultiGenProgressBar";
import { MultiGenResultsGrid, type ResultCell } from "./MultiGenResultsGrid";
import {
    MultiGenSettingsBar,
    defaultMultiGenSettings,
    type MultiGenSettings,
} from "./MultiGenSettingsBar";

type BatchView = RouterOutputs["batch"]["getById"];

interface PhotoMultiGenViewProps {
    projectId: string;
}

export function PhotoMultiGenView({ projectId }: PhotoMultiGenViewProps) {
    const activeSessionId = usePhotoStore((s) => s.activeSessionId);
    const activeBatchId = usePhotoStore((s) => s.activeBatchId);
    const setActiveBatchId = usePhotoStore((s) => s.setActiveBatchId);

    const { imagePresets } = useStylePresets();
    const { enqueueItems, cancel } = useBatchRunner(projectId);

    const [settings, setSettings] = useState<MultiGenSettings>(
        defaultMultiGenSettings,
    );
    const [draftSources, setDraftSources] = useState<ImportedSource[]>([]);
    const [exporting, setExporting] = useState(false);

    const utils = trpc.useUtils();
    const createMutation = trpc.batch.create.useMutation();
    const setStatusMutation = trpc.batch.setStatus.useMutation();
    const retryMutation = trpc.batch.retryFailed.useMutation();

    const batchQuery = trpc.batch.getById.useQuery(
        { batchId: activeBatchId ?? "" },
        {
            enabled: !!activeBatchId,
            refetchInterval: (query) => {
                const data = query.state.data;
                return data?.status === "RUNNING" ? 4000 : false;
            },
        },
    );
    const batch = batchQuery.data;

    // Batches already handed to the queue this mount — prevents the resume
    // effect from double-enqueuing after invalidations.
    const enqueuedRef = useRef<Set<string>>(new Set());

    const updateSettings = (patch: Partial<MultiGenSettings>) =>
        setSettings((prev) => ({ ...prev, ...patch }));

    const resolvePrompt = (s: MultiGenSettings): string => {
        const suffix = getImagePresetPromptSuffixForModel(
            s.imageStyleId,
            s.model,
            imagePresets,
        );
        return suffix ? `${s.prompt}. Style: ${suffix}` : s.prompt;
    };

    const configFromSettings = (s: MultiGenSettings): BatchGenerationConfig => ({
        projectId,
        mode: s.mode,
        model: s.model,
        prompt: resolvePrompt(s),
        aspectRatio: s.mode === "t2i" ? s.aspectRatio : undefined,
        scale: s.mode === "t2i" ? s.scale : undefined,
        countPerItem: s.countPerItem,
        loraFields: s.loras.length > 0 ? { loras: s.loras } : undefined,
    });

    const configFromBatch = (b: BatchView): BatchGenerationConfig => {
        const s = (b.settings ?? {}) as Record<string, unknown>;
        const loras = Array.isArray(s.loras)
            ? (s.loras as LoraWeight[])
            : undefined;
        return {
            projectId,
            mode: b.mode as BatchMode,
            model: b.model,
            prompt: b.prompt,
            aspectRatio:
                b.mode === "t2i" ? (s.aspectRatio as string | undefined) : undefined,
            scale: b.mode === "t2i" ? (s.scale as string | undefined) : undefined,
            countPerItem:
                typeof s.countPerItem === "number" ? s.countPerItem : 1,
            loraFields: loras && loras.length > 0 ? { loras } : undefined,
        };
    };

    // Resume a RUNNING batch after a reload: re-enqueue whatever is still PENDING.
    useEffect(() => {
        if (!batch || !batch.items) return;
        if (batch.status !== "RUNNING") return;
        if (enqueuedRef.current.has(batch.id)) return;
        enqueuedRef.current.add(batch.id);
        const pending = batch.items.filter((it) => it.status === "PENDING");
        if (pending.length === 0) return;
        enqueueItems(
            batch.id,
            pending.map((it) => ({ id: it.id, sourceUrl: it.sourceUrl })),
            configFromBatch(batch),
            batch.sessionId ?? undefined,
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [batch?.id, batch?.status, batch?.items]);

    const handleImported = (sources: ImportedSource[]) => {
        setDraftSources((prev) => {
            const seen = new Set(prev.map((s) => s.sourceUrl));
            const next = [...prev];
            for (const s of sources) {
                if (!seen.has(s.sourceUrl)) {
                    next.push(s);
                    seen.add(s.sourceUrl);
                }
            }
            return next;
        });
    };

    const handleRemoveDraft = (sourceUrl: string) => {
        setDraftSources((prev) => prev.filter((s) => s.sourceUrl !== sourceUrl));
    };

    const handleRun = async () => {
        if (draftSources.length === 0 || !settings.prompt.trim()) return;
        const config = configFromSettings(settings);
        const created = await createMutation.mutateAsync({
            projectId,
            sessionId: activeSessionId ?? undefined,
            mode: settings.mode,
            model: settings.model,
            prompt: config.prompt,
            settings: {
                aspectRatio: settings.aspectRatio,
                scale: settings.scale,
                countPerItem: settings.countPerItem,
                imageStyleId: settings.imageStyleId,
                loras: settings.loras,
            },
            status: "RUNNING",
            items: draftSources.map((s) => ({
                sourceUrl: s.sourceUrl,
                sourceType: s.sourceType,
                sourceName: s.sourceName,
            })),
        });

        enqueuedRef.current.add(created.id);
        setActiveBatchId(created.id);
        setDraftSources([]);
        enqueueItems(
            created.id,
            (created.items ?? []).map((it) => ({
                id: it.id,
                sourceUrl: it.sourceUrl,
            })),
            config,
            activeSessionId ?? undefined,
        );
    };

    const handleStop = async () => {
        if (!activeBatchId) return;
        cancel(activeBatchId);
        await setStatusMutation.mutateAsync({
            batchId: activeBatchId,
            status: "CANCELLED",
        });
        await utils.batch.getById.invalidate({ batchId: activeBatchId });
    };

    const handleRetry = async () => {
        if (!activeBatchId) return;
        const updated = await retryMutation.mutateAsync({ batchId: activeBatchId });
        await utils.batch.getById.invalidate({ batchId: activeBatchId });
        const pending = (updated.items ?? []).filter(
            (it) => it.status === "PENDING",
        );
        if (pending.length > 0) {
            enqueueItems(
                updated.id,
                pending.map((it) => ({ id: it.id, sourceUrl: it.sourceUrl })),
                configFromBatch(updated),
                updated.sessionId ?? undefined,
            );
        }
    };

    const handleNewBatch = () => {
        setActiveBatchId(null);
        setDraftSources([]);
    };

    const handleExport = async () => {
        if (!batch?.items) return;
        setExporting(true);
        try {
            const items = batch.items
                .filter((it) => it.resultUrls.length > 0)
                .map((it) => ({
                    sourceName: it.sourceName,
                    index: it.index,
                    resultUrls: it.resultUrls,
                }));
            await exportBatchResultsZip(items, `multi-generation-${batch.id}.zip`);
        } finally {
            setExporting(false);
        }
    };

    const draftCells: InputCell[] = useMemo(
        () =>
            draftSources.map((s) => ({
                id: s.sourceUrl,
                sourceUrl: s.sourceUrl,
                sourceName: s.sourceName,
            })),
        [draftSources],
    );

    const batchItems = batch?.items;

    const batchCells: InputCell[] = useMemo(
        () =>
            (batchItems ?? []).map((it) => ({
                id: it.id,
                sourceUrl: it.sourceUrl,
                sourceName: it.sourceName,
                status: it.status as InputCell["status"],
                error: it.error,
            })),
        [batchItems],
    );

    const resultCells: ResultCell[] = useMemo(() => {
        if (!batchItems) return [];
        const cells: ResultCell[] = [];
        for (const it of batchItems) {
            for (const url of it.resultUrls) {
                cells.push({ url, sourceName: it.sourceName });
            }
        }
        return cells;
    }, [batchItems]);

    const isCreating = createMutation.isPending;
    const showDraft = !activeBatchId;

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1100px] px-6 py-6 space-y-5">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Layers size={18} className="text-accent-primary" />
                        <h1 className="text-[16px] font-semibold text-text-primary">
                            Мульти-генерация
                        </h1>
                    </div>
                    {!showDraft && (
                        <div className="flex items-center gap-2">
                            {batch?.status === "RUNNING" && (
                                <button
                                    onClick={handleStop}
                                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border-primary px-3 py-1.5 text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
                                >
                                    <StopCircle size={13} /> Остановить
                                </button>
                            )}
                            {(batch?.failedItems ?? 0) > 0 && (
                                <button
                                    onClick={handleRetry}
                                    disabled={retryMutation.isPending}
                                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border-primary px-3 py-1.5 text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer disabled:opacity-60"
                                >
                                    <RefreshCw size={13} /> Повторить неудачные
                                </button>
                            )}
                            <button
                                onClick={handleNewBatch}
                                className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-accent-lime-hover px-3 py-1.5 text-[12px] font-medium text-accent-lime-text hover:bg-accent-lime transition-colors cursor-pointer"
                            >
                                <Plus size={13} /> Новый батч
                            </button>
                        </div>
                    )}
                </div>

                {showDraft ? (
                    <>
                        <MultiGenSourcePanel
                            projectId={projectId}
                            disabled={isCreating}
                            onImported={handleImported}
                        />

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <h2 className="text-[13px] font-semibold text-text-primary">
                                    Источники · {draftSources.length}
                                </h2>
                            </div>
                            <MultiGenInputGrid
                                cells={draftCells}
                                onRemove={handleRemoveDraft}
                            />
                        </div>

                        <MultiGenSettingsBar
                            settings={settings}
                            onChange={updateSettings}
                            onRun={handleRun}
                            runDisabled={
                                draftSources.length === 0 ||
                                !settings.prompt.trim() ||
                                isCreating
                            }
                            running={isCreating}
                            inputCount={draftSources.length}
                        />
                    </>
                ) : batchQuery.isLoading || !batch ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2
                            size={22}
                            className="animate-spin text-text-tertiary"
                        />
                    </div>
                ) : (
                    <>
                        <MultiGenProgressBar
                            total={batch.totalItems}
                            completed={batch.completedItems}
                            failed={batch.failedItems}
                            status={batch.status}
                        />

                        <div className="space-y-2">
                            <h2 className="text-[13px] font-semibold text-text-primary">
                                Источники · {batchCells.length}
                            </h2>
                            <MultiGenInputGrid cells={batchCells} />
                        </div>

                        <MultiGenResultsGrid
                            results={resultCells}
                            onExport={handleExport}
                            exporting={exporting}
                        />
                    </>
                )}
            </div>
        </div>
    );
}
