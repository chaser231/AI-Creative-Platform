import { describe, it, expect } from "vitest";
import type { TextLayer } from "@/types";
import { getTextTrimMetrics, measureTextLayer } from "@/utils/layoutEngine";

function makeText(overrides: Partial<TextLayer> = {}): TextLayer {
    return {
        id: "t",
        type: "text",
        name: "t",
        x: 0,
        y: 0,
        width: 200,
        height: 40,
        rotation: 0,
        visible: true,
        locked: false,
        text: "Hello",
        fontSize: 100,
        fontFamily: "Inter",
        fontWeight: "400",
        fill: "#000000",
        align: "left",
        letterSpacing: 0,
        lineHeight: 2,
        textAdjust: "auto_width",
        ...overrides,
    } as TextLayer;
}

describe("vertical trim", () => {
    it("reports a positive trim offset when line-height adds leading", () => {
        const { offsetY } = getTextTrimMetrics(makeText({ lineHeight: 2 }));
        expect(offsetY).toBeGreaterThan(0);
    });

    it("produces a shorter container than the untrimmed measurement", () => {
        const base = measureTextLayer(makeText({ verticalTrim: false }));
        const trimmed = measureTextLayer(makeText({ verticalTrim: true }));
        expect(trimmed.height).toBeLessThan(base.height);
        expect(trimmed.width).toBe(base.width);
    });

    it("never trims a fixed-size text layer", () => {
        const fixed = makeText({ textAdjust: "fixed", verticalTrim: true, width: 200, height: 80 });
        expect(measureTextLayer(fixed)).toEqual({ width: 200, height: 80 });
    });
});
