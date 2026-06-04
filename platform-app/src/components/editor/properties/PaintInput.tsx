"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FlipHorizontal, Plus, RotateCw, Trash2, X } from "lucide-react";
import type { GradientPaint, GradientType, Paint, PaintStop } from "@/types";
import { SmartNumberInput } from "@/components/ui/SmartNumberInput";
import { useCanvasStore } from "@/store/canvasStore";
import {
    flipGradientPaint,
    gradientEndpointsFromAngle,
    gradientLabel,
    makeGradientPaint,
    makeSolidPaint,
    normalizePaint,
    paintToCssBackground,
    rotateGradientPaint,
} from "@/utils/paint";

const GRADIENT_TYPES: Array<{ value: GradientType; label: string }> = [
    { value: "linear", label: "Linear" },
    { value: "radial", label: "Radial" },
    { value: "angular", label: "Angular" },
    { value: "diamond", label: "Diamond" },
];

function checkerboardStyle() {
    return {
        backgroundImage:
            "linear-gradient(45deg, #d4d4d8 25%, transparent 25%), linear-gradient(-45deg, #d4d4d8 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d4d4d8 75%), linear-gradient(-45deg, transparent 75%, #d4d4d8 75%)",
        backgroundSize: "10px 10px",
        backgroundPosition: "0 0, 0 5px, 5px -5px, -5px 0px",
    };
}

function asGradient(value: Paint): GradientPaint {
    const paint = normalizePaint(value);
    if (paint.kind === "gradient") return paint;
    return makeGradientPaint("linear", [
        { id: "stop-solid", offset: 0, color: paint.color, opacity: paint.opacity },
        { id: "stop-purple", offset: 1, color: "#8341EF", opacity: 1 },
    ]);
}

