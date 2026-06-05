"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, Minus, Settings2 } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { SmartNumberInput, useNumberScrub } from "@/components/ui/SmartNumberInput";
import { PaintInput } from "./PaintInput";
import type { FillMode, LayerImageFill, Paint, StrokeAlign, StrokeJoin } from "@/types";
import { STROKE_ALIGN_LABELS, STROKE_JOIN_LABELS } from "@/types";
import { cn } from "@/lib/cn";
import { normalizePaint } from "@/utils/paint";

const STROKE_ALIGN_OPTIONS: { value: StrokeAlign; label: string }[] = (
    Object.entries(STROKE_ALIGN_LABELS) as [StrokeAlign, string][]
).map(([value, label]) => ({ value, label }));

const STROKE_JOIN_OPTIONS: StrokeJoin[] = ["miter", "round", "bevel"];
type PopoverPosition = { top: number; left: number; maxHeight: number };

export interface StrokeControlsValue {
    stroke: Paint;
    strokeMode?: FillMode;
    strokeImage?: LayerImageFill;
    strokeEnabled?: boolean;
    strokeWidth: number;
    strokeAlign?: StrokeAlign;
    strokeJoin?: StrokeJoin;
}

export function StrokeControls({
    value,
    onChange,
    imagePanel,
    showLabel = true,
}: {
    value: StrokeControlsValue;
    onChange: (updates: Partial<StrokeControlsValue>) => void;
    imagePanel?: ReactNode;
    showLabel?: boolean;
}) {
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const strokeEnabled = value.strokeEnabled !== false;
    const strokeAlign = value.strokeAlign ?? "center";
    const strokeJoin = value.strokeJoin ?? "miter";
    const strokeMode = value.strokeMode ?? "paint";
    const strokeIsImage = strokeMode === "image";
    const currentOpacity = strokeIsImage
        ? value.strokeImage?.opacity ?? 1
        : readPaintOpacity(value.stroke);

    const updatePopoverPosition = useCallback(() => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect || typeof window === "undefined") return;
        const width = 236;
        const viewportPadding = 12;
        const gap = 6;
        const preferredMaxHeight = Math.min(320, window.innerHeight - viewportPadding * 2);
        const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
        const spaceAbove = rect.top - viewportPadding;
        const openBelow = spaceBelow >= Math.min(180, preferredMaxHeight) || spaceBelow >= spaceAbove;
        const availableHeight = Math.max(120, (openBelow ? spaceBelow : spaceAbove) - gap);
        const maxHeight = Math.min(preferredMaxHeight, availableHeight);
        const top = openBelow
            ? Math.max(viewportPadding, Math.min(rect.bottom + gap, window.innerHeight - viewportPadding - maxHeight))
            : Math.max(viewportPadding, rect.top - gap - maxHeight);

        setPopoverPosition({
            top,
            left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - width - viewportPadding)),
            maxHeight,
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

    const handleStrokeChange = (stroke: Paint) => {
        const updates: Partial<StrokeControlsValue> = { stroke, strokeMode: "paint", strokeEnabled: true };
        if (value.strokeWidth <= 0) {
            updates.strokeWidth = 1;
        }
        onChange(updates);
    };

    const handleOpacityChange = (opacity: number) => {
        if (strokeIsImage && value.strokeImage) {
            onChange({
                strokeImage: { ...value.strokeImage, opacity },
                strokeEnabled: true,
                strokeWidth: value.strokeWidth <= 0 ? 1 : value.strokeWidth,
            });
            return;
        }
        onChange({
            stroke: applyPaintOpacity(value.stroke, opacity),
            strokeMode: "paint",
            strokeEnabled: true,
            strokeWidth: value.strokeWidth <= 0 ? 1 : value.strokeWidth,
        });
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
            {showLabel && (
                <div className="text-[9px] font-medium uppercase tracking-wider text-text-tertiary">Обводка</div>
            )}
            <div className={cn("flex items-center gap-2", !strokeEnabled && "opacity-55")}>
                <div className={cn("min-w-0", !strokeEnabled && "pointer-events-none opacity-30")}>
                    <PaintInput
                        value={value.stroke || "#000000"}
                        onChange={handleStrokeChange}
                        imagePanel={imagePanel}
                        imageActive={strokeIsImage}
                        imagePreviewSrc={value.strokeImage?.src}
                        onPaintTab={() => onChange({ strokeMode: "paint" })}
                        onImageTab={() => onChange({ strokeMode: "image", strokeEnabled: true, strokeWidth: value.strokeWidth <= 0 ? 1 : value.strokeWidth })}
                    />
                </div>
                <StrokePercentField
                    value={currentOpacity}
                    onChange={handleOpacityChange}
                    disabled={!strokeEnabled}
                />
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
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary">
                        <StrokeWidthIconHandle
                            value={value.strokeWidth}
                            onChange={(strokeWidth) => onChange({ strokeWidth: Math.max(0, strokeWidth) })}
                        />
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
                    className="fixed z-[9999] w-[236px] space-y-3 overflow-y-auto rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface p-3 shadow-[var(--shadow-xl)]"
                    style={{ top: popoverPosition.top, left: popoverPosition.left, maxHeight: popoverPosition.maxHeight }}
                >
                    <div className="text-[11px] font-semibold text-text-primary">Обводка</div>
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

function readPaintOpacity(value: Paint) {
    const paint = normalizePaint(value);
    if (paint.kind === "solid") return paint.opacity;
    const first = paint.stops[0]?.opacity ?? 1;
    return paint.stops.every((stop) => stop.opacity === first) ? first : 1;
}

function applyPaintOpacity(value: Paint, opacity: number): Paint {
    const paint = normalizePaint(value);
    if (paint.kind === "solid") return { ...paint, opacity };
    return {
        ...paint,
        stops: paint.stops.map((stop) => ({ ...stop, opacity })),
    };
}

function StrokePercentField({
    value,
    onChange,
    disabled,
}: {
    value: number;
    onChange: (value: number) => void;
    disabled?: boolean;
}) {
    const percent = Math.round(value * 100);
    const scrub = useNumberScrub({
        value: percent,
        min: 0,
        max: 100,
        onChange: (next) => onChange(Math.max(0, Math.min(100, next)) / 100),
    });

    return (
        <div className={cn("relative w-[64px]", disabled && "pointer-events-none opacity-40")}>
            <span
                {...scrub}
                className="absolute left-2 top-1/2 z-10 h-px w-2 -translate-y-1/2 cursor-ew-resize rounded-full bg-text-tertiary hover:bg-text-primary"
                title="Изменить непрозрачность"
            />
            <SmartNumberInput
                min={0}
                max={100}
                value={percent}
                onChange={(next) => onChange(Math.max(0, Math.min(100, next)) / 100)}
                className="h-8 w-full rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary pl-4 pr-5 text-center text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-tertiary">%</span>
        </div>
    );
}

function StrokeWidthIconHandle({
    value,
    onChange,
}: {
    value: number;
    onChange: (value: number) => void;
}) {
    const scrub = useNumberScrub({ value, min: 0, onChange });
    return (
        <span {...scrub} className="cursor-ew-resize" title="Drag to adjust stroke width">
            <StrokeWidthIcon />
        </span>
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
