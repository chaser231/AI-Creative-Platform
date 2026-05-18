import { describe, expect, it } from "vitest";

import {
    computeWizardExpandGeometry,
    type FormatSize,
} from "./wizardExpandGeometry";

// The real banner pack pictured in the plan's screenshot. Used as a
// regression-pin for the "wizard expand stays in flux 2 pro" guarantee.
// Master = Landing Header (1192×300).
const PLAN_PACK: FormatSize[] = [
    { width: 540, height: 225 }, // Hero
    { width: 470, height: 762 }, // Feed
    { width: 1192, height: 300 }, // Landing Header (master)
    { width: 521, height: 170 }, // Header Mobile
    { width: 360, height: 360 }, // Pop-up
    { width: 270, height: 370 }, // vertical
    { width: 512, height: 256 }, // push
    { width: 853, height: 92 }, // Top banner
];

const MASTER: FormatSize = { width: 1192, height: 300 };

describe("computeWizardExpandGeometry — per-side scaling", () => {
    it("does not grow an axis when the master is already wider than the entire pack on it", () => {
        // No format is wider than 1192 except master itself. With buffer
        // applied to width too, we get targetW = layerW + buffer. Width
        // padding is exactly the buffer; no per-side growth contributes.
        const g = computeWizardExpandGeometry(MASTER, PLAN_PACK, {
            buffer: 100,
            leftBias: 0.5,
            topBias: 0.5,
        });
        expect(g.targetW).toBe(1192 + 100); // = 1292
        expect(g.padLeft + g.padRight).toBe(100);
    });

    it("grows the tall axis to fit the tallest format in the pack", () => {
        // Tallest format is Feed at 762. Target height = 762 + buffer.
        const g = computeWizardExpandGeometry(MASTER, PLAN_PACK, {
            buffer: 100,
            leftBias: 0.5,
            topBias: 0.5,
        });
        expect(g.targetH).toBe(762 + 100); // = 862
        expect(g.padTop + g.padBottom).toBe(862 - 300); // = 562
    });

    it("computes the exact PLAN-pack geometry under the production defaults (67/33 + 100 buffer)", () => {
        // This is the pinned regression case from the plan. If any of
        // these numbers drift the wizard expand will start tripping
        // multipass/bria fallback again — see the plan's "Acceptance
        // criteria" section for context.
        const g = computeWizardExpandGeometry(MASTER, PLAN_PACK, {
            buffer: 100,
            leftBias: 0.67,
            topBias: 0.67,
        });
        expect(g.targetW).toBe(1292);
        expect(g.targetH).toBe(862);

        const hPad = g.padLeft + g.padRight;
        const vPad = g.padTop + g.padBottom;
        expect(hPad).toBe(100);
        expect(vPad).toBe(562);

        // 67/33 split: round(100 * 0.67) = 67 left, 33 right.
        expect(g.padLeft).toBe(67);
        expect(g.padRight).toBe(33);
        // 67/33 split: round(562 * 0.67) = 377 top, remainder 185 bottom.
        expect(g.padTop).toBe(377);
        expect(g.padBottom).toBe(185);
    });
});

