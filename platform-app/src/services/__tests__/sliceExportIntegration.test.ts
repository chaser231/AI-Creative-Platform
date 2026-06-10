/**
 * End-to-end slice export check (mirrors the manual Figma comparison):
 * a 900×300 layout is procedurally sliced 3×1, every slice exports to SVG,
 * and vector geometry must survive intact — no path mutation, no layer
 * displacement, cropping handled purely by the root clipPath.
 */

import { describe, expect, it } from "vitest";
import { computeSliceGrid } from "@/utils/sliceGrid";
import { layersToSvgSliceRegion } from "../svgExport";
import { layersToEpsSliceRegion } from "../epsExport";
import type { Layer, RectangleLayer, VectorLayer } from "@/types";

const ARTBOARD = { width: 900, height: 300 };

function makeLayers(): Layer[] {
    const base = { rotation: 0, visible: true, locked: false };
    const rect: RectangleLayer = {
        id: "bg-band",
        type: "rectangle",
        name: "Band",
        x: 50, y: 100, width: 800, height: 100,
        fill: "#112233", stroke: "", strokeWidth: 0, cornerRadius: 8,
        ...base,
    };
    // A star-ish vector deliberately straddling the first slice boundary (x=300)
    const vector: VectorLayer = {
        id: "cross-vector",
        type: "vector",
        name: "Cross",
        x: 250, y: 50, width: 100, height: 100,
        fill: "#ff4400", fillEnabled: true,
        subpaths: [
            {
                closed: true,
                points: [
                    { x: 0, y: 0, type: "corner" },
                    { x: 1, y: 0.25, type: "corner" },
                    { x: 0.5, y: 1, type: "corner" },
                ],
            },
        ],
        ...base,
    };
    return [rect, vector];
}

describe("slice export integration (3×1 grid)", () => {
    const rects = computeSliceGrid({
        bounds: { x: 0, y: 0, width: ARTBOARD.width, height: ARTBOARD.height },
        cols: 3,
        rows: 1,
    });

    it("produces three flush 300×300 slices", () => {
        expect(rects).toHaveLength(3);
        expect(rects.map((r) => r.x)).toEqual([0, 300, 600]);
        expect(rects.every((r) => r.width === 300 && r.height === 300)).toBe(true);
    });

    it("exports each slice to SVG with intact vector geometry", () => {
        const layers = makeLayers();
        const expectedPath = "M 0 0 L 100 25 L 50 100 L 0 0 Z";

        const svgs = rects.map((r) => layersToSvgSliceRegion({
            layers,
            width: ARTBOARD.width,
            height: ARTBOARD.height,
            artboardFill: "#FFFFFF",
            rect: r,
        }));

        for (const [i, svg] of svgs.entries()) {
            // Every slice is a standalone 300×300 document with a root clip.
            expect(svg).toContain('viewBox="0 0 300 300"');
            expect(svg).toMatch(/<g clip-path="url\(#sliceClip\d+\)"><g transform="translate\(-?\d+ 0\)">/);
            // The vector path is byte-identical in every slice — geometry untouched.
            expect(svg).toContain(expectedPath);
            // Layers keep their absolute positions (no displacement between slices).
            expect(svg).toContain('transform="translate(250 50)"');
            expect(svg).toContain('transform="translate(50 100)"');
            // Cropping is expressed only through the wrapper shift.
            expect(svg).toContain(`translate(${-rects[i].x} 0)`);
        }
    });

    it("exports each slice to EPS with intact vector geometry", () => {
        const layers = makeLayers();

        for (const r of rects) {
            const eps = layersToEpsSliceRegion({
                layers,
                width: ARTBOARD.width,
                height: ARTBOARD.height,
                artboardFill: "#FFFFFF",
                rect: r,
            });
            expect(eps).toContain("%%BoundingBox: 0 0 300 300");
            expect(eps).toContain(`newpath 0 0 moveto 300 0 lineto 300 300 lineto 0 300 lineto closepath clip`);
            expect(eps).toContain(`${-r.x} 0 translate`.replace("-0", "0"));
            // Vector keeps its local geometry in every slice.
            expect(eps).toContain("250 50 translate");
            expect(eps).toContain("100 25 lineto");
            expect(eps).toContain("50 100 lineto");
        }
    });
});
