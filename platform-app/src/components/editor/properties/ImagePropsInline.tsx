"use client";

import { useRef } from "react";
import type { ImageLayer, ImageFitMode } from "@/types";
import { IMAGE_FIT_MODE_LABELS } from "@/types";

export function ImagePropsInline({
    layer,
    onChange,
}: {
    layer: ImageLayer;
    onChange: (updates: Partial<ImageLayer>) => void;
}) {
    const fileRef = useRef<HTMLInputElement>(null);
    const currentFit: ImageFitMode = layer.objectFit || "cover";

    const handleReplace = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            onChange({ src: reader.result as string });
        };
        reader.readAsDataURL(file);
        e.target.value = "";
    };

    const FIT_MODES: ImageFitMode[] = ["cover", "contain", "fill", "crop"];

    return (
        <div className="flex items-center gap-2">
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
        </div>
    );
}
