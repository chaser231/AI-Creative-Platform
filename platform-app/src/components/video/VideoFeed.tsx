"use client";

import { useEffect, useMemo, useRef } from "react";
import { Loader2, Clapperboard, Image as ImageIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useVideoStore } from "@/store/videoStore";
import { getVideoModelById } from "@/lib/video-models";
import { VideoResultCard } from "./VideoResultCard";

interface VideoFeedProps {
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

export function VideoFeed({ projectId }: VideoFeedProps) {
    const activeSessionId = useVideoStore((s) => s.activeSessionId);
    const allActiveJobs = useVideoStore((s) => s.activeJobs);
    const scrollRef = useRef<HTMLDivElement>(null);

    const messagesQuery = trpc.ai.getMessages.useQuery(
        { sessionId: activeSessionId ?? "", limit: 100 },
        { enabled: !!activeSessionId, refetchOnWindowFocus: false }
    );

    const messages = (messagesQuery.data?.messages ?? []) as AIMessageRecord[];
    const activeJobs = useMemo(
        () => allActiveJobs.filter((j) => j.sessionId === activeSessionId),
        [allActiveJobs, activeSessionId],
    );

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [messages.length, activeJobs.length]);

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
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 pb-[160px]">
            {messages.length === 0 && activeJobs.length === 0 ? (
                <EmptyState />
            ) : (
                <div className="max-w-[760px] mx-auto px-6 py-6 flex flex-col gap-4">
                    {messages.map((m) => (
                        <MessageRow key={m.id} message={m} projectId={projectId} />
                    ))}
                    {activeJobs.map((job) => (
                        <PendingJobRow
                            key={job.id}
                            status={job.status}
                            prompt={job.prompt}
                            modelId={job.modelId}
                            aspectRatio={job.aspectRatio}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function PendingJobRow({ status, prompt, modelId, aspectRatio }: {
    status: "QUEUED" | "RUNNING";
    prompt: string;
    modelId: string;
    aspectRatio?: string;
}) {
    const model = getVideoModelById(modelId);
    return (
        <div className="flex justify-start">
            <div className="max-w-[480px] w-full rounded-[var(--radius-xl)] border border-border-primary bg-bg-tertiary/40 p-3">
                <div className="mb-2 flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 text-[11px] font-medium text-text-tertiary">
                        <Loader2 size={12} className="animate-spin shrink-0" />
                        <span>
                            {status === "QUEUED" ? "В очереди" : "Генерируем видео"}
                            {model ? ` · ${model.label}` : ""}
                        </span>
                    </div>
                    {prompt.trim() && (
                        <p className="text-[10px] text-text-tertiary/90 line-clamp-2 pl-5" title={prompt}>
                            {prompt}
                        </p>
                    )}
                </div>
                <div
                    className="w-full animate-pulse rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary flex items-center justify-center"
                    style={{ aspectRatio: aspectRatio?.replace(":", " / ") ?? "16 / 9" }}
                >
                    <Clapperboard size={22} className="text-text-tertiary/50" />
                </div>
                <p className="mt-2 text-[10px] text-text-tertiary">
                    Видео генерируется 1–5 минут. Можно запускать следующие — результат появится здесь.
                </p>
            </div>
        </div>
    );
}

function EmptyState() {
    return (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 h-full">
            <div className="w-12 h-12 rounded-full bg-accent-lime/20 text-accent-primary flex items-center justify-center mb-3">
                <Clapperboard size={22} />
            </div>
            <h3 className="text-sm font-semibold text-text-primary mb-1">Начните генерацию видео</h3>
            <p className="text-xs text-text-tertiary max-w-[320px]">
                Опишите сцену в строке ниже, выберите модель и движение камеры слева.
                Готовые ролики сохранятся в этой сессии и в библиотеке проекта.
            </p>
        </div>
    );
}

function MessageRow({ message, projectId }: { message: AIMessageRecord; projectId: string }) {
    const isUser = message.role === "user";
    const meta = (message.metadata ?? {}) as {
        mode?: string;
        duration?: string;
        aspectRatio?: string;
        resolution?: string;
        presetId?: string;
        startFrameUrl?: string;
        model?: string;
    };

    if (isUser) {
        return (
            <div className="flex justify-end">
                <div className="max-w-[80%] bg-accent-lime/20 text-text-primary rounded-[var(--radius-xl)] px-3 py-2 space-y-2">
                    {meta.startFrameUrl && (
                        <div className="flex items-center gap-2 text-[11px] text-accent-primary font-medium">
                            <ImageIcon size={11} />
                            <span>Кадр → Видео</span>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={meta.startFrameUrl}
                                alt="start frame"
                                className="w-8 h-8 rounded-[var(--radius-sm)] object-cover"
                            />
                        </div>
                    )}
                    <div className="text-[13px] whitespace-pre-wrap leading-relaxed">{message.content}</div>
                </div>
            </div>
        );
    }

    if (message.type === "error") {
        return (
            <div className="flex justify-start">
                <div className="max-w-[80%] bg-red-500/10 border border-red-500/30 text-red-400 rounded-[var(--radius-xl)] px-3 py-2 text-[12px]">
                    {message.content}
                </div>
            </div>
        );
    }

    if (message.type === "video") {
        return (
            <div className="flex justify-start">
                <VideoResultCard
                    url={message.content}
                    projectId={projectId}
                    model={message.model ?? meta.model}
                    metadata={meta}
                />
            </div>
        );
    }

    return (
        <div className="flex justify-start">
            <div className="max-w-[80%] bg-bg-tertiary text-text-secondary rounded-[var(--radius-xl)] px-3 py-2 text-[13px] whitespace-pre-wrap">
                {message.content}
            </div>
        </div>
    );
}