export function PaintInput({
    value,
    onChange,
    allowGradient = true,
    gradientTargetId,
    imagePanel,
    imageActive = false,
    imagePreviewSrc,
    onImageTab,
    onPaintTab,
}: {
    value: Paint;
    onChange: (value: Paint) => void;
    allowGradient?: boolean;
    gradientTargetId?: string;
    imagePanel?: ReactNode;
    imageActive?: boolean;
    imagePreviewSrc?: string;
    onImageTab?: () => void;
    onPaintTab?: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
    const normalized = normalizePaint(value);
    const gradient = normalized.kind === "gradient" ? normalized : null;
    const isGradient = normalized.kind === "gradient";
    const [selectedStopId, setSelectedStopId] = useState<string | null>(gradient?.stops[0]?.id ?? null);
    const barRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const draggingStopId = useRef<string | null>(null);
    const suppressNextBarClick = useRef(false);
    const setActiveGradientEditorTarget = useCanvasStore((s) => s.setActiveGradientEditorTarget);

    const selectedStop = useMemo(() => {
        if (!gradient) return null;
        return gradient.stops.find((stop) => stop.id === selectedStopId) ?? gradient.stops[0] ?? null;
    }, [gradient, selectedStopId]);

    const updateGradient = (updates: Partial<GradientPaint>) => {
        const next = { ...asGradient(value), ...updates };
        onChange(next);
        if (!selectedStopId && next.stops[0]) setSelectedStopId(next.stops[0].id);
    };

    const updateStop = (stopId: string, updates: Partial<PaintStop>) => {
        const next = asGradient(value);
        const stops = next.stops
            .map((stop) => stop.id === stopId ? { ...stop, ...updates } : stop)
            .sort((a, b) => a.offset - b.offset);
        onChange({ ...next, stops });
    };

    const addStop = (offset = 0.5) => {
        const next = asGradient(value);
        const stop: PaintStop = {
            id: `stop-${Date.now()}`,
            offset,
            color: selectedStop?.color ?? "#EB469F",
            opacity: selectedStop?.opacity ?? 1,
        };
        setSelectedStopId(stop.id);
        onChange({ ...next, stops: [...next.stops, stop].sort((a, b) => a.offset - b.offset) });
    };

    const removeStop = (stopId: string) => {
        const next = asGradient(value);
        if (next.stops.length <= 2) return;
        const stops = next.stops.filter((stop) => stop.id !== stopId);
        setSelectedStopId(stops[0]?.id ?? null);
        onChange({ ...next, stops });
    };

    const handleBarClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (suppressNextBarClick.current) {
            suppressNextBarClick.current = false;
            return;
        }
        if (!barRef.current || !gradient) return;
        const rect = barRef.current.getBoundingClientRect();
        const offset = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        addStop(offset);
    };

    const moveStopToClientX = (stopId: string, clientX: number) => {
        if (!barRef.current) return;
        const rect = barRef.current.getBoundingClientRect();
        const offset = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
        updateStop(stopId, { offset });
    };

    const startStopDrag = (event: React.PointerEvent<HTMLButtonElement>, stopId: string) => {
        event.preventDefault();
        event.stopPropagation();
        draggingStopId.current = stopId;
        suppressNextBarClick.current = false;
        setSelectedStopId(stopId);
        event.currentTarget.setPointerCapture(event.pointerId);
        moveStopToClientX(stopId, event.clientX);
    };

    const handleStopDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!draggingStopId.current) return;
        event.preventDefault();
        event.stopPropagation();
        suppressNextBarClick.current = true;
        moveStopToClientX(draggingStopId.current, event.clientX);
    };

    const endStopDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!draggingStopId.current) return;
        event.preventDefault();
        event.stopPropagation();
        draggingStopId.current = null;
    };

    const closePopover = useCallback(() => {
        setOpen(false);
        if (gradientTargetId) setActiveGradientEditorTarget(null);
    }, [gradientTargetId, setActiveGradientEditorTarget]);

    const updatePopoverPosition = useCallback(() => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect || typeof window === "undefined") return;
        const popoverWidth = imageActive ? 300 : 320;
        setPopoverPosition({
            top: Math.min(rect.bottom + 6, window.innerHeight - 24),
            left: Math.max(12, Math.min(rect.left, window.innerWidth - popoverWidth - 12)),
        });
    }, [imageActive]);

    const openPopover = () => {
        updatePopoverPosition();
        setOpen((prev) => !prev);
    };

    useEffect(() => {
        if (!open) {
            if (gradientTargetId) setActiveGradientEditorTarget(null);
            return;
        }

        updatePopoverPosition();
        if (gradientTargetId && isGradient && !imageActive) {
            setActiveGradientEditorTarget(gradientTargetId);
        } else if (gradientTargetId) {
            setActiveGradientEditorTarget(null);
        }

        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null;
            const isCanvasInteraction = target instanceof HTMLCanvasElement || !!target?.closest(".konvajs-content");
            if (isCanvasInteraction) return;

            if (!rootRef.current?.contains(event.target as Node) && !popoverRef.current?.contains(event.target as Node)) {
                closePopover();
            }
        };

        window.addEventListener("resize", updatePopoverPosition);
        window.addEventListener("scroll", updatePopoverPosition, true);
        document.addEventListener("pointerdown", onPointerDown);
        return () => {
            window.removeEventListener("resize", updatePopoverPosition);
            window.removeEventListener("scroll", updatePopoverPosition, true);
            document.removeEventListener("pointerdown", onPointerDown);
            if (gradientTargetId) setActiveGradientEditorTarget(null);
        };
    }, [open, gradientTargetId, imageActive, isGradient, setActiveGradientEditorTarget, closePopover, updatePopoverPosition]);

    const stopBarBackground = gradient
        ? `linear-gradient(90deg, ${gradient.stops.map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`).join(", ")})`
        : undefined;
    const imagePreviewStyle = imageActive && imagePreviewSrc
        ? {
            backgroundImage: `url(${imagePreviewSrc})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
        }
        : { background: imageActive ? "#D1D5DB" : paintToCssBackground(value) };

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={openPopover}
                className="flex h-8 min-w-[128px] items-center gap-1.5 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary px-1.5 text-left text-[11px] text-text-primary hover:bg-bg-tertiary"
            >
                <span className="relative h-5 w-5 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-border-primary" style={checkerboardStyle()}>
                    <span className="absolute inset-0" style={imagePreviewStyle} />
                </span>
                <span className="truncate">{imageActive ? "Image" : gradientLabel(value)}</span>
            </button>

            {open && popoverPosition && typeof document !== "undefined" && createPortal((
                <div
                    ref={popoverRef}
                    className="fixed z-[9999] rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface p-3 shadow-[var(--shadow-xl)]"
                    style={{ top: popoverPosition.top, left: popoverPosition.left, width: imageActive ? 300 : 320 }}
                >
                    <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="flex rounded-[var(--radius-md)] bg-bg-secondary p-0.5">
                            <button
                                type="button"
                                onClick={() => {
                                    onPaintTab?.();
                                    onChange(makeSolidPaint(normalized.kind === "solid" ? normalized.color : "#FFFFFF", normalized.kind === "solid" ? normalized.opacity : 1));
                                }}
                                className={`h-8 rounded-[var(--radius-md)] px-2 text-[11px] ${!imageActive && normalized.kind === "solid" ? "bg-bg-surface text-text-primary shadow-[var(--shadow-sm)]" : "text-text-tertiary hover:text-text-primary"}`}
                            >
                                Solid
                            </button>
                            {allowGradient && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onPaintTab?.();
                                        const next = asGradient(value);
                                        onChange(next);
                                        setSelectedStopId(next.stops[0]?.id ?? null);
                                        if (gradientTargetId) setActiveGradientEditorTarget(gradientTargetId);
                                    }}
                                    className={`h-8 rounded-[var(--radius-md)] px-2 text-[11px] ${!imageActive && normalized.kind === "gradient" ? "bg-bg-surface text-text-primary shadow-[var(--shadow-sm)]" : "text-text-tertiary hover:text-text-primary"}`}
                                >
                                    Gradient
                                </button>
                            )}
                            {imagePanel && (
                                <button
                                    type="button"
                                    onClick={() => onImageTab?.()}
                                    className={`h-8 rounded-[var(--radius-md)] px-2 text-[11px] ${imageActive ? "bg-bg-surface text-text-primary shadow-[var(--shadow-sm)]" : "text-text-tertiary hover:text-text-primary"}`}
                                >
                                    Image
                                </button>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={closePopover}
                            className="rounded-[var(--radius-sm)] p-1 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
                        >
                            <X size={13} />
                        </button>
                    </div>

                    {imageActive && imagePanel}

                    {!imageActive && normalized.kind === "solid" && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={normalized.color.startsWith("#") ? normalized.color.slice(0, 7) : "#000000"}
                                    onChange={(event) => onChange({ ...normalized, color: event.target.value })}
                                    className="h-9 w-12 cursor-pointer rounded-[var(--radius-sm)] border border-border-primary"
                                />
                                <input
                                    value={normalized.color}
                                    onChange={(event) => onChange({ ...normalized, color: event.target.value })}
                                    className="h-9 flex-1 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary px-2 text-[12px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
                                />
                            </div>
                            <OpacityControl
                                value={normalized.opacity}
                                onChange={(opacity) => onChange({ ...normalized, opacity })}
                            />
                        </div>
                    )}

                    {!imageActive && gradient && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <select
                                    value={gradient.gradientType}
                                    onChange={(event) => updateGradient({ gradientType: event.target.value as GradientType })}
                                    className="h-8 flex-1 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary px-2 text-[11px] text-text-primary focus:outline-none"
                                >
                                    {GRADIENT_TYPES.map((type) => (
                                        <option key={type.value} value={type.value}>{type.label}</option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    onClick={() => onChange(flipGradientPaint(value))}
                                    className="h-8 rounded-[var(--radius-sm)] border border-border-primary px-2 text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                                    title="Flip gradient"
                                >
                                    <FlipHorizontal size={13} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onChange(rotateGradientPaint(value, 45))}
                                    className="h-8 rounded-[var(--radius-sm)] border border-border-primary px-2 text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                                    title="Rotate gradient"
                                >
                                    <RotateCw size={13} />
                                </button>
                            </div>

                            <div>
                                <div
                                    ref={barRef}
                                    onClick={handleBarClick}
                                    className="relative h-10 cursor-copy overflow-visible rounded-[var(--radius-md)] border border-border-primary"
                                    style={{ ...checkerboardStyle(), backgroundColor: "#fff" }}
                                >
                                    <div className="absolute inset-0 rounded-[var(--radius-md)]" style={{ background: stopBarBackground }} />
                                    {gradient.stops.map((stop) => (
                                        <button
                                            key={stop.id}
                                            type="button"
                                            onPointerDown={(event) => startStopDrag(event, stop.id)}
                                            onPointerMove={handleStopDrag}
                                            onPointerUp={endStopDrag}
                                            onPointerCancel={endStopDrag}
                                            onClick={(event) => event.stopPropagation()}
                                            className={`absolute -top-1 h-12 w-4 -translate-x-1/2 rounded-full border ${selectedStop?.id === stop.id ? "border-accent-primary bg-accent-primary/15" : "border-border-primary bg-bg-surface"}`}
                                            style={{ left: `${stop.offset * 100}%` }}
                                            title={`${Math.round(stop.offset * 100)}%`}
                                        >
                                            <span className="absolute bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 rounded-[var(--radius-sm)] border border-border-primary" style={{ background: stop.color, opacity: stop.opacity }} />
                                        </button>
                                    ))}
                                </div>
                                <div className="mt-2 flex items-center justify-between">
                                    <span className="text-[10px] text-text-tertiary">Stops</span>
                                    <button
                                        type="button"
                                        onClick={() => addStop()}
                                        className="flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-[10px] text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                                    >
                                        <Plus size={11} />
                                        Add
                                    </button>
                                </div>
                            </div>

                            {selectedStop && (
                                <div className="space-y-2 rounded-[var(--radius-lg)] bg-bg-secondary p-2">
                                    <div className="grid grid-cols-[58px_1fr_64px_28px] items-center gap-2">
                                        <SmartNumberInput
                                            min={0}
                                            max={100}
                                            value={Math.round(selectedStop.offset * 100)}
                                            onChange={(value) => updateStop(selectedStop.id, { offset: Math.min(1, Math.max(0, value / 100)) })}
                                            className="h-8 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary px-1 text-center text-[11px] text-text-primary"
                                        />
                                        <input
                                            value={selectedStop.color}
                                            onChange={(event) => updateStop(selectedStop.id, { color: event.target.value })}
                                            className="h-8 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary px-2 text-[11px] text-text-primary"
                                        />
                                        <input
                                            type="color"
                                            value={selectedStop.color.startsWith("#") ? selectedStop.color.slice(0, 7) : "#000000"}
                                            onChange={(event) => updateStop(selectedStop.id, { color: event.target.value })}
                                            className="h-8 w-full rounded-[var(--radius-sm)] border border-border-primary"
                                        />
                                        <button
                                            type="button"
                                            disabled={gradient.stops.length <= 2}
                                            onClick={() => removeStop(selectedStop.id)}
                                            className="flex h-8 items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary hover:bg-red-500/10 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                    <OpacityControl
                                        value={selectedStop.opacity}
                                        onChange={(opacity) => updateStop(selectedStop.id, { opacity })}
                                    />
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-2">
                                {(gradient.gradientType === "linear" || gradient.gradientType === "angular") && (
                                    <label className="text-[10px] text-text-tertiary">
                                        Angle
                                        <SmartNumberInput
                                            value={Math.round(gradient.angle)}
                                            onChange={(angle) => {
                                                updateGradient(gradient.gradientType === "linear"
                                                    ? { angle, ...gradientEndpointsFromAngle(angle) }
                                                    : { angle });
                                            }}
                                            className="mt-1 h-8 w-full rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary px-2 text-[11px] text-text-primary"
                                        />
                                    </label>
                                )}
                                {(gradient.gradientType === "radial" || gradient.gradientType === "diamond") && (
                                    <label className="text-[10px] text-text-tertiary">
                                        Radius
                                        <SmartNumberInput
                                            min={0}
                                            max={100}
                                            value={Math.round((gradient.radius ?? 0.7) * 100)}
                                            onChange={(value) => updateGradient({ radius: Math.min(1, Math.max(0, value / 100)) })}
                                            className="mt-1 h-8 w-full rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary px-2 text-[11px] text-text-primary"
                                        />
                                    </label>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            ), document.body)}
        </div>
    );
}

function OpacityControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
    return (
        <div className="flex items-center gap-2">
            <input
                type="range"
                min={0}
                max={100}
                value={Math.round(value * 100)}
                onChange={(event) => onChange(Math.min(1, Math.max(0, Number(event.target.value) / 100)))}
                className="flex-1 accent-accent-primary"
            />
            <SmartNumberInput
                min={0}
                max={100}
                value={Math.round(value * 100)}
                onChange={(next) => onChange(Math.min(1, Math.max(0, next / 100)))}
                className="h-8 w-14 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary px-1 text-center text-[11px] text-text-primary"
            />
            <span className="text-[10px] text-text-tertiary">%</span>
        </div>
    );
}
