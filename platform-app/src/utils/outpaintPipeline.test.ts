import { describe, expect, it } from "vitest";

import { splitPadForPass1 } from "./outpaintPipeline";

// `splitPadForPass1` is the pure pad-splitting helper that backs the Phase 5
// multipass orchestrator. The orchestrator only invokes it after the
// `needsMultipass` predicate has already fired (final size > MAX_FINAL_DIMENSION
// OR — for flux-2-pro-outpaint — per-side pad > FLUX2_PER_SIDE_CAP). All tests
// below therefore pass inputs where multipass would actually be triggered; the
// trivial "predicate false" case is documented in the helper's JSDoc rather
// than asserted here, since the helper is never reached in that branch.
//
// FLUX2_PER_SIDE_CAP and MAX_FINAL_DIMENSION are not re-exported — we encode
// the well-known constants (2048 / 4800) directly in the test inputs and
// expectations to keep the tests' source of truth aligned with the spec.
const FLUX = "flux-2-pro-outpaint";
const BRIA = "bria-expand";

describe("splitPadForPass1 — flux-2-pro-outpaint over per-side cap", () => {
    it("splits a single over-cap side; under-cap sides flow fully into pass 1", () => {
        // Spec test case 1: only `right` exceeds the 2048 cap.
        // pass 1 takes the cap on right (and the original 0s elsewhere).
        // pass 2 picks up the remainder on right (3000 - 2048 = 952).
        const pad = { top: 0, right: 3000, bottom: 0, left: 0 };
        const finalW = 1000 + pad.left + pad.right; // arbitrary >0
        const finalH = 1000 + pad.top + pad.bottom;
        const { pass1, pass2 } = splitPadForPass1(pad, FLUX, finalW, finalH);
        expect(pass1).toEqual({ top: 0, right: 2048, bottom: 0, left: 0 });
        expect(pass2).toEqual({ top: 0, right: 952, bottom: 0, left: 0 });
    });

    it("splits all four sides when every side exceeds the cap", () => {
        // Spec test case 2: every side requests 3000 px; pass 1 caps to 2048,
        // pass 2 takes the 952 remainder on each side.
        const pad = { top: 3000, right: 3000, bottom: 3000, left: 3000 };
        const { pass1, pass2 } = splitPadForPass1(
            pad,
            FLUX,
            5000 + pad.left + pad.right,
            5000 + pad.top + pad.bottom,
        );
        expect(pass1).toEqual({
            top: 2048,
            right: 2048,
            bottom: 2048,
            left: 2048,
        });
        expect(pass2).toEqual({
            top: 952,
            right: 952,
            bottom: 952,
            left: 952,
        });
    });

    it("passes a side equal to the cap through fully (boundary, no overflow)", () => {
        // Pad of exactly 2048 should stay in pass 1 entirely (Math.min keeps
        // it as 2048, pass 2 gets 0). The predicate would NOT fire on this
        // alone (`> CAP` not `>= CAP`), so this case only arises when ANOTHER
        // side over the cap forces multipass and this side rides along.
        const pad = { top: 2048, right: 2500, bottom: 0, left: 100 };
        const { pass1, pass2 } = splitPadForPass1(pad, FLUX, 9999, 9999);
        expect(pass1).toEqual({ top: 2048, right: 2048, bottom: 0, left: 100 });
        expect(pass2).toEqual({ top: 0, right: 452, bottom: 0, left: 0 });
    });

    it("splits asymmetric padding correctly (only the over-cap side splits)", () => {
        // One large side, one moderate side, two zero sides. pass 2 should
        // contain ONLY the over-cap remainder; the under-cap side rides
        // entirely in pass 1.
        const pad = { top: 0, right: 3500, bottom: 1500, left: 0 };
        const { pass1, pass2 } = splitPadForPass1(pad, FLUX, 9999, 9999);
        expect(pass1).toEqual({ top: 0, right: 2048, bottom: 1500, left: 0 });
        expect(pass2).toEqual({ top: 0, right: 1452, bottom: 0, left: 0 });
    });
});