describe("computeWizardExpandGeometry — asymmetric distribution", () => {
    it("respects leftBias > 0.5: more padding on the left than the right", () => {
        const g = computeWizardExpandGeometry(MASTER, PLAN_PACK, {
            buffer: 100,
            leftBias: 0.67,
            topBias: 0.5,
        });
        expect(g.padLeft).toBeGreaterThan(g.padRight);
        expect(g.padLeft + g.padRight).toBe(100);
    });

    it("respects topBias > 0.5: more padding on the top than the bottom", () => {
        const g = computeWizardExpandGeometry(MASTER, PLAN_PACK, {
            buffer: 100,
            leftBias: 0.5,
            topBias: 0.67,
        });
        expect(g.padTop).toBeGreaterThan(g.padBottom);
        expect(g.padTop + g.padBottom).toBe(g.targetH - MASTER.height);
    });

    it("keeps padding symmetric at bias=0.5 within 1 px (rounding only)", () => {
        const g = computeWizardExpandGeometry(MASTER, PLAN_PACK, {
            buffer: 100,
            leftBias: 0.5,
            topBias: 0.5,
        });
        expect(Math.abs(g.padLeft - g.padRight)).toBeLessThanOrEqual(1);
        expect(Math.abs(g.padTop - g.padBottom)).toBeLessThanOrEqual(1);
    });

    it("clamps out-of-range biases to [0, 1]", () => {
        const g = computeWizardExpandGeometry(MASTER, PLAN_PACK, {
            buffer: 100,
            // Negative + over-1: should clamp to 0 (all right) and 1 (all top).
            leftBias: -2,
            topBias: 7,
        });
        expect(g.padLeft).toBe(0);
        expect(g.padRight).toBe(100);
        expect(g.padTop).toBe(g.targetH - MASTER.height);
        expect(g.padBottom).toBe(0);
    });
});

describe("computeWizardExpandGeometry — edge cases", () => {
    it("handles an empty pack: only the buffer is added, no per-side growth", () => {
        const g = computeWizardExpandGeometry(MASTER, [], {
            buffer: 100,
            leftBias: 0.5,
            topBias: 0.5,
        });
        expect(g.targetW).toBe(MASTER.width + 100);
        expect(g.targetH).toBe(MASTER.height + 100);
    });

    it("uses defaults (buffer=100, bias=0.67/0.67) when opts are omitted", () => {
        const g1 = computeWizardExpandGeometry(MASTER, PLAN_PACK);
        const g2 = computeWizardExpandGeometry(MASTER, PLAN_PACK, {
            buffer: 100,
            leftBias: 0.67,
            topBias: 0.67,
        });
        expect(g1).toEqual(g2);
    });

    it("returns no-growth when every format is strictly smaller than master on both axes", () => {
        const smallPack: FormatSize[] = [
            { width: 200, height: 100 },
            { width: 500, height: 200 },
        ];
        const g = computeWizardExpandGeometry(MASTER, smallPack, {
            buffer: 100,
            leftBias: 0.5,
            topBias: 0.5,
        });
        // No format exceeds master on any axis -> only buffer contributes.
        expect(g.targetW).toBe(MASTER.width + 100);
        expect(g.targetH).toBe(MASTER.height + 100);
    });

    it("ignores formats with non-positive width/height", () => {
        const dirtyPack: FormatSize[] = [
            { width: 0, height: 0 },
            { width: -10, height: -20 },
            { width: 2000, height: 1000 },
        ];
        const g = computeWizardExpandGeometry(MASTER, dirtyPack, {
            buffer: 0,
            leftBias: 0.5,
            topBias: 0.5,
        });
        // Only the valid 2000×1000 entry contributes.
        expect(g.targetW).toBe(2000);
        expect(g.targetH).toBe(1000);
    });

    it("survives zero/negative layer dimensions without throwing", () => {
        const g = computeWizardExpandGeometry(
            { width: 0, height: -5 },
            PLAN_PACK,
            { buffer: 0, leftBias: 0.5, topBias: 0.5 },
        );
        // Layer width/height get clamped to 1 internally — function
        // shouldn't crash, padding should be non-negative.
        expect(g.padLeft).toBeGreaterThanOrEqual(0);
        expect(g.padRight).toBeGreaterThanOrEqual(0);
        expect(g.padTop).toBeGreaterThanOrEqual(0);
        expect(g.padBottom).toBeGreaterThanOrEqual(0);
    });

    it("preserves invariant: padLeft + padRight === targetW - layerW", () => {
        const g = computeWizardExpandGeometry(MASTER, PLAN_PACK, {
            buffer: 250,
            leftBias: 0.67,
            topBias: 0.67,
        });
        expect(g.padLeft + g.padRight).toBe(g.targetW - MASTER.width);
        expect(g.padTop + g.padBottom).toBe(g.targetH - MASTER.height);
    });
});
