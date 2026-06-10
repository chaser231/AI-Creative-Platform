"use client";

/**
 * Higgsfield-style settings column for the video workspace:
 * mode toggle (t2v/i2v), tiered model picker with price + quota badges,
 * duration / aspect / resolution pills, audio toggle, camera-motion preset
 * grid, and start/end frame slots for image-to-video.
 */

import { useMemo, useRef, useState } from "react";
import { ChevronDown, Image as ImageIcon, Loader2, Type, Volume2, VolumeX, X, Zap } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useVideoStore } from "@/store/videoStore";
import {
    getVideoModelById,
    getModelDurations,
    listVideoModelsByTier,
    durationToSeconds,
    estimateVideoCostUsd,
    VIDEO_TIER_LABELS,
    type VideoMode,
    type VideoTier,
} from "@/lib/video-models";
import { VIDEO_MOTION_PRESETS } from "@/lib/video-presets";
import { compressImageFile, uploadForAI } from "@/utils/imageUpload";

const TIER_BADGE_CLASSES: Record<VideoTier, string> = {
    premium: "bg-amber-500/15 text-amber-500 border-amber-500/25",
    advanced: "bg-purple-500/15 text-purple-400 border-purple-500/25",
    standard: "bg-emerald-500/15 text-emerald-500 border-emerald-500/25",
};

interface QuotaState {
    modelId: string;
    enabled: boolean;
    dailyLimit: number | null;
    remaining: number | null;
}

interface VideoSettingsPanelProps {
    projectId: string;
}

