import { describe, expect, it } from "vitest";

import { chooseOutpaintObjectFitForRect, computeOutpaintMaskAlphaAt } from "./gptImageOutpaint";

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
