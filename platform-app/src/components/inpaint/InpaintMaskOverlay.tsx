/**
 * InpaintMaskOverlay — DOM `<canvas>` painted on top of a target image (Konva
 * layer, <img>, Photo workspace preview) to capture the inpaint mask.
 */

"use client";

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    type PointerEvent as ReactPointerEvent,
} from "react";
import type { UseInpaintMaskApi } from "@/hooks/useInpaintMask";

export interface InpaintMaskOverlayProps {
    bbox: { left: number; top: number; width: number; height: number };
    mask: UseInpaintMaskApi;
    zIndex?: number;
    disabled?: boolean;
}

export function InpaintMaskOverlay({
    bbox,
    mask,
    zIndex = 20,
    disabled = false,
}: InpaintMaskOverlayProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const cursorRef = useRef<HTMLDivElement | null>(null);
    const drawingRef = useRef(false);
    const captureTargetRef = useRef<HTMLCanvasElement | null>(null);
    const capturePointerIdRef = useRef<number | null>(null);

    const releaseCapture = useCallback(() => {
        const target = captureTargetRef.current;
        const pointerId = capturePointerIdRef.current;
        if (target && pointerId !== null) {
            try {
                target.releasePointerCapture(pointerId);
            } catch {
                // Already released.
            }
        }
        captureTargetRef.current = null;
        capturePointerIdRef.current = null;
        drawingRef.current = false;
    }, []);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const w = Math.max(1, Math.round(bbox.width));
        const h = Math.max(1, Math.round(bbox.height));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            mask.renderToOverlay(canvas);
        }
    }, [bbox.width, bbox.height, mask]);

    useEffect(() => {
        mask.renderToOverlay(canvasRef.current);
    }, [mask, mask.maskVersion]);

    useEffect(() => {
        if (!disabled) return;
        releaseCapture();
    }, [disabled, releaseCapture]);

    // Safety net: release pointer capture even if the main thread lagged and
    // pointerup on the canvas was missed.
    useEffect(() => {
        const onGlobalPointerEnd = () => {
            if (!drawingRef.current) return;
            releaseCapture();
            mask.endStroke();
        };
        window.addEventListener("pointerup", onGlobalPointerEnd);
        window.addEventListener("pointercancel", onGlobalPointerEnd);
        return () => {
            window.removeEventListener("pointerup", onGlobalPointerEnd);
            window.removeEventListener("pointercancel", onGlobalPointerEnd);
        };
    }, [mask, releaseCapture]);

    const updateCursor = useCallback(
        (point: { x: number; y: number } | null) => {
            const ring = cursorRef.current;
            if (!ring) return;
            if (!point || disabled) {
                ring.style.visibility = "hidden";
                return;
            }
            ring.style.visibility = "visible";
            ring.style.transform = `translate(${point.x - mask.brushSize / 2}px, ${point.y - mask.brushSize / 2}px)`;
            ring.style.width = `${mask.brushSize}px`;
            ring.style.height = `${mask.brushSize}px`;
            ring.style.borderColor = mask.eraserActive
                ? "rgba(239, 68, 68, 0.95)"
                : "rgba(99, 102, 241, 0.95)";
            ring.style.background = mask.eraserActive
                ? "rgba(239, 68, 68, 0.10)"
                : "rgba(99, 102, 241, 0.10)";
        },
        [disabled, mask.brushSize, mask.eraserActive],
    );

    const localPointFromEvent = useCallback(
        (e: ReactPointerEvent<HTMLCanvasElement>) => {
            const canvas = canvasRef.current;
            if (!canvas) return null;
            const rect = canvas.getBoundingClientRect();
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
        if (e.button !== undefined && e.button !== 0) return;
        const point = localPointFromEvent(e);
        if (!point) return;
        drawingRef.current = true;
        captureTargetRef.current = e.currentTarget;
        capturePointerIdRef.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        mask.beginStroke(point);
        updateCursor(point);
    };

    const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        const point = localPointFromEvent(e);
        if (!point) return;
        updateCursor(point);
        if (!drawingRef.current || disabled) return;
        mask.extendStroke(point);
    };

    const finishStroke = (_e: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current) return;
        releaseCapture();
        mask.endStroke();
    };

    const onPointerLeave = () => {
        updateCursor(null);
    };

    return (
        <div
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
            <div
                ref={cursorRef}
                className="pointer-events-none absolute left-0 top-0 rounded-full border-2 will-change-transform"
                style={{
                    visibility: "hidden",
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
                }}
            />
        </div>
    );
}
