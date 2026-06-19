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

/** Per-axis anchor: leading edge, center, or trailing edge. */
export type AxisAnchor = "start" | "center" | "end";

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
 * Anchor a scaled segment on one axis.
 * - Active axis: position the new segment of `newSize` INSIDE the cell
 *   [cellStart, cellStart+cellSize] according to the anchor (start/center/end).
 * - Inactive axis: keep the corresponding EDGE of the original box fixed while
 *   scaling (start → top/left edge, end → bottom/right edge, center → center),
 *   so the object does not drift on the free axis.
 */
function anchorAxis(
    active: boolean,
    anchor: AxisAnchor,
    cellStart: number,
    cellSize: number,
    boxStart: number,
    boxSize: number,
    newSize: number,
): number {
    if (active) {
        if (anchor === "start") return cellStart;
        if (anchor === "end") return cellStart + cellSize - newSize;
        return cellStart + (cellSize - newSize) / 2;
    }
    if (anchor === "start") return boxStart;
    if (anchor === "end") return boxStart + boxSize - newSize;
    return boxStart - (newSize - boxSize) / 2;
}

/**
 * Fit transform: proportional scale + new top-left, positioned per anchor.
 * Anchors default to center on both axes (previous behaviour).
 */
export function computeFitTransform(
    box: Rect,
    cell: Rect,
    axes: Axes,
    anchorX: AxisAnchor = "center",
    anchorY: AxisAnchor = "center",
): { scale: number; x: number; y: number } {
    const scale = computeFitScale(box, cell, axes);
    const newW = box.width * scale;
    const newH = box.height * scale;
    const x = anchorAxis(axes.x, anchorX, cell.x, cell.width, box.x, box.width, newW);
    const y = anchorAxis(axes.y, anchorY, cell.y, cell.height, box.y, box.height, newH);
    return { scale, x, y };
}

/**
 * Place a 1D segment within [lo, hi], avoiding the given forbidden START
 * intervals (open), as close as possible to `current`. Returns null when no
 * feasible position exists. Used to keep a shifted layer off both the cut-lines
 * (via [lo, hi]) and other layers (via forbidden intervals).
 */
export function placeInRange(
    current: number,
    lo: number,
    hi: number,
    forbidden: Array<[number, number]>,
): number | null {
    if (hi < lo - 1e-6) return null;

    // Test against the ORIGINAL intervals (open). Clamp only the candidate
    // positions into [lo, hi]; clamping the intervals themselves would wrongly
    // free up a boundary that still overlaps an obstacle reaching past it.
    const isForbidden = (x: number) => forbidden.some(([a, b]) => x > a + 1e-6 && x < b - 1e-6);
    const clamp = (x: number) => Math.min(Math.max(x, lo), hi);

    const clampedCurrent = clamp(current);
    if (!isForbidden(clampedCurrent)) return clampedCurrent;

    const candidates = [lo, hi];
    for (const [a, b] of forbidden) {
        candidates.push(a, b);
    }

    let best: number | null = null;
    let bestDist = Infinity;
    for (const candidate of candidates) {
        const x = clamp(candidate);
        if (isForbidden(x)) continue;
        const dist = Math.abs(x - current);
        if (dist < bestDist) {
            bestDist = dist;
            best = x;
        }
    }
    return best;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return aEnd > bStart + 1e-6 && bEnd > aStart + 1e-6;
}

/**
 * Place `subject` inside ONE concrete `cell` (cut-avoidance) while staying off
 * `obstacles` (per active axis, via `placeInRange`). Returns the shift, or null
 * when overlap cannot be cleared anywhere inside this cell.
 */
function solveOverlapFreePlacement(
    subject: Rect,
    cell: Rect,
    axes: Axes,
    obstacles: Rect[],
): { dx: number; dy: number } | null {
    let dx = 0;
    let dy = 0;
    if (axes.x) {
        const forbidden = obstacles
            .filter((o) => rangesOverlap(subject.y, subject.y + subject.height, o.y, o.y + o.height))
            .map((o) => [o.x - subject.width, o.x + o.width] as [number, number]);
        const placed = placeInRange(subject.x, cell.x, cell.x + cell.width - subject.width, forbidden);
        if (placed == null) return null;
        dx = placed - subject.x;
    }
    if (axes.y) {
        const movedX = subject.x + dx;
        const forbidden = obstacles
            .filter((o) => rangesOverlap(movedX, movedX + subject.width, o.x, o.x + o.width))
            .map((o) => [o.y - subject.height, o.y + o.height] as [number, number]);
        const placed = placeInRange(subject.y, cell.y, cell.y + cell.height - subject.height, forbidden);
        if (placed == null) return null;
        dy = placed - subject.y;
    }
    return { dx, dy };
}

/**
 * Overlap-aware avoid-cut shift. Among ALL cells that can contain `subject` on
 * the active axes, picks the one whose overlap-free placement needs the least
 * movement — so a column already occupied by an obstacle (e.g. another headline)
 * is skipped in favour of a free neighbouring column.
 *
 * Falls back to the nearest containing cell with plain cut-avoidance (and
 * `overlapFailed = true`) when no cell admits an overlap-free spot. Returns null
 * only when no cell can contain the subject at all (caller → "cannot avoid cut").
 */
export function computeOverlapAwareDelta(
    subject: Rect,
    cells: Rect[],
    axes: Axes,
    obstacles: Rect[],
): { dx: number; dy: number; overlapFailed: boolean } | null {
    const fits = cells.filter((c) =>
        (!axes.x || c.width >= subject.width - FIT_EPSILON) &&
        (!axes.y || c.height >= subject.height - FIT_EPSILON)
    );
    if (fits.length === 0) return null;

    let best: { dx: number; dy: number } | null = null;
    let bestCost = Infinity;
    for (const cell of fits) {
        const placement = solveOverlapFreePlacement(subject, cell, axes, obstacles);
        if (!placement) continue;
        const cost = Math.abs(placement.dx) + Math.abs(placement.dy);
        if (cost < bestCost - 1e-6) {
            bestCost = cost;
            best = placement;
        }
    }
    if (best) return { ...best, overlapFailed: false };

    const fallback = pickBestCell(subject, fits) as Rect;
    const { dx, dy } = computeAvoidCutDelta(subject, fallback, axes);
    return { dx, dy, overlapFailed: true };
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
