import type { FrameLayer, Layer } from "@/types";

/** Layer fits inside frame bounds (axis-aligned width/height). */
export function canLayerFitInFrame(
    layer: Pick<Layer, "width" | "height">,
    frame: Pick<FrameLayer, "width" | "height">,
): boolean {
    return layer.width <= frame.width && layer.height <= frame.height;
}

/**
 * Walks frame.childIds upward to collect every ancestor frame id of `layerId`.
 * Used during drag to remove ancestor frames from the effective drag set so a
 * grabbed child does not pull its parent frame along when both happen to be
 * selected.
 */
export function collectAncestorFrameIds(
    layerId: string,
    layers: ReadonlyArray<Pick<Layer, "id" | "type"> & { childIds?: ReadonlyArray<string> }>,
): Set<string> {
    const result = new Set<string>();
    let current = layerId;
    // Cap iterations to prevent runaway loops if the data ever has a cycle.
    for (let i = 0; i < layers.length; i++) {
        const parent = layers.find(
            (l) =>
                l.type === "frame"
                && Array.isArray(l.childIds)
                && (l.childIds as string[]).includes(current),
        );
        if (!parent || result.has(parent.id)) return result;
        result.add(parent.id);
        current = parent.id;
    }
    return result;
}
