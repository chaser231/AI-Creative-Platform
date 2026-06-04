"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, Minus, Settings2 } from "lucide-react";
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
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const strokeEnabled = value.strokeEnabled !== false;
    const strokeAlign = value.strokeAlign ?? "center";
    const strokeJoin = value.strokeJoin ?? "miter";

    const updatePopoverPosition = useCallback(() => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect || typeof window === "undefined") return;
        const width = 236;
        setPopoverPosition({
            top: Math.min(rect.bottom + 6, window.innerHeight - 24),
            left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        });
    }, []);

    const toggleSettings = () => {
        updatePopoverPosition();
        setSettingsOpen((open) => !open);
    };

    const handleToggleVisibility = () => {
        const nextEnabled = !strokeEnabled;
        const updates: Partial<StrokeControlsValue> = { strokeEnabled: nextEnabled };
        if (nextEnabled && value.strokeWidth <= 0) {
            updates.strokeWidth = 1;
        }
        onChange(updates);
    };

    useEffect(() => {
        if (!settingsOpen) return;
        updatePopoverPosition();
        const onPointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node) && !popoverRef.current?.contains(event.target as Node)) {
                setSettingsOpen(false);
            }
        };
        window.addEventListener("resize", updatePopoverPosition);
        window.addEventListener("scroll", updatePopoverPosition, true);
        document.addEventListener("pointerdown", onPointerDown);
        return () => {
            window.removeEventListener("resize", updatePopoverPosition);
            window.removeEventListener("scroll", updatePopoverPosition, true);
            document.removeEventListener("pointerdown", onPointerDown);
        };
    }, [settingsOpen, updatePopoverPosition]);

    return (
        <div ref={rootRef} className="space-y-2">
            <div className={cn("flex items-center gap-2", !strokeEnabled && "opacity-55")}>
                <div className="min-w-0 flex-1">
                    <ColorInput
                        value={value.stroke || "#000000"}
                        onChange={(stroke) => {
                            const updates: Partial<StrokeControlsValue> = { stroke };
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
                    className="flex h-8 w-7 items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                    title={strokeEnabled ? "Скрыть обводку" : "Показать обводку"}
                >
                    {strokeEnabled ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
            </div>
            <div className={cn("grid grid-cols-[1fr_74px_28px] gap-2", !strokeEnabled && "opacity-55")}>
                <Select
                    size="xs"
                    value={strokeAlign}
                    onChange={(val) => onChange({ strokeAlign: val as StrokeAlign })}
                    options={STROKE_ALIGN_OPTIONS}
                    triggerClassName="h-8 rounded-[var(--radius-md)] text-[11px]"
                />
                <div className="relative">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary">
                        <StrokeWidthIcon />
                    </span>
                    <SmartNumberInput
                        min={0}
                        value={value.strokeWidth}
                        onChange={(strokeWidth) => onChange({ strokeWidth: Math.max(0, strokeWidth) })}
                        className="h-8 w-full rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary pl-7 pr-2 text-center text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
                    />
                </div>
                <button
                    type="button"
                    onClick={toggleSettings}
                    className={cn(
                        "flex h-8 items-center justify-center rounded-[var(--radius-md)] text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary",
                        settingsOpen && "bg-accent-primary/10 text-accent-primary",
                    )}
                    title="Настройки обводки"
                >
                    <Settings2 size={14} />
                </button>
            </div>

            {settingsOpen && popoverPosition && typeof document !== "undefined" && createPortal((
                <div
                    ref={popoverRef}
                    className="fixed z-[9999] w-[236px] space-y-3 rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface p-3 shadow-[var(--shadow-xl)]"
                    style={{ top: popoverPosition.top, left: popoverPosition.left }}
                >
                    <div className="text-[11px] font-semibold text-text-primary">Stroke</div>
                    <div
                        className="grid grid-cols-3 overflow-hidden rounded-[var(--radius-md)] border border-border-primary"
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
                                    "flex h-8 items-center justify-center border-r border-border-primary text-[9px] font-medium transition-colors last:border-r-0",
                                    strokeJoin === join
                                        ? "bg-accent-primary/10 text-accent-primary"
                                        : "bg-bg-secondary text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary",
                                )}
                            >
                                {join === "miter" ? <Minus size={12} /> : STROKE_JOIN_LABELS[join]}
                            </button>
                        ))}
                    </div>
                </div>
            ), document.body)}
        </div>
    );
}

function StrokeWidthIcon() {
    return (
        <span className="flex h-3.5 w-3.5 flex-col justify-center gap-[2px]">
            <span className="block h-px w-full bg-current" />
            <span className="block h-[2px] w-full bg-current" />
            <span className="block h-[3px] w-full bg-current" />
        </span>
    );
}
