import type Konva from "konva";
import type { Layer } from "@/types";

/** Whether this layer has aspect ratio locked during resize (Figma per-object lock). */
export function isLayerAspectLocked(layer: Layer | undefined): boolean {
    return !!layer?.lockAspectRatio;
}

/**
 * When a layer has `lockAspectRatio`, force uniform scale on the Konva node so
 * width/height stay proportional during transformer drags (incl. multi-select).
 */
export function enforceLockedAspectOnNode(node: Konva.Node, layer: Layer | undefined): void {
    if (!isLayerAspectLocked(layer)) return;

    const sx = node.scaleX();
    const sy = node.scaleY();
    if (Math.abs(sx - sy) < 0.0005) return;

    const dominant = Math.abs(sx) >= Math.abs(sy) ? sx : sy;
    const signX = sx < 0 ? -1 : 1;
    const signY = sy < 0 ? -1 : 1;
    node.scaleX(Math.abs(dominant) * signX);
    node.scaleY(Math.abs(dominant) * signY);
}

/** Uniform scale factors for commit when aspect lock is on. */
export function lockedAspectDimensions(
    layer: Layer,
    scaleX: number,
    scaleY: number,
    baseWidth: number,
    baseHeight: number,
): { width: number; height: number; scaleX: number; scaleY: number } {
    if (!isLayerAspectLocked(layer)) {
        return {
            width: baseWidth * scaleX,
            height: baseHeight * scaleY,
            scaleX,
            scaleY,
        };
    }

    const dominant = Math.abs(scaleX) >= Math.abs(scaleY) ? scaleX : scaleY;
    return {
        width: baseWidth * dominant,
        height: baseHeight * dominant,
        scaleX: dominant,
        scaleY: dominant,
    };
}
