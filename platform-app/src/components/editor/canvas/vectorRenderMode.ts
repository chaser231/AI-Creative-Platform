import type { VectorLayer } from "@/types";
import { hasRenderableGeometry } from "@/utils/vectorGeometry";

/**
 * How a read-only renderer (overview sibling tiles + `PreviewCanvas`) should
 * paint a vector layer.
 *
 * - `inline`: rasterize the layer's `inlineSvg` snapshot via the browser. This
 *   is required for complex Figma boolean/even-odd vectors whose geometry lives
 *   only in `inlineSvg` (their `subpaths` are empty), so a Konva `<Path>` would
 *   paint nothing or garbage.
 * - `path` with `subpaths`: editable subpath geometry exists, draw it directly.
 * - `path` with `raw`: fall back to the imported `rawSvgPath` (scaled by viewBox).
 */
export type ReadOnlyVectorRenderMode =
    | { kind: "inline" }
    | { kind: "path"; source: "subpaths" | "raw" };

/**
 * Mirrors the studio active-path non-editing render priority so every surface
 * (active artboard, inactive overview tiles, wizard preview) paints the same
 * vector. `inlineSvg` wins, then renderable subpaths, then the raw SVG path.
 */
export function resolveReadOnlyVectorRenderMode(
    layer: Pick<VectorLayer, "inlineSvg" | "subpaths" | "rawSvgPath">,
): ReadOnlyVectorRenderMode {
    if (layer.inlineSvg) return { kind: "inline" };
    if (hasRenderableGeometry(layer.subpaths)) return { kind: "path", source: "subpaths" };
    return { kind: "path", source: "raw" };
}
