import { describe, it, expect } from "vitest";
import type { TextLayer } from "@/types";
import { measureTextLayer } from "@/utils/layoutEngine";

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
        fontSize: 16,
        fontFamily: "Inter",
        fontWeight: "400",
        fill: "#000000",
        align: "left",
        letterSpacing: 0,
        lineHeight: 1.5,
        textAdjust: "auto_width",
        ...overrides,
    } as TextLayer;
}

describe("fixed truncateText measurement", () => {
    it("measures single-line height for fixed+truncateText, not wrapped multi-line height", () => {
        const longText = Array.from({ length: 40 }, () => "word").join(" ");
        const layer = makeText({
            textAdjust: "fixed",
            truncateText: true,
            width: 120,
            height: 200,
            text: longText,
            fontSize: 16,
            lineHeight: 1.5,
        });

        const measured = measureTextLayer(layer);
        const singleLineHeight = 16 * 1.5;

        expect(measured.width).toBe(120);
        expect(measured.height).toBeLessThanOrEqual(singleLineHeight + 1);
        expect(measured.height).toBeLessThan(200);
    });

    it("returns stored box dimensions for fixed text without truncateText", () => {
        const layer = makeText({
            textAdjust: "fixed",
            truncateText: false,
            width: 120,
            height: 200,
        });

        expect(measureTextLayer(layer)).toEqual({ width: 120, height: 200 });
    });

    it("does not apply vertical trim to fixed truncate text", () => {
        const layer = makeText({
            textAdjust: "fixed",
            truncateText: true,
            verticalTrim: true,
            width: 120,
            height: 200,
            fontSize: 16,
            lineHeight: 1.5,
        });

        const measured = measureTextLayer(layer);
        expect(measured.height).toBe(16 * 1.5);
    });
});
