import type { FrameLayer, Layer } from "@/types";

/** Layer fits inside frame bounds (axis-aligned width/height). */
export function canLayerFitInFrame(
    layer: Pick<Layer, "width" | "height">,
    frame: Pick<FrameLayer, "width" | "height">,
): boolean {
    return layer.width <= frame.width && layer.height <= frame.height;
}
