"use client";

import { useCallback, useRef } from "react";
import { useOptionalSharedInpaintMask } from "@/components/inpaint/InpaintContext";
import { useCanvasStore } from "@/store/canvasStore";

export interface ExitCanvasEditModeOptions {
    /** When true (default), clears inpaint brush strokes from shared context. */
    clearMask?: boolean;
}

/**
 * Central hook for leaving exclusive canvas edit modes (inpaint + expand).
 * Resets Zustand flags and optionally clears the shared inpaint mask buffer.
 */
export function useCanvasEditMode() {
    const exitCanvasEditModes = useCanvasStore((s) => s.exitCanvasEditModes);
    const inpaintMask = useOptionalSharedInpaintMask();
    const inpaintMaskRef = useRef(inpaintMask);
    inpaintMaskRef.current = inpaintMask;

    const exitCanvasEditMode = useCallback(
        (opts: ExitCanvasEditModeOptions = {}) => {
            exitCanvasEditModes();
            if (opts.clearMask !== false) {
                inpaintMaskRef.current?.clear();
            }
        },
        [exitCanvasEditModes],
    );

    return { exitCanvasEditMode };
}
