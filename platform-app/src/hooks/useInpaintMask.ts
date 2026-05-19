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
 *   • All public functions are stable across renders (wrapped in useCallback)
 *     so callers can drop them into event handlers without stale closures.
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
    /** Brush diameter in screen pixels (controls cursor + stroke width). */
    brushSize: number;
    setBrushSize: (size: number) => void;

    /** Brush hardness 0..1. Currently render-equivalent to 1 (hard edge). */
    hardness: number;
    setHardness: (h: number) => void;

    /** Toggle between draw (false) and erase (true). */
    eraserActive: boolean;
    setEraserActive: (active: boolean) => void;

    /** True when at least one stroke exists. */
    hasMask: boolean;

    /**
     * Monotonic counter that bumps whenever the stroke buffer changes.
     * Consumers tie their overlay redraw effect to this so the live preview
     * stays in sync with the underlying ref-stored strokes without
     * re-creating the renderToOverlay callback on every change.
     */
    maskVersion: number;

    /** Begin a new stroke at the given overlay (screen-bbox-relative) point. */
    beginStroke: (point: BrushPoint) => void;
    /** Add a point to the currently active stroke. */
    extendStroke: (point: BrushPoint) => void;
    /** Finalise the current stroke (no-op if none in progress). */
    endStroke: () => void;

    /** Remove the most recent stroke. */
    undo: () => void;
    /** Clear all strokes. */
    clear: () => void;

    /**
     * Imperatively redraw the overlay canvas with the current strokes in
     * screen coordinates. The canvas should be sized to the overlay bbox.
     */
    renderToOverlay: (canvas: HTMLCanvasElement | null) => void;

    /**
     * Build the AI-ready mask as a PNG Blob in the source image's natural
     * pixel space. Returns null when there are no strokes.
     *
     * Caller is responsible for uploading the blob to S3 (fal.ai inpaint
     * endpoints require URLs, not data URIs).
     */
    exportMaskBlob: (
        target: InpaintMaskTarget,
        modelSlug?: string,
    ) => Promise<Blob | null>;
}

/**
 * Public color of the overlay paint preview. Bright, slightly transparent
 * so the user sees the underlying image through their mask.
 */
const OVERLAY_PAINT_COLOR = "rgba(99, 102, 241, 0.55)";

export function useInpaintMask(opts: UseInpaintMaskOptions = {}): UseInpaintMaskApi {
    const strokesRef = useRef<BrushStroke[]>([]);
    const activeStrokeRef = useRef<BrushStroke | null>(null);
    const [version, setVersion] = useState(0);
    const [brushSize, setBrushSize] = useState(opts.initialBrushSize ?? 40);
    const [hardness, setHardness] = useState(opts.initialHardness ?? 1);
    const [eraserActive, setEraserActive] = useState(false);

    // RAF-coalesced re-render trigger so we don't bump state more than once
    // per frame during a fast mousemove.
    const rafScheduledRef = useRef(false);
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
            // Mutate the points array in-place — we never compare strokes by
            // identity from outside this hook, and the version bump below is
            // what drives re-render.
            active.points.push(point);
            scheduleRender();
        },
        [scheduleRender],
    );

    const endStroke = useCallback(() => {
        activeStrokeRef.current = null;
        scheduleRender();
    }, [scheduleRender]);

    const undo = useCallback(() => {
        if (strokesRef.current.length === 0) return;
        strokesRef.current = strokesRef.current.slice(0, -1);
        activeStrokeRef.current = null;
        scheduleRender();
    }, [scheduleRender]);

    const clear = useCallback(() => {
        strokesRef.current = [];
        activeStrokeRef.current = null;
        scheduleRender();
    }, [scheduleRender]);

    const renderToOverlay = useCallback(
        (canvas: HTMLCanvasElement | null) => {
            if (!canvas) return;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw strokes in screen coords. The canvas dimensions == overlay
            // pixel dimensions, so coordinates can be used as-is.
            for (const stroke of strokesRef.current) {
                if (stroke.points.length === 0) continue;
                ctx.save();
                ctx.globalCompositeOperation =
                    stroke.type === "erase" ? "destination-out" : "source-over";
                ctx.fillStyle = OVERLAY_PAINT_COLOR;
                ctx.strokeStyle = OVERLAY_PAINT_COLOR;
                ctx.lineWidth = stroke.size;
                ctx.lineCap = "round";
                ctx.lineJoin = "round";

                ctx.beginPath();
                const first = stroke.points[0];
                ctx.moveTo(first.x, first.y);
                for (let i = 1; i < stroke.points.length; i++) {
                    const p = stroke.points[i];
                    ctx.lineTo(p.x, p.y);
                }
                ctx.stroke();

                // Cap each point with a circle so a click without drag still
                // produces a visible dot (lineTo on a single point is a no-op).
                for (const p of stroke.points) {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, stroke.size / 2, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }
        },
        // version drives re-render via consumer effect; not a dep of the cb
        // because the cb doesn't read it.
        [],
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

/**
 * Re-export the version counter accessor so consumers that need to redraw
 * an overlay imperatively can wire it into their effect deps. Implementation
 * stays internal because we don't want consumers reading the counter directly.
 */
export type { BrushPoint, BrushStroke, InpaintMaskTarget };