export function VideoSettingsPanel({ projectId }: VideoSettingsPanelProps) {
    const mode = useVideoStore((s) => s.mode);
    const setMode = useVideoStore((s) => s.setMode);
    const selectedModelId = useVideoStore((s) => s.selectedModelId);
    const setSelectedModel = useVideoStore((s) => s.setSelectedModel);
    const duration = useVideoStore((s) => s.duration);
    const setDuration = useVideoStore((s) => s.setDuration);
    const aspectRatio = useVideoStore((s) => s.aspectRatio);
    const setAspectRatio = useVideoStore((s) => s.setAspectRatio);
    const resolution = useVideoStore((s) => s.resolution);
    const setResolution = useVideoStore((s) => s.setResolution);
    const audio = useVideoStore((s) => s.audio);
    const setAudio = useVideoStore((s) => s.setAudio);
    const presetId = useVideoStore((s) => s.presetId);
    const setPresetId = useVideoStore((s) => s.setPresetId);

    const quotasQuery = trpc.video.myQuotas.useQuery(undefined, {
        refetchOnWindowFocus: false,
        staleTime: 30_000,
    });
    const quotaByModel = useMemo(() => {
        const map = new Map<string, QuotaState>();
        for (const q of (quotasQuery.data ?? []) as QuotaState[]) {
            map.set(q.modelId, q);
        }
        return map;
    }, [quotasQuery.data]);

    const model = getVideoModelById(selectedModelId);
    if (!model) return null;

    const durations = getModelDurations(model, mode);
    const selectedQuota = quotaByModel.get(model.id);
    const estCost = estimateVideoCostUsd(model, duration);

    return (
        <aside className="w-[300px] shrink-0 border-r border-border-primary bg-bg-surface flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
                {/* Mode */}
                <section>
                    <SectionLabel>Режим</SectionLabel>
                    <div className="grid grid-cols-2 gap-1.5">
                        <ModeButton
                            active={mode === "t2v"}
                            onClick={() => setMode("t2v")}
                            icon={<Type size={13} />}
                            label="Текст → Видео"
                        />
                        <ModeButton
                            active={mode === "i2v"}
                            onClick={() => setMode("i2v")}
                            icon={<ImageIcon size={13} />}
                            label="Кадр → Видео"
                        />
                    </div>
                </section>

                {/* Model picker */}
                <section>
                    <SectionLabel>Модель</SectionLabel>
                    <ModelPicker
                        mode={mode}
                        selectedModelId={selectedModelId}
                        onSelect={setSelectedModel}
                        quotaByModel={quotaByModel}
                    />
                    {selectedQuota && selectedQuota.dailyLimit !== null && (
                        <p className="mt-1.5 text-[11px] text-text-tertiary">
                            Осталось сегодня:{" "}
                            <span className={selectedQuota.remaining === 0 ? "text-red-400 font-medium" : "text-text-secondary font-medium"}>
                                {selectedQuota.remaining} из {selectedQuota.dailyLimit}
                            </span>
                        </p>
                    )}
                </section>

                {/* Frames (i2v) */}
                {mode === "i2v" && (
                    <section className="space-y-2.5">
                        <SectionLabel>Кадры</SectionLabel>
                        <FrameSlot kind="start" projectId={projectId} />
                        {model.supportsEndFrame && <FrameSlot kind="end" projectId={projectId} />}
                    </section>
                )}

                {/* Duration */}
                <section>
                    <SectionLabel>Длительность</SectionLabel>
                    <PillRow
                        options={durations.map((d) => ({ value: d, label: `${durationToSeconds(d)}с` }))}
                        value={duration}
                        onChange={setDuration}
                    />
                </section>

                {/* Aspect ratio */}
                {model.aspectRatios && (
                    <section>
                        <SectionLabel>Соотношение сторон</SectionLabel>
                        <PillRow
                            options={model.aspectRatios.map((r) => ({ value: r, label: r }))}
                            value={aspectRatio ?? ""}
                            onChange={setAspectRatio}
                            disabled={mode === "i2v" && !model.id.startsWith("veo")}
                        />
                        {mode === "i2v" && !model.id.startsWith("veo") && (
                            <p className="mt-1 text-[10px] text-text-tertiary">
                                В режиме «Кадр → Видео» формат определяется исходным кадром
                            </p>
                        )}
                    </section>
                )}

                {/* Resolution */}
                {model.resolutions && (
                    <section>
                        <SectionLabel>Разрешение</SectionLabel>
                        <PillRow
                            options={model.resolutions.map((r) => ({ value: r, label: r }))}
                            value={resolution ?? ""}
                            onChange={setResolution}
                        />
                    </section>
                )}

                {/* Audio */}
                {(model.supportsAudio || model.alwaysAudio) && (
                    <section>
                        <SectionLabel>Звук</SectionLabel>
                        {model.alwaysAudio ? (
                            <div className="flex items-center gap-2 text-[12px] text-text-secondary">
                                <Volume2 size={13} className="text-text-tertiary" />
                                Всегда включён для этой модели
                            </div>
                        ) : (
                            <button
                                onClick={() => setAudio(!audio)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-md)] text-[12px] font-medium border transition-colors cursor-pointer ${
                                    audio
                                        ? "bg-accent-lime/15 border-accent-lime/30 text-accent-primary"
                                        : "border-border-primary text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary"
                                }`}
                            >
                                {audio ? <Volume2 size={13} /> : <VolumeX size={13} />}
                                {audio ? "Генерировать звук" : "Без звука"}
                            </button>
                        )}
                    </section>
                )}

                {/* Motion presets */}
                <section>
                    <SectionLabel>Движение камеры</SectionLabel>
                    <div className="grid grid-cols-3 gap-1.5">
                        <button
                            onClick={() => setPresetId(null)}
                            className={`flex flex-col items-center gap-1 px-1 py-2 rounded-[var(--radius-md)] border text-center transition-colors cursor-pointer ${
                                presetId === null
                                    ? "bg-accent-lime/15 border-accent-lime/30 text-accent-primary"
                                    : "border-border-primary text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary"
                            }`}
                        >
                            <span className="text-[14px] leading-none">—</span>
                            <span className="text-[9.5px] font-medium leading-tight">Авто</span>
                        </button>
                        {VIDEO_MOTION_PRESETS.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => setPresetId(presetId === p.id ? null : p.id)}
                                title={p.description}
                                className={`flex flex-col items-center gap-1 px-1 py-2 rounded-[var(--radius-md)] border text-center transition-colors cursor-pointer ${
                                    presetId === p.id
                                        ? "bg-accent-lime/15 border-accent-lime/30 text-accent-primary"
                                        : "border-border-primary text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary"
                                }`}
                            >
                                <span className="text-[14px] leading-none">{p.glyph}</span>
                                <span className="text-[9.5px] font-medium leading-tight">{p.label}</span>
                            </button>
                        ))}
                    </div>
                </section>
            </div>

            {/* Cost estimate footer */}
            <div className="border-t border-border-primary px-4 py-2.5 flex items-center justify-between">
                <span className="text-[11px] text-text-tertiary">Примерная стоимость</span>
                <span className="text-[12px] font-semibold text-text-secondary">~${estCost.toFixed(2)}</span>
            </div>
        </aside>
    );
}

/* ─── Subcomponents ───────────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">
            {children}
        </div>
    );
}

function ModeButton({ active, onClick, icon, label }: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
}) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-[var(--radius-md)] text-[11.5px] font-medium border transition-colors cursor-pointer ${
                active
                    ? "bg-accent-lime/15 border-accent-lime/30 text-accent-primary"
                    : "border-border-primary text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary"
            }`}
        >
            {icon}
            {label}
        </button>
    );
}

function PillRow({ options, value, onChange, disabled }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
}) {
    return (
        <div className={`flex flex-wrap gap-1.5 ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
            {options.map((o) => (
                <button
                    key={o.value}
                    onClick={() => onChange(o.value)}
                    className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition-colors cursor-pointer ${
                        o.value === value
                            ? "bg-accent-lime/15 border-accent-lime/30 text-accent-primary"
                            : "border-border-primary text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary"
                    }`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

function ModelPicker({ mode, selectedModelId, onSelect, quotaByModel }: {
    mode: VideoMode;
    selectedModelId: string;
    onSelect: (id: string) => void;
    quotaByModel: Map<string, QuotaState>;
}) {
    const [open, setOpen] = useState(false);
    const selected = getVideoModelById(selectedModelId);
    const groups = listVideoModelsByTier();

    return (
        <div className="relative">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary/40 hover:bg-bg-tertiary transition-colors cursor-pointer"
            >
                <div className="flex items-center gap-2 min-w-0">
                    <Zap size={13} className="shrink-0 text-text-tertiary" />
                    <span className="text-[12.5px] font-medium text-text-primary truncate">
                        {selected?.label ?? selectedModelId}
                    </span>
                </div>
                <ChevronDown size={13} className={`shrink-0 text-text-tertiary transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-[420px] overflow-y-auto bg-bg-surface border border-border-primary rounded-[var(--radius-md)] shadow-[var(--shadow-lg)] py-1">
                        {groups.map(({ tier, models }) => {
                            const available = models.filter((m) => m.endpoints[mode]);
                            if (available.length === 0) return null;
                            return (
                                <div key={tier}>
                                    <div className="px-3 pt-2 pb-1 flex items-center gap-1.5">
                                        <span className={`inline-flex px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wide ${TIER_BADGE_CLASSES[tier]}`}>
                                            {VIDEO_TIER_LABELS[tier]}
                                        </span>
                                    </div>
                                    {available.map((m) => {
                                        const quota = quotaByModel.get(m.id);
                                        const exhausted = quota?.dailyLimit !== null && quota?.remaining === 0;
                                        const isDisabled = quota ? !quota.enabled : false;
                                        return (
                                            <button
                                                key={m.id}
                                                disabled={isDisabled}
                                                onClick={() => {
                                                    onSelect(m.id);
                                                    setOpen(false);
                                                }}
                                                className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors ${
                                                    isDisabled
                                                        ? "opacity-40 cursor-not-allowed"
                                                        : "hover:bg-bg-tertiary cursor-pointer"
                                                } ${m.id === selectedModelId ? "bg-accent-lime/10" : ""}`}
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[12.5px] font-medium text-text-primary">{m.label}</span>
                                                        <span className="text-[10px] text-text-tertiary">${m.pricePerSecondUsd.toFixed(2)}/с</span>
                                                    </div>
                                                    <p className="text-[10.5px] text-text-tertiary truncate">{m.description}</p>
                                                </div>
                                                {quota && quota.dailyLimit !== null && (
                                                    <span className={`shrink-0 mt-0.5 text-[10px] font-medium ${exhausted ? "text-red-400" : "text-text-tertiary"}`}>
                                                        {isDisabled ? "выкл" : `${quota.remaining}/${quota.dailyLimit}`}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}

function FrameSlot({ kind, projectId }: { kind: "start" | "end"; projectId: string }) {
    const url = useVideoStore((s) => (kind === "start" ? s.startFrameUrl : s.endFrameUrl));
    const setUrl = useVideoStore((s) => (kind === "start" ? s.setStartFrameUrl : s.setEndFrameUrl));
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleFile = async (file: File) => {
        setError(null);
        setUploading(true);
        try {
            const base64 = await compressImageFile(file, 2000);
            const uploaded = await uploadForAI(base64, projectId);
            if (!uploaded.startsWith("http")) {
                throw new Error("Не удалось загрузить изображение");
            }
            setUrl(uploaded);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Ошибка загрузки");
        } finally {
            setUploading(false);
        }
    };

    return (
        <div>
            <div className="text-[11px] text-text-secondary font-medium mb-1">
                {kind === "start" ? "Первый кадр" : "Последний кадр (опционально)"}
            </div>
            {url ? (
                <div className="relative group rounded-[var(--radius-md)] overflow-hidden border border-border-primary">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={kind} className="w-full h-24 object-cover" />
                    <button
                        onClick={() => setUrl(null)}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/40 text-on-dark opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        aria-label="Удалить кадр"
                    >
                        <X size={11} />
                    </button>
                </div>
            ) : (
                <button
                    onClick={() => inputRef.current?.click()}
                    disabled={uploading}
                    className="w-full h-24 flex flex-col items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-border-primary text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary/40 transition-colors cursor-pointer disabled:opacity-60"
                >
                    {uploading ? <Loader2 size={15} className="animate-spin" /> : <ImageIcon size={15} />}
                    <span className="text-[10.5px]">{uploading ? "Загрузка…" : "Загрузить изображение"}</span>
                </button>
            )}
            {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                    e.target.value = "";
                }}
            />
        </div>
    );
}
