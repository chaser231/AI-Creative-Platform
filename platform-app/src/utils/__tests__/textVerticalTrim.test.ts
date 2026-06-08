import { describe, it, expect } from "vitest";
import type { TextLayer } from "@/types";
import { getTextTrimMetrics, isTextTrimActive, measureTextLayer } from "@/utils/layoutEngine";

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
    it("reports positive top/bottom trim when line-height adds leading", () => {
        const { top, bottom, total } = getTextTrimMetrics(makeText({ lineHeight: 2 }));
        expect(top).toBeGreaterThan(0);
        expect(bottom).toBeGreaterThan(0);
        expect(total).toBeCloseTo(top + bottom);
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

    it("baseline trim cuts further than vertical trim (removes the descender)", () => {
        const vertical = getTextTrimMetrics(makeText({ verticalTrim: true }));
        const baseline = getTextTrimMetrics(makeText({ baselineTrim: true }));
        expect(baseline.bottom).toBeGreaterThan(vertical.bottom);
        expect(baseline.total).toBeGreaterThan(vertical.total);

        const verticalH = measureTextLayer(makeText({ verticalTrim: true }));
        const baselineH = measureTextLayer(makeText({ baselineTrim: true }));
        expect(baselineH.height).toBeLessThan(verticalH.height);
    });

    it("isTextTrimActive reflects either trim mode and ignores fixed sizing", () => {
        expect(isTextTrimActive(makeText({ verticalTrim: true }))).toBe(true);
        expect(isTextTrimActive(makeText({ baselineTrim: true }))).toBe(true);
        expect(isTextTrimActive(makeText({}))).toBe(false);
        expect(isTextTrimActive(makeText({ baselineTrim: true, textAdjust: "fixed" }))).toBe(false);
    });
});
