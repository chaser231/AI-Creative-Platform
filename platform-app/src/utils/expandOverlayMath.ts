/**
 * Pure padding math for Generative Expand overlay handles.
 * Extracted for unit tests without Konva.
 */

/** Matches FLUX2_PER_SIDE_CAP in outpaintPipeline.ts */
export const EXPAND_MAX_PADDING = 2048;

export function clampPadding(value: number, max = EXPAND_MAX_PADDING): number {
    return Math.max(0, Math.min(max, Math.round(value)));
}

export function computeTopPadding(origY: number, handleY: number, max = EXPAND_MAX_PADDING): number {
    return clampPadding(origY - handleY, max);
}

export function computeBottomPadding(
    origY: number,
    origH: number,
    handleY: number,
    max = EXPAND_MAX_PADDING,
): number {
    return clampPadding(handleY - (origY + origH), max);
}

export function computeLeftPadding(origX: number, handleX: number, max = EXPAND_MAX_PADDING): number {
    return clampPadding(origX - handleX, max);
}

export function computeRightPadding(
    origX: number,
    origW: number,
    handleX: number,
    max = EXPAND_MAX_PADDING,
): number {
    return clampPadding(handleX - (origX + origW), max);
}

/** Allow handles to move outside artboard bounds while dragging. */
export function expandHandleDragBound(
    pos: { x: number; y: number },
    canvasW: number,
    canvasH: number,
    maxPad = EXPAND_MAX_PADDING,
): { x: number; y: number } {
    return {
        x: Math.max(-maxPad, Math.min(pos.x, canvasW + maxPad)),
        y: Math.max(-maxPad, Math.min(pos.y, canvasH + maxPad)),
    };
}
