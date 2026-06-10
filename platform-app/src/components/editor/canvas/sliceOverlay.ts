/**
 * Slice overlay helpers.
 *
 * Slice layers render on the Konva stage as studio-only overlays (dashed
 * outline + label). They must never leak into raster exports, so every slice
 * overlay node carries the `SLICE_OVERLAY_NAME` name and gets hidden for the
 * duration of any `stage.toDataURL` capture.
 */

import type Konva from "konva";
import { withEditorChromeHiddenAsync } from "@/utils/stageExportCapture";

export const SLICE_OVERLAY_NAME = "slice-overlay";

/** Hide studio chrome (selection handles, slice overlays, …), capture, restore. */
export async function withSliceOverlaysHidden<T>(
    stage: Konva.Stage,
    fn: () => T | Promise<T>,
): Promise<T> {
    return withEditorChromeHiddenAsync(stage, fn);
}
