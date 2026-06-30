"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { Loader2, Image as ImageIcon, Wand2, AlertTriangle, RefreshCw } from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { trpc } from "@/lib/trpc";
import { usePhotoStore } from "@/store/photoStore";
import { PhotoResultCard } from "./PhotoResultCard";

interface PhotoChatViewProps {
    projectId: string;
}

interface AIMessageRecord {
    id: string;
    role: string;
    content: string;
    type: string;
    model: string | null;
    createdAt: Date | string;
    metadata?: unknown;
}

export function PhotoChatView({ projectId }: PhotoChatViewProps) {
    const activeSessionId = usePhotoStore((s) => s.activeSessionId);
    const allPendingGenerations = usePhotoStore((s) => s.pendingGenerations);
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    const messagesQuery = trpc.ai.getMessages.useQuery(
        { sessionId: activeSessionId ?? "", limit: 100 },
        { enabled: !!activeSessionId, refetchOnWindowFocus: false }
    );

    // Load project assets to detect which generated images are already saved
    const assetsQuery = trpc.asset.listByProject.useQuery(
        { projectId },
        { enabled: !!projectId, refetchOnWindowFocus: false }
    );
    const urlToAssetId = useMemo(() => {
        const map = new Map<string, string>();
        for (const a of (assetsQuery.data ?? []) as Array<{ id: string; url: string }>) {
            map.set(a.url, a.id);
        }
        return map;
    }, [assetsQuery.data]);

    const messages = (messagesQuery.data?.messages ?? []) as AIMessageRecord[];
    const pendingGenerations = useMemo(
        () => allPendingGenerations.filter((generation) => generation.sessionId === activeSessionId),
        [activeSessionId, allPendingGenerations],
    );

    // Auto-scroll: pending rows live in Footer, not in Virtuoso data.
    useEffect(() => {
        if (messages.length === 0 && pendingGenerations.length === 0) return;

        if (messages.length > 0) {
            virtuosoRef.current?.scrollToIndex({
                index: messages.length - 1,
                align: "end",
                behavior: "smooth",
            });
            return;
        }

        if (pendingGenerations.length > 0) {
            virtuosoRef.current?.scrollTo({
                top: Number.MAX_SAFE_INTEGER,
                behavior: "smooth",
            });
        }
    }, [messages.length, pendingGenerations.length]);

    if (!activeSessionId) {
        return (
            <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
                Выберите или создайте сессию
            </div>
        );
    }

    if (messagesQuery.isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-text-tertiary" />
            </div>
        );
    }

    if (messagesQuery.isError) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
                <AlertTriangle size={28} className="text-amber-500" />
                <p className="text-sm text-text-secondary">Не удалось загрузить историю сессии.</p>
                <button
                    type="button"
                    onClick={() => messagesQuery.refetch()}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border-primary px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-bg-tertiary cursor-pointer"
                >
                    <RefreshCw size={12} /> Повторить
                </button>
            </div>
        );
    }

    if (messages.length === 0 && pendingGenerations.length === 0) {
        return (
            <div className="flex-1 overflow-y-auto min-h-0 pb-[180px]">
                <EmptyState />
            </div>
        );
    }

    return (
        <div className="flex-1 min-h-0 pb-[180px]">
            <Virtuoso
                key={activeSessionId}
                ref={virtuosoRef}
                className="h-full"
                data={messages}
                initialTopMostItemIndex={Math.max(0, messages.length - 1)}
                followOutput="smooth"
                increaseViewportBy={400}
                itemContent={(_index, message) => (
                    <div className="max-w-[720px] mx-auto px-6 pb-4">
                        <MessageRow
                            message={message}
                            projectId={projectId}
                            savedAssetId={
                                message.role === "assistant" && message.type === "image"
                                    ? urlToAssetId.get(message.content)
                                    : undefined
                            }
                        />
                    </div>
                )}
                components={{
                    Footer: () =>
                        pendingGenerations.length > 0 ? (
                            <div className="max-w-[720px] mx-auto px-6 pb-6 flex flex-col gap-4">
                                {pendingGenerations.map((generation) => (
                                    <PendingGenerationRow key={generation.id} generation={generation} />
                                ))}
                            </div>
                        ) : (
                            <div className="h-4" aria-hidden />
                        ),
                }}
            />
        </div>
    );
}