describe("splitPadForPass1 — final size > MAX_FINAL_DIMENSION, every pad ≤ cap", () => {
    it("half-splits each side when no per-side cap fires (flux model, size-only trigger)", () => {
        // Spec test case 3: pads are 1500 each (< 2048 cap), so the
        // predicate fired purely because finalW = 5000 + 1500 + 1500 = 8000
        // > 4800. The helper falls back to half-split.
        const pad = { top: 1500, right: 1500, bottom: 1500, left: 1500 };
        const finalW = 5000 + pad.left + pad.right;
        const finalH = 5000 + pad.top + pad.bottom;
        const { pass1, pass2 } = splitPadForPass1(pad, FLUX, finalW, finalH);
        expect(pass1).toEqual({
            top: 750,
            right: 750,
            bottom: 750,
            left: 750,
        });
        expect(pass2).toEqual({
            top: 750,
            right: 750,
            bottom: 750,
            left: 750,
        });
    });

    it("half-split correctly assigns the odd pixel to pass 2 for odd pads", () => {
        // floor(101 / 2) = 50, remainder 51 to pass 2. This guarantees the
        // sum is exact (pass1 + pass2 === pad) for odd pads.
        const pad = { top: 101, right: 0, bottom: 0, left: 0 };
        const { pass1, pass2 } = splitPadForPass1(pad, FLUX, 9999, 9999);
        expect(pass1.top).toBe(50);
        expect(pass2.top).toBe(51);
        expect(pass1.top + pass2.top).toBe(pad.top);
    });
});

describe("splitPadForPass1 — non-flux model (bria-expand), only finalSize matters", () => {
    it("half-splits regardless of per-side cap because the cap doesn't apply", () => {
        // Spec test case 4: bria-expand has no per-side 2048 cap. Even with
        // a side at 3000 (which would trigger cap-split for flux), the
        // helper does a half-split because the model isn't subject to the
        // flux per-side limit.
        const pad = { top: 0, right: 3000, bottom: 0, left: 0 };
        const finalW = 5000 + pad.right + pad.left;
        const finalH = 5000 + pad.top + pad.bottom;
        const { pass1, pass2 } = splitPadForPass1(pad, BRIA, finalW, finalH);
        expect(pass1).toEqual({ top: 0, right: 1500, bottom: 0, left: 0 });
        expect(pass2).toEqual({ top: 0, right: 1500, bottom: 0, left: 0 });
    });

    it("half-splits a balanced bria request when finalSize exceeds the ceiling", () => {
        const pad = { top: 800, right: 800, bottom: 800, left: 800 };
        // finalW = 4000 + 800 + 800 = 5600 > MAX_FINAL_DIMENSION (4800).
        const { pass1, pass2 } = splitPadForPass1(pad, BRIA, 5600, 5600);
        expect(pass1).toEqual({ top: 400, right: 400, bottom: 400, left: 400 });
        expect(pass2).toEqual({ top: 400, right: 400, bottom: 400, left: 400 });
    });
});

describe("splitPadForPass1 — invariants across both branches", () => {
    it("pass1 + pass2 always sums exactly to the input pad on every side", () => {
        // Property check across a small grid of representative inputs.
        const samples: Array<{
            pad: { top: number; right: number; bottom: number; left: number };
            model: string;
        }> = [
            { pad: { top: 0, right: 3000, bottom: 0, left: 0 }, model: FLUX },
            { pad: { top: 3000, right: 3000, bottom: 3000, left: 3000 }, model: FLUX },
            { pad: { top: 1500, right: 1500, bottom: 1500, left: 1500 }, model: FLUX },
            { pad: { top: 101, right: 99, bottom: 1, left: 0 }, model: FLUX },
            { pad: { top: 0, right: 3000, bottom: 0, left: 0 }, model: BRIA },
            { pad: { top: 800, right: 800, bottom: 800, left: 800 }, model: BRIA },
        ];
        for (const { pad, model } of samples) {
            const { pass1, pass2 } = splitPadForPass1(pad, model, 9999, 9999);
            for (const side of ["top", "right", "bottom", "left"] as const) {
                expect(pass1[side] + pass2[side]).toBe(pad[side]);
            }
        }
    });

    it("flux cap-split keeps every pass1 side ≤ FLUX2_PER_SIDE_CAP (2048)", () => {
        // Hard guarantee: after a cap-split, no pass1 side may exceed the
        // per-side cap. This is the whole reason multipass exists.
        const pad = { top: 5000, right: 5000, bottom: 5000, left: 5000 };
        const { pass1 } = splitPadForPass1(pad, FLUX, 99999, 99999);
        const FLUX_CAP = 2048;
        expect(pass1.top).toBeLessThanOrEqual(FLUX_CAP);
        expect(pass1.right).toBeLessThanOrEqual(FLUX_CAP);
        expect(pass1.bottom).toBeLessThanOrEqual(FLUX_CAP);
        expect(pass1.left).toBeLessThanOrEqual(FLUX_CAP);
    });

    it("half-split keeps every pass1 side ≤ pad/2 (and pass2 keeps the remainder)", () => {
        const pad = { top: 1000, right: 2000, bottom: 1500, left: 999 };
        const { pass1, pass2 } = splitPadForPass1(pad, FLUX, 99999, 99999);
        for (const side of ["top", "right", "bottom", "left"] as const) {
            expect(pass1[side]).toBe(Math.floor(pad[side] / 2));
            expect(pass2[side]).toBe(pad[side] - Math.floor(pad[side] / 2));
        }
    });
});
