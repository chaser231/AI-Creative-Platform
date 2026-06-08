import type { TextLayer } from "@/types";

/** Max visible height from `responsive.maxLines`, if set. */
export function getMaxLinesCapHeight(text: TextLayer): number | undefined {
    const maxLines = text.responsive?.maxLines;
    if (!maxLines || maxLines < 1) return undefined;
    return maxLines * text.fontSize * (text.lineHeight || 1.2);
}

function clampDimension(value: number, min?: number, max?: number): number {
    let next = value;
    if (min != null && Number.isFinite(min) && min > 0) next = Math.max(next, min);
    if (max != null && Number.isFinite(max) && max > 0) next = Math.min(next, max);
    return next;
}

/** Clamp adapted text box to responsive min/max and maxLines cap. */
export function applyTextContainerLimits(text: TextLayer): TextLayer {
    const responsive = text.responsive;
    const capHeight = getMaxLinesCapHeight(text);
    const hasLimits = responsive && (
        capHeight != null
        || responsive.minWidth != null
        || responsive.maxWidth != null
        || responsive.minHeight != null
        || responsive.maxHeight != null
    );
    if (!hasLimits) return text;

    let width = clampDimension(text.width, responsive?.minWidth, responsive?.maxWidth);
    let height = clampDimension(text.height, responsive?.minHeight, responsive?.maxHeight);
    if (capHeight != null) height = Math.min(height, capHeight);

    if (Math.abs(width - text.width) < 0.01 && Math.abs(height - text.height) < 0.01) {
        return text;
    }
    return { ...text, width, height };
}

export function shouldUseTextEllipsis(text: TextLayer): boolean {
    if (text.truncateText) return true;
    const maxLines = text.responsive?.maxLines;
    return !!maxLines && maxLines >= 1;
}

/** Fixed-box render height when maxLines caps visible lines. */
export function getEffectiveTextRenderHeight(text: TextLayer): number {
    const capHeight = getMaxLinesCapHeight(text);
    if (capHeight != null) return Math.min(text.height, capHeight);
    return text.height;
}
