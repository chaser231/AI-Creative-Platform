/**
 * Procedural slice grid math.
 *
 * Splits a rectangular region (usually the artboard) into rows × cols slice
 * rects with optional margins, gaps, and per-track fixed pixel sizes. Tracks
 * without a fixed size share the remaining space equally. Slice boundaries
 * are rounded to whole pixels by rounding track *edges* (not sizes), so
 * adjacent slices never drift apart or overlap.
 */

export interface SliceGridMargins {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface SliceGridOptions {
    /** Region being sliced (scene coordinates). */
    bounds: { x: number; y: number; width: number; height: number };
    /** Number of horizontal divisions (columns), >= 1. */
    cols: number;
    /** Number of vertical divisions (rows), >= 1. */
    rows: number;
    /**
     * Fixed pixel widths per column index. `undefined` entries (and indices
     * beyond the array) auto-share the remaining width equally.
     */
    colSizes?: Array<number | undefined>;
    /** Fixed pixel heights per row index — same semantics as `colSizes`. */
    rowSizes?: Array<number | undefined>;
    /** Horizontal gap between adjacent columns, px. */
    gapX?: number;
    /** Vertical gap between adjacent rows, px. */
    gapY?: number;
    margins?: Partial<SliceGridMargins>;
}

export interface SliceGridRect {
    x: number;
    y: number;
    width: number;
    height: number;
    row: number;
    col: number;
}

/**
 * Resolve track sizes (column widths or row heights) for one axis.
 * `total` is the inner span (bounds minus margins). Fixed sizes are kept
 * as-is (clamped to >= 0); the remaining space after fixed tracks and gaps
 * is split equally between auto tracks (never below 0).
 */
export function resolveTrackSizes(
    total: number,
    count: number,
    fixedSizes: Array<number | undefined> | undefined,
    gap: number,
): number[] {
    const n = Math.max(1, Math.floor(count));
    const inner = total - gap * (n - 1);

    const fixed: Array<number | undefined> = Array.from({ length: n }, (_, i) => {
        const v = fixedSizes?.[i];
        return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : undefined;
    });

    const fixedSum = fixed.reduce<number>((sum, v) => sum + (v ?? 0), 0);
    const autoCount = fixed.filter((v) => v === undefined).length;
    const autoSize = autoCount > 0 ? Math.max(0, (inner - fixedSum) / autoCount) : 0;

    return fixed.map((v) => v ?? autoSize);
}

/** Compute rounded track edges: [start, end] pairs derived from cumulative positions. */
function trackEdges(start: number, sizes: number[], gap: number): Array<[number, number]> {
    const edges: Array<[number, number]> = [];
    let cursor = start;
    for (const size of sizes) {
        const from = Math.round(cursor);
        const to = Math.round(cursor + size);
        edges.push([from, to]);
        cursor += size + gap;
    }
    return edges;
}

export function computeSliceGrid(options: SliceGridOptions): SliceGridRect[] {
    const { bounds } = options;
    const cols = Math.max(1, Math.floor(options.cols));
    const rows = Math.max(1, Math.floor(options.rows));
    const gapX = Math.max(0, options.gapX ?? 0);
    const gapY = Math.max(0, options.gapY ?? 0);
    const margins: SliceGridMargins = {
        top: Math.max(0, options.margins?.top ?? 0),
        right: Math.max(0, options.margins?.right ?? 0),
        bottom: Math.max(0, options.margins?.bottom ?? 0),
        left: Math.max(0, options.margins?.left ?? 0),
    };

    const innerWidth = bounds.width - margins.left - margins.right;
    const innerHeight = bounds.height - margins.top - margins.bottom;
    if (innerWidth <= 0 || innerHeight <= 0) return [];

    const colWidths = resolveTrackSizes(innerWidth, cols, options.colSizes, gapX);
    const rowHeights = resolveTrackSizes(innerHeight, rows, options.rowSizes, gapY);

    const xEdges = trackEdges(bounds.x + margins.left, colWidths, gapX);
    const yEdges = trackEdges(bounds.y + margins.top, rowHeights, gapY);

    const rects: SliceGridRect[] = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const [x0, x1] = xEdges[col];
            const [y0, y1] = yEdges[row];
            const width = x1 - x0;
            const height = y1 - y0;
            if (width <= 0 || height <= 0) continue;
            rects.push({ x: x0, y: y0, width, height, row, col });
        }
    }
    return rects;
}
