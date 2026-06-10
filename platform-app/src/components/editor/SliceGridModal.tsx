"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCanvasStore } from "@/store/canvasStore";
import { Modal } from "@/components/ui/Modal";
import { CompactInput } from "@/components/editor/properties/CompactInput";
import { computeSliceGrid, resolveTrackSizes } from "@/utils/sliceGrid";

const PREVIEW_MAX_W = 420;
const PREVIEW_MAX_H = 260;

type TrackSizes = Array<number | undefined>;

function resizeTracks(prev: TrackSizes, count: number): TrackSizes {
    const next = prev.slice(0, count);
    while (next.length < count) next.push(undefined);
    return next;
}

/**
 * Procedural slice generator: splits the artboard into a rows × cols grid of
 * slice layers with configurable margins, gaps and per-track pixel sizes.
 * One-shot: generated slices are ordinary slice layers, individually editable
 * afterwards.
 */
export function SliceGridModal({ onClose }: { onClose: () => void }) {
    const { canvasWidth, canvasHeight, addSliceLayers } = useCanvasStore(useShallow((s) => ({
        canvasWidth: s.canvasWidth,
        canvasHeight: s.canvasHeight,
        addSliceLayers: s.addSliceLayers,
    })));

    const [cols, setCols] = useState(3);
    const [rows, setRows] = useState(1);
    const [gapX, setGapX] = useState(0);
    const [gapY, setGapY] = useState(0);
    const [margins, setMargins] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
    const [colSizes, setColSizes] = useState<TrackSizes>([]);
    const [rowSizes, setRowSizes] = useState<TrackSizes>([]);

    const setColCount = (n: number) => {
        const count = Math.min(24, Math.max(1, Math.round(n)));
        setCols(count);
        setColSizes((prev) => resizeTracks(prev, count));
    };
    const setRowCount = (n: number) => {
        const count = Math.min(24, Math.max(1, Math.round(n)));
        setRows(count);
        setRowSizes((prev) => resizeTracks(prev, count));
    };

    const bounds = useMemo(
        () => ({ x: 0, y: 0, width: canvasWidth, height: canvasHeight }),
        [canvasWidth, canvasHeight],
    );

    const rects = useMemo(() => computeSliceGrid({
        bounds, cols, rows, colSizes, rowSizes, gapX, gapY, margins,
    }), [bounds, cols, rows, colSizes, rowSizes, gapX, gapY, margins]);

    const innerWidth = canvasWidth - margins.left - margins.right;
    const innerHeight = canvasHeight - margins.top - margins.bottom;
    const resolvedColWidths = useMemo(
        () => resolveTrackSizes(Math.max(0, innerWidth), cols, colSizes, gapX),
        [innerWidth, cols, colSizes, gapX],
    );
    const resolvedRowHeights = useMemo(
        () => resolveTrackSizes(Math.max(0, innerHeight), rows, rowSizes, gapY),
        [innerHeight, rows, rowSizes, gapY],
    );

    const scale = Math.min(PREVIEW_MAX_W / canvasWidth, PREVIEW_MAX_H / canvasHeight);
    const previewW = canvasWidth * scale;
    const previewH = canvasHeight * scale;

    // ── Divider dragging on the preview ──
    const previewRef = useRef<HTMLDivElement>(null);
    const dragState = useRef<{ axis: "x" | "y"; index: number } | null>(null);

    const handleDividerPointerDown = useCallback((axis: "x" | "y", index: number) => (e: React.PointerEvent) => {
        e.preventDefault();
        dragState.current = { axis, index };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }, []);

    const handleDividerPointerMove = useCallback((e: React.PointerEvent) => {
        const drag = dragState.current;
        const preview = previewRef.current;
        if (!drag || !preview) return;
        const rect = preview.getBoundingClientRect();
        if (drag.axis === "x") {
            const scenePos = (e.clientX - rect.left) / scale;
            // Track start = left margin + widths and gaps of preceding tracks
            let trackStart = margins.left;
            for (let i = 0; i < drag.index; i++) trackStart += resolvedColWidths[i] + gapX;
            const newSize = Math.max(1, Math.round(scenePos - gapX / 2 - trackStart));
            setColSizes((prev) => {
                const next = resizeTracks(prev, cols);
                next[drag.index] = newSize;
                return next;
            });
        } else {
            const scenePos = (e.clientY - rect.top) / scale;
            let trackStart = margins.top;
            for (let i = 0; i < drag.index; i++) trackStart += resolvedRowHeights[i] + gapY;
            const newSize = Math.max(1, Math.round(scenePos - gapY / 2 - trackStart));
            setRowSizes((prev) => {
                const next = resizeTracks(prev, rows);
                next[drag.index] = newSize;
                return next;
            });
        }
    }, [scale, margins.left, margins.top, resolvedColWidths, resolvedRowHeights, gapX, gapY, cols, rows]);

    const handleDividerPointerUp = useCallback(() => {
        dragState.current = null;
    }, []);

    const hasFixedSizes = colSizes.some((v) => v !== undefined) || rowSizes.some((v) => v !== undefined);

    const handleCreate = () => {
        if (rects.length === 0) return;
        addSliceLayers(rects.map((r, i) => ({
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            name: rows > 1 && cols > 1 ? `Slice ${r.row + 1}.${r.col + 1}` : `Slice ${i + 1}`,
        })));
        onClose();
    };

    // Divider positions (in scene px) between adjacent tracks
    const colDividers = useMemo(() => {
        const out: Array<{ index: number; pos: number }> = [];
        let cursor = margins.left;
        for (let i = 0; i < cols - 1; i++) {
            cursor += resolvedColWidths[i];
            out.push({ index: i, pos: cursor + gapX / 2 });
            cursor += gapX;
        }
        return out;
    }, [margins.left, cols, resolvedColWidths, gapX]);

    const rowDividers = useMemo(() => {
        const out: Array<{ index: number; pos: number }> = [];
        let cursor = margins.top;
        for (let i = 0; i < rows - 1; i++) {
            cursor += resolvedRowHeights[i];
            out.push({ index: i, pos: cursor + gapY / 2 });
            cursor += gapY;
        }
        return out;
    }, [margins.top, rows, resolvedRowHeights, gapY]);

    return (
        <Modal
            open
            onClose={onClose}
            title="Разрезать на слайсы"
            maxWidth="max-w-xl"
            footer={
                <>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-[var(--radius-lg)] text-[13px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
                    >
                        Отмена
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={rects.length === 0}
                        className="px-4 py-2 rounded-[var(--radius-lg)] text-[13px] bg-accent-lime-hover text-accent-lime-text hover:bg-accent-lime transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Создать {rects.length} {pluralizeSlices(rects.length)}
                    </button>
                </>
            }
        >
            <div className="space-y-5">
                {/* Divisions */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <span className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium w-full">Деления</span>
                    <CompactInput label="Колонки" value={cols} min={1} onChange={(v) => setColCount(Number(v))} />
                    <CompactInput label="Строки" value={rows} min={1} onChange={(v) => setRowCount(Number(v))} />
                    <CompactInput label="Гэп X" value={gapX} min={0} onChange={(v) => setGapX(Math.max(0, Number(v) || 0))} />
                    <CompactInput label="Гэп Y" value={gapY} min={0} onChange={(v) => setGapY(Math.max(0, Number(v) || 0))} />
                </div>

                {/* Margins */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <span className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium w-full">Марджины</span>
                    <CompactInput label="↑" value={margins.top} min={0} onChange={(v) => setMargins((m) => ({ ...m, top: Math.max(0, Number(v) || 0) }))} />
                    <CompactInput label="→" value={margins.right} min={0} onChange={(v) => setMargins((m) => ({ ...m, right: Math.max(0, Number(v) || 0) }))} />
                    <CompactInput label="↓" value={margins.bottom} min={0} onChange={(v) => setMargins((m) => ({ ...m, bottom: Math.max(0, Number(v) || 0) }))} />
                    <CompactInput label="←" value={margins.left} min={0} onChange={(v) => setMargins((m) => ({ ...m, left: Math.max(0, Number(v) || 0) }))} />
                </div>

                {/* Interactive preview */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
                            Превью · {canvasWidth}×{canvasHeight}
                        </span>
                        {hasFixedSizes && (
                            <button
                                onClick={() => { setColSizes(resizeTracks([], cols)); setRowSizes(resizeTracks([], rows)); }}
                                className="text-[11px] text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                            >
                                Сбросить размеры
                            </button>
                        )}
                    </div>
                    <div className="flex justify-center py-2">
                        <div
                            ref={previewRef}
                            className="relative bg-bg-secondary border border-border-primary rounded-[var(--radius-sm)] overflow-hidden"
                            style={{ width: previewW, height: previewH }}
                            onPointerMove={handleDividerPointerMove}
                            onPointerUp={handleDividerPointerUp}
                        >
                            {/* Slice cells */}
                            {rects.map((r) => (
                                <div
                                    key={`cell-${r.row}-${r.col}`}
                                    className="absolute border border-dashed border-orange-500/80 bg-orange-500/10"
                                    style={{
                                        left: r.x * scale,
                                        top: r.y * scale,
                                        width: r.width * scale,
                                        height: r.height * scale,
                                    }}
                                >
                                    <span className="absolute inset-0 flex items-center justify-center text-[9px] text-text-tertiary select-none pointer-events-none overflow-hidden">
                                        {Math.round(r.width)}×{Math.round(r.height)}
                                    </span>
                                </div>
                            ))}
                            {/* Column dividers (draggable) */}
                            {colDividers.map(({ index, pos }) => (
                                <div
                                    key={`vdiv-${index}`}
                                    className="absolute top-0 bottom-0 cursor-col-resize group"
                                    style={{ left: pos * scale - 4, width: 8 }}
                                    onPointerDown={handleDividerPointerDown("x", index)}
                                >
                                    <div className="absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 bg-accent-primary/40 group-hover:bg-accent-primary" />
                                </div>
                            ))}
                            {/* Row dividers (draggable) */}
                            {rowDividers.map(({ index, pos }) => (
                                <div
                                    key={`hdiv-${index}`}
                                    className="absolute left-0 right-0 cursor-row-resize group"
                                    style={{ top: pos * scale - 4, height: 8 }}
                                    onPointerDown={handleDividerPointerDown("y", index)}
                                >
                                    <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-accent-primary/40 group-hover:bg-accent-primary" />
                                </div>
                            ))}
                        </div>
                    </div>
                    <p className="text-[10px] text-text-quaternary mt-1">
                        Перетащите границы на превью или задайте размеры попиксельно ниже — остальные деления подстроятся автоматически.
                    </p>
                </div>

                {/* Per-track pixel sizes */}
                {cols > 1 && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium w-full">Ширины колонок</span>
                        {resolvedColWidths.map((w, i) => (
                            <CompactInput
                                key={`colw-${i}`}
                                label={`${i + 1}`}
                                value={Math.round(w)}
                                min={1}
                                onChange={(v) => setColSizes((prev) => {
                                    const next = resizeTracks(prev, cols);
                                    next[i] = Math.max(1, Number(v) || 1);
                                    return next;
                                })}
                            />
                        ))}
                    </div>
                )}
                {rows > 1 && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium w-full">Высоты строк</span>
                        {resolvedRowHeights.map((h, i) => (
                            <CompactInput
                                key={`rowh-${i}`}
                                label={`${i + 1}`}
                                value={Math.round(h)}
                                min={1}
                                onChange={(v) => setRowSizes((prev) => {
                                    const next = resizeTracks(prev, rows);
                                    next[i] = Math.max(1, Number(v) || 1);
                                    return next;
                                })}
                            />
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
}

function pluralizeSlices(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "слайс";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "слайса";
    return "слайсов";
}
