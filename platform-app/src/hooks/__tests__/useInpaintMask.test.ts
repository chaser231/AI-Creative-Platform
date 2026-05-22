import { describe, expect, it } from "vitest";
import {
    shouldAddBrushPoint,
    INPAINT_BRUSH_SPACING_FACTOR,
} from "@/hooks/useInpaintMask";

describe("shouldAddBrushPoint", () => {
    it("always accepts the first point", () => {
        expect(shouldAddBrushPoint(undefined, { x: 10, y: 10 }, 40)).toBe(true);
    });

    it("skips points closer than brush spacing", () => {
        const brushSize = 100;
        const minDist = brushSize * INPAINT_BRUSH_SPACING_FACTOR;
        const last = { x: 0, y: 0 };
        const tooClose = { x: minDist * 0.5, y: 0 };
        expect(shouldAddBrushPoint(last, tooClose, brushSize)).toBe(false);
    });

    it("accepts points beyond brush spacing", () => {
        const brushSize = 100;
        const minDist = brushSize * INPAINT_BRUSH_SPACING_FACTOR;
        const last = { x: 0, y: 0 };
        const farEnough = { x: minDist + 1, y: 0 };
        expect(shouldAddBrushPoint(last, farEnough, brushSize)).toBe(true);
    });
});
