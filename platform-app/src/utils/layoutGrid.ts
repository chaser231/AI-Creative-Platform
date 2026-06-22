/**
 * Layout grid geometry (Figma-like safe zones).
 *
 * Pure math that turns a {@link LayoutGrid} config plus an artboard size into:
 *   - `bands`: filled rectangles (columns / rows / container cells) to render as
 *     a semi-transparent overlay;
 *   - `lines`: vertical / horizontal scene coordinates used both to draw the
 *     uniform grid and to feed snapping.
 *
 * Track parametrization (fixed px vs. auto-share) reuses the same primitives as
 * the procedural slice grid (`resolveTrackSizes` / `computeSliceGrid`), so the
 * "container" grid behaves exactly like the slice tool.
 */

import type { LayoutGrid } from "@/types";
import { computeSliceGrid, resolveTrackSizes } from "@/utils/sliceGrid";

export interface GridRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface GridLines {
    vertical: number[];
    horizontal: number[];
}

export interface GridGeometry {
    bands: GridRect[];
    lines: GridLines;
}

export interface GridBounds {
    width: number;
    height: number;
}

const EMPTY: GridGeometry = { bands: [], lines: { vertical: [], horizontal: [] } };

/** Sort ascending, round to whole pixels, and drop duplicates. */
function dedupe(values: number[]): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    for (const v of values) {
        const r = Math.round(v);
        if (seen.has(r)) continue;
        seen.add(r);
        out.push(r);
    }
    out.sort((a, b) => a - b);
    return out;
}

/** Convert nullable fixed-track arrays to the `undefined`-based form used by sliceGrid. */
function toFixedSizes(arr?: Array<number | null>): Array<number | undefined> | undefined {
    if (!arr) return undefined;
    return arr.map((v) => (v == null ? undefined : v));
}

function uniformGeometry(grid: LayoutGrid, width: number, height: number): GridGeometry {
    const size = Math.max(1, Math.floor(grid.cellSize ?? 8));
    const vertical: number[] = [];
    const horizontal: number[] = [];
    for (let x = size; x < width; x += size) vertical.push(x);
    for (let y = size; y < height; y += size) horizontal.push(y);
    return { bands: [], lines: { vertical: dedupe(vertical), horizontal: dedupe(horizontal) } };
}

/** Resolve track widths/heights and the start offset for a columns/rows grid. */
function resolveTracks(
    span: number,
    count: number,
    gutter: number,
    margin: number,
    trackSize: number | null | undefined,
    align: LayoutGrid["align"],
): { sizes: number[]; start: number } | null {
    const inner = span - margin * 2;
    if (inner <= 0) return null;

    const useFixed = typeof trackSize === "number" && trackSize > 0 && (align ?? "stretch") !== "stretch";
    if (useFixed) {
        const sizes = Array.from({ length: count }, () => trackSize as number);
        const groupSize = (trackSize as number) * count + gutter * (count - 1);
        // Clamp so an oversized fixed-track group never starts before the margin
        // (otherwise center/max alignment would push bands off the artboard).
        const free = Math.max(0, inner - groupSize);
        const offset = align === "center" ? free / 2 : align === "max" ? free : 0;
        return { sizes, start: margin + offset };
    }

    const sizes = resolveTrackSizes(inner, count, undefined, gutter);
    return { sizes, start: margin };
}

function columnsGeometry(grid: LayoutGrid, width: number, height: number): GridGeometry {
    const count = Math.max(1, Math.floor(grid.count ?? 1));
    const gutter = Math.max(0, grid.gutter ?? 0);
    const margin = Math.max(0, grid.margin ?? 0);
    const resolved = resolveTracks(width, count, gutter, margin, grid.trackSize, grid.align);
    if (!resolved) return EMPTY;

    const bands: GridRect[] = [];
    const vertical: number[] = [];
    let cursor = resolved.start;
    for (let i = 0; i < count; i++) {
        const x0 = Math.round(cursor);
        const x1 = Math.round(cursor + resolved.sizes[i]);
        const w = x1 - x0;
        if (w > 0) {
            bands.push({ x: x0, y: 0, width: w, height });
            vertical.push(x0, x1);
        }
        cursor += resolved.sizes[i] + gutter;
    }
    return { bands, lines: { vertical: dedupe(vertical), horizontal: [] } };
}

function rowsGeometry(grid: LayoutGrid, width: number, height: number): GridGeometry {
    const count = Math.max(1, Math.floor(grid.count ?? 1));
    const gutter = Math.max(0, grid.gutter ?? 0);
    const margin = Math.max(0, grid.margin ?? 0);
    const resolved = resolveTracks(height, count, gutter, margin, grid.trackSize, grid.align);
    if (!resolved) return EMPTY;

    const bands: GridRect[] = [];
    const horizontal: number[] = [];
    let cursor = resolved.start;
    for (let i = 0; i < count; i++) {
        const y0 = Math.round(cursor);
        const y1 = Math.round(cursor + resolved.sizes[i]);
        const h = y1 - y0;
        if (h > 0) {
            bands.push({ x: 0, y: y0, width, height: h });
            horizontal.push(y0, y1);
        }
        cursor += resolved.sizes[i] + gutter;
    }
    return { bands, lines: { vertical: [], horizontal: dedupe(horizontal) } };
}

function containerGeometry(grid: LayoutGrid, width: number, height: number): GridGeometry {
    const rects = computeSliceGrid({
        bounds: { x: 0, y: 0, width, height },
        cols: grid.cols ?? 1,
        rows: grid.rows ?? 1,
        colSizes: toFixedSizes(grid.colSizes),
        rowSizes: toFixedSizes(grid.rowSizes),
        gapX: grid.gapX ?? 0,
        gapY: grid.gapY ?? 0,
        margins: grid.margins,
    });

    const bands: GridRect[] = rects.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
    const vertical: number[] = [];
    const horizontal: number[] = [];
    for (const r of bands) {
        vertical.push(r.x, r.x + r.width);
        horizontal.push(r.y, r.y + r.height);
    }
    return { bands, lines: { vertical: dedupe(vertical), horizontal: dedupe(horizontal) } };
}

/** Compute renderable bands + snap lines for a single layout grid. */
export function computeLayoutGridGeometry(grid: LayoutGrid, bounds: GridBounds): GridGeometry {
    const width = Math.max(0, bounds.width);
    const height = Math.max(0, bounds.height);
    if (width <= 0 || height <= 0) return EMPTY;

    switch (grid.type) {
        case "uniform":
            return uniformGeometry(grid, width, height);
        case "columns":
            return columnsGeometry(grid, width, height);
        case "rows":
            return rowsGeometry(grid, width, height);
        case "container":
            return containerGeometry(grid, width, height);
        default:
            return EMPTY;
    }
}

/**
 * Collect snap lines (vertical / horizontal scene coordinates) from all visible
 * grids. Edges of bands/cells and uniform grid lines become snap targets.
 */
export function getLayoutGridSnapLines(
    grids: LayoutGrid[] | undefined,
    bounds: GridBounds,
): GridLines {
    const vertical: number[] = [];
    const horizontal: number[] = [];
    if (!grids || grids.length === 0) return { vertical, horizontal };

    for (const grid of grids) {
        if (!grid.visible) continue;
        const geo = computeLayoutGridGeometry(grid, bounds);
        vertical.push(...geo.lines.vertical);
        horizontal.push(...geo.lines.horizontal);
    }
    return { vertical: dedupe(vertical), horizontal: dedupe(horizontal) };
}
