/**
 * Slice overlay helpers.
 *
 * Slice layers render on the Konva stage as studio-only overlays (dashed
 * outline + label). They must never leak into raster exports, so every slice
 * overlay node carries the `SLICE_OVERLAY_NAME` name and gets hidden for the
 * duration of any `stage.toDataURL` capture.
 */

import type Konva from "konva";

export const SLICE_OVERLAY_NAME = "slice-overlay";

/** Hide slice overlays, run `fn` (e.g. a toDataURL capture), then restore. */
export async function withSliceOverlaysHidden<T>(
    stage: Konva.Stage,
    fn: () => T | Promise<T>,
): Promise<T> {
    const nodes = stage.find(`.${SLICE_OVERLAY_NAME}`);
    const prevVisible = nodes.map((node) => node.visible());
    nodes.forEach((node) => node.visible(false));
    try {
        return await fn();
    } finally {
        nodes.forEach((node, i) => node.visible(prevVisible[i]));
    }
}
