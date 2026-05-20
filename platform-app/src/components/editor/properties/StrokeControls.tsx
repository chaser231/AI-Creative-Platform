"use client";

import { Eye, EyeOff } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { SmartNumberInput } from "@/components/ui/SmartNumberInput";
import { ColorInput } from "./ColorInput";
import type { StrokeAlign, StrokeJoin } from "@/types";
import { STROKE_ALIGN_LABELS, STROKE_JOIN_LABELS } from "@/types";
import { cn } from "@/lib/cn";

const STROKE_ALIGN_OPTIONS: { value: StrokeAlign; label: string }[] = (
    Object.entries(STROKE_ALIGN_LABELS) as [StrokeAlign, string][]
).map(([value, label]) => ({ value, label }));

const STROKE_JOIN_OPTIONS: StrokeJoin[] = ["miter", "round", "bevel"];

export interface StrokeControlsValue {
    stroke: string;
    strokeEnabled?: boolean;
    strokeWidth: number;
    strokeAlign?: StrokeAlign;
    strokeJoin?: StrokeJoin;
}

export function StrokeControls({
    value,
    onChange,
}: {
    value: StrokeControlsValue;
    onChange: (updates: Partial<StrokeControlsValue>) => void;
}) {
    const strokeEnabled = value.strokeEnabled !== false;
    const strokeAlign = value.strokeAlign ?? "center";
    const strokeJoin = value.strokeJoin ?? "miter";

    const handleToggleVisibility = () => {
        const nextEnabled = !strokeEnabled;
        const updates: Partial<StrokeControlsValue> = { strokeEnabled: nextEnabled };
        if (nextEnabled && value.strokeWidth <= 0) {
            updates.strokeWidth = 1;
        }
        onChange(updates);
    };

    return (
        <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
                <div className={`flex-1 transition-opacity ${strokeEnabled ? "" : "opacity-30 pointer-events-none"}`}>
                    <ColorInput
                        value={value.stroke || "#000000"}
                        onChange={(v) => {
                            const updates: Partial<StrokeControlsValue> = { stroke: v };
                            if (strokeEnabled && value.strokeWidth <= 0) {
                                updates.strokeWidth = 1;
                            }
                            onChange(updates);
                        }}
                    />
                </div>
                <button
                    type="button"
                    onClick={handleToggleVisibility}
                    className={`p-1 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${strokeEnabled ? "text-text-secondary hover:text-text-primary" : "text-text-tertiary/40 hover:text-text-tertiary"}`}
                    title={strokeEnabled ? "Скрыть обводку" : "Показать обводку"}
                >
                    {strokeEnabled ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
            </div>
            <div className={`flex items-center gap-1.5 ${strokeEnabled ? "" : "opacity-30 pointer-events-none"}`}>
                <Select
                    size="xs"
                    value={strokeAlign}
                    onChange={(val) => onChange({ strokeAlign: val as StrokeAlign })}
                    options={STROKE_ALIGN_OPTIONS}
                    className="flex-1 min-w-0"
                />
                <SmartNumberInput
                    min={0}
                    value={value.strokeWidth}
                    onChange={(v) => onChange({ strokeWidth: Math.max(0, v) })}
                    className="w-12 h-7 px-1 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-[10px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
                <span className="text-[10px] text-text-tertiary shrink-0">px</span>
            </div>
            <div className={strokeEnabled ? "" : "opacity-30 pointer-events-none"}>
                <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1 block">
                    Углы обводки
                </label>
                <div
                    className="flex rounded-[var(--radius-sm)] border border-border-primary overflow-hidden"
                    role="group"
                    aria-label="Стиль углов обводки"
                >
                    {STROKE_JOIN_OPTIONS.map((join) => (
                        <button
                            key={join}
                            type="button"
                            onClick={() => onChange({ strokeJoin: join })}
                            title={STROKE_JOIN_LABELS[join]}
                            className={cn(
                                "flex-1 h-7 text-[9px] font-medium transition-colors cursor-pointer border-r border-border-primary last:border-r-0",
                                strokeJoin === join
                                    ? "bg-accent-primary/10 text-accent-primary"
                                    : "bg-bg-secondary text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary",
                            )}
                        >
                            {STROKE_JOIN_LABELS[join]}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
