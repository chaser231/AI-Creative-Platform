"use client";

import { useRef } from "react";
import type { ImageLayer, ImageFitMode } from "@/types";
import { IMAGE_FIT_MODE_LABELS } from "@/types";

function clampFocus(value: number) {
    if (Number.isNaN(value)) return 0.5;
    return Math.max(0, Math.min(1, value));
}

export function ImagePropsInline({
    layer,
    onChange,
}: {
    layer: ImageLayer;
    onChange: (updates: Partial<ImageLayer>) => void;
}) {
    const fileRef = useRef<HTMLInputElement>(null);
    const currentFit: ImageFitMode = layer.objectFit || "cover";
    const focusX = layer.focusX ?? 0.5;
    const focusY = layer.focusY ?? 0.5;

    const handleReplace = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        import("@/utils/imageUpload").then(({ compressImageFile }) => {
            compressImageFile(file).then((compressedBase64) => {
                onChange({ src: compressedBase64 });
            });
        });
        e.target.value = "";
    };

    const FIT_MODES: ImageFitMode[] = ["cover", "contain", "fill", "crop"];

    return (
        <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-text-tertiary font-light shrink-0">Изображение</span>
            <button
                onClick={() => fileRef.current?.click()}
                className="text-[10px] px-2 py-1 rounded-[var(--radius-sm)] border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-secondary cursor-pointer transition-colors shrink-0"
            >
                Заменить
            </button>
            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleReplace}
            />
            <div className="w-px h-5 bg-border-primary shrink-0" />
            <span className="text-[10px] text-text-tertiary font-light shrink-0">Стиль</span>
            <div className="flex items-center border border-border-primary rounded-[var(--radius-md)] overflow-hidden">
                {FIT_MODES.map((mode) => (
                    <button
                        key={mode}
                        onClick={() => onChange({ objectFit: mode })}
                        title={IMAGE_FIT_MODE_LABELS[mode]}
                        className={`px-2 py-1 text-[10px] transition-colors cursor-pointer ${
                            currentFit === mode
                                ? "bg-accent-primary/10 text-accent-primary font-medium"
                                : "text-text-tertiary hover:text-text-primary hover:bg-bg-secondary"
                        }`}
                    >
                        {IMAGE_FIT_MODE_LABELS[mode]}
                    </button>
                ))}
            </div>
            <div className="w-px h-5 bg-border-primary shrink-0" />
            <span className="text-[10px] text-text-tertiary font-light shrink-0">Фокус</span>
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-primary px-2 py-1.5 bg-bg-secondary/60">
                <label className="flex items-center gap-1 text-[10px] text-text-tertiary">
                    X
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={focusX}
                        onChange={(e) => onChange({ focusX: clampFocus(Number(e.target.value)) })}
                        className="w-16 accent-[var(--color-accent-primary)]"
                    />
                    <span className="w-8 text-right text-text-secondary">{Math.round(focusX * 100)}%</span>
                </label>
                <label className="flex items-center gap-1 text-[10px] text-text-tertiary">
                    Y
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={focusY}
                        onChange={(e) => onChange({ focusY: clampFocus(Number(e.target.value)) })}
                        className="w-16 accent-[var(--color-accent-primary)]"
                    />
                    <span className="w-8 text-right text-text-secondary">{Math.round(focusY * 100)}%</span>
                </label>
            </div>
        </div>
    );
}
