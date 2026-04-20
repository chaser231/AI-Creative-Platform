"use client";

import { Group, Image as KonvaImage } from "react-konva";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import { computeImageFitProps } from "@/utils/imageFitUtils";
import { useImage } from "./useImage";
import type { ImageFitMode } from "@/types";

/**
 * Renders the artboard's global background image (if any) inside the
 * artboard group, between the solid `fill` rect and the user layers.
 * It is non-interactive and does not participate in selection/hit-testing.
 *
 * Honours `cornerRadius` even when the parent group does NOT clip
 * (so the image doesn't bleed past the rounded artboard corners).
 */
export function ArtboardBackgroundRenderer() {
    const { backgroundImage, canvasWidth, canvasHeight, cornerRadius } = useCanvasStore(
        useShallow((s) => ({
            backgroundImage: s.artboardProps.backgroundImage,
            canvasWidth: s.canvasWidth,
            canvasHeight: s.canvasHeight,
            cornerRadius: s.artboardProps.cornerRadius || 0,
        }))
    );

    const img = useImage(backgroundImage?.src ?? "");

    if (!backgroundImage?.src || !img) return null;

    // ArtboardBackgroundFit is a strict subset of ImageFitMode ("cover" | "contain" | "fill"),
    // so the cast below is safe at runtime.
    const fit = backgroundImage.fit as ImageFitMode;
    const fitProps = computeImageFitProps(
        fit,
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        canvasWidth,
        canvasHeight,
        { focusX: backgroundImage.focusX, focusY: backgroundImage.focusY },
    );

    const image = (
        <KonvaImage
            image={img}
            x={fitProps.drawX}
            y={fitProps.drawY}
            width={fitProps.drawWidth}
            height={fitProps.drawHeight}
            crop={{
                x: fitProps.cropX,
                y: fitProps.cropY,
                width: fitProps.cropWidth,
                height: fitProps.cropHeight,
            }}
            opacity={backgroundImage.opacity ?? 1}
            listening={false}
        />
    );

    // If the artboard has rounded corners, clip the background to match — even
    // when the parent doesn't clip (e.g. clipContent === false).
    if (cornerRadius > 0) {
        const r = Math.min(cornerRadius, Math.min(canvasWidth, canvasHeight) / 2);
        return (
            <Group
                listening={false}
                clipFunc={(ctx) => {
                    ctx.beginPath();
                    ctx.moveTo(r, 0);
                    ctx.arcTo(canvasWidth, 0, canvasWidth, canvasHeight, r);
                    ctx.arcTo(canvasWidth, canvasHeight, 0, canvasHeight, r);
                    ctx.arcTo(0, canvasHeight, 0, 0, r);
                    ctx.arcTo(0, 0, canvasWidth, 0, r);
                    ctx.closePath();
                }}
            >
                {image}
            </Group>
        );
    }

    return image;
}
