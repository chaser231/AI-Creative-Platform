import { describe, expect, it } from "vitest";
import {
    computeLeftPadding,
    computeRightPadding,
    expandHandleDragBound,
} from "@/utils/expandOverlayMath";

describe("expandOverlayMath", () => {
    it("computes left padding when layer is flush to artboard x=0", () => {
        const origX = 0;
        const handleX = -100;
        expect(computeLeftPadding(origX, handleX)).toBe(100);
    });

    it("clamps negative padding to zero when handle moves inward", () => {
        expect(computeLeftPadding(0, 20)).toBe(0);
    });

    it("computes right padding beyond artboard width", () => {
        const origX = 800;
        const origW = 400;
        const handleX = 1300;
        expect(computeRightPadding(origX, origW, handleX)).toBe(100);
    });

    it("allows drag positions outside artboard bounds", () => {
        const bound = expandHandleDragBound({ x: -200, y: 50 }, 1200, 800, 2048);
        expect(bound.x).toBe(-200);
        expect(bound.y).toBe(50);
    });
});
