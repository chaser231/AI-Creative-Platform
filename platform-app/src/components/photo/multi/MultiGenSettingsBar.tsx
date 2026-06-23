"use client";

import { Sparkles, Ratio, Maximize2, Settings2, Play, Loader2 } from "lucide-react";
import { SelectPill } from "@/components/ui/SelectPill";
import { ImageStylePresetPicker } from "@/components/ui/StylePresetPicker";
import { LoraSelectorPicker } from "@/components/ui/LoraSelectorPicker";
import { useStylePresets } from "@/hooks/useStylePresets";
import {
    getImageGenerationPickerOptions,
    getImageEditPickerOptions,
    getAspectRatios,
    getResolutions,
    getDefaultResolution,
    getMaxOutputs,
    getLoraSpec,
} from "@/lib/ai-models";
import type { LoraWeight } from "@/lib/ai-providers";
import type { BatchMode } from "@/lib/batchGenerationRunner";

export interface MultiGenSettings {
    mode: BatchMode;
    model: string;
    prompt: string;
    aspectRatio: string;
    scale: string;
    countPerItem: number;
    imageStyleId: string;
    loras: LoraWeight[];
}

interface MultiGenSettingsBarProps {
    settings: MultiGenSettings;
    onChange: (patch: Partial<MultiGenSettings>) => void;
    onRun: () => void;
    runDisabled: boolean;
    running: boolean;
    inputCount: number;
}

/** Default settings for a fresh batch (img2img reprocessing). */
export function defaultMultiGenSettings(): MultiGenSettings {
    const model = getImageEditPickerOptions()[0]?.id ?? "nano-banana-2";
    return {
        mode: "img2img",
        model,
        prompt: "",
        aspectRatio: getAspectRatios(model)[0] ?? "1:1",
        scale: getDefaultResolution(model),
        countPerItem: 1,
        imageStyleId: "none",
        loras: [],
    };
}

const MODE_OPTIONS: { id: BatchMode; label: string }[] = [
    { id: "img2img", label: "Перегенерация" },
    { id: "t2i", label: "Новое фото" },
];

export function MultiGenSettingsBar({
    settings,
    onChange,
    onRun,
    runDisabled,
    running,
    inputCount,
}: MultiGenSettingsBarProps) {
    const { imagePresets } = useStylePresets();

    const isEdit = settings.mode === "img2img";
    const modelOptions = isEdit
        ? getImageEditPickerOptions()
        : getImageGenerationPickerOptions();
    const aspectRatios = getAspectRatios(settings.model);
    const resolutions = getResolutions(settings.model);
    const maxOutputs = getMaxOutputs(settings.model);
    const loraSpec = getLoraSpec(settings.model);

    const applyModel = (id: string) => {
        const ratios = getAspectRatios(id);
        onChange({
            model: id,
            aspectRatio: ratios.includes(settings.aspectRatio)
                ? settings.aspectRatio
                : ratios[0] ?? "1:1",
            scale: getDefaultResolution(id),
            countPerItem: Math.min(settings.countPerItem, getMaxOutputs(id)),
            loras: [],
        });
    };

    const applyMode = (mode: BatchMode) => {
        if (mode === settings.mode) return;
        const list =
            mode === "img2img"
                ? getImageEditPickerOptions()
                : getImageGenerationPickerOptions();
        const model = list[0]?.id ?? settings.model;
        const ratios = getAspectRatios(model);
        onChange({
            mode,
            model,
            aspectRatio: ratios[0] ?? "1:1",
            scale: getDefaultResolution(model),
            countPerItem: 1,
            loras: [],
        });
    };

    return (
        <div className="rounded-[var(--radius-lg)] border border-border-primary bg-bg-surface p-3 space-y-3">
            {/* Mode toggle */}
            <div className="inline-flex rounded-[var(--radius-md)] border border-border-primary p-0.5">
                {MODE_OPTIONS.map((opt) => {
                    const active = settings.mode === opt.id;
                    return (
                        <button
                            key={opt.id}
                            onClick={() => applyMode(opt.id)}
                            className={`px-3 py-1 rounded-[var(--radius-sm)] text-[12px] font-medium transition-colors cursor-pointer ${
                                active
                                    ? "bg-accent-lime/15 text-accent-primary"
                                    : "text-text-secondary hover:text-text-primary"
                            }`}
                        >
                            {opt.label}
                        </button>
                    );
                })}
                <span className="self-center px-2 text-[10px] text-text-tertiary">
                    {isEdit
                        ? "каждое фото — основа"
                        : "фото как референс"}
                </span>
            </div>

            {/* Prompt */}
            <textarea
                value={settings.prompt}
                onChange={(e) => onChange({ prompt: e.target.value })}
                placeholder={
                    isEdit
                        ? "Опишите, как перегенерировать каждое фото: студийный фон, мягкий свет, премиальная подача…"
                        : "Опишите желаемое изображение для каждого товара…"
                }
                className="w-full min-h-[64px] resize-none rounded-[var(--radius-md)] bg-bg-tertiary px-3 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary/60 outline-none focus:ring-1 focus:ring-border-focus"
            />

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-2">
                <SelectPill
                    icon={<Settings2 size={12} />}
                    label="Модель"
                    value={settings.model}
                    onChange={applyModel}
                    options={modelOptions.map((m) => ({ value: m.id, label: m.label }))}
                    className="min-w-[150px] max-w-[200px]"
                />

                {!isEdit && (
                    <SelectPill
                        icon={<Ratio size={12} />}
                        label="Соотношение сторон"
                        value={settings.aspectRatio}
                        onChange={(v) => onChange({ aspectRatio: v })}
                        options={aspectRatios.map((r) => ({ value: r, label: r }))}
                        className="w-[86px]"
                    />
                )}

                {!isEdit && resolutions.length > 0 && (
                    <SelectPill
                        icon={<Maximize2 size={12} />}
                        label="Разрешение"
                        value={settings.scale}
                        onChange={(v) => onChange({ scale: v })}
                        options={resolutions.map((r) => ({ value: r.id, label: r.label }))}
                        className="w-[82px]"
                    />
                )}

                {maxOutputs > 1 && (
                    <SelectPill
                        icon={<Sparkles size={12} />}
                        label="Изображений на фото"
                        value={settings.countPerItem}
                        onChange={(v) => onChange({ countPerItem: Number(v) })}
                        options={Array.from({ length: maxOutputs }, (_, i) => ({
                            value: String(i + 1),
                            label: String(i + 1),
                        }))}
                        className="w-[64px]"
                    />
                )}

                {!loraSpec && (
                    <ImageStylePresetPicker
                        presets={imagePresets}
                        selectedId={settings.imageStyleId}
                        onChange={(id) => onChange({ imageStyleId: id })}
                        variant="compact"
                    />
                )}

                {loraSpec && (
                    <LoraSelectorPicker
                        family={loraSpec.family}
                        maxCount={loraSpec.maxCount ?? 1}
                        value={settings.loras}
                        onChange={(loras) => onChange({ loras })}
                    />
                )}

                <div className="flex-1" />

                <button
                    onClick={onRun}
                    disabled={runDisabled}
                    className="inline-flex items-center gap-2 rounded-full bg-accent-lime-hover px-4 py-2 text-[13px] font-semibold text-accent-lime-text transition-all hover:bg-accent-lime disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                    {running ? (
                        <Loader2 size={15} className="animate-spin" />
                    ) : (
                        <Play size={15} />
                    )}
                    Запустить{inputCount > 0 ? ` (${inputCount})` : ""}
                </button>
            </div>
        </div>
    );
}