function PendingGenerationRow({
    generation,
}: {
    generation: { count: number; aspectRatio?: string; prompt: string };
}) {
    return (
        <div className="flex justify-start">
            <div className="max-w-[80%] rounded-[var(--radius-xl)] border border-border-primary bg-bg-tertiary/40 p-3">
                <div className="mb-2 flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 text-[11px] font-medium text-text-tertiary">
                        <Loader2 size={12} className="animate-spin shrink-0" />
                        <span>
                            Генерируем {generation.count} вариант{generation.count > 1 ? "а" : ""}
                        </span>
                    </div>
                    {generation.prompt.trim() && (
                        <p
                            className="text-[10px] text-text-tertiary/90 line-clamp-2 pl-5"
                            title={generation.prompt}
                        >
                            {generation.prompt}
                        </p>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {Array.from({ length: generation.count }, (_, index) => (
                        <div
                            key={index}
                            className="h-32 min-w-32 animate-pulse rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary"
                            style={{ aspectRatio: generation.aspectRatio?.replace(":", " / ") ?? "1 / 1" }}
                            aria-label={`Ожидание изображения ${index + 1}`}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

function EmptyState() {
    return (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 h-full">
            <div className="w-12 h-12 rounded-full bg-accent-lime/20 text-accent-primary flex items-center justify-center mb-3">
                <ImageIcon size={22} />
            </div>
            <h3 className="text-sm font-semibold text-text-primary mb-1">Начните генерацию</h3>
            <p className="text-xs text-text-tertiary max-w-[300px]">
                Опишите желаемое изображение в строке ниже. Результаты сохранятся в этой сессии,
                а финальные кадры — в библиотеке проекта.
            </p>
        </div>
    );
}

const MessageRow = memo(function MessageRow({
    message,
    projectId,
    savedAssetId,
}: {
    message: AIMessageRecord;
    projectId: string;
    savedAssetId?: string;
}) {
    const isUser = message.role === "user";
    const meta = (message.metadata ?? {}) as {
        kind?: "generate" | "edit";
        referenceImages?: string[];
        sourceUrl?: string;
        aspectRatio?: string;
    };

    if (isUser) {
        return (
            <div className="flex justify-end">
                <div className="max-w-[80%] bg-accent-lime/20 text-text-primary rounded-[var(--radius-xl)] px-3 py-2 space-y-2">
                    {meta.kind === "edit" && meta.sourceUrl && (
                        <div className="flex items-center gap-2 text-[11px] text-accent-primary font-medium">
                            <Wand2 size={11} />
                            <span>Редактирование</span>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={meta.sourceUrl}
                                alt="source"
                                loading="lazy"
                                className="w-8 h-8 rounded-[var(--radius-sm)] object-cover"
                            />
                        </div>
                    )}
                    {!!meta.referenceImages?.length && (
                        <div className="flex items-center gap-1 flex-wrap">
                            {meta.referenceImages.slice(0, 4).map((ref, i) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    key={i}
                                    src={ref}
                                    alt={`ref${i}`}
                                    loading="lazy"
                                    className="w-10 h-10 rounded-[var(--radius-sm)] object-cover border border-border-primary"
                                />
                            ))}
                        </div>
                    )}
                    <div className="text-[13px] whitespace-pre-wrap leading-relaxed">{message.content}</div>
                </div>
            </div>
        );
    }

    // Assistant message
    if (message.type === "error") {
        return (
            <div className="flex justify-start">
                <div className="max-w-[80%] bg-red-500/10 border border-red-500/30 text-red-400 rounded-[var(--radius-xl)] px-3 py-2 text-[12px]">
                    {message.content}
                </div>
            </div>
        );
    }

    if (message.type === "image") {
        return (
            <div className="flex justify-start">
                <PhotoResultCard
                    url={message.content}
                    messageId={message.id}
                    projectId={projectId}
                    model={message.model ?? undefined}
                    savedAssetId={savedAssetId}
                />
            </div>
        );
    }

    // Plain text
    return (
        <div className="flex justify-start">
            <div className="max-w-[80%] bg-bg-tertiary text-text-secondary rounded-[var(--radius-xl)] px-3 py-2 text-[13px] whitespace-pre-wrap">
                {message.content}
            </div>
        </div>
    );
});
