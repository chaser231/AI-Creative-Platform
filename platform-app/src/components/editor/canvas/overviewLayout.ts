/**
 * Overview Layout — Pure row-based packing for the world-space overview canvas.
 *
 * Used by `StudioOverviewCanvas` to lay out every project artboard (resize
 * format) in a wrapping grid (Figma Slides–style). Deterministic and side-effect
 * free so it can be unit-tested independently of react-konva.
 *
 * Algorithm: left→right, top→bottom row packing. The next item wraps to a new
 * row when placing it would push the current row past `rowWidth`. Each row's
 * vertical separation is `tallestTileInRow + gap + labelHeight` so every tile
 * has predictable space below it for a caption.
 */

export interface OverviewLayoutItem {
    id: string;
    width: number;
    height: number;
}

export interface OverviewLayoutTile {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface OverviewLayoutOptions {
    /** Horizontal & vertical spacing between tiles, in artboard units. */
    gap?: number;
    /** Wrap when the current row's accumulated width + next tile would exceed this. */
    rowWidth?: number;
    /** Vertical room reserved under each tile for caption text. */
    labelHeight?: number;
}

export interface OverviewLayoutResult {
    tiles: OverviewLayoutTile[];
    /** Bounding-box width = right edge of the widest packed row. */
    totalWidth: number;
    /** Bounding-box height = bottom edge of the last row, including its label slot. */
    totalHeight: number;
}

export const DEFAULT_OVERVIEW_GAP = 120;
export const DEFAULT_OVERVIEW_ROW_WIDTH = 4000;
export const DEFAULT_OVERVIEW_LABEL_HEIGHT = 64;

export function computeOverviewLayout(
    items: OverviewLayoutItem[],
    opts: OverviewLayoutOptions = {},
): OverviewLayoutResult {
    const gap = opts.gap ?? DEFAULT_OVERVIEW_GAP;
    const rowWidth = opts.rowWidth ?? DEFAULT_OVERVIEW_ROW_WIDTH;
    const labelHeight = opts.labelHeight ?? DEFAULT_OVERVIEW_LABEL_HEIGHT;

    if (items.length === 0) {
        return { tiles: [], totalWidth: 0, totalHeight: 0 };
    }

    const tiles: OverviewLayoutTile[] = [];
    let cursorX = 0;
    let cursorY = 0;
    let rowMaxHeight = 0;
    let maxRightEdge = 0;
    let maxBottomEdge = 0;

    for (const item of items) {
        // Wrap only if the row is non-empty — items wider than `rowWidth`
        // still get placed (single-tile row) rather than skipped.
        if (cursorX > 0 && cursorX + item.width > rowWidth) {
            cursorY += rowMaxHeight + gap + labelHeight;
            cursorX = 0;
            rowMaxHeight = 0;
        }

        tiles.push({
            id: item.id,
            x: cursorX,
            y: cursorY,
            width: item.width,
            height: item.height,
        });

        const rightEdge = cursorX + item.width;
        const bottomEdge = cursorY + item.height + labelHeight;
        if (rightEdge > maxRightEdge) maxRightEdge = rightEdge;
        if (bottomEdge > maxBottomEdge) maxBottomEdge = bottomEdge;
        if (item.height > rowMaxHeight) rowMaxHeight = item.height;

        cursorX = rightEdge + gap;
    }

    return {
        tiles,
        totalWidth: maxRightEdge,
        totalHeight: maxBottomEdge,
    };
}
