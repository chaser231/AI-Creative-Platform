"use client";

import { Group, Image as KonvaImage } from "react-konva";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import { computeImageFitProps } from "@/utils/imageFitUtils";
import { useImage } from "./useImage";
import type { CornerRadii, ImageFitMode } from "@/types";

function resolveCornerRadius(cornerRadius = 0, cornerRadii?: CornerRadii): [number, number, number, number] {
    return [
        cornerRadii?.topLeft ?? cornerRadius,
        cornerRadii?.topRight ?? cornerRadius,
        cornerRadii?.bottomRight ?? cornerRadius,
        cornerRadii?.bottomLeft ?? cornerRadius,
    ];
}

/**
 * Renders the artboard's global background image (if any) inside the
 * artboard group, between the solid `fill` rect and the user layers.
 * It is non-interactive and does not participate in selection/hit-testing.
 *
 * Honours `cornerRadius` even when the parent group does NOT clip
 * (so the image doesn't bleed past the rounded artboard corners).
 */
export function ArtboardBackgroundRenderer() {
    const { backgroundImage, fillEnabled, canvasWidth, canvasHeight, cornerRadius, cornerRadii } = useCanvasStore(
        useShallow((s) => ({
            backgroundImage: s.artboardProps.backgroundImage,
            fillEnabled: s.artboardProps.fillEnabled !== false,
            canvasWidth: s.canvasWidth,
            canvasHeight: s.canvasHeight,
            cornerRadius: s.artboardProps.cornerRadius || 0,
            cornerRadii: s.artboardProps.cornerRadii,
        }))
    );

    const img = useImage(backgroundImage?.src ?? "");

    if (!fillEnabled || !backgroundImage?.src || !img) return null;

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
            name="export-artboard-background"
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
    const [tl, tr, br, bl] = resolveCornerRadius(cornerRadius, cornerRadii)
        .map((radius) => Math.min(Math.max(0, radius), Math.min(canvasWidth, canvasHeight) / 2)) as [number, number, number, number];
    if (tl > 0 || tr > 0 || br > 0 || bl > 0) {
        return (
            <Group
                name="export-artboard-background"
                listening={false}
                clipFunc={(ctx) => {
                    ctx.beginPath();
                    ctx.moveTo(tl, 0);
                    ctx.lineTo(canvasWidth - tr, 0);
                    ctx.arcTo(canvasWidth, 0, canvasWidth, tr, tr);
                    ctx.lineTo(canvasWidth, canvasHeight - br);
                    ctx.arcTo(canvasWidth, canvasHeight, canvasWidth - br, canvasHeight, br);
                    ctx.lineTo(bl, canvasHeight);
                    ctx.arcTo(0, canvasHeight, 0, canvasHeight - bl, bl);
                    ctx.lineTo(0, tl);
                    ctx.arcTo(0, 0, tl, 0, tl);
                    ctx.closePath();
                }}
            >
                {image}
            </Group>
        );
    }

    return image;
}
