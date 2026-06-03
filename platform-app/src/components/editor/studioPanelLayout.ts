export const STUDIO_LEFT_TOP_RATIO_STORAGE_KEY = "studio:leftTopPanelRatio";
export const STUDIO_LEFT_TOP_DEFAULT_RATIO = 0.4;
export const STUDIO_LEFT_TOP_MIN_HEIGHT = 160;
export const STUDIO_LEFT_LAYERS_MIN_HEIGHT = 220;

function isFiniteNumber(value: number) {
    return Number.isFinite(value) && !Number.isNaN(value);
}

export function clampStudioLeftTopRatio(
    ratio: number,
    railHeight: number,
    topMinHeight = STUDIO_LEFT_TOP_MIN_HEIGHT,
    layersMinHeight = STUDIO_LEFT_LAYERS_MIN_HEIGHT,
) {
    if (!isFiniteNumber(ratio)) return STUDIO_LEFT_TOP_DEFAULT_RATIO;
    if (!isFiniteNumber(railHeight) || railHeight <= 0) return STUDIO_LEFT_TOP_DEFAULT_RATIO;

    const minTotal = topMinHeight + layersMinHeight;
    if (railHeight <= minTotal) {
        return topMinHeight / minTotal;
    }

    const minRatio = topMinHeight / railHeight;
    const maxRatio = (railHeight - layersMinHeight) / railHeight;
    return Math.min(Math.max(ratio, minRatio), maxRatio);
}

export function studioLeftTopRatioFromPointer(
    pointerY: number,
    railTop: number,
    railHeight: number,
    topMinHeight = STUDIO_LEFT_TOP_MIN_HEIGHT,
    layersMinHeight = STUDIO_LEFT_LAYERS_MIN_HEIGHT,
) {
    if (!isFiniteNumber(pointerY) || !isFiniteNumber(railTop)) {
        return STUDIO_LEFT_TOP_DEFAULT_RATIO;
    }

    return clampStudioLeftTopRatio(
        (pointerY - railTop) / railHeight,
        railHeight,
        topMinHeight,
        layersMinHeight,
    );
}
