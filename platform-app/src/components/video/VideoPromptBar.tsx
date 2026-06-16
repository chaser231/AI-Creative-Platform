"use client";

import { useMemo, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useVideoStore } from "@/store/videoStore";
import { getVideoModelById } from "@/lib/video-models";
import { getMotionPresetById } from "@/lib/video-presets";
import { MotionPresetIcon } from "./MotionPresetIcon";
import {
    compileSeedanceMultiShotPrompt,
    isMultiShotCustomize,
    sumShotDurationSec,
    validateMultiShot,
} from "@/lib/video-multishot";

interface VideoPromptBarProps {
    projectId: string;
    workspaceId: string;
}

interface SubmitResponse {
    job?: {
        id: string;
        status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
        sessionId: string | null;
    };
    error?: string;
    quota?: { remaining: number | null; dailyLimit: number | null; resetAt?: string };
}

export function VideoPromptBar({ projectId, workspaceId }: VideoPromptBarProps) {
    const activeSessionId = useVideoStore((s) => s.activeSessionId);
    const mode = useVideoStore((s) => s.mode);
    const selectedModelId = useVideoStore((s) => s.selectedModelId);
    const duration = useVideoStore((s) => s.duration);
    const aspectRatio = useVideoStore((s) => s.aspectRatio);
    const resolution = useVideoStore((s) => s.resolution);
    const audio = useVideoStore((s) => s.audio);
    const presetId = useVideoStore((s) => s.presetId);
    const startFrameUrl = useVideoStore((s) => s.startFrameUrl);
    const endFrameUrl = useVideoStore((s) => s.endFrameUrl);
    const multiShotEnabled = useVideoStore((s) => s.multiShotEnabled);
    const multiShots = useVideoStore((s) => s.multiShots);
    const shotType = useVideoStore((s) => s.shotType);
    const getMultiShotConfig = useVideoStore((s) => s.getMultiShotConfig);
    const addActiveJob = useVideoStore((s) => s.addActiveJob);

    const [prompt, setPrompt] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const utils = trpc.useUtils();
    const addMessageMutation = trpc.ai.addMessage.useMutation();
    const createSessionMutation = trpc.ai.createSession.useMutation();

    const model = getVideoModelById(selectedModelId);
    const preset = presetId ? getMotionPresetById(presetId) : undefined;
    const multiShotConfig = getMultiShotConfig();
    const customizeMulti = Boolean(model && multiShotConfig && isMultiShotCustomize(multiShotConfig, model));
    const intelligentMulti = Boolean(multiShotConfig?.enabled && shotType === "intelligent");
    const needsStartFrame = mode === "i2v" && !startFrameUrl;

    const displayDuration = useMemo(() => {
        if (customizeMulti && model) {
            return String(sumShotDurationSec(multiShots));
        }
        return duration.replace(/s$/i, "");
    }, [customizeMulti, model, multiShots, duration]);

    const compiledPreview = useMemo(() => {
        if (!customizeMulti || model?.multiShot?.strategy !== "prompt") return null;
        const text = compileSeedanceMultiShotPrompt(multiShots);
        return text.trim() ? text : null;
    }, [customizeMulti, model, multiShots]);

    const multiValidationError = useMemo(() => {
        if (!model || !multiShotConfig?.enabled) return null;
        return validateMultiShot(model, multiShotConfig, mode);
    }, [model, multiShotConfig, mode]);

    const hasPromptInput = customizeMulti
        ? multiShots.every((s) => s.prompt.trim())
        : !!prompt.trim();

    const canSubmit = hasPromptInput && !needsStartFrame && !submitting && !multiValidationError;

    const ensureSession = async (): Promise<string | null> => {
        if (activeSessionId) return activeSessionId;
        try {
            const created = await createSessionMutation.mutateAsync({ projectId });
            useVideoStore.getState().setActiveSession(created.id);
            await utils.ai.listSessions.invalidate({ projectId });
            return created.id;
        } catch {
            return null;
        }
    };

    const handleSubmit = async () => {
        if (!canSubmit || !model) return;
        setErrorMsg(null);

        const sessionId = await ensureSession();
        if (!sessionId) {
            setErrorMsg("Не удалось создать сессию");
            return;
        }

        const submittedPrompt = customizeMulti
            ? (compiledPreview ?? multiShots.map((s) => s.prompt.trim()).join(" | "))
            : prompt.trim();
        const apiMultiShot = multiShotConfig?.enabled ? multiShotConfig : undefined;
        const apiDuration = customizeMulti ? String(sumShotDurationSec(multiShots)) : duration;

        setSubmitting(true);
        try {
            await addMessageMutation.mutateAsync({
                sessionId,
                role: "user",
                content: submittedPrompt,
                type: "text",
                metadata: {
                    kind: "video",
                    model: model.id,
                    mode,
                    duration: apiDuration,
                    aspectRatio,
                    resolution,
                    presetId: presetId ?? undefined,
                    startFrameUrl: mode === "i2v" ? startFrameUrl : undefined,
                    multiShot: apiMultiShot ? { enabled: true, shotType, shotCount: multiShots.length } : undefined,
                },
            });
            utils.ai.getMessages.invalidate({ sessionId });

            const res = await fetch("/api/ai/video/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    modelId: model.id,
                    mode,
                    prompt: customizeMulti ? "" : submittedPrompt,
                    duration: apiDuration,
                    aspectRatio,
                    resolution,
                    audio: model.supportsAudio ? audio : undefined,
                    presetId: presetId ?? undefined,
                    multiShot: apiMultiShot,
                    startFrameUrl: mode === "i2v" ? startFrameUrl : undefined,
                    endFrameUrl: mode === "i2v" && model.supportsEndFrame ? endFrameUrl : undefined,
                    workspaceId,
                    projectId,
                    sessionId,
                }),
            });
            const data = await res.json() as SubmitResponse;

            if (!res.ok || !data.job) {
                throw new Error(data.error || "Не удалось запустить генерацию");
            }

            addActiveJob({
                id: data.job.id,
                sessionId,
                prompt: submittedPrompt,
                modelId: model.id,
                mode,
                status: "QUEUED",
                aspectRatio,
                createdAt: Date.now(),
            });
            utils.video.myQuotas.invalidate();
            if (!customizeMulti) setPrompt("");
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : "Не удалось запустить генерацию");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="w-full">
            {(errorMsg || multiValidationError) && (
                <div className="mb-2 px-3 py-2 rounded-[var(--radius-md)] bg-red-500/10 border border-red-500/30 text-red-400 text-[11.5px]">
                    {errorMsg ?? multiValidationError}
                </div>
            )}
            <div className="rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface shadow-[var(--shadow-lg)] p-2.5">
                {customizeMulti ? (
                    <div className="px-1.5 pt-1 pb-2 text-[12px] text-text-secondary leading-relaxed">
                        <p className="text-text-tertiary text-[11px] mb-1">
                            Multi-shot: заполните шоты в панели слева
                        </p>
                        {compiledPreview ? (
                            <p className="text-[11px] text-text-tertiary line-clamp-3">{compiledPreview}</p>
                        ) : (
                            <p className="text-[11px] text-amber-500">Добавьте описание хотя бы в один шот</p>
                        )}
                    </div>
                ) : (
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void handleSubmit();
                            }
                        }}
                        placeholder={
                            intelligentMulti
                                ? "Опишите сцену — модель сама разобьёт на планы…"
                                : mode === "i2v"
                                    ? "Опишите, как анимировать кадр…"
                                    : "Опишите сцену для видео…"
                        }
                        rows={2}
                        className="w-full resize-none bg-transparent text-[13px] text-text-primary placeholder:text-text-tertiary outline-none px-1.5 pt-1"
                    />
                )}
                <div className="flex items-center justify-between gap-2 mt-1">
                    <div className="flex items-center gap-1.5 min-w-0 text-[10.5px] text-text-tertiary px-1.5 truncate">
                        <span className="font-medium text-text-secondary">{model?.label}</span>
                        <span>·</span>
                        <span>{displayDuration}с</span>
                        {multiShotEnabled && (
                            <>
                                <span>·</span>
                                <span>multi-shot</span>
                            </>
                        )}
                        {preset && (
                            <>
                                <span>·</span>
                                <span className="inline-flex items-center gap-1">
                                    <MotionPresetIcon name={preset.icon} size={11} />
                                    {preset.label}
                                </span>
                            </>
                        )}
                        {needsStartFrame && (
                            <>
                                <span>·</span>
                                <span className="text-amber-500">загрузите первый кадр слева</span>
                            </>
                        )}
                    </div>
                    <button
                        onClick={() => void handleSubmit()}
                        disabled={!canSubmit}
                        aria-label="Сгенерировать видео"
                        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-accent-lime-hover text-accent-lime-text hover:bg-accent-lime transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {submitting ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
                    </button>
                </div>
            </div>
        </div>
    );
}
