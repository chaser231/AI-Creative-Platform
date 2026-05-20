import { describe, expect, it } from "vitest";
import {
    getInsideStrokePath,
    getOutsideStrokePath,
    getStrokeBoundsExpansion,
    resolveStrokeAlign,
} from "@/utils/strokeGeometry";

describe("resolveStrokeAlign", () => {
    it("defaults to center when undefined", () => {
        expect(resolveStrokeAlign(undefined)).toBe("center");
    });

    it("preserves explicit align", () => {
        expect(resolveStrokeAlign("inside")).toBe("inside");
        expect(resolveStrokeAlign("outside")).toBe("outside");
    });
});

describe("getStrokeBoundsExpansion", () => {
    it("returns zero when stroke width is 0", () => {
        expect(getStrokeBoundsExpansion(0, "outside")).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });

    it("expands half stroke for center align", () => {
        expect(getStrokeBoundsExpansion(4, "center")).toEqual({ x: -2, y: -2, width: 4, height: 4 });
    });

    it("does not expand for inside align", () => {
        expect(getStrokeBoundsExpansion(6, "inside")).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });

    it("expands full stroke for outside align", () => {
        expect(getStrokeBoundsExpansion(3, "outside")).toEqual({ x: -3, y: -3, width: 6, height: 6 });
    });

    it("uses center when align omitted", () => {
        expect(getStrokeBoundsExpansion(2)).toEqual({ x: -1, y: -1, width: 2, height: 2 });
    });
});

describe("stroke path geometry", () => {
    it("insets inside stroke path by half stroke width", () => {
        expect(getInsideStrokePath(100, 80, 10, 0)).toEqual({
            x: 5,
            y: 5,
            width: 90,
            height: 70,
            cornerRadius: 0,
        });
    });

    it("outsets outside stroke path by half stroke width", () => {
        expect(getOutsideStrokePath(100, 80, 10, 0)).toEqual({
            x: -5,
            y: -5,
            width: 110,
            height: 90,
            cornerRadius: 0,
        });
    });

    it("offsets outside path corner radius by half stroke for concentric arcs", () => {
        expect(getOutsideStrokePath(200, 200, 24, 46).cornerRadius).toBe(58);
    });

    it("offsets inside path corner radius by half stroke for concentric arcs", () => {
        expect(getInsideStrokePath(200, 200, 24, 46).cornerRadius).toBe(34);
    });

    it("uses zero path radius when layer radius is zero (miter corners)", () => {
        expect(getOutsideStrokePath(100, 80, 24, 0).cornerRadius).toBe(0);
    });
});
