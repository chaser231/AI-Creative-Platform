/**
 * Offset-aware coordinate pipeline for the overview canvas (Phase 2 foundation).
 *
 * Three coordinate spaces are in play once multiple artboards live on one stage:
 *
 *  - screen:   container pixels (Konva pointer positions, DOM overlay offsets).
 *  - world:    the overview Stage scene space, AFTER stage scale (`zoom`) and
 *              position (`x`,`y`). Pan/zoom move world relative to screen.
 *  - artboard: a single tile's local space — what the studio editor and every
 *              `Layer.x/y` already use (artboard top-left = (0,0)). A tile sits
 *              at world `(tile.x, tile.y)`, so artboard-local = world − tile.
 *
 * Single-artboard studio editing is the degenerate case `tile = {x:0,y:0}` and
 * `viewport = {zoom, x:stageX, y:stageY}`, so these helpers are a strict superset
 * of the existing pipeline and safe to reuse there.
 *
 * All functions are pure (no Konva), so they can be unit-tested in isolation and
 * shared by pointer math, transformer geometry, and DOM-overlay positioning.
 */

export interface Point {
    x: number;
    y: number;
}

/** Overview stage transform: uniform scale + translation (screen = world*zoom + pos). */
export interface OverviewViewport {
    zoom: number;
    x: number;
    y: number;
}

/** World-space top-left of an artboard tile. */
export type TileOffset = Point;

export function screenToWorld(point: Point, viewport: OverviewViewport): Point {
    return {
        x: (point.x - viewport.x) / viewport.zoom,
        y: (point.y - viewport.y) / viewport.zoom,
    };
}

export function worldToScreen(point: Point, viewport: OverviewViewport): Point {
    return {
        x: point.x * viewport.zoom + viewport.x,
        y: point.y * viewport.zoom + viewport.y,
    };
}

export function worldToArtboard(point: Point, tile: TileOffset): Point {
    return { x: point.x - tile.x, y: point.y - tile.y };
}

export function artboardToWorld(point: Point, tile: TileOffset): Point {
    return { x: point.x + tile.x, y: point.y + tile.y };
}

/** Screen pixel → artboard-local coordinate for the tile at `tile`. */
export function screenToArtboard(point: Point, viewport: OverviewViewport, tile: TileOffset): Point {
    return worldToArtboard(screenToWorld(point, viewport), tile);
}

/** Artboard-local coordinate → screen pixel for the tile at `tile`. */
export function artboardToScreen(point: Point, viewport: OverviewViewport, tile: TileOffset): Point {
    return worldToScreen(artboardToWorld(point, tile), viewport);
}

/**
 * On-screen size (px) of `lengthInArtboardUnits` artboard units. Useful for
 * keeping chrome (handles, hairlines, hit padding) a constant pixel size
 * regardless of overview zoom.
 */
export function artboardLengthToScreen(lengthInArtboardUnits: number, viewport: OverviewViewport): number {
    return lengthInArtboardUnits * viewport.zoom;
}

/** Inverse of {@link artboardLengthToScreen}. */
export function screenLengthToArtboard(lengthInScreenPx: number, viewport: OverviewViewport): number {
    return lengthInScreenPx / viewport.zoom;
}
