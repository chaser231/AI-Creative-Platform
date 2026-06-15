"use client";

import { Plus, Trash2 } from "lucide-react";
import { useVideoStore } from "@/store/videoStore";
import {
    compileSeedanceMultiShotPrompt,
    isMultiShotCustomize,
    sumShotDurationSec,
    type ShotType,
} from "@/lib/video-multishot";
import type { VideoModelEntry } from "@/lib/video-models";

const SHOT_DURATION_OPTIONS = ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"];

interface MultiShotSectionProps {
    model: VideoModelEntry;
}

export function MultiShotSection({ model }: MultiShotSectionProps) {
    const caps = model.multiShot;
    if (!caps) return null;

    const multiShotEnabled = useVideoStore((s) => s.multiShotEnabled);
    const setMultiShotEnabled = useVideoStore((s) => s.setMultiShotEnabled);
    const multiShots = useVideoStore((s) => s.multiShots);
    const updateMultiShot = useVideoStore((s) => s.updateMultiShot);
    const addMultiShot = useVideoStore((s) => s.addMultiShot);
    const removeMultiShot = useVideoStore((s) => s.removeMultiShot);
    const shotType = useVideoStore((s) => s.shotType);
    const setShotType = useVideoStore((s) => s.setShotType);

    const config = { enabled: multiShotEnabled, shots: multiShots, shotType };
    const customize = isMultiShotCustomize(config, model);
    const totalSec = sumShotDurationSec(multiShots);
    const overCap = customize && totalSec > caps.totalDurationCap;
    const compiledPreview = customize && caps.strategy === "prompt"
        ? compileSeedanceMultiShotPrompt(multiShots)
        : null;

    return (
        <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
                <SectionLabel>Multi-shot</SectionLabel>
                <button
                    type="button"
                    onClick={() => setMultiShotEnabled(!multiShotEnabled)}
                    className={`relative w-9 h-5 rounded-full border transition-colors cursor-pointer ${
                        multiShotEnabled
                            ? "bg-accent-lime/30 border-accent-lime/40"
                            : "bg-bg-tertiary border-border-primary"
                    }`}
                    aria-pressed={multiShotEnabled}
                    aria-label="Multi-shot режим"
                >
                    <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-text-primary transition-transform ${
                            multiShotEnabled ? "translate-x-4 bg-accent-lime-hover" : ""
                        }`}
                    />
                </button>
            </div>

            {multiShotEnabled && caps.shotTypeOptions && (
                <PillRow
                    options={caps.shotTypeOptions.map((t) => ({
                        value: t,
                        label: t === "customize" ? "Свои шоты" : "Авто",
                    }))}
                    value={shotType}
                    onChange={(v) => setShotType(v as ShotType)}
                />
            )}

            {multiShotEnabled && customize && (
                <>
                    <p className="text-[10px] text-text-tertiary leading-snug">
                        {caps.strategy === "prompt"
                            ? "Промпт соберётся автоматически с таймкодами для Seedance."
                            : "Каждый шот уходит в API как отдельный сегмент (Kling)."}
                    </p>

                    <div className="space-y-2">
                        {multiShots.map((shot, index) => (
                            <div
                                key={index}
                                className="rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary/30 p-2 space-y-1.5"
                            >
                                <div className="flex items-center justify-between gap-1">
                                    <span className="text-[10px] font-semibold text-text-tertiary uppercase">
                                        Шот {index + 1}
                                    </span>
                                    {multiShots.length > caps.minShots && (
                                        <button
                                            type="button"
                                            onClick={() => removeMultiShot(index)}
                                            className="p-0.5 text-text-tertiary hover:text-red-400 cursor-pointer"
                                            aria-label={`Удалить шот ${index + 1}`}
                                        >
                                            <Trash2 size={11} />
                                        </button>
                                    )}
                                </div>
                                <textarea
                                    value={shot.prompt}
                                    onChange={(e) => updateMultiShot(index, { prompt: e.target.value })}
                                    placeholder="Описание сцены и камеры…"
                                    rows={2}
                                    className="w-full resize-none rounded-[var(--radius-sm)] border border-border-primary bg-bg-surface px-2 py-1.5 text-[11px] text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-focus"
                                />
                                <div className="flex flex-wrap gap-1">
                                    {SHOT_DURATION_OPTIONS.filter((d) => {
                                        const n = parseInt(d, 10);
                                        return n >= caps.shotDurationRange[0] && n <= caps.shotDurationRange[1];
                                    }).map((d) => (
                                        <button
                                            key={d}
                                            type="button"
                                            onClick={() => updateMultiShot(index, { durationSec: parseInt(d, 10) })}
                                            className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors cursor-pointer ${
                                                shot.durationSec === parseInt(d, 10)
                                                    ? "bg-accent-lime/15 border-accent-lime/30 text-accent-primary"
                                                    : "border-border-primary text-text-tertiary hover:text-text-secondary"
                                            }`}
                                        >
                                            {d}с
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    {multiShots.length < caps.maxShots && (
                        <button
                            type="button"
                            onClick={() => addMultiShot()}
                            className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary cursor-pointer"
                        >
                            <Plus size={12} />
                            Добавить шот
                        </button>
                    )}

                    <p className={`text-[10px] ${overCap ? "text-red-400" : "text-text-tertiary"}`}>
                        Итого: {totalSec} с / {caps.totalDurationCap} с
                    </p>

                    {compiledPreview && compiledPreview.trim() && (
                        <details className="group">
                            <summary className="text-[10px] text-text-tertiary cursor-pointer hover:text-text-secondary">
                                Итоговый промпт
                            </summary>
                            <p className="mt-1 text-[10px] text-text-secondary leading-snug whitespace-pre-wrap break-words">
                                {compiledPreview}
                            </p>
                        </details>
                    )}
                </>
            )}

            {multiShotEnabled && shotType === "intelligent" && (
                <p className="text-[10px] text-text-tertiary leading-snug">
                    Модель сама разобьёт один промпт на несколько планов. Опишите сцену в поле внизу.
                </p>
            )}
        </section>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">
            {children}
        </div>
    );
}

function PillRow({ options, value, onChange }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
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
