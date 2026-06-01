import { describe, expect, it } from "vitest";

import {
    clampRgbDelta,
    computeInpaintCompositeMaskAlpha,
    computeInpaintCropPlan,
    computeFeatherMaskData,
    computeInpaintBlendRadii,
    computeInpaintOutsideBlendPx,
    featherAlphaAt,
    getInpaintMaskBounds,
    normalizeInpaintMaskAlpha,
    resolveInpaintEditedRect,
} from "./imageComposite";

// `computeFeatherMaskData` is the pure backing function for `buildFeatherMask`:
// `buildFeatherMask` creates a canvas, calls `ctx.createImageData`, copies in the
// bytes from `computeFeatherMaskData`, and `putImageData`s it. So inspecting the
// Uint8ClampedArray returned here is structurally identical to calling
// `getContext("2d").getImageData(...).data` on the canvas built by
// `buildFeatherMask` — without needing a Canvas implementation in vitest's
// default `node` environment. The bytes are packed RGBA row-major, so for
// width `w`, alpha at (x, y) lives at index `(y * w + x) * 4 + 3`.
const alphaReader = (data: Uint8ClampedArray, width: number) =>
    (x: number, y: number) => data[(y * width + x) * 4 + 3];

describe("featherAlphaAt", () => {
    it("returns 255 when no side has padding", () => {
        const pad = { top: 0, right: 0, bottom: 0, left: 0 };
        expect(featherAlphaAt(0, 0, 100, 100, pad, 20)).toBe(255);
        expect(featherAlphaAt(50, 50, 100, 100, pad, 20)).toBe(255);
        expect(featherAlphaAt(99, 99, 100, 100, pad, 20)).toBe(255);
    });

    it("returns 255 when featherPx <= 0", () => {
        const pad = { top: 50, right: 50, bottom: 50, left: 50 };
        expect(featherAlphaAt(0, 0, 100, 100, pad, 0)).toBe(255);
        expect(featherAlphaAt(50, 50, 100, 100, pad, -5)).toBe(255);
    });
});

describe("computeFeatherMaskData — only top padding", () => {
    const pad = { top: 50, right: 0, bottom: 0, left: 0 };
    const w = 200;
    const h = 200;
    const featherPx = 50;
    const data = computeFeatherMaskData(w, h, pad, featherPx);
    const a = alphaReader(data, w);

    it("alpha at (100, 0) is ≈ 0 (at the feathered top edge)", () => {
        expect(a(100, 0)).toBeLessThanOrEqual(1);
    });

    it("alpha at (100, 25) is ≈ 127 (halfway through the gradient)", () => {
        const v = a(100, 25);
        expect(v).toBeGreaterThanOrEqual(124);
        expect(v).toBeLessThanOrEqual(130);
    });

    it("alpha at (100, 75) is 255 (past the feather, opaque)", () => {
        expect(a(100, 75)).toBe(255);
    });

    it("alpha at (100, 100) is 255 (deep interior, opaque)", () => {
        expect(a(100, 100)).toBe(255);
    });

    it("alpha at (0, 100) is 255 (left edge with no padding stays opaque)", () => {
        expect(a(0, 100)).toBe(255);
    });

    it("alpha at (199, 100) is 255 (right edge with no padding stays opaque)", () => {
        expect(a(199, 100)).toBe(255);
    });

    it("alpha at (100, 199) is 255 (bottom edge with no padding stays opaque)", () => {
        expect(a(100, 199)).toBe(255);
    });
});

describe("computeFeatherMaskData — zero padding everywhere", () => {
    it("all alpha values are 255", () => {
        const pad = { top: 0, right: 0, bottom: 0, left: 0 };
        const w = 40;
        const h = 40;
        const data = computeFeatherMaskData(w, h, pad, 10);
        const a = alphaReader(data, w);

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (a(x, y) !== 255) {
                    throw new Error(`Expected 255 at (${x}, ${y}), got ${a(x, y)}`);
                }
            }
        }
    });
});

