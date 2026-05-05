import { describe, expect, it } from "vitest";
import {
    makeGradientPaint,
    normalizePaint,
    paintToCssBackground,
    paintToKonvaProps,
    rotateGradientPaint,
    setGradientEndpoints,
} from "../paint";

describe("paint helpers", () => {
    it("normalizes legacy hex strings as solid paint", () => {
        expect(normalizePaint("#FF5C4D")).toEqual({
            kind: "solid",
            color: "#FF5C4D",
            opacity: 1,
        });
    });

    it("keeps gradient stops sorted and clamps alpha", () => {
        const paint = normalizePaint({
            kind: "gradient",
            gradientType: "linear",
            angle: 0,
            stops: [
                { id: "b", offset: 1.4, color: "#000000", opacity: 2 },
                { id: "a", offset: -0.2, color: "#FFFFFF", opacity: -1 },
            ],
        });

        expect(paint.kind).toBe("gradient");
        if (paint.kind !== "gradient") return;
        expect(paint.stops.map((stop) => stop.offset)).toEqual([0, 1]);
        expect(paint.stops.map((stop) => stop.opacity)).toEqual([0, 1]);
    });

    it("produces native Konva linear gradient props", () => {
        const paint = makeGradientPaint("linear");
        const props = paintToKonvaProps(paint, 200, 100);

        expect(props.fillPriority).toBe("linear-gradient");
        expect(props.fillLinearGradientColorStops).toEqual([
            0,
            "#FF5C4D",
            1,
            "#8341EF",
        ]);
    });

    it("updates linear endpoints and angle from canvas handles", () => {
        const paint = setGradientEndpoints(makeGradientPaint("linear"), { x: 0.2, y: 0.3 }, { x: 0.8, y: 0.3 });

        expect(paint.start).toEqual({ x: 0.2, y: 0.3 });
        expect(paint.end).toEqual({ x: 0.8, y: 0.3 });
        expect(paint.angle).toBe(0);
    });

    it("rotates linear gradient endpoints with the angle", () => {
        const paint = rotateGradientPaint(makeGradientPaint("linear"), 90);

        expect(paint.angle).toBe(90);
        expect(paint.start?.x).toBeCloseTo(0.5);
        expect(paint.start?.y).toBeCloseTo(0);
        expect(paint.end?.x).toBeCloseTo(0.5);
        expect(paint.end?.y).toBeCloseTo(1);
    });

    it("renders angular gradients as conic CSS previews", () => {
        const paint = makeGradientPaint("angular");
        expect(paintToCssBackground(paint)).toContain("conic-gradient");
    });
});
