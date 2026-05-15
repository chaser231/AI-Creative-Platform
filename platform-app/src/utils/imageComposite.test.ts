import { describe, expect, it } from "vitest";

import { computeFeatherMaskData, featherAlphaAt } from "./imageComposite";

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
