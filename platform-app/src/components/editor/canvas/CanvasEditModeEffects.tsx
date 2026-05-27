"use client";

/**
 * Side-effects for canvas edit modes that require React context (inpaint mask).
 * Mount inside InpaintProvider on Studio editor surfaces.
 */

import { useEffect, useRef } from "react";
import { useOptionalSharedInpaintMask } from "@/components/inpaint/InpaintContext";
import { useCanvasStore } from "@/store/canvasStore";

export function CanvasEditModeEffects() {
    const inpaintMode = useCanvasStore((s) => s.inpaintMode);
    const inpaintMask = useOptionalSharedInpaintMask();
    const inpaintMaskRef = useRef(inpaintMask);
    inpaintMaskRef.current = inpaintMask;
    const wasInpaintActiveRef = useRef(false);

    // Clear brush strokes whenever inpaint mode turns off (selection change,
    // prompt bar close, explicit cancel, etc.).
    useEffect(() => {
        if (wasInpaintActiveRef.current && !inpaintMode) {
            inpaintMaskRef.current?.clear();
        }
        wasInpaintActiveRef.current = inpaintMode;
    }, [inpaintMode]);

    return null;
}