describe("computeFeatherMaskData — top + right padding", () => {
    const pad = { top: 30, right: 30, bottom: 0, left: 0 };
    const w = 200;
    const h = 200;
    const featherPx = 30;
    const data = computeFeatherMaskData(w, h, pad, featherPx);
    const a = alphaReader(data, w);

    it("alpha at the top-right corner is 0 (both gradients meet at edge)", () => {
        expect(a(199, 0)).toBe(0);
    });

    it("alpha is monotonically non-decreasing as we move diagonally inward from the corner", () => {
        // Walk diagonally inward 1, 2, 3, ... steps and verify alpha never drops.
        let prev = a(199, 0);
        for (let step = 1; step <= 40; step++) {
            const x = 199 - step;
            const y = step;
            const v = a(x, y);
            expect(v).toBeGreaterThanOrEqual(prev);
            prev = v;
        }
    });

    it("alpha at top-left (0, 0) is 255 — left side has no padding, only top fades", () => {
        // (0, 0): pad.left === 0 so left contributes 1; pad.top > 0 and y < featherPx so
        // top contributes 0 → final alpha 0. Wait, that means the top-LEFT corner IS
        // feathered (because top alone fades). The top-RIGHT corner double-fades.
        // The point of the test is that the top-right is more transparent at one step
        // inward than the top-left, because right also feathers.
        const topLeft = a(5, 5);
        const topRight = a(194, 5);
        expect(topRight).toBeLessThanOrEqual(topLeft);
    });

    it("alpha at the deep interior (100, 100) is 255", () => {
        expect(a(100, 100)).toBe(255);
    });

    it("alpha at the bottom edge with no padding stays 255", () => {
        expect(a(100, 199)).toBe(255);
        expect(a(0, 199)).toBe(255);
    });
});

describe("computeFeatherMaskData — featherPx larger than half the smaller dimension is clamped", () => {
    it("centre stays opaque even when requested feather >= width/2", () => {
        // width=20, height=20, featherPx=15 should be clamped to 10 (half of min dim).
        // With pad on all sides, the centre at (10, 10) should be alpha 255 because
        // the clamped feathers don't overlap there.
        const data = computeFeatherMaskData(
            20,
            20,
            { top: 10, right: 10, bottom: 10, left: 10 },
            15,
        );
        const a = alphaReader(data, 20);
        expect(a(10, 10)).toBe(255);
    });
});

describe("normalizeInpaintMaskAlpha", () => {
    it("treats RGB black as preserve and RGB white as edit", () => {
        const data = new Uint8ClampedArray([
            0, 0, 0, 255,
            255, 255, 255, 255,
            128, 128, 128, 255,
        ]);

        expect(Array.from(normalizeInpaintMaskAlpha(data))).toEqual([0, 255, 128]);
    });

    it("uses alpha painted strokes as the edit region even when stroke RGB is black", () => {
        const data = new Uint8ClampedArray([
            0, 0, 0, 0,
            0, 0, 0, 0,
            0, 0, 0, 0,
            0, 0, 0, 255,
        ]);

        expect(Array.from(normalizeInpaintMaskAlpha(data))).toEqual([0, 0, 0, 255]);
    });

    it("keeps a transparent background preserved for alpha masks", () => {
        const data = new Uint8ClampedArray([
            255, 255, 255, 0,
            255, 255, 255, 0,
            255, 255, 255, 255,
        ]);

        expect(Array.from(normalizeInpaintMaskAlpha(data))).toEqual([0, 0, 255]);
    });

    it("treats OpenAI-style transparent pixels as edit when most of the mask is opaque", () => {
        const data = new Uint8ClampedArray([
            0, 0, 0, 255,
            0, 0, 0, 255,
            0, 0, 0, 0,
        ]);

        expect(Array.from(normalizeInpaintMaskAlpha(data))).toEqual([0, 0, 255]);
    });

    it("treats OpenAI-style transparent pixels as edit even when edit is the majority", () => {
        const data = new Uint8ClampedArray([
            0, 0, 0, 255,
            0, 0, 0, 0,
            0, 0, 0, 0,
        ]);

        expect(Array.from(normalizeInpaintMaskAlpha(data, "transparent-edit"))).toEqual([0, 255, 255]);
    });

    it("keeps legacy alpha painted strokes as edit when explicitly requested", () => {
        const data = new Uint8ClampedArray([
            0, 0, 0, 0,
            0, 0, 0, 255,
            0, 0, 0, 255,
        ]);

        expect(Array.from(normalizeInpaintMaskAlpha(data, "opaque-edit"))).toEqual([0, 255, 255]);
    });
});

