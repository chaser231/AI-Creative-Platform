/**
 * Screen-space bbox helpers for wizard inpaint overlay on PreviewCanvas.
 *
 * Mirrors the scale / centering math in PreviewCanvas.tsx so the DOM
 * mask overlay aligns with Konva layer positions.
 */

export interface WizardPreviewLayerBbox {
    left: number;
    top: number;
    width: number;
    height: number;
}

export function computeWizardPreviewScale(params: {
    artboardWidth: number;
    artboardHeight: number;
    containerWidth: number;
    containerHeight: number;
    zoom: number;
    appearance: "light" | "dark";
}): { scale: number; stageX: number; stageY: number } {
    const padding = params.appearance === "dark" ? 32 : 40;
    const availableWidth = Math.max(1, params.containerWidth - padding * 2);
    const availableHeight = Math.max(1, params.containerHeight - padding * 2);

    let scale = Math.min(
        availableWidth / params.artboardWidth,
        availableHeight / params.artboardHeight,
    );
    if (scale > 1) scale = 1;
    scale *= params.zoom;

    const stageX = (params.containerWidth - params.artboardWidth * scale) / 2;
    const stageY = (params.containerHeight - params.artboardHeight * scale) / 2;

    return { scale, stageX, stageY };
}

export function computeWizardPreviewLayerBbox(params: {
    layerX: number;
    layerY: number;
    layerWidth: number;
    layerHeight: number;
    artboardWidth: number;
    artboardHeight: number;
    containerWidth: number;
    containerHeight: number;
    zoom: number;
    appearance: "light" | "dark";
}): WizardPreviewLayerBbox {
    const { scale, stageX, stageY } = computeWizardPreviewScale(params);
    return {
        left: stageX + params.layerX * scale,
        top: stageY + params.layerY * scale,
        width: params.layerWidth * scale,
        height: params.layerHeight * scale,
    };
}
