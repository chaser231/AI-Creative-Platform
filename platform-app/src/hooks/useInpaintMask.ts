/**
 * React hook for managing inpaint brush state.
 *
 * Responsibilities:
 *   • Stroke buffer (draw + erase) with undo and clear.
 *   • Live overlay rendering — draws current strokes onto a caller-provided
 *     `<canvas>` element in *overlay (screen) coordinates*. This is what the
 *     user sees while painting.
 *   • Mask export — rasterises strokes onto an offscreen canvas in *source
 *     image natural pixel space* via inpaintMaskExport and returns a PNG Blob
 *     ready to upload to S3 (so we can hand fal/Replicate a real URL).
 *
 * Design notes:
 *   • Strokes are kept in a ref (mutable) to avoid React state churn during
 *     fast mousemove sequences (60+ points per second). A version counter in
 *     state forces a re-render whenever the visible mask changes.
 *   • The overlay redraw is throttled via requestAnimationFrame so we never
 *     paint more than once per frame, regardless of pointer rate.
 *   • Point spacing skips redundant samples so fast drags stay smooth.
 *   • Finished strokes are cached in an offscreen bitmap; only the active
 *     stroke is redrawn each frame during drag.
 */

import { useCallback, useRef, useState } from "react";
import {
    renderInpaintMaskToCanvas,
    canvasToPngBlob,
    modelRequiresAlphaMask,
    type BrushPoint,
    type BrushStroke,
    type InpaintMaskTarget,
} from "@/utils/inpaintMaskExport";

export interface UseInpaintMaskOptions {
    /** Default brush diameter in screen pixels. */
    initialBrushSize?: number;
    /** Default brush hardness (0..1). Reserved for future soft brush UI. */
    initialHardness?: number;
}

export interface UseInpaintMaskApi {
    brushSize: number;
    setBrushSize: (size: number) => void;
    hardness: number;
    setHardness: (h: number) => void;
    eraserActive: boolean;
    setEraserActive: (active: boolean) => void;
    hasMask: boolean;
    maskVersion: number;
    beginStroke: (point: BrushPoint) => void;
    extendStroke: (point: BrushPoint) => void;
    endStroke: () => void;
    undo: () => void;
    clear: () => void;
    renderToOverlay: (canvas: HTMLCanvasElement | null) => void;
    exportMaskBlob: (
        target: InpaintMaskTarget,
        modelSlug?: string,
    ) => Promise<Blob | null>;
}

const OVERLAY_PAINT_COLOR = "rgba(99, 102, 241, 0.55)";

/** Min distance between sampled points as a fraction of brush diameter. */
export const INPAINT_BRUSH_SPACING_FACTOR = 0.15;

export function shouldAddBrushPoint(
    last: BrushPoint | undefined,
    next: BrushPoint,
    brushSize: number,
): boolean {
    if (!last) return true;
    const minDist = Math.max(1, brushSize * INPAINT_BRUSH_SPACING_FACTOR);
    const dx = next.x - last.x;
    const dy = next.y - last.y;
    return dx * dx + dy * dy >= minDist * minDist;
}