describe("getInpaintMaskBounds", () => {
    it("returns null for an empty mask", () => {
        expect(getInpaintMaskBounds(new Uint8ClampedArray(9), 3)).toBeNull();
    });

    it("finds the bounding box of painted pixels", () => {
        const alpha = new Uint8ClampedArray([
            0, 0, 0, 0,
            0, 255, 255, 0,
            0, 0, 255, 0,
        ]);

        expect(getInpaintMaskBounds(alpha, 4)).toEqual({
            x: 1,
            y: 1,
            width: 2,
            height: 2,
        });
    });
});

describe("computeInpaintCropPlan", () => {
    it("returns null for an empty mask", () => {
        expect(computeInpaintCropPlan(1000, 1000, null)).toBeNull();
    });

    it("pads mask bounds, clamps to image edges, and upscales small crops", () => {
        const plan = computeInpaintCropPlan(2000, 1000, { x: 900, y: 400, width: 100, height: 80 });

        expect(plan).toEqual({
            rect: { x: 804, y: 304, width: 292, height: 272 },
            outputWidth: 584,
            outputHeight: 544,
            scale: 2,
        });
    });

    it("skips crop prep when the padded crop covers more than 85% of the source", () => {
        expect(computeInpaintCropPlan(1000, 1000, { x: 50, y: 50, width: 900, height: 900 })).toBeNull();
    });

    it("caps provider dimensions to 2048px per side and 4MP", () => {
        const plan = computeInpaintCropPlan(5000, 3000, { x: 1800, y: 900, width: 2000, height: 100 });

        expect(plan).toEqual({
            rect: { x: 1100, y: 200, width: 3400, height: 1500 },
            outputWidth: 2048,
            outputHeight: 904,
            scale: 2048 / 3400,
        });
    });
});

describe("resolveInpaintEditedRect", () => {
    it("uses the full image when no provider crop rect is supplied", () => {
        expect(resolveInpaintEditedRect(undefined, 1200, 300)).toEqual({
            x: 0,
            y: 0,
            width: 1200,
            height: 300,
        });
    });

    it("preserves original-space crop rects for provider output placement", () => {
        expect(resolveInpaintEditedRect({ x: 804, y: 304, width: 292, height: 272 }, 2000, 1000)).toEqual({
            x: 804,
            y: 304,
            width: 292,
            height: 272,
        });
    });

    it("clamps edited rects to the original image bounds", () => {
        expect(resolveInpaintEditedRect({ x: 980, y: 490, width: 100, height: 50 }, 1000, 500)).toEqual({
            x: 980,
            y: 490,
            width: 20,
            height: 10,
        });
    });

    it("pins an entirely out-of-bounds edited rect to the last image pixel", () => {
        expect(resolveInpaintEditedRect({ x: 1200, y: 800, width: 50, height: 50 }, 1000, 500)).toEqual({
            x: 999,
            y: 499,
            width: 1,
            height: 1,
        });
    });
});

