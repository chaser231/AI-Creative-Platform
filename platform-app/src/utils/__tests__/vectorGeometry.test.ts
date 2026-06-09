import { describe, expect, it } from "vitest";
import {
    subpathsToPathData,
    hasRenderableGeometry,
    parseSvgPathToAbsSubpaths,
    computeAbsBounds,
    normalizeAbsSubpaths,
    pathDataToSubpaths,
    makeStarSubpaths,
} from "../vectorGeometry";
import type { VectorSubpath } from "@/types";

describe("vectorGeometry", () => {
    it("serializes a closed triangle to an SVG d string", () => {
        const subpaths: VectorSubpath[] = [
            {
                closed: true,
                points: [
                    { x: 0, y: 0, type: "corner" },
                    { x: 1, y: 0, type: "corner" },
                    { x: 0.5, y: 1, type: "corner" },
                ],
            },
        ];
        const d = subpathsToPathData(subpaths, 100, 100);
        expect(d).toBe("M 0 0 L 100 0 L 50 100 L 0 0 Z");
    });

    it("emits cubic segments for bezier anchors", () => {
        const subpaths: VectorSubpath[] = [
            {
                closed: false,
                points: [
                    { x: 0, y: 0, outX: 0.25, outY: 0, type: "bezier" },
                    { x: 1, y: 1, inX: 0.75, inY: 1, type: "bezier" },
                ],
            },
        ];
        const d = subpathsToPathData(subpaths, 100, 100);
        expect(d).toBe("M 0 0 C 25 0 75 100 100 100");
    });

    it("detects renderable geometry", () => {
        expect(hasRenderableGeometry(undefined)).toBe(false);
        expect(hasRenderableGeometry([{ closed: false, points: [{ x: 0, y: 0, type: "corner" }] }])).toBe(false);
        expect(makeStarSubpaths().length).toBe(1);
        expect(hasRenderableGeometry(makeStarSubpaths())).toBe(true);
    });

    it("parses an absolute path with line + curve commands", () => {
        const abs = parseSvgPathToAbsSubpaths("M 10 10 L 20 10 C 25 10 30 15 30 20 Z");
        expect(abs).toHaveLength(1);
        expect(abs[0].closed).toBe(true);
        expect(abs[0].points[0]).toMatchObject({ x: 10, y: 10 });
        // The L target gains an out handle from the following C command.
        expect(abs[0].points[1]).toMatchObject({ x: 20, y: 10, outX: 25, outY: 10 });
        expect(abs[0].points[2]).toMatchObject({ x: 30, y: 20, inX: 30, inY: 15 });
    });

    it("handles relative commands", () => {
        const abs = parseSvgPathToAbsSubpaths("m 5 5 l 10 0 l 0 10 z");
        expect(abs[0].points.map((p) => [p.x, p.y])).toEqual([
            [5, 5],
            [15, 5],
            [15, 15],
        ]);
    });

    it("computes bounds including control handles", () => {
        const abs = parseSvgPathToAbsSubpaths("M 0 0 C 10 -5 20 5 30 0");
        const bounds = computeAbsBounds(abs);
        expect(bounds).toEqual({ minX: 0, minY: -5, maxX: 30, maxY: 5 });
    });

    it("round-trips a d string through normalize + serialize", () => {
        const d = "M 0 0 L 40 0 L 40 20 L 0 20 Z";
        const { subpaths, width, height } = pathDataToSubpaths(d);
        expect(width).toBe(40);
        expect(height).toBe(20);
        // Anchors normalized into 0..1; scaling back reproduces the original box.
        // A closed subpath serializes the final segment back to the start anchor
        // explicitly before `Z`, which is geometrically equivalent.
        const back = subpathsToPathData(subpaths, width, height);
        expect(back).toBe("M 0 0 L 40 0 L 40 20 L 0 20 L 0 0 Z");
    });

    it("normalizes absolute subpaths into the unit box", () => {
        const abs = parseSvgPathToAbsSubpaths("M 100 100 L 200 100 L 200 300 Z");
        const { subpaths, width, height } = normalizeAbsSubpaths(abs);
        expect(width).toBe(100);
        expect(height).toBe(200);
        expect(subpaths[0].points[0]).toMatchObject({ x: 0, y: 0 });
        expect(subpaths[0].points[1]).toMatchObject({ x: 1, y: 0 });
        expect(subpaths[0].points[2]).toMatchObject({ x: 1, y: 1 });
    });
});
