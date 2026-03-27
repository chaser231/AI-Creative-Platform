/**
 * Image Fit Utilities
 *
 * Computes Konva props for rendering images with different objectFit modes.
 * Used by both Canvas.tsx and PreviewCanvas.tsx.
 */

import type { ImageFitMode } from "@/types";

export interface ImageFitResult {
    /** Konva crop region (source image coordinates) */
    cropX: number;
    cropY: number;
    cropWidth: number;
    cropHeight: number;
    /** Draw dimensions on canvas */
    drawWidth: number;
    drawHeight: number;
    /** Offset within the container (for contain mode centering) */
    drawX: number;
    drawY: number;
}

/**
 * Compute Konva Image crop & draw props for a given objectFit mode.
 *
 * @param mode       - The fit mode: cover, contain, fill, crop
 * @param naturalW   - Source image natural width (pixels)
 * @param naturalH   - Source image natural height (pixels)
 * @param containerW - Layer/container width on canvas
 * @param containerH - Layer/container height on canvas
 */
export function computeImageFitProps(
    mode: ImageFitMode | undefined,
    naturalW: number,
    naturalH: number,
    containerW: number,
    containerH: number,
): ImageFitResult {
    const effectiveMode = mode || "cover";

    if (naturalW <= 0 || naturalH <= 0 || containerW <= 0 || containerH <= 0) {
        return {
            cropX: 0, cropY: 0,
            cropWidth: naturalW, cropHeight: naturalH,
            drawWidth: containerW, drawHeight: containerH,
            drawX: 0, drawY: 0,
        };
    }

    const imgRatio = naturalW / naturalH;
    const containerRatio = containerW / containerH;

    switch (effectiveMode) {
        case "cover": {
            // Scale source to fill container, crop excess
            let cropW: number, cropH: number;
            if (imgRatio > containerRatio) {
                // Image wider — crop horizontally
                cropH = naturalH;
                cropW = naturalH * containerRatio;
            } else {
                // Image taller — crop vertically
                cropW = naturalW;
                cropH = naturalW / containerRatio;
            }
            const cropX = (naturalW - cropW) / 2;
            const cropY = (naturalH - cropH) / 2;
            return {
                cropX, cropY, cropWidth: cropW, cropHeight: cropH,
                drawWidth: containerW, drawHeight: containerH,
                drawX: 0, drawY: 0,
            };
        }

        case "contain": {
            // Scale source to fit within container, letterbox
            let drawW: number, drawH: number;
            if (imgRatio > containerRatio) {
                // Fit width
                drawW = containerW;
                drawH = containerW / imgRatio;
            } else {
                // Fit height
                drawH = containerH;
                drawW = containerH * imgRatio;
            }
            const drawX = (containerW - drawW) / 2;
            const drawY = (containerH - drawH) / 2;
            return {
                cropX: 0, cropY: 0,
                cropWidth: naturalW, cropHeight: naturalH,
                drawWidth: drawW, drawHeight: drawH,
                drawX, drawY,
            };
        }

        case "fill": {
            // Stretch to container dimensions (default Konva behavior)
            return {
                cropX: 0, cropY: 0,
                cropWidth: naturalW, cropHeight: naturalH,
                drawWidth: containerW, drawHeight: containerH,
                drawX: 0, drawY: 0,
            };
        }

        case "crop": {
            // Show at natural 1:1 scale, centered, clip overflow
            const cropW = Math.min(naturalW, containerW);
            const cropH = Math.min(naturalH, containerH);
            const cropX = (naturalW - cropW) / 2;
            const cropY = (naturalH - cropH) / 2;

            // If image is smaller than container, center it
            const drawW = Math.min(naturalW, containerW);
            const drawH = Math.min(naturalH, containerH);
            const drawX = (containerW - drawW) / 2;
            const drawY = (containerH - drawH) / 2;

            return {
                cropX, cropY, cropWidth: cropW, cropHeight: cropH,
                drawWidth: drawW, drawHeight: drawH,
                drawX, drawY,
            };
        }

        default:
            return {
                cropX: 0, cropY: 0,
                cropWidth: naturalW, cropHeight: naturalH,
                drawWidth: containerW, drawHeight: containerH,
                drawX: 0, drawY: 0,
            };
    }
}
