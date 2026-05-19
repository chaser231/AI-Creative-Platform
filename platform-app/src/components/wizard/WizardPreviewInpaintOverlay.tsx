"use client";

import { useMemo } from "react";
import type { ImageLayer } from "@/types";
import { useSharedInpaintMask } from "@/components/inpaint/InpaintContext";
import { InpaintMaskOverlay } from "@/components/inpaint/InpaintMaskOverlay";
import { computeWizardPreviewLayerBbox } from "@/utils/wizardPreviewInpaint";

interface WizardPreviewInpaintOverlayProps {
    layer: ImageLayer;
    artboardWidth: number;
    artboardHeight: number;
    containerWidth: number;
    containerHeight: number;
    zoom: number;
    appearance: "light" | "dark";
    disabled?: boolean;
}

/**
 * DOM mask overlay aligned to an image layer inside wizard PreviewCanvas.
 * Must be rendered inside InpaintProvider + a relative host sized to the
 * PreviewCanvas container.
 */
export function WizardPreviewInpaintOverlay({
    layer,
    artboardWidth,
    artboardHeight,
    containerWidth,
    containerHeight,
    zoom,
    appearance,
    disabled = false,
}: WizardPreviewInpaintOverlayProps) {
    const mask = useSharedInpaintMask();

    const rotation = layer.rotation ?? 0;
    const hasRotation = Math.abs(rotation) > 0.01;

    const bbox = useMemo(
        () =>
            computeWizardPreviewLayerBbox({
                layerX: layer.x,
                layerY: layer.y,
                layerWidth: layer.width,
                layerHeight: layer.height,
                artboardWidth,
                artboardHeight,
                containerWidth,
                containerHeight,
                zoom,
                appearance,
            }),
        [
            layer.x,
            layer.y,
            layer.width,
            layer.height,
            artboardWidth,
            artboardHeight,
            containerWidth,
            containerHeight,
            zoom,
            appearance,
        ],
    );

    if (hasRotation) {
        return (
            <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full border border-amber-500/30 bg-amber-500/15 px-3 py-1 text-[11px] text-amber-600 backdrop-blur-md">
                Сбросьте поворот слоя, чтобы рисовать inpaint-маску
            </div>
        );
    }

    return (
        <InpaintMaskOverlay
            bbox={bbox}
            mask={mask}
            disabled={disabled}
            zIndex={30}
        />
    );
}
