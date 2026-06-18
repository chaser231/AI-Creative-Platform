import { describe, expect, it } from "vitest";
import {
    computeAvoidCutDelta,
    computeFitScale,
    computeFitTransform,
    deriveSliceGrid,
    findContainingCell,
    findNearestCell,
    isBoxCut,
    type Rect,
} from "../sliceLayout";

const cols3 = [
    { x: 0, y: 0, width: 300, height: 600 },
    { x: 300, y: 0, width: 300, height: 600 },
    { x: 600, y: 0, width: 300, height: 600 },
];

const rows2 = [
    { x: 0, y: 0, width: 600, height: 200 },
    { x: 0, y: 200, width: 600, height: 200 },
];

const grid2x2 = [
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 100, y: 0, width: 100, height: 100 },
    { x: 0, y: 100, width: 100, height: 100 },
    { x: 100, y: 100, width: 100, height: 100 },
];

describe("deriveSliceGrid", () => {
    it("detects vertical cut-lines only (columns)", () => {
        const grid = deriveSliceGrid(cols3);
        expect(grid.axisX).toBe(true);
        expect(grid.axisY).toBe(false);
        expect(grid.cells).toHaveLength(3);
    });

    it("detects horizontal cut-lines only (rows)", () => {
        const grid = deriveSliceGrid(rows2);
        expect(grid.axisX).toBe(false);
        expect(grid.axisY).toBe(true);
    });

    it("detects both axes for a grid", () => {
        const grid = deriveSliceGrid(grid2x2);
        expect(grid.axisX).toBe(true);
        expect(grid.axisY).toBe(true);
    });

    it("treats a single cell as having no active cut-lines", () => {
        const grid = deriveSliceGrid([{ x: 0, y: 0, width: 100, height: 100 }]);
        expect(grid.axisX).toBe(false);
        expect(grid.axisY).toBe(false);
    });
});

describe("findContainingCell", () => {
    const cells = deriveSliceGrid(cols3).cells;

    it("returns the most-overlapping cell that can contain the box", () => {
        const box: Rect = { x: 260, y: 100, width: 100, height: 100 };
        const cell = findContainingCell(box, cells, { x: true, y: false });
        expect(cell).not.toBeNull();
        // box (260..360) overlaps cell 1 (300..600) more than cell 0 (0..300)
        expect(cell?.x).toBe(300);
    });

    it("returns null when no cell can fit the box on the active axis", () => {
        const box: Rect = { x: 0, y: 0, width: 400, height: 100 };
        expect(findContainingCell(box, cells, { x: true, y: false })).toBeNull();
    });

    it("ignores the inactive axis when checking containment", () => {
        // Box taller than the cell, but Y is inactive → still fits.
        const box: Rect = { x: 10, y: 0, width: 100, height: 9999 };
        expect(findContainingCell(box, cells, { x: true, y: false })).not.toBeNull();
    });
});

describe("findNearestCell", () => {
    it("picks the cell with the nearest center", () => {
        const cells = deriveSliceGrid(grid2x2).cells;
        const box: Rect = { x: 120, y: 120, width: 20, height: 20 };
        const cell = findNearestCell(box, cells);
        expect(cell).toMatchObject({ x: 100, y: 100 });
    });

    it("returns null for an empty grid", () => {
        expect(findNearestCell({ x: 0, y: 0, width: 10, height: 10 }, [])).toBeNull();
    });
});

describe("computeAvoidCutDelta", () => {
    it("shifts left so a box straddling a vertical cut fits the left cell", () => {
        const cell: Rect = { x: 0, y: 0, width: 100, height: 100 };
        const box: Rect = { x: 80, y: 10, width: 40, height: 40 };
        const { dx, dy } = computeAvoidCutDelta(box, cell, { x: true, y: false });
        expect(dx).toBe(-20); // 80+40=120 → clamp right edge to 100
        expect(dy).toBe(0);
    });

    it("shifts right so a box past the left edge enters the cell", () => {
        const cell: Rect = { x: 100, y: 0, width: 100, height: 100 };
        const box: Rect = { x: 80, y: 10, width: 40, height: 40 };
        const { dx } = computeAvoidCutDelta(box, cell, { x: true, y: false });
        expect(dx).toBe(20); // left edge 80 → 100
    });

    it("operates on Y for horizontal cut-lines", () => {
        const cell: Rect = { x: 0, y: 0, width: 600, height: 100 };
        const box: Rect = { x: 10, y: 80, width: 40, height: 40 };
        const { dx, dy } = computeAvoidCutDelta(box, cell, { x: false, y: true });
        expect(dx).toBe(0);
        expect(dy).toBe(-20);
    });

    it("returns zero when the box is already inside the cell", () => {
        const cell: Rect = { x: 0, y: 0, width: 100, height: 100 };
        const box: Rect = { x: 20, y: 20, width: 40, height: 40 };
        expect(computeAvoidCutDelta(box, cell, { x: true, y: true })).toEqual({ dx: 0, dy: 0 });
    });
});

describe("computeFitScale / computeFitTransform", () => {
    it("scales up proportionally to fill the cell on active axes", () => {
        const cell: Rect = { x: 0, y: 0, width: 100, height: 100 };
        const box: Rect = { x: 20, y: 20, width: 40, height: 40 };
        expect(computeFitScale(box, cell, { x: true, y: true })).toBe(2.5);
        const t = computeFitTransform(box, cell, { x: true, y: true });
        expect(t).toMatchObject({ scale: 2.5, x: 0, y: 0 });
    });

    it("scales down when the box is larger than the cell", () => {
        const cell: Rect = { x: 0, y: 0, width: 100, height: 100 };
        const box: Rect = { x: 0, y: 0, width: 200, height: 100 };
        const t = computeFitTransform(box, cell, { x: true, y: true });
        expect(t.scale).toBe(0.5);
        // 200x100 → 100x50, centered in 100x100 cell
        expect(t.x).toBe(0);
        expect(t.y).toBe(25);
    });

    it("only constrains the active axis and keeps center on the inactive axis", () => {
        const cell: Rect = { x: 0, y: 0, width: 100, height: 400 };
        const box: Rect = { x: 30, y: 30, width: 40, height: 40 };
        // Only X active → scale = 100/40 = 2.5
        const t = computeFitTransform(box, cell, { x: true, y: false });
        expect(t.scale).toBe(2.5);
        expect(t.x).toBe(0); // centered in cell width
        // Y inactive: scaled around its own center (50) → newH 100 → y = 50 - 50 = 0
        expect(t.y).toBe(0);
    });
});

describe("isBoxCut", () => {
    const grid = deriveSliceGrid(cols3);

    it("is true when a cut-line crosses the box", () => {
        expect(isBoxCut({ x: 280, y: 0, width: 40, height: 100 }, grid)).toBe(true);
    });

    it("is false when the box sits inside one cell", () => {
        expect(isBoxCut({ x: 20, y: 0, width: 40, height: 100 }, grid)).toBe(false);
    });

    it("is true when the box is too large to fit any cell", () => {
        expect(isBoxCut({ x: 0, y: 0, width: 500, height: 100 }, grid)).toBe(true);
    });
});
