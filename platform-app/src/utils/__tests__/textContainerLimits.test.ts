import { describe, expect, it } from "vitest";
import type { TextLayer } from "@/types";
import {
    applyTextContainerLimits,
    getMaxLinesCapHeight,
    shouldUseTextEllipsis,
} from "@/utils/textContainerLimits";
import { measureTextLayer } from "@/utils/layoutEngine";

function makeText(overrides: Partial<TextLayer> = {}): TextLayer {
    return {
        id: "t",
        type: "text",
        name: "t",
        x: 0,
        y: 0,
        width: 200,
        height: 120,
        rotation: 0,
        visible: true,
        locked: false,
        text: "Hello",
        fontSize: 16,
        fontFamily: "Inter",
        fontWeight: "400",
        fill: "#000000",
        align: "left",
        letterSpacing: 0,
        lineHeight: 1.5,
        textAdjust: "fixed",
        ...overrides,
    } as TextLayer;
}

describe("textContainerLimits", () => {
    it("computes maxLines cap height from font metrics", () => {
        const layer = makeText({
            responsive: { maxLines: 2 },
            fontSize: 20,
            lineHeight: 1.2,
        });
        expect(getMaxLinesCapHeight(layer)).toBe(48);
    });

    it("floors the maxLines cap at 1em per line so line-height < 1 doesn't collapse the box", () => {
        // Regression: cap = maxLines * fontSize * lineHeight used to collapse with
        // line-height (e.g. 1% -> ~0.5px), clamping the container into a thin strip
        // even though glyph ink stays full height. Per-line height is floored to 1em.
        const tight = makeText({ responsive: { maxLines: 1 }, fontSize: 52, lineHeight: 0.01 });
        expect(getMaxLinesCapHeight(tight)).toBe(52);
        // Cap is unchanged for the normal (>= 1) line-height range.
        const normal = makeText({ responsive: { maxLines: 2 }, fontSize: 52, lineHeight: 1.2 });
        expect(getMaxLinesCapHeight(normal)).toBeCloseTo(2 * 52 * 1.2, 5);
    });

    it("clamps width and height to responsive min/max", () => {
        const layer = makeText({
            width: 500,
            height: 20,
            responsive: { minWidth: 120, maxWidth: 300, minHeight: 40, maxHeight: 80 },
        });
        const next = applyTextContainerLimits(layer);
        expect(next.width).toBe(300);
        expect(next.height).toBe(40);
    });

    it("caps height to maxLines after remeasure overflow", () => {
        const layer = makeText({
            width: 120,
            height: 200,
            responsive: { maxLines: 2 },
            fontSize: 16,
            lineHeight: 1.5,
        });
        const next = applyTextContainerLimits(layer);
        expect(next.height).toBe(48);
    });

    it("enables ellipsis when maxLines is set", () => {
        expect(shouldUseTextEllipsis(makeText({ responsive: { maxLines: 2 } }))).toBe(true);
        expect(shouldUseTextEllipsis(makeText({ truncateText: true }))).toBe(true);
        expect(shouldUseTextEllipsis(makeText())).toBe(false);
    });

    it("measures fixed text height capped by maxLines in layout engine", () => {
        const longText = Array.from({ length: 40 }, () => "word").join(" ");
        const layer = makeText({
            textAdjust: "fixed",
            width: 120,
            height: 200,
            text: longText,
            responsive: { maxLines: 2 },
            fontSize: 16,
            lineHeight: 1.5,
        });

        const measured = measureTextLayer(layer);
        expect(measured.height).toBeLessThanOrEqual(48 + 1);
        expect(measured.height).toBeLessThan(200);
    });
});
