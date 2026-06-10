import { describe, expect, it } from "vitest";
import { computeSliceGrid, resolveTrackSizes } from "../sliceGrid";

describe("resolveTrackSizes", () => {
    it("splits space equally when no fixed sizes", () => {
        expect(resolveTrackSizes(300, 3, undefined, 0)).toEqual([100, 100, 100]);
    });

    it("subtracts gaps before splitting", () => {
        expect(resolveTrackSizes(320, 3, undefined, 10)).toEqual([100, 100, 100]);
    });

    it("keeps fixed sizes and shares the remainder among auto tracks", () => {
        expect(resolveTrackSizes(400, 3, [200, undefined, undefined], 0)).toEqual([200, 100, 100]);
    });

    it("clamps auto size at zero when fixed tracks overflow", () => {
        expect(resolveTrackSizes(100, 2, [150, undefined], 0)).toEqual([150, 0]);
    });

    it("ignores negative fixed sizes", () => {
        expect(resolveTrackSizes(200, 2, [-50, undefined], 0)).toEqual([0, 200]);
    });
});

describe("computeSliceGrid", () => {
    const bounds = { x: 0, y: 0, width: 900, height: 600 };

    it("produces rows × cols rects covering the bounds without gaps/margins", () => {
        const rects = computeSliceGrid({ bounds, cols: 3, rows: 2 });
        expect(rects).toHaveLength(6);
        expect(rects[0]).toMatchObject({ x: 0, y: 0, width: 300, height: 300, row: 0, col: 0 });
        expect(rects[5]).toMatchObject({ x: 600, y: 300, width: 300, height: 300, row: 1, col: 2 });
        // Adjacent slices share edges exactly
        expect(rects[0].x + rects[0].width).toBe(rects[1].x);
        expect(rects[0].y + rects[0].height).toBe(rects[3].y);
    });

    it("applies margins", () => {
        const rects = computeSliceGrid({
            bounds, cols: 2, rows: 1,
            margins: { top: 10, right: 20, bottom: 30, left: 40 },
        });
        expect(rects).toHaveLength(2);
        expect(rects[0]).toMatchObject({ x: 40, y: 10, width: 420, height: 560 });
        expect(rects[1]).toMatchObject({ x: 460, y: 10, width: 420, height: 560 });
    });

    it("applies gaps between tracks only", () => {
        const rects = computeSliceGrid({ bounds, cols: 3, rows: 1, gapX: 30 });
        expect(rects).toHaveLength(3);
        expect(rects.map((r) => r.width)).toEqual([280, 280, 280]);
        expect(rects[1].x - (rects[0].x + rects[0].width)).toBe(30);
        expect(rects[2].x + rects[2].width).toBe(900);
    });

    it("honors fixed column sizes with auto remainder", () => {
        const rects = computeSliceGrid({
            bounds, cols: 3, rows: 1,
            colSizes: [500, undefined, undefined],
        });
        expect(rects.map((r) => r.width)).toEqual([500, 200, 200]);
        expect(rects.map((r) => r.x)).toEqual([0, 500, 700]);
    });

    it("honors fixed row sizes", () => {
        const rects = computeSliceGrid({
            bounds, cols: 1, rows: 3,
            rowSizes: [undefined, 100, undefined],
        });
        expect(rects.map((r) => r.height)).toEqual([250, 100, 250]);
        expect(rects.map((r) => r.y)).toEqual([0, 250, 350]);
    });

    it("rounds edges so neighbours stay flush with fractional track sizes", () => {
        const rects = computeSliceGrid({
            bounds: { x: 0, y: 0, width: 100, height: 30 },
            cols: 3, rows: 1,
        });
        // 100 / 3 = 33.33… — edges must round consistently, no overlap/holes
        expect(rects[0].x + rects[0].width).toBe(rects[1].x);
        expect(rects[1].x + rects[1].width).toBe(rects[2].x);
        expect(rects[2].x + rects[2].width).toBe(100);
        const total = rects.reduce((s, r) => s + r.width, 0);
        expect(total).toBe(100);
    });

    it("offsets by bounds origin", () => {
        const rects = computeSliceGrid({
            bounds: { x: 50, y: 70, width: 200, height: 100 },
            cols: 2, rows: 1,
        });
        expect(rects[0]).toMatchObject({ x: 50, y: 70, width: 100, height: 100 });
        expect(rects[1]).toMatchObject({ x: 150, y: 70 });
    });

    it("returns empty array when margins consume the whole region", () => {
        const rects = computeSliceGrid({
            bounds, cols: 2, rows: 2,
            margins: { left: 500, right: 500 },
        });
        expect(rects).toEqual([]);
    });

    it("skips zero-size tracks created by overflowing fixed sizes", () => {
        const rects = computeSliceGrid({
            bounds: { x: 0, y: 0, width: 100, height: 100 },
            cols: 2, rows: 1,
            colSizes: [120, undefined],
        });
        expect(rects).toHaveLength(1);
        expect(rects[0]).toMatchObject({ col: 0, width: 120 });
    });
});
