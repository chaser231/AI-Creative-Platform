/**
 * InpaintMaskOverlay — DOM `<canvas>` painted on top of a target image (Konva
 * layer, <img>, Photo workspace preview) to capture the inpaint mask.
 *
 * Responsibilities:
 *   • Positioned absolutely at the screen bbox of the target (passed via `bbox`)
 *     so it lines up pixel-perfect with the underlying image.
 *   • Captures pointer events (mouse, touch, pen) and routes them to the
 *     useInpaintMask hook.
 *   • Redraws the live preview through `mask.renderToOverlay` whenever
 *     `mask.maskVersion` bumps OR the overlay is resized.
 *   • Renders a brush ring cursor that tracks the pointer.
 *
 * What it does NOT do:
 *   • Style the surrounding chrome — caller owns the container that sets
 *     `position: relative` and decides what to render around the image.
 *   • Decide WHEN to mount — caller turns inpaint mode on/off and only
 *     mounts the overlay while a layer is selected.
 */

"use client";

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
} from "react";
import type { UseInpaintMaskApi } from "@/hooks/useInpaintMask";

export interface InpaintMaskOverlayProps {
    /** Screen-space bbox of the image to paint on (relative to the offset parent). */
    bbox: { left: number; top: number; width: number; height: number };
    /** State hook from {@link useInpaintMask}. */
    mask: UseInpaintMaskApi;
    /** Stacking context — should sit above the target image but below modals. */
    zIndex?: number;
    /** Disable pointer interaction (e.g. while generation is in-flight). */
    disabled?: boolean;
}

export function InpaintMaskOverlay({
    bbox,
    mask,
    zIndex = 20,
    disabled = false,
}: InpaintMaskOverlayProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

    // Keep the canvas's internal pixel buffer in sync with its CSS size.
    // We use the bbox as the source of truth — when zoom/pan changes, the
    // caller updates bbox and we re-allocate the buffer so strokes don't
    // get scaled.
    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const w = Math.max(1, Math.round(bbox.width));
        const h = Math.max(1, Math.round(bbox.height));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            // Allocation clears the buffer — force a redraw with current strokes.
            mask.renderToOverlay(canvas);
        }
    }, [bbox.width, bbox.height, mask]);

    // Redraw on every stroke change.
    useEffect(() => {
        mask.renderToOverlay(canvasRef.current);
    }, [mask, mask.maskVersion]);

    // ─── Pointer handling ───────────────────────────────────────────────
    // We rely on Pointer Events (unified mouse/touch/pen) and pointer
    // capture so that a stroke continues even if the cursor leaves the
    // overlay bbox mid-drag.
    const drawingRef = useRef(false);

    const localPointFromEvent = useCallback(
        (e: ReactPointerEvent<HTMLCanvasElement>) => {
            const canvas = canvasRef.current;
            if (!canvas) return null;
            const rect = canvas.getBoundingClientRect();
            // Account for CSS scaling (rect.width may differ from canvas.width
            // by a small fractional amount on HiDPI displays).
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY,
            };
        },
        [],
    );

    const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        if (disabled) return;
        if (e.button !== undefined && e.button !== 0) return; // only primary
        const point = localPointFromEvent(e);
        if (!point) return;
        drawingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        mask.beginStroke(point);
        setCursor(point);
    };

    const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        const point = localPointFromEvent(e);
        if (!point) return;
        setCursor(point);
        if (!drawingRef.current || disabled) return;
        mask.extendStroke(point);
    };

    const finishStroke = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current) return;
        drawingRef.current = false;
        try {
            e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
            // Capture may already be released (e.g. on pointercancel).
        }
        mask.endStroke();
    };

    const onPointerLeave = () => {
        setCursor(null);
    };

    return (
        <div
            ref={containerRef}
            className="pointer-events-none absolute"
            style={{
                left: bbox.left,
                top: bbox.top,
                width: bbox.width,
                height: bbox.height,
                zIndex,
            }}
        >
            <canvas
                ref={canvasRef}
                className={
                    "absolute inset-0 h-full w-full"
                    + (disabled
                        ? " cursor-not-allowed pointer-events-none"
                        : " pointer-events-auto")
                }
                style={{ cursor: disabled ? "not-allowed" : "none", touchAction: "none" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={finishStroke}
                onPointerCancel={finishStroke}
                onPointerLeave={onPointerLeave}
            />
            {/* Brush ring cursor — purely visual hint of brush size + mode. */}
            {cursor && !disabled && (
                <div
                    className="pointer-events-none absolute rounded-full border-2"
                    style={{
                        left: cursor.x - mask.brushSize / 2,
                        top: cursor.y - mask.brushSize / 2,
                        width: mask.brushSize,
                        height: mask.brushSize,
                        borderColor: mask.eraserActive
                            ? "rgba(239, 68, 68, 0.95)"
                            : "rgba(99, 102, 241, 0.95)",
                        background: mask.eraserActive
                            ? "rgba(239, 68, 68, 0.10)"
                            : "rgba(99, 102, 241, 0.10)",
                        boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
                    }}
                />
            )}
        </div>
    );
}
