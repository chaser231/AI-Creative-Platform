/**
 * normalizeTextLayer — single source of truth for the text sizing model.
 *
 * Text has historically carried TWO parallel sizing models that drifted out of
 * sync and caused unpredictable behaviour:
 *   - `textAdjust`        : "auto_width" | "auto_height" | "fixed"  (text-resize)
 *   - `layoutSizingWidth/Height` : "fixed" | "fill" | "hug"        (auto-layout grow)
 *
 * This module reconciles them into ONE coherent state via a canonical mapping,
 * so the layout engine and the UI never see contradictory intent. It is a pure
 * function: no store access, no side effects.
 *
 * Canonical mapping (per axis; width = horizontal, height = vertical):
 *   - hug  width + hug  height            -> textAdjust "auto_width"
 *   - fixed/fill width + hug height       -> textAdjust "auto_height"
 *   - fixed/fill width + fixed/fill height-> textAdjust "fixed"
 *   - hug width + fixed/fill height (edge)-> textAdjust "auto_width" (hug width wins)
 *
 * `align` (left/center/right) and `verticalAlign` are NEVER touched here — they
 * only affect glyph placement inside the box, not which axis-sizing applies.
 */

import type { TextLayer } from "@/types";

type AxisSizing = "fixed" | "fill" | "hug";
type TextAdjust = NonNullable<TextLayer["textAdjust"]>;

/** Keys whose change can alter the sizing model and therefore needs reconciliation. */
export const TEXT_SIZING_KEYS: ReadonlySet<string> = new Set<string>([
    "textAdjust",
    "layoutSizingWidth",
    "layoutSizingHeight",
    "width",
    "height",
]);

/** Derive `textAdjust` from a (width, height) layout-sizing pair. */
export function textAdjustFromSizing(width: AxisSizing, height: AxisSizing): TextAdjust {
    const widthHugs = width === "hug";
    const heightHugs = height === "hug";
    if (widthHugs && heightHugs) return "auto_width";
    if (!widthHugs && heightHugs) return "auto_height";
    if (!widthHugs && !heightHugs) return "fixed";
    // hug width + fixed/fill height (edge): hugging the width wins → single-line
    // auto width; the fixed/fill height is dormant for auto_width measurement.
    return "auto_width";
}

/** Derive the canonical layout-sizing pair from `textAdjust` (no fill — textAdjust has no fill concept). */
export function sizingFromTextAdjust(textAdjust: TextAdjust): { width: AxisSizing; height: AxisSizing } {
    if (textAdjust === "auto_width") return { width: "hug", height: "hug" };
    if (textAdjust === "auto_height") return { width: "fixed", height: "hug" };
    return { width: "fixed", height: "fixed" };
}

/**
 * Reconcile a text layer's sizing model into a consistent state.
 *
 * @param layer        the text layer AFTER raw updates were merged in
 * @param changedKeys  the keys that were just changed (from `updateLayer`'s
 *                     `updates`). When provided and none of them touch sizing,
 *                     the layer is returned untouched (no normalisation churn).
 *                     When omitted, a full reconcile runs (sizing is treated as
 *                     the source of truth).
 *
 * Direction-of-truth rules:
 *   - If `textAdjust` was the changed field (and layout-sizing was not), the new
 *     `textAdjust` is the intent → derive layout-sizing from it (drops fill).
 *   - Otherwise layout-sizing (or a manual width/height edit) is the intent: a
 *     manual width/height change pins that axis to "fixed", then `textAdjust` is
 *     derived from the resulting pair.
 */
export function normalizeTextLayer(layer: TextLayer, changedKeys?: Iterable<string>): TextLayer {
    const changed = changedKeys ? new Set(changedKeys) : null;
    if (changed) {
        let relevant = false;
        for (const key of changed) {
            if (TEXT_SIZING_KEYS.has(key)) { relevant = true; break; }
        }
        if (!relevant) return layer;
    }

    const currentAdjust: TextAdjust = layer.textAdjust ?? "auto_width";
    const fallback = sizingFromTextAdjust(currentAdjust);

    let width: AxisSizing = (layer.layoutSizingWidth as AxisSizing | undefined) ?? fallback.width;
    let height: AxisSizing = (layer.layoutSizingHeight as AxisSizing | undefined) ?? fallback.height;
    let textAdjust: TextAdjust = currentAdjust;

    const sizingChanged = !!changed && (changed.has("layoutSizingWidth") || changed.has("layoutSizingHeight"));
    const textAdjustChanged = !!changed && changed.has("textAdjust");

    if (textAdjustChanged && !sizingChanged) {
        const derived = sizingFromTextAdjust(currentAdjust);
        width = derived.width;
        height = derived.height;
        textAdjust = currentAdjust;
    } else {
        // A manual width/height edit pins that axis to a concrete (fixed) size —
        // mirrors Figma converting an auto box to fixed when a handle is dragged.
        if (changed?.has("width") && !changed.has("layoutSizingWidth")) width = "fixed";
        if (changed?.has("height") && !changed.has("layoutSizingHeight")) height = "fixed";
        textAdjust = textAdjustFromSizing(width, height);
    }

    if (
        layer.textAdjust === textAdjust &&
        layer.layoutSizingWidth === width &&
        layer.layoutSizingHeight === height
    ) {
        return layer;
    }

    return {
        ...layer,
        textAdjust,
        layoutSizingWidth: width,
        layoutSizingHeight: height,
    };
}
