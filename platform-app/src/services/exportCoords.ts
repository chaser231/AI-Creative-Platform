import Konva from "konva";
import type { Layer } from "@/types";

/** Layer position from the live Konva stage (falls back to store coords). */
export function resolveLayerPosition(layer: Layer, stage?: Konva.Stage | null): { x: number; y: number } {
    if (!stage) return { x: layer.x, y: layer.y };
    const node = stage.findOne("#" + layer.id);
    if (!node) return { x: layer.x, y: layer.y };
    return { x: node.x(), y: node.y() };
}
