import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TextLayer } from "@/types";
import { measureWrappedTextContent } from "@/utils/layoutEngine";
import { shrinkTextToFitBox } from "@/utils/textFit";

function makeText(overrides: Partial<TextLayer> = {}): TextLayer {
    return {
        id: "t",
        type: "text",
        name: "t",
        x: 0,
        y: 0,
        width: 200,
        height: 60,
        rotation: 0,
        visible: true,
        locked: false,
        text: "Длинный заголовок который точно переносится",
        fontSize: 40,
        fontFamily: "Inter",
        fontWeight: "700",
        fill: "#000000",
        align: "left",
        letterSpacing: 0,
        lineHeight: 1.2,
        textAdjust: "fixed",
        responsive: { textFit: "shrink", minFontSize: 12 },
        ...overrides,
    } as TextLayer;
}

describe("shrinkTextToFitBox", () => {
    beforeAll(() => {
        const fakeContext = {
            font: "",
            fillStyle: "",
            clearRect: () => undefined,
            fillRect: () => undefined,
            getImageData: () => ({ data: new Uint8ClampedArray(16) }),
            save: () => undefined,
            restore: () => undefined,
            measureText: (value: string) => ({ width: value.length * 6 }),
        };

        vi.stubGlobal("document", {
            createElement: (tagName: string) => tagName === "canvas"
                ? { style: {}, getContext: () => fakeContext }
                : {},
            fonts: { load: async () => undefined, ready: Promise.resolve() },
        });
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    it("shrinks font until fixed box height fits", () => {
        const source = makeText();
        expect(measureWrappedTextContent(source, source.width).height).toBeGreaterThan(source.height);

        const shrunk = shrinkTextToFitBox(source);
        expect(shrunk.fontSize).toBeLessThan(source.fontSize);
        expect(shrunk.fontSize).toBeGreaterThanOrEqual(12);
        expect(measureWrappedTextContent(shrunk, shrunk.width).height).toBeLessThanOrEqual(shrunk.height + 0.5);
    });

    it("skips auto_height text", () => {
        const source = makeText({ textAdjust: "auto_height" });
        expect(shrinkTextToFitBox(source).fontSize).toBe(source.fontSize);
    });

    it("skips when textFit is unset", () => {
        const source = makeText({ responsive: { minFontSize: 12 } });
        expect(shrinkTextToFitBox(source).fontSize).toBe(source.fontSize);
    });
});
