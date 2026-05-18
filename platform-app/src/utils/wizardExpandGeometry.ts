/**
 * Geometry math for the wizard "Расширить фон" flow.
 *
 * Computes the target canvas size and per-side padding for an outpaint
 * call given the master layer rect and the full pack of preview formats.
 *
 * Why this lives in a separate util:
 *   - It's pure (no DOM, no React) — testable with vitest.
 *   - It encodes a *policy* (per-side aware target + asymmetric padding
 *     distribution) that we want pinned down with tests so future tuning
 *     doesn't silently regress the "wizard expand stays in flux 2 pro,
 *     no multipass" guarantee documented in
 *     `.cursor/plans/wizard-outpaint-geometry-fix_*.plan.md`.
 *
 * The previous in-component logic took
 *   target = max(packMaxSize, layerSize) + 700 px buffer
 * on each axis, which generated huge canvases when ANY format in the
 * pack was bigger than the master in EITHER dimension — even when the
 * master itself was already wide enough for half the pack. The result
 * was an outpaint canvas in image-pixel space well past 10000×10000
 * for typical product shots, blowing past flux's 2560 cap and forcing
 * a multipass bria fallback (slow + low quality).
 *
 * The new policy:
 *   - Look at EACH format and compute how much the master would have to
 *     grow on each axis so the cascade scales the instance image layer
 *     to (at least) cover that format's artboard. We take `max` over
 *     all formats per-axis (so axes that don't need growth pass through
 *     unchanged).
 *   - Distribute the resulting per-axis padding asymmetrically:
 *     by default 67% goes to left/top, 33% to right/bottom. This biases
 *     the AI-generated background toward the side where banner layouts
 *     typically place text/logos (top-left), leaving the original
 *     product anchored bottom-right.
 *   - A small per-axis buffer (100 px by default) absorbs sub-pixel
 *     rounding and instance-rect-vs-artboard mismatch in the cascade
 *     without bloating the canvas.
 */

export interface FormatSize {
    width: number;
    height: number;
}

export interface ExpandGeometry {
    /** Target master width AFTER expand (canvas pixels). */
    targetW: number;
    /** Target master height AFTER expand (canvas pixels). */
    targetH: number;
    /** Padding added to the top of the master (canvas pixels). */
    padTop: number;
    /** Padding added to the right of the master (canvas pixels). */
    padRight: number;
    /** Padding added to the bottom of the master (canvas pixels). */
    padBottom: number;
    /** Padding added to the left of the master (canvas pixels). */
    padLeft: number;
}

export interface ComputeWizardExpandGeometryOptions {
    /**
     * Extra canvas-pixel buffer added to each axis on top of the
     * per-side required growth. Absorbs cascade rounding and small
     * instance-rect mismatches. Default: 100 px.
     */
    buffer?: number;
    /**
     * Fraction of horizontal padding that goes to the LEFT side.
     * 0.5 = symmetric. Default 0.67 (more pad on the left to leave
     * room for text/logo overlays in typical banner layouts).
     * Right side gets `1 - leftBias`.
     */
    leftBias?: number;
    /**
     * Fraction of vertical padding that goes to the TOP side. 0.5 =
     * symmetric. Default 0.67 (more pad on top — banner products
     * usually anchor bottom-right). Bottom side gets `1 - topBias`.
     */
    topBias?: number;
}

const DEFAULT_BUFFER_PX = 100;
const DEFAULT_LEFT_BIAS = 0.67;
const DEFAULT_TOP_BIAS = 0.67;

/**
 * Compute the wizard outpaint canvas geometry for a given master layer
 * and pack of preview formats.
 *
 * See module docstring for the policy rationale. The function is pure
 * and does not touch DOM or any image data — image-pixel-space padding
 * (which is what the outpaint API actually sees) is derived later by
 * `outpaintImage` from this canvas-space geometry plus the source
 * image's natural dimensions.
 *
 * Edge cases:
 *   - `layerSize.width <= 0` or `layerSize.height <= 0`: returns
 *     all-zero padding and `targetW/H = max(1, layer dim)` — the
 *     caller's "no expand needed" guard further upstream should
 *     prevent this branch from firing in practice.
 *   - `packFormats` empty: only the buffer is added, no per-side growth.
 *   - A format strictly smaller than the master on an axis: that axis
 *     contributes `scale = 1` (i.e. zero growth from that format).
 *     Different formats can drive different axes — the union is taken.
 */
export function computeWizardExpandGeometry(
    layerSize: FormatSize,
    packFormats: FormatSize[],
    opts?: ComputeWizardExpandGeometryOptions,
): ExpandGeometry {
    const buffer = opts?.buffer ?? DEFAULT_BUFFER_PX;
    const leftBias = clamp01(opts?.leftBias ?? DEFAULT_LEFT_BIAS);
    const topBias = clamp01(opts?.topBias ?? DEFAULT_TOP_BIAS);

    const layerW = Math.max(1, layerSize.width);
    const layerH = Math.max(1, layerSize.height);

    // For each format, the cascade applies a *proportional* growth to
    // the instance image layer (see `computeExpansionDelta` in
    // `bindingCascade.ts`). To make the instance cover a format whose
    // artboard exceeds the master on an axis, the master needs to grow
    // by at least the same ratio on that axis. We take the max over
    // all formats per axis to satisfy every format simultaneously.
    let maxScaleW = 1;
    let maxScaleH = 1;
    for (const f of packFormats) {
        if (f.width > 0 && f.width / layerW > maxScaleW) {
            maxScaleW = f.width / layerW;
        }
        if (f.height > 0 && f.height / layerH > maxScaleH) {
            maxScaleH = f.height / layerH;
        }
    }

    const targetW = Math.round(layerW * maxScaleW) + buffer;
    const targetH = Math.round(layerH * maxScaleH) + buffer;

    const hPad = Math.max(0, targetW - layerW);
    const vPad = Math.max(0, targetH - layerH);

    // Asymmetric distribution. `Math.round` on the biased side, then
    // `hPad - padLeft` on the complementary side, so the two sides sum
    // back to `hPad` exactly (no off-by-one drift from double-rounding).
    const padLeft = Math.round(hPad * leftBias);
    const padRight = hPad - padLeft;
    const padTop = Math.round(vPad * topBias);
    const padBottom = vPad - padTop;

    return {
        targetW,
        targetH,
        padTop,
        padRight,
        padBottom,
        padLeft,
    };
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0.5;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}
