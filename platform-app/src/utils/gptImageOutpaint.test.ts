import { describe, expect, it } from "vitest";

import {
    buildFalOutpaintMaskPixels,
    chooseOutpaintObjectFitForRect,
    computeFalOutpaintMaskPixelAt,
    computeHardSourcePreserveAlphaAt,
    computeOutpaintMaskAlphaAt,
    computeTransparentPaddedInputAlphaAt,
    gptOutputSizeMatchesRequest,
} from "./gptImageOutpaint";

describe("computeOutpaintMaskAlphaAt", () => {
    const sourceRect = { x: 10, y: 20, width: 100, height: 80 };
    const outputSize = { width: 130, height: 120 };

    it("marks padding as transparent edit area", () => {
        expect(computeOutpaintMaskAlphaAt(0, 60, sourceRect, outputSize)).toBe(0);
        expect(computeOutpaintMaskAlphaAt(60, 10, sourceRect, outputSize)).toBe(0);
        expect(computeOutpaintMaskAlphaAt(125, 60, sourceRect, outputSize)).toBe(0);
    });

    it("keeps the source core opaque for preserve", () => {
        expect(computeOutpaintMaskAlphaAt(60, 60, sourceRect, outputSize)).toBe(1);
    });

    it("limits soft transition to the 24px seam band", () => {
        expect(computeOutpaintMaskAlphaAt(10, 60, sourceRect, outputSize)).toBe(0);
        expect(computeOutpaintMaskAlphaAt(22, 60, sourceRect, outputSize)).toBeCloseTo(0.5);
        expect(computeOutpaintMaskAlphaAt(34, 60, sourceRect, outputSize)).toBe(1);
        expect(computeOutpaintMaskAlphaAt(85, 60, sourceRect, outputSize)).toBe(1);
        expect(computeOutpaintMaskAlphaAt(109, 60, sourceRect, outputSize)).toBe(0);
    });

    it("does not feather an edge that has no padding", () => {
        const flushLeft = { x: 0, y: 20, width: 100, height: 80 };

        expect(computeOutpaintMaskAlphaAt(0, 60, flushLeft, outputSize)).toBe(1);
    });
});

describe("chooseOutpaintObjectFitForRect", () => {
    it("uses fill when bitmap and layer aspects match", () => {
        expect(
            chooseOutpaintObjectFitForRect(
                { width: 1600, height: 900 },
                { width: 800, height: 450 },
            ),
        ).toBe("fill");
    });

    it("falls back to cover when fill would stretch the result", () => {
        expect(
            chooseOutpaintObjectFitForRect(
                { width: 1600, height: 900 },
                { width: 800, height: 600 },
            ),
        ).toBe("cover");
    });
});

describe("fal GPT Image 2 outpaint request helpers", () => {
    const sourceRect = { x: 10, y: 20, width: 100, height: 80 };

    it("builds a black/white fal mask where padding is editable and source is preserved", () => {
        expect(computeFalOutpaintMaskPixelAt(0, 60, sourceRect)).toEqual({
            r: 255,
            g: 255,
            b: 255,
            a: 255,
        });
        expect(computeFalOutpaintMaskPixelAt(60, 60, sourceRect)).toEqual({
            r: 0,
            g: 0,
            b: 0,
            a: 255,
        });
    });

    it("builds fal mask pixels with the requested dimensions", () => {
        const pixels = buildFalOutpaintMaskPixels({ width: 13, height: 7 }, sourceRect);

        expect(pixels.width).toBe(13);
        expect(pixels.height).toBe(7);
        expect(pixels.data).toHaveLength(13 * 7 * 4);
    });

    it("uses transparent padding for the default GPT input canvas", () => {
        expect(computeTransparentPaddedInputAlphaAt(0, 60, sourceRect)).toBe(0);
        expect(computeTransparentPaddedInputAlphaAt(60, 60, sourceRect)).toBe(255);
    });
});

describe("source-preserve composite policy", () => {
    const sourceRect = { x: 10, y: 20, width: 100, height: 80 };

    it("hard-preserves the full source rect without feathering inside it", () => {
        expect(computeHardSourcePreserveAlphaAt(10, 20, sourceRect)).toBe(255);
        expect(computeHardSourcePreserveAlphaAt(22, 60, sourceRect)).toBe(255);
        expect(computeHardSourcePreserveAlphaAt(109, 99, sourceRect)).toBe(255);
        expect(computeHardSourcePreserveAlphaAt(9, 60, sourceRect)).toBe(0);
        expect(computeHardSourcePreserveAlphaAt(110, 60, sourceRect)).toBe(0);
    });

    it("detects when raw GPT output size differs from request size", () => {
        expect(
            gptOutputSizeMatchesRequest(
                { width: 1536, height: 1024 },
                { width: 1536, height: 1024 },
            ),
        ).toBe(true);
        expect(
            gptOutputSizeMatchesRequest(
                { width: 1536, height: 1024 },
                { width: 1536, height: 1008 },
            ),
        ).toBe(false);
    });
});