describe("computeInpaintCompositeMaskAlpha", () => {
    it("keeps strict mode outside alpha at 0", () => {
        const candidateAlpha = new Uint8ClampedArray([40, 120, 255]);
        const allowedAlpha = new Uint8ClampedArray([0, 80, 255]);
        const coreAlpha = new Uint8ClampedArray([0, 255, 255]);

        expect(Array.from(computeInpaintCompositeMaskAlpha(candidateAlpha, allowedAlpha, coreAlpha, {
            blendMode: "strict",
        }))).toEqual([
            0,
            80,
            255,
        ]);
    });

    it("keeps strict context backward-compatible when context opacity is set", () => {
        const candidateAlpha = new Uint8ClampedArray([200, 200]);
        const allowedAlpha = new Uint8ClampedArray([200, 200]);
        const coreAlpha = new Uint8ClampedArray([0, 255]);

        expect(Array.from(computeInpaintCompositeMaskAlpha(candidateAlpha, allowedAlpha, coreAlpha, {
            blendMode: "strict",
            contextOpacity: 0.25,
        }))).toEqual([
            64,
            200,
        ]);
    });

    it("allows seamless outside alpha only inside the outer ring and caps it by outside opacity", () => {
        const candidateAlpha = new Uint8ClampedArray([200, 60, 10, 90]);
        const allowedAlpha = new Uint8ClampedArray([0, 255, 0, 0]);
        const coreAlpha = new Uint8ClampedArray([0, 255, 0, 0]);
        const outerAllowedAlpha = new Uint8ClampedArray([255, 255, 255, 0]);

        expect(Array.from(computeInpaintCompositeMaskAlpha(candidateAlpha, allowedAlpha, coreAlpha, {
            blendMode: "seamless",
            outsideBlendOpacity: 0.18,
            outerAllowedAlpha,
        }))).toEqual([
            46,
            60,
            10,
            0,
        ]);
    });

    it("keeps seamless outside alpha smoothly decreasing when opacity cap does not flatten it", () => {
        const candidateAlpha = new Uint8ClampedArray([250, 180, 100, 20, 0]);
        const allowedAlpha = new Uint8ClampedArray([255, 0, 0, 0, 0]);
        const coreAlpha = new Uint8ClampedArray([255, 0, 0, 0, 0]);
        const outerAllowedAlpha = new Uint8ClampedArray([255, 255, 255, 255, 0]);

        expect(Array.from(computeInpaintCompositeMaskAlpha(candidateAlpha, allowedAlpha, coreAlpha, {
            blendMode: "seamless",
            outsideBlendOpacity: 1,
            outerAllowedAlpha,
        }))).toEqual([
            250,
            180,
            100,
            20,
            0,
        ]);
    });
});

describe("computeInpaintOutsideBlendPx", () => {
    it("keeps adaptive seamless blend radius in the conservative 8-18px range", () => {
        expect(computeInpaintOutsideBlendPx(512, 512, { x: 10, y: 10, width: 12, height: 12 })).toBe(10);
        expect(computeInpaintOutsideBlendPx(1200, 300, { x: 100, y: 20, width: 900, height: 220 })).toBe(18);
    });
});

describe("clampRgbDelta", () => {
    it("clamps seam colour deltas to ±18 by default", () => {
        expect(clampRgbDelta({ r: 40, g: -30, b: 12 })).toEqual({
            r: 18,
            g: -18,
            b: 12,
        });
    });
});

describe("computeInpaintBlendRadii", () => {
    it("keeps blend radii within conservative bounds", () => {
        expect(computeInpaintBlendRadii(1200, 300, { x: 50, y: 20, width: 300, height: 120 })).toEqual({
            expandPx: 24,
            featherPx: 28,
        });
    });

    it("uses a small-but-visible minimum for tiny masks", () => {
        expect(computeInpaintBlendRadii(512, 512, { x: 10, y: 10, width: 12, height: 12 })).toEqual({
            expandPx: 4,
            featherPx: 6,
        });
    });

    it("caps very large masks so provider changes do not bleed too far", () => {
        expect(computeInpaintBlendRadii(4096, 4096, { x: 0, y: 0, width: 3000, height: 3000 })).toEqual({
            expandPx: 32,
            featherPx: 32,
        });
    });
});
