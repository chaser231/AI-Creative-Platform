import { describe, expect, it } from "vitest";

import { computeStudioOutpaintRasterPlan } from "./studioOutpaintSource";

describe("computeStudioOutpaintRasterPlan", () => {
    it("keeps an already matching cover image untouched", () => {
        const plan = computeStudioOutpaintRasterPlan(
            { width: 1200, height: 300 },
            { width: 1200, height: 300, objectFit: "cover" },
        );

        expect(plan.changed).toBe(false);
        expect(plan.canvasWidth).toBe(1200);
        expect(plan.canvasHeight).toBe(300);
        expect(plan.source).toEqual({ x: 0, y: 0, width: 1200, height: 300 });
        expect(plan.dest).toEqual({ x: 0, y: 0, width: 1200, height: 300 });
    });

    it("rasterizes the visible cover crop instead of sending hidden source pixels", () => {
        const plan = computeStudioOutpaintRasterPlan(
            { width: 1600, height: 900 },
            { width: 800, height: 300, objectFit: "cover", focusX: 0.75, focusY: 0.5 },
        );

        expect(plan.changed).toBe(true);
        expect(plan.canvasWidth).toBe(1600);
        expect(plan.canvasHeight).toBe(600);
        expect(plan.source).toEqual({ x: 0, y: 150, width: 1600, height: 600 });
        expect(plan.dest).toEqual({ x: 0, y: 0, width: 1600, height: 600 });
    });

    it("preserves fill's visible non-uniform layer aspect in a pre-rasterized source", () => {
        const plan = computeStudioOutpaintRasterPlan(
            { width: 1000, height: 1000 },
            { width: 500, height: 250, objectFit: "fill" },
        );

        expect(plan.changed).toBe(true);
        expect(plan.canvasWidth).toBe(1000);
        expect(plan.canvasHeight).toBe(500);
        expect(plan.source).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
        expect(plan.dest).toEqual({ x: 0, y: 0, width: 1000, height: 500 });
    });

    it("keeps contain letterbox bands in the bitmap sent to outpaint", () => {
        const plan = computeStudioOutpaintRasterPlan(
            { width: 1000, height: 500 },
            { width: 500, height: 500, objectFit: "contain" },
        );

        expect(plan.changed).toBe(true);
        expect(plan.canvasWidth).toBe(1000);
        expect(plan.canvasHeight).toBe(1000);
        expect(plan.source).toEqual({ x: 0, y: 0, width: 1000, height: 500 });
        expect(plan.dest).toEqual({ x: 0, y: 250, width: 1000, height: 500 });
    });
});
