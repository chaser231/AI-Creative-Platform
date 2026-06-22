import { describe, expect, it } from "vitest";
import {
    computeOverviewLayout,
    DEFAULT_OVERVIEW_GAP,
    DEFAULT_OVERVIEW_LABEL_HEIGHT,
    DEFAULT_OVERVIEW_ROW_WIDTH,
} from "./overviewLayout";

describe("computeOverviewLayout", () => {
    it("returns empty result for empty input", () => {
        const result = computeOverviewLayout([]);
        expect(result.tiles).toEqual([]);
        expect(result.totalWidth).toBe(0);
        expect(result.totalHeight).toBe(0);
    });

    it("places a single item at origin and includes label slot in totalHeight", () => {
        const result = computeOverviewLayout(
            [{ id: "a", width: 1080, height: 1080 }],
            { gap: 100, rowWidth: 5000, labelHeight: 60 },
        );
        expect(result.tiles).toEqual([
            { id: "a", x: 0, y: 0, width: 1080, height: 1080 },
        ]);
        expect(result.totalWidth).toBe(1080);
        expect(result.totalHeight).toBe(1080 + 60);
    });

    it("packs items left-to-right with the configured gap", () => {
        const result = computeOverviewLayout(
            [
                { id: "a", width: 1000, height: 1000 },
                { id: "b", width: 800, height: 1000 },
                { id: "c", width: 600, height: 1000 },
            ],
            { gap: 100, rowWidth: 10000, labelHeight: 50 },
        );
        expect(result.tiles.map((t) => ({ id: t.id, x: t.x, y: t.y }))).toEqual([
            { id: "a", x: 0, y: 0 },
            { id: "b", x: 1100, y: 0 },
            { id: "c", x: 2000, y: 0 },
        ]);
        // Right edge of the last tile = 2000 + 600 = 2600.
        expect(result.totalWidth).toBe(2600);
        // Single row, tallest = 1000, plus label slot below.
        expect(result.totalHeight).toBe(1000 + 50);
    });

    it("wraps to a new row when the next item would overflow rowWidth", () => {
        const result = computeOverviewLayout(
            [
                { id: "a", width: 1000, height: 800 },
                { id: "b", width: 1000, height: 1200 },
                { id: "c", width: 1000, height: 400 },
            ],
            // After placing a + b: cursorX = 1000 + 100 + 1000 + 100 = 2200.
            // Adding c (1000) would push cursor to 3200 > rowWidth (3000) → wrap.
            { gap: 100, rowWidth: 3000, labelHeight: 60 },
        );
        const [a, b, c] = result.tiles;
        expect(a).toEqual({ id: "a", x: 0, y: 0, width: 1000, height: 800 });
        expect(b).toEqual({ id: "b", x: 1100, y: 0, width: 1000, height: 1200 });
        // New row Y = max(800,1200) + gap + labelHeight = 1200 + 100 + 60.
        expect(c).toEqual({ id: "c", x: 0, y: 1200 + 100 + 60, width: 1000, height: 400 });
        // Widest right edge across all rows = max(2100, 1000) = 2100.
        expect(result.totalWidth).toBe(2100);
        // Bottom edge of last tile = c.y + c.height + labelHeight = 1360 + 400 + 60 = 1820.
        expect(result.totalHeight).toBe(1360 + 400 + 60);
    });

    it("places an oversized first item on its own row instead of skipping it", () => {
        const result = computeOverviewLayout(
            [
                { id: "huge", width: 5000, height: 500 },
                { id: "small", width: 200, height: 400 },
            ],
            { gap: 100, rowWidth: 1000, labelHeight: 40 },
        );
        const [huge, small] = result.tiles;
        expect(huge).toEqual({ id: "huge", x: 0, y: 0, width: 5000, height: 500 });
        // `small` cannot fit alongside `huge` (cursorX > 0 and would overflow) → wraps.
        expect(small).toEqual({
            id: "small",
            x: 0,
            y: 500 + 100 + 40,
            width: 200,
            height: 400,
        });
        expect(result.totalWidth).toBe(5000);
        expect(result.totalHeight).toBe(500 + 100 + 40 + 400 + 40);
    });

    it("uses sensible defaults when no options are provided", () => {
        const result = computeOverviewLayout([
            { id: "a", width: 1080, height: 1080 },
            { id: "b", width: 1080, height: 1080 },
        ]);
        expect(result.tiles[0].x).toBe(0);
        // Second tile placed at width + default gap.
        expect(result.tiles[1].x).toBe(1080 + DEFAULT_OVERVIEW_GAP);
        // Both fit comfortably within the default rowWidth (no wrap).
        expect(result.tiles[1].y).toBe(0);
        expect(DEFAULT_OVERVIEW_ROW_WIDTH).toBeGreaterThan(1080 * 2);
        expect(result.totalHeight).toBe(1080 + DEFAULT_OVERVIEW_LABEL_HEIGHT);
    });
});
