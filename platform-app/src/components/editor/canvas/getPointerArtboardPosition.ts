import type Konva from "konva";
import { screenToArtboard, worldToArtboard, type TileOffset } from "./overviewCoords";

/**
 * Screen pointer -> artboard-local coordinate, reading the LIVE stage transform
 * (matches the legacy `(pointer - stage.x()) / stage.scaleX()` math exactly) and
 * subtracting the tile offset. Single-view studio is the degenerate tile {0,0}.
 * Returns null when the stage has no pointer (parity with getPointerPosition()).
 */
export function getPointerArtboardPosition(
    stage: Konva.Stage,
    tile: TileOffset = { x: 0, y: 0 },
): { x: number; y: number } | null {
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;
    const viewport = { zoom: stage.scaleX(), x: stage.x(), y: stage.y() };
    return screenToArtboard(pointer, viewport, tile);
}

/**
 * World/scene point (e.g. from getAbsolutePosition) -> artboard-local, tile-aware.
 * The stage argument is part of the documented API so callers can later supply
 * stage-driven world points without changing call sites; it is unused today.
 */
export function worldPointToArtboard(
    stage: Konva.Stage,
    worldPoint: { x: number; y: number },
    tile: TileOffset = { x: 0, y: 0 },
): { x: number; y: number } {
    void stage;
    return worldToArtboard(worldPoint, tile);
}