function drawStrokeOnContext(ctx: CanvasRenderingContext2D, stroke: BrushStroke) {
    if (stroke.points.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation =
        stroke.type === "erase" ? "destination-out" : "source-over";
    ctx.fillStyle = OVERLAY_PAINT_COLOR;
    ctx.strokeStyle = OVERLAY_PAINT_COLOR;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (stroke.points.length === 1) {
        const p = stroke.points[0];
        ctx.beginPath();
        ctx.arc(p.x, p.y, stroke.size / 2, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
            const p = stroke.points[i];
            ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
    }
    ctx.restore();
}

export function useInpaintMask(opts: UseInpaintMaskOptions = {}): UseInpaintMaskApi {
    const strokesRef = useRef<BrushStroke[]>([]);
    const activeStrokeRef = useRef<BrushStroke | null>(null);
    const [version, setVersion] = useState(0);
    const [brushSize, setBrushSize] = useState(opts.initialBrushSize ?? 40);
    const [hardness, setHardness] = useState(opts.initialHardness ?? 1);
    const [eraserActive, setEraserActive] = useState(false);

    const rafScheduledRef = useRef(false);
    const finishedCacheRef = useRef<HTMLCanvasElement | null>(null);
    const finishedCacheStrokeCountRef = useRef(0);
    const finishedCacheSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

    const invalidateFinishedCache = useCallback(() => {
        finishedCacheStrokeCountRef.current = -1;
    }, []);

    const scheduleRender = useCallback(() => {
        if (rafScheduledRef.current) return;
        rafScheduledRef.current = true;
        requestAnimationFrame(() => {
            rafScheduledRef.current = false;
            setVersion((v) => v + 1);
        });
    }, []);

    const beginStroke = useCallback(
        (point: BrushPoint) => {
            const stroke: BrushStroke = {
                type: eraserActive ? "erase" : "draw",
                size: brushSize,
                hardness,
                points: [point],
            };
            strokesRef.current = [...strokesRef.current, stroke];
            activeStrokeRef.current = stroke;
            scheduleRender();
        },
        [brushSize, hardness, eraserActive, scheduleRender],
    );

    const extendStroke = useCallback(
        (point: BrushPoint) => {
            const active = activeStrokeRef.current;
            if (!active) return;
            const last = active.points[active.points.length - 1];
            if (!shouldAddBrushPoint(last, point, active.size)) return;
            active.points.push(point);
            scheduleRender();
        },
        [scheduleRender],
    );

    const endStroke = useCallback(() => {
        activeStrokeRef.current = null;
        invalidateFinishedCache();
        scheduleRender();
    }, [invalidateFinishedCache, scheduleRender]);

    const undo = useCallback(() => {
        if (strokesRef.current.length === 0) return;
        strokesRef.current = strokesRef.current.slice(0, -1);
        activeStrokeRef.current = null;
        invalidateFinishedCache();
        scheduleRender();
    }, [invalidateFinishedCache, scheduleRender]);

    const clear = useCallback(() => {
        strokesRef.current = [];
        activeStrokeRef.current = null;
        invalidateFinishedCache();
        scheduleRender();
    }, [invalidateFinishedCache, scheduleRender]);

    const ensureFinishedCache = useCallback(
        (width: number, height: number) => {
            const finishedCount = activeStrokeRef.current
                ? strokesRef.current.length - 1
                : strokesRef.current.length;
            const sizeChanged =
                finishedCacheSizeRef.current.w !== width
                || finishedCacheSizeRef.current.h !== height;
            if (
                !sizeChanged
                && finishedCacheStrokeCountRef.current === finishedCount
                && finishedCacheRef.current
            ) {
                return finishedCacheRef.current;
            }

            let cache = finishedCacheRef.current;
            if (!cache || cache.width !== width || cache.height !== height) {
                cache = document.createElement("canvas");
                cache.width = width;
                cache.height = height;
                finishedCacheRef.current = cache;
                finishedCacheSizeRef.current = { w: width, h: height };
            }

            const ctx = cache.getContext("2d");
            if (!ctx) return cache;
            ctx.clearRect(0, 0, width, height);
            for (let i = 0; i < finishedCount; i++) {
                drawStrokeOnContext(ctx, strokesRef.current[i]);
            }
            finishedCacheStrokeCountRef.current = finishedCount;
            return cache;
        },
        [],
    );

    const renderToOverlay = useCallback(
        (canvas: HTMLCanvasElement | null) => {
            if (!canvas) return;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            const w = canvas.width;
            const h = canvas.height;
            const cache = ensureFinishedCache(w, h);
            ctx.clearRect(0, 0, w, h);
            if (cache) {
                ctx.drawImage(cache, 0, 0);
            }
            const active = activeStrokeRef.current;
            if (active) {
                drawStrokeOnContext(ctx, active);
            }
        },
        [ensureFinishedCache],
    );

    const exportMaskBlob = useCallback(
        async (target: InpaintMaskTarget, modelSlug?: string): Promise<Blob | null> => {
            if (strokesRef.current.length === 0) return null;
            const withAlpha = modelRequiresAlphaMask(modelSlug);
            const canvas = renderInpaintMaskToCanvas(strokesRef.current, target, {
                withAlpha,
                blackBackground: !withAlpha,
            });
            return await canvasToPngBlob(canvas);
        },
        [],
    );

    return {
        brushSize,
        setBrushSize,
        hardness,
        setHardness,
        eraserActive,
        setEraserActive,
        hasMask: strokesRef.current.length > 0,
        maskVersion: version,
        beginStroke,
        extendStroke,
        endStroke,
        undo,
        clear,
        renderToOverlay,
        exportMaskBlob,
    };
}

export type { BrushPoint, BrushStroke, InpaintMaskTarget };
