"use client";

import { useEffect, useMemo, useRef } from "react";
import { Loader2, Image as ImageIcon, Wand2 } from "lucide-react";
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
    const scrollRef = useRef<HTMLDivElement>(null);

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

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [messages.length]);

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

    return (
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 pb-[180px]">
            {messages.length === 0 ? (
                <EmptyState />
            ) : (
                <div className="max-w-[720px] mx-auto px-6 py-6 flex flex-col gap-4">
                    {messages.map((m) => (
                        <MessageRow
                            key={m.id}
                            message={m}
                            projectId={projectId}
                            savedAssetId={
                                m.role === "assistant" && m.type === "image"
                                    ? urlToAssetId.get(m.content)
                                    : undefined
                            }
                        />
                    ))}
                </div>
            )}
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

function MessageRow({
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
}
