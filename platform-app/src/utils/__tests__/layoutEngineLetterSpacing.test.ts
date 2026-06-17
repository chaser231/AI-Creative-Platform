import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Konva from "konva";
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
        text: "на заказ цветов",
        fontSize: 30,
        fontFamily: "Arial",
        fontWeight: "400",
        fill: "#000000",
        align: "left",
        letterSpacing: -0.7,
        lineHeight: 0.9,
        textAdjust: "auto_width",
        ...overrides,
    } as TextLayer;
}

function measureKonvaLegacyWidth(text: string, letterSpacing: number, fontSize: number): number {
    const node = new Konva.Text({
        text,
        fontSize,
        fontFamily: "Arial",
        letterSpacing,
        wrap: "none",
    });
    return node.width();
}

function measureKonvaPerCharWidth(text: string, letterSpacing: number, fontSize: number): number {
    const node = new Konva.Text({
        text,
        fontSize,
        fontFamily: "Arial",
        letterSpacing,
        wrap: "none",
    });
    let width = 0;
    for (const ch of text) {
        width += node.measureSize(ch).width + letterSpacing;
    }
    return width;
}

describe("letter-spacing text measurement", () => {
    beforeAll(() => {
        const fakeContext = {
            font: "",
            fillStyle: "",
            clearRect: () => undefined,
            fillRect: () => undefined,
            getImageData: () => ({ data: new Uint8ClampedArray(400) }),
            save: () => undefined,
            restore: () => undefined,
            // Full-string metric is tighter than the sum of per-glyph advances.
            measureText: (value: string) => ({
                width: value.length <= 1 ? 10 : value.length * 6,
                actualBoundingBoxAscent: 24,
                actualBoundingBoxDescent: 6,
                fontBoundingBoxAscent: 28,
                fontBoundingBoxDescent: 8,
            }),
            fillText: () => undefined,
            strokeText: () => undefined,
            setAttr: () => undefined,
        };

        vi.stubGlobal("window", globalThis);
        vi.stubGlobal("document", {
            createElement: (tagName: string) => tagName === "canvas"
                ? { style: {}, getContext: () => fakeContext }
                : {},
            fonts: { ready: Promise.resolve() },
        });
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    it("uses per-glyph width for negative tracking instead of whole-string Konva width", () => {
        const layer = makeText();
        const measured = measureTextLayer(layer);
        const legacy = measureKonvaLegacyWidth(layer.text, layer.letterSpacing, layer.fontSize);
        const rendered = measureKonvaPerCharWidth(layer.text, layer.letterSpacing, layer.fontSize);

        expect(rendered).toBeGreaterThan(legacy);
        expect(measured.width).toBeCloseTo(rendered, 0);
    });

    it("floors auto-height line box when line-height is below 1", () => {
        const layer = makeText({ textAdjust: "auto_height", width: 400 });
        const measured = measureTextLayer(layer);
        const lineBoxOnly = layer.fontSize * layer.lineHeight;
        expect(measured.height).toBeGreaterThan(lineBoxOnly);
    });
});
