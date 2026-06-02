import { computeImageFitProps } from "@/utils/imageFitUtils";
import type { ImageFitMode } from "@/types";

export interface StudioOutpaintLayerView {
    width: number;
    height: number;
    objectFit?: ImageFitMode;
    focusX?: number;
    focusY?: number;
}

export interface StudioOutpaintRasterPlan {
    changed: boolean;
    canvasWidth: number;
    canvasHeight: number;
    source: { x: number; y: number; width: number; height: number };
    dest: { x: number; y: number; width: number; height: number };
}

function nearlyEqual(a: number, b: number): boolean {
    return Math.abs(a - b) <= 1;
}

export function computeStudioOutpaintRasterPlan(
    sourceSize: { width: number; height: number },
    layer: StudioOutpaintLayerView,
): StudioOutpaintRasterPlan {
    const naturalW = Math.max(1, Math.round(sourceSize.width));
    const naturalH = Math.max(1, Math.round(sourceSize.height));
    const layerW = Math.max(1, layer.width);
    const layerH = Math.max(1, layer.height);
    const layerAspect = layerW / layerH;
    const mode = layer.objectFit ?? "cover";
    const fit = computeImageFitProps(
        mode,
        naturalW,
        naturalH,
        layerW,
        layerH,
        { focusX: layer.focusX, focusY: layer.focusY },
    );

    if (mode === "cover") {
        const cropX = Math.max(0, Math.round(fit.cropX));
        const cropY = Math.max(0, Math.round(fit.cropY));
        const cropW = Math.max(1, Math.min(naturalW - cropX, Math.round(fit.cropWidth)));
        const cropH = Math.max(1, Math.min(naturalH - cropY, Math.round(fit.cropHeight)));
        const changed = cropX !== 0 || cropY !== 0 || cropW !== naturalW || cropH !== naturalH;
        return {
            changed,
            canvasWidth: cropW,
            canvasHeight: cropH,
            source: { x: cropX, y: cropY, width: cropW, height: cropH },
            dest: { x: 0, y: 0, width: cropW, height: cropH },
        };
    }

    if (mode === "fill") {
        const targetW = naturalW;
        const targetH = Math.max(1, Math.round(targetW / layerAspect));
        return {
            changed: !nearlyEqual(targetH, naturalH),
            canvasWidth: targetW,
            canvasHeight: targetH,
            source: { x: 0, y: 0, width: naturalW, height: naturalH },
            dest: { x: 0, y: 0, width: targetW, height: targetH },
        };
    }

    if (mode === "contain") {
        const scaleX = fit.drawWidth > 0 ? naturalW / fit.drawWidth : 1;
        const scaleY = fit.drawHeight > 0 ? naturalH / fit.drawHeight : 1;
        const pixelScale = Math.max(scaleX, scaleY, 1);
        const canvasW = Math.max(1, Math.round(layerW * pixelScale));
        const canvasH = Math.max(1, Math.round(layerH * pixelScale));
        const dest = {
            x: Math.round(fit.drawX * pixelScale),
            y: Math.round(fit.drawY * pixelScale),
            width: Math.max(1, Math.round(fit.drawWidth * pixelScale)),
            height: Math.max(1, Math.round(fit.drawHeight * pixelScale)),
        };
        const fillsCanvas = dest.x === 0
            && dest.y === 0
            && nearlyEqual(dest.width, canvasW)
            && nearlyEqual(dest.height, canvasH);
        return {
            changed: !fillsCanvas || !nearlyEqual(canvasW, naturalW) || !nearlyEqual(canvasH, naturalH),
            canvasWidth: canvasW,
            canvasHeight: canvasH,
            source: { x: 0, y: 0, width: naturalW, height: naturalH },
            dest,
        };
    }

    const cropX = Math.max(0, Math.round(fit.cropX));
    const cropY = Math.max(0, Math.round(fit.cropY));
    const cropW = Math.max(1, Math.min(naturalW - cropX, Math.round(fit.cropWidth)));
    const cropH = Math.max(1, Math.min(naturalH - cropY, Math.round(fit.cropHeight)));
    return {
        changed: true,
        canvasWidth: Math.max(1, Math.round(layerW)),
        canvasHeight: Math.max(1, Math.round(layerH)),
        source: { x: cropX, y: cropY, width: cropW, height: cropH },
        dest: {
            x: Math.round(fit.drawX),
            y: Math.round(fit.drawY),
            width: Math.max(1, Math.round(fit.drawWidth)),
            height: Math.max(1, Math.round(fit.drawHeight)),
        },
    };
}
