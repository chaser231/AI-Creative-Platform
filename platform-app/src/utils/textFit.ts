import type { TextLayer } from "@/types";
import { measureTextLayer, measureWrappedTextContent } from "@/utils/layoutEngine";

const SHRINK_SEARCH_ITERATIONS = 7;

function roundFontSize(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * Shrinks fontSize so fixed-width text fits within the layer height.
 * Used on the adaptation path when `responsive.textFit === "shrink"`.
 */
export function shrinkTextToFitBox(text: TextLayer): TextLayer {
    if (text.responsive?.textFit !== "shrink") return text;
    if (text.responsive?.behavior === "fixed") return text;
    if ((text.textAdjust ?? "auto_width") !== "fixed") return text;
    if (!(text.width > 0) || !(text.height > 0)) return text;

    const minFontSize = text.responsive?.minFontSize ?? 8;
    const maxFontSize = text.fontSize;
    if (maxFontSize <= minFontSize) return text;

    const fits = (fontSize: number) => (
        measureWrappedTextContent(text, text.width, { fontSize }).height <= text.height + 0.5
    );

    if (fits(maxFontSize)) return text;

    let lo = minFontSize;
    let hi = maxFontSize;
    let best = minFontSize;

    for (let i = 0; i < SHRINK_SEARCH_ITERATIONS; i += 1) {
        const mid = roundFontSize((lo + hi) / 2);
        if (fits(mid)) {
            best = mid;
            lo = mid;
        } else {
            hi = mid;
        }
        if (hi - lo < 0.25) break;
    }

    const nextFontSize = roundFontSize(best);
    if (Math.abs(nextFontSize - text.fontSize) < 0.01) return text;
    const sized = measureTextLayer({ ...text, fontSize: nextFontSize }, text.width);
    return {
        ...text,
        fontSize: nextFontSize,
        height: Math.min(text.height, sized.height),
    };
}
