import { describe, expect, it } from "vitest";

import {
    buildFalOutpaintMaskPixels,
    chooseOutpaintObjectFitForRect,
    computeFalOutpaintMaskPixelAt,
    computeTransparentPaddedInputAlphaAt,
    computeUniformContainRect,
} from "./gptImageOutpaint";

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

    it("emits a strictly binary mask — only 0 or 255 on every channel", () => {
        const pixels = buildFalOutpaintMaskPixels(
            { width: 64, height: 32 },
            { x: 12, y: 4, width: 30, height: 20 },
        );

        for (let i = 0; i < pixels.data.length; i++) {
            const v = pixels.data[i];
            expect(v === 0 || v === 255).toBe(true);
        }
    });

    it("preserves asymmetric source placement — mask reflects the requested rect, not the canvas center", () => {
        const size = { width: 200, height: 120 };
        const asymmetric = { x: 10, y: 80, width: 150, height: 30 };
        const pixels = buildFalOutpaintMaskPixels(size, asymmetric);

        const px = (x: number, y: number) => pixels.data[(y * size.width + x) * 4];
        expect(px(0, 0)).toBe(255); // top-left padding → editable
        expect(px(50, 90)).toBe(0); // inside source → preserved
        expect(px(100, 50)).toBe(255); // above the source rect → editable
        expect(px(180, 90)).toBe(255); // right of the source rect → editable
    });

    it("uses transparent padding for the default GPT input canvas", () => {
        expect(computeTransparentPaddedInputAlphaAt(0, 60, sourceRect)).toBe(0);
        expect(computeTransparentPaddedInputAlphaAt(60, 60, sourceRect)).toBe(255);
    });
});

describe("computeUniformContainRect", () => {
    it("centers a wider source inside a square target with horizontal letterbox", () => {
        const rect = computeUniformContainRect(
            { width: 200, height: 100 },
            { width: 300, height: 300 },
        );

        expect(rect.width).toBe(300);
        expect(rect.height).toBe(150);
        expect(rect.x).toBe(0);
        expect(rect.y).toBe(75);
    });

    it("centers a taller source inside a wider target with vertical letterbox", () => {
        const rect = computeUniformContainRect(
            { width: 100, height: 200 },
            { width: 400, height: 300 },
        );

        expect(rect.width).toBe(150);
        expect(rect.height).toBe(300);
        expect(rect.x).toBe(125);
        expect(rect.y).toBe(0);
    });

    it("preserves source aspect when source already matches target aspect", () => {
        const rect = computeUniformContainRect(
            { width: 1356, height: 899 },
            { width: 1356, height: 899 },
        );

        expect(rect).toEqual({ x: 0, y: 0, width: 1356, height: 899 });
    });
});
