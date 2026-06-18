/**
 * Slice geometry helpers for slice-aware layer alignment.
 *
 * Pure, layer-agnostic math: works on axis-aligned rectangles only. The slice
 * grid is DERIVED from the existing slice rects (the procedural grid config —
 * cols/rows/gap/margins — is not persisted), so the "cut-lines" are the edges
 * of those rects and the gap bands between them are already excluded (a slice
 * rect IS the safe area inside its cell).
 */

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Which axes the alignment operates on, derived from slice orientation. */
export interface Axes {
    x: boolean;
    y: boolean;
}

export interface SliceGrid {
    /** The slice rects, treated directly as the safe cells. */
    cells: Rect[];
    /** Vertical cut-lines exist (more than one column) → operate on X. */
    axisX: boolean;
    /** Horizontal cut-lines exist (more than one row) → operate on Y. */
    axisY: boolean;
}

/** Edges closer than this are treated as the same track boundary. */
const EDGE_EPSILON = 0.5;
/** Containment / equality slack, in px. */
const FIT_EPSILON = 0.5;

function uniqueSorted(values: number[], eps = EDGE_EPSILON): number[] {
    const sorted = [...values].sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted) {
        if (out.length === 0 || Math.abs(v - out[out.length - 1]) > eps) out.push(v);
    }
    return out;
}

/**
 * Derive a slice grid from raw slice rects. Axis activity is inferred from the
 * number of distinct column starts (X) and row starts (Y): a single column
 * means there are no vertical cut-lines, so the X axis stays inactive, etc.
 */
export function deriveSliceGrid(slices: Rect[]): SliceGrid {
    const cells = slices.map((s) => ({ x: s.x, y: s.y, width: s.width, height: s.height }));
    const lefts = uniqueSorted(cells.map((c) => c.x));
    const tops = uniqueSorted(cells.map((c) => c.y));
    return {
        cells,
        axisX: lefts.length > 1,
        axisY: tops.length > 1,
    };
}

function overlapArea(a: Rect, b: Rect): number {
    const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return w * h;
}

function centerDistanceSq(a: Rect, b: Rect): number {
    const dx = (a.x + a.width / 2) - (b.x + b.width / 2);
    const dy = (a.y + a.height / 2) - (b.y + b.height / 2);
    return dx * dx + dy * dy;
}

/**
 * Pick the cell the box belongs to: maximum overlap area, tie-broken by the
 * nearest center. When the box does not overlap any cell, the nearest center
 * wins outright.
 */
function pickBestCell(box: Rect, pool: Rect[]): Rect | null {
    let best: Rect | null = null;
    let bestOverlap = -1;
    let bestDist = Infinity;
    for (const cell of pool) {
        const ov = overlapArea(box, cell);
        const dist = centerDistanceSq(box, cell);
        if (ov > bestOverlap + 1e-6 || (Math.abs(ov - bestOverlap) <= 1e-6 && dist < bestDist)) {
            best = cell;
            bestOverlap = ov;
            bestDist = dist;
        }
    }
    return best;
}

/** Nearest / most-overlapping cell, ignoring whether the box fits (used by "fit"). */
export function findNearestCell(box: Rect, cells: Rect[]): Rect | null {
    if (cells.length === 0) return null;
    return pickBestCell(box, cells);
}

/**
 * Best cell that can fully CONTAIN the box on the active axes (used by
 * "avoid_cut"). Returns null when no cell is large enough — the caller treats
 * that as "alignment not feasible".
 */
export function findContainingCell(box: Rect, cells: Rect[], axes: Axes): Rect | null {
    const fits = cells.filter((c) =>
        (!axes.x || c.width >= box.width - FIT_EPSILON) &&
        (!axes.y || c.height >= box.height - FIT_EPSILON)
    );
    if (fits.length === 0) return null;
    return pickBestCell(box, fits);
}

/**
 * Minimal `{dx, dy}` shift so the box sits fully inside the cell on the active
 * axes. Assumes the box fits the cell on those axes (see `findContainingCell`).
 */
export function computeAvoidCutDelta(box: Rect, cell: Rect, axes: Axes): { dx: number; dy: number } {
    let dx = 0;
    let dy = 0;
    if (axes.x) {
        if (box.x < cell.x) dx = cell.x - box.x;
        else if (box.x + box.width > cell.x + cell.width) {
            dx = (cell.x + cell.width) - (box.x + box.width);
        }
    }
    if (axes.y) {
        if (box.y < cell.y) dy = cell.y - box.y;
        else if (box.y + box.height > cell.y + cell.height) {
            dy = (cell.y + cell.height) - (box.y + box.height);
        }
    }
    return { dx, dy };
}

/**
 * Proportional scale factor so the box fits the cell on the active axes.
 * Shrinks AND grows (scale_fit semantics); inactive axes never constrain.
 */
export function computeFitScale(box: Rect, cell: Rect, axes: Axes): number {
    const ratios: number[] = [];
    if (axes.x && box.width > 0) ratios.push(cell.width / box.width);
    if (axes.y && box.height > 0) ratios.push(cell.height / box.height);
    if (ratios.length === 0) return 1;
    return Math.min(...ratios);
}

/**
 * Fit transform: proportional scale + new top-left. The box is centered inside
 * the cell on active axes; on inactive axes it scales around its own center so
 * it does not drift.
 */
export function computeFitTransform(
    box: Rect,
    cell: Rect,
    axes: Axes,
): { scale: number; x: number; y: number } {
    const scale = computeFitScale(box, cell, axes);
    const newW = box.width * scale;
    const newH = box.height * scale;
    const x = axes.x
        ? cell.x + (cell.width - newW) / 2
        : box.x - (newW - box.width) / 2;
    const y = axes.y
        ? cell.y + (cell.height - newH) / 2
        : box.y - (newH - box.height) / 2;
    return { scale, x, y };
}

/** True when the box is crossed by a cut-line on an active axis (i.e. cut). */
export function isBoxCut(box: Rect, grid: SliceGrid): boolean {
    if (grid.cells.length === 0) return false;
    const axes: Axes = { x: grid.axisX, y: grid.axisY };
    const cell = findContainingCell(box, grid.cells, axes);
    if (!cell) return true; // too large to fit any cell on an active axis
    const delta = computeAvoidCutDelta(box, cell, axes);
    return Math.abs(delta.dx) > FIT_EPSILON || Math.abs(delta.dy) > FIT_EPSILON;
}
