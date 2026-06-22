import { describe, expect, it } from "vitest";
import { createDefaultLayoutGrid, type LayoutGrid } from "@/types";
import { computeLayoutGridGeometry, getLayoutGridSnapLines } from "../layoutGrid";

function grid(overrides: Partial<LayoutGrid> & Pick<LayoutGrid, "type">): LayoutGrid {
    const base = createDefaultLayoutGrid("g1", overrides.type);
    return { ...base, ...overrides };
}

describe("computeLayoutGridGeometry — uniform", () => {
    it("emits interior lines at every cellSize multiple (edges excluded)", () => {
        const geo = computeLayoutGridGeometry(grid({ type: "uniform", cellSize: 100 }), { width: 300, height: 200 });
        expect(geo.bands).toHaveLength(0);
        expect(geo.lines.vertical).toEqual([100, 200]);
        expect(geo.lines.horizontal).toEqual([100]);
    });
});

describe("computeLayoutGridGeometry — columns", () => {
    it("auto-shares equal columns over the inner span (stretch)", () => {
        const geo = computeLayoutGridGeometry(
            grid({ type: "columns", count: 3, gutter: 0, margin: 0, trackSize: null, align: "stretch" }),
            { width: 300, height: 100 },
        );
        expect(geo.bands).toHaveLength(3);
        expect(geo.bands[0]).toEqual({ x: 0, y: 0, width: 100, height: 100 });
        expect(geo.bands[2]).toEqual({ x: 200, y: 0, width: 100, height: 100 });
        // band edges become vertical snap lines
        expect(geo.lines.vertical).toEqual([0, 100, 200, 300]);
        expect(geo.lines.horizontal).toEqual([]);
    });

    it("subtracts margins and gutters", () => {
        const geo = computeLayoutGridGeometry(
            grid({ type: "columns", count: 2, gutter: 20, margin: 10, trackSize: null, align: "stretch" }),
            { width: 300, height: 100 },
        );
        // inner = 300 - 20 = 280; minus gutter 20 => 260 / 2 = 130 each
        expect(geo.bands[0]).toEqual({ x: 10, y: 0, width: 130, height: 100 });
        expect(geo.bands[1]).toEqual({ x: 160, y: 0, width: 130, height: 100 });
    });

    it("centers fixed-width columns within the inner span", () => {
        const geo = computeLayoutGridGeometry(
            grid({ type: "columns", count: 2, gutter: 0, margin: 0, trackSize: 50, align: "center" }),
            { width: 300, height: 100 },
        );
        // group width = 100, free = 200, center offset = 100
        expect(geo.bands[0].x).toBe(100);
        expect(geo.bands[0].width).toBe(50);
        expect(geo.bands[1].x).toBe(150);
    });

    it("right-aligns fixed-width columns (max)", () => {
        const geo = computeLayoutGridGeometry(
            grid({ type: "columns", count: 1, gutter: 0, margin: 0, trackSize: 80, align: "max" }),
            { width: 300, height: 100 },
        );
        expect(geo.bands[0].x).toBe(220);
        expect(geo.bands[0].width).toBe(80);
    });

    it("clamps oversized fixed-width groups so bands never start before the margin", () => {
        // group = 4 * 100 = 400 > inner 300 -> free clamped to 0, no negative offset
        const center = computeLayoutGridGeometry(
            grid({ type: "columns", count: 4, gutter: 0, margin: 0, trackSize: 100, align: "center" }),
            { width: 300, height: 100 },
        );
        expect(center.bands[0].x).toBe(0);
        const max = computeLayoutGridGeometry(
            grid({ type: "columns", count: 4, gutter: 0, margin: 0, trackSize: 100, align: "max" }),
            { width: 300, height: 100 },
        );
        expect(max.bands[0].x).toBe(0);
    });
});

describe("computeLayoutGridGeometry — rows", () => {
    it("auto-shares equal rows over full width", () => {
        const geo = computeLayoutGridGeometry(
            grid({ type: "rows", count: 2, gutter: 0, margin: 0, trackSize: null, align: "stretch" }),
            { width: 200, height: 100 },
        );
        expect(geo.bands).toHaveLength(2);
        expect(geo.bands[0]).toEqual({ x: 0, y: 0, width: 200, height: 50 });
        expect(geo.bands[1]).toEqual({ x: 0, y: 50, width: 200, height: 50 });
        expect(geo.lines.horizontal).toEqual([0, 50, 100]);
        expect(geo.lines.vertical).toEqual([]);
    });
});

describe("computeLayoutGridGeometry — container", () => {
    it("delegates to slice grid math with fixed/fluid tracks", () => {
        const geo = computeLayoutGridGeometry(
            grid({
                type: "container",
                cols: 3,
                rows: 1,
                colSizes: [200, null, null],
                rowSizes: [],
                gapX: 0,
                gapY: 0,
                margins: { top: 0, right: 0, bottom: 0, left: 0 },
            }),
            { width: 400, height: 100 },
        );
        expect(geo.bands).toHaveLength(3);
        // fixed 200, then two auto = 100 each
        expect(geo.bands[0]).toEqual({ x: 0, y: 0, width: 200, height: 100 });
        expect(geo.bands[1]).toEqual({ x: 200, y: 0, width: 100, height: 100 });
        expect(geo.bands[2]).toEqual({ x: 300, y: 0, width: 100, height: 100 });
        expect(geo.lines.vertical).toEqual([0, 200, 300, 400]);
    });
});

describe("computeLayoutGridGeometry — degenerate bounds", () => {
    it("returns empty geometry for zero-size bounds", () => {
        const geo = computeLayoutGridGeometry(grid({ type: "columns", count: 3 }), { width: 0, height: 0 });
        expect(geo.bands).toHaveLength(0);
        expect(geo.lines.vertical).toEqual([]);
    });
});

describe("getLayoutGridSnapLines", () => {
    it("merges visible grids and dedupes/sorts lines", () => {
        const grids: LayoutGrid[] = [
            grid({ type: "columns", id: "a", count: 2, gutter: 0, margin: 0, trackSize: null, align: "stretch" }),
            { ...grid({ type: "uniform", id: "b", cellSize: 100 }) },
        ];
        const lines = getLayoutGridSnapLines(grids, { width: 200, height: 100 });
        // columns edges: 0,100,200 ; uniform vertical: 100 => deduped 0,100,200
        expect(lines.vertical).toEqual([0, 100, 200]);
    });

    it("ignores grids whose visible flag is false", () => {
        const grids: LayoutGrid[] = [
            { ...grid({ type: "columns", count: 2, gutter: 0, margin: 0, trackSize: null, align: "stretch" }), visible: false },
        ];
        const lines = getLayoutGridSnapLines(grids, { width: 200, height: 100 });
        expect(lines.vertical).toEqual([]);
        expect(lines.horizontal).toEqual([]);
    });

    it("handles undefined input", () => {
        expect(getLayoutGridSnapLines(undefined, { width: 100, height: 100 })).toEqual({ vertical: [], horizontal: [] });
    });
});
