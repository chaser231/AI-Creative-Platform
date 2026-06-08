import { describe, it, expect } from "vitest";
import { applyConstraintBox } from "@/utils/constraintKernel";
import { applyConstraints } from "@/utils/resizeUtil";
import { computeConstrainedPosition } from "@/store/canvas/helpers";
import type { LayerConstraints } from "@/types";

const MASTER = { width: 100, height: 100 };
const TARGET = { width: 200, height: 150 };

function deltaFromMasterTarget(
    mw = MASTER.width,
    mh = MASTER.height,
    tw = TARGET.width,
    th = TARGET.height,
) {
    return {
        oldX: 0,
        oldY: 0,
        oldWidth: mw,
        oldHeight: mh,
        newX: 0,
        newY: 0,
        newWidth: tw,
        newHeight: th,
    };
}

describe("applyConstraintBox", () => {
    const child = { x: 10, y: 20, width: 30, height: 40 };

    it("pins left and top", () => {
        const result = applyConstraintBox(
            { ...child, constraints: { horizontal: "left", vertical: "top" } },
            deltaFromMasterTarget(),
        );
        expect(result).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    });

    it("pins right and bottom", () => {
        const result = applyConstraintBox(
            { ...child, constraints: { horizontal: "right", vertical: "bottom" } },
            deltaFromMasterTarget(),
        );
        // rightGap = 100 - (10+30) = 60, bottomGap = 100 - (20+40) = 40
        expect(result.x).toBe(200 - 60 - 30);
        expect(result.y).toBe(150 - 40 - 40);
        expect(result.width).toBe(30);
        expect(result.height).toBe(40);
    });

    it("uses proportional center (centerRatio)", () => {
        const result = applyConstraintBox(
            { ...child, constraints: { horizontal: "center", vertical: "center" } },
            deltaFromMasterTarget(),
        );
        // centerRatioX = (10 + 15) / 100 = 0.25 → x = 0.25*200 - 15 = 35
        expect(result.x).toBeCloseTo(35);
        // centerRatioY = (20 + 20) / 100 = 0.4 → y = 0.4*150 - 20 = 40
        expect(result.y).toBeCloseTo(40);
        expect(result.width).toBe(30);
        expect(result.height).toBe(40);
    });

    it("stretch preserves gaps", () => {
        const result = applyConstraintBox(
            { ...child, constraints: { horizontal: "stretch", vertical: "stretch" } },
            deltaFromMasterTarget(),
        );
        expect(result.x).toBe(10);
        expect(result.y).toBe(20);
        // newW = 200 - 10 - 60 = 130, newH = 150 - 20 - 40 = 90
        expect(result.width).toBe(130);
        expect(result.height).toBe(90);
    });

    it("scale scales position and size", () => {
        const result = applyConstraintBox(
            { ...child, constraints: { horizontal: "scale", vertical: "scale" } },
            deltaFromMasterTarget(),
        );
        expect(result.x).toBeCloseTo(20);   // 10 * (200/100)
        expect(result.y).toBeCloseTo(30);   // 20 * (150/100)
        expect(result.width).toBeCloseTo(60); // 30 * 2
        expect(result.height).toBeCloseTo(60); // 40 * 1.5
    });

    it("falls back to fixed translation on degenerate parent", () => {
        const result = applyConstraintBox(
            { ...child, constraints: { horizontal: "center", vertical: "center" } },
            {
                oldX: 100,
                oldY: 100,
                oldWidth: 0,
                oldHeight: 0,
                newX: 500,
                newY: 700,
                newWidth: 0,
                newHeight: 0,
            },
        );
        expect(result.x).toBe(500 + (10 - 100));
        expect(result.y).toBe(700 + (20 - 100));
        expect(result.width).toBe(30);
        expect(result.height).toBe(40);
    });

    it("enforces Math.max(1, size) on stretch shrink — not 10px floor", () => {
        const tiny = { x: 5, y: 5, width: 80, height: 80 };
        const result = applyConstraintBox(
            { ...tiny, constraints: { horizontal: "stretch", vertical: "stretch" } },
            deltaFromMasterTarget(100, 100, 10, 10),
        );
        expect(result.width).toBe(1);
        expect(result.height).toBe(1);
    });
});

describe("parity: applyConstraints vs computeConstrainedPosition", () => {
    const props = { x: 10, y: 20, width: 30, height: 40 };
    const delta = deltaFromMasterTarget();

    const combos: LayerConstraints[] = [
        { horizontal: "left", vertical: "top" },
        { horizontal: "right", vertical: "bottom" },
        { horizontal: "center", vertical: "center" },
        { horizontal: "stretch", vertical: "stretch" },
        { horizontal: "scale", vertical: "scale" },
        { horizontal: "left", vertical: "stretch" },
        { horizontal: "right", vertical: "scale" },
    ];

    for (const constraints of combos) {
        it(`matches for ${constraints.horizontal}/${constraints.vertical}`, () => {
            const fromResize = applyConstraints(
                { ...props, constraints },
                MASTER,
                TARGET,
            );
            const fromCanvas = computeConstrainedPosition(
                { ...props, constraints },
                delta,
            );
            expect(fromResize).toEqual(fromCanvas);
        });
    }
});
