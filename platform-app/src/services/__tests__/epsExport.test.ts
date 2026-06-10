import { describe, expect, it } from "vitest";
import { layersToEps, layersToEpsSliceRegion } from "../epsExport";
import type { Layer, VectorLayer } from "@/types";

function baseLayer(over: Partial<Layer>): Layer {
    return {
        id: "l1",
        name: "Layer",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        visible: true,
        locked: false,
        ...over,
    } as Layer;
}

describe("epsExport", () => {
    it("emits a valid EPS header and bounding box", () => {
        const eps = layersToEps({ layers: [], width: 200, height: 120, artboardFillEnabled: false });
        expect(eps.startsWith("%!PS-Adobe-3.0 EPSF-3.0")).toBe(true);
        expect(eps).toContain("%%BoundingBox: 0 0 200 120");
        expect(eps).toContain("showpage");
        expect(eps).toContain("%%EOF");
    });

    it("flips the coordinate system for top-left authoring", () => {
        const eps = layersToEps({ layers: [], width: 100, height: 80, artboardFillEnabled: false });
        expect(eps).toContain("0 80 translate");
        expect(eps).toContain("1 -1 scale");
    });

    it("emits curveto for bezier vector geometry", () => {
        const vector: VectorLayer = baseLayer({
            id: "v1",
            type: "vector",
            width: 100,
            height: 100,
            fill: "#000000",
            fillEnabled: true,
            subpaths: [
                {
                    closed: false,
                    points: [
                        { x: 0, y: 0, outX: 0.25, outY: 0, type: "bezier" },
                        { x: 1, y: 1, inX: 0.75, inY: 1, type: "bezier" },
                    ],
                },
            ],
        }) as VectorLayer;
        const eps = layersToEps({ layers: [vector], width: 100, height: 100, artboardFillEnabled: false });
        expect(eps).toContain("curveto");
        expect(eps).toContain("25 0 75 100 100 100 curveto");
    });

    it("renders gradients via PostScript axial shading", () => {
        const rect = baseLayer({
            id: "r1",
            type: "rectangle",
            width: 100,
            height: 100,
            cornerRadius: 0,
            fillEnabled: true,
            strokeEnabled: false,
            fill: {
                kind: "gradient",
                gradientType: "linear",
                angle: 0,
                stops: [
                    { id: "s0", offset: 0, color: "#ff0000", opacity: 1 },
                    { id: "s1", offset: 1, color: "#0000ff", opacity: 1 },
                ],
            },
        }) as Layer;
        const eps = layersToEps({ layers: [rect], width: 100, height: 100, artboardFillEnabled: false });
        expect(eps).not.toContain("shfill");
        expect(eps).toContain("clip");
        expect(eps).toContain("closepath fill");
    });

    it("flattens semi-transparent fills over the backdrop (no alpha in EPS)", () => {
        const rect = baseLayer({
            id: "r2",
            type: "rectangle",
            width: 100,
            height: 100,
            cornerRadius: 0,
            fillEnabled: true,
            strokeEnabled: false,
            fill: { kind: "solid", color: "#ff0000", opacity: 0.5 },
        }) as Layer;
        // Red at 50% over white -> (1, 0.5, 0.5).
        const eps = layersToEps({ layers: [rect], width: 100, height: 100, artboardFillEnabled: false });
        expect(eps).toContain("1 0.5 0.5 setrgbcolor");
    });

    it("emits outlined text as a vector path (no `show`)", () => {
        const text = baseLayer({
            id: "t1",
            type: "text",
            width: 100,
            height: 40,
            text: "Привет",
            fill: "#112233",
            fillEnabled: true,
            fontSize: 20,
            fontFamily: "YS Display",
            fontWeight: "400",
            align: "left",
            lineHeight: 1.2,
            letterSpacing: 0,
        }) as Layer;
        const outlined = new Map([["t1", { d: "M 0 0 L 10 0 L 10 10 Z", fill: "#112233" }]]);
        const eps = layersToEps({ layers: [text], width: 100, height: 100, artboardFillEnabled: false, outlinedText: outlined });
        expect(eps).not.toContain(" show");
        expect(eps).toContain("lineto");
        expect(eps).toContain("0.067 0.133 0.2 setrgbcolor");
    });

    it("uses eofill for evenodd vectors", () => {
        const vector: VectorLayer = baseLayer({
            id: "v2",
            type: "vector",
            width: 10,
            height: 10,
            fill: "#000000",
            fillEnabled: true,
            fillRule: "evenodd",
            subpaths: [
                {
                    closed: true,
                    points: [
                        { x: 0, y: 0, type: "corner" },
                        { x: 1, y: 0, type: "corner" },
                        { x: 1, y: 1, type: "corner" },
                    ],
                },
            ],
        }) as VectorLayer;
        const eps = layersToEps({ layers: [vector], width: 10, height: 10, artboardFillEnabled: false });
        expect(eps).toContain("eofill");
    });

    describe("layersToEpsSliceRegion", () => {
        const triangle = (): VectorLayer => baseLayer({
            id: "v-slice",
            type: "vector",
            x: 250,
            y: 0,
            width: 100,
            height: 100,
            fill: "#000000",
            fillEnabled: true,
            subpaths: [
                {
                    closed: true,
                    points: [
                        { x: 0, y: 0, type: "corner" },
                        { x: 1, y: 0, type: "corner" },
                        { x: 0.5, y: 1, type: "corner" },
                    ],
                },
            ],
        }) as VectorLayer;

        it("sizes the BoundingBox to the slice rect", () => {
            const eps = layersToEpsSliceRegion({
                layers: [],
                width: 900,
                height: 300,
                artboardFillEnabled: false,
                rect: { x: 300, y: 0, width: 300, height: 300 },
            });
            expect(eps).toContain("%%BoundingBox: 0 0 300 300");
            expect(eps).toContain("0 300 translate");
            expect(eps).toContain("1 -1 scale");
        });

        it("installs a rect clip and translates the region origin to (0,0)", () => {
            const eps = layersToEpsSliceRegion({
                layers: [],
                width: 900,
                height: 300,
                artboardFillEnabled: false,
                rect: { x: 300, y: 50, width: 300, height: 250 },
            });
            expect(eps).toContain("newpath 0 0 moveto 300 0 lineto 300 250 lineto 0 250 lineto closepath clip");
            expect(eps).toContain("-300 -50 translate");
        });

        it("keeps vector geometry intact for layers crossing the slice boundary", () => {
            const eps = layersToEpsSliceRegion({
                layers: [triangle()],
                width: 900,
                height: 300,
                artboardFillEnabled: false,
                rect: { x: 300, y: 0, width: 300, height: 300 },
            });
            // Layer-local geometry is unchanged — cropping happens via clip.
            expect(eps).toContain("250 0 translate");
            expect(eps).toContain("0 0 moveto");
            expect(eps).toContain("100 0 lineto");
            expect(eps).toContain("50 100 lineto");
        });

        it("fills the artboard background sized to the artboard", () => {
            const eps = layersToEpsSliceRegion({
                layers: [],
                width: 900,
                height: 300,
                artboardFill: "#ff0000",
                rect: { x: 300, y: 0, width: 300, height: 300 },
            });
            expect(eps).toContain("newpath 0 0 moveto 900 0 lineto 900 300 lineto 0 300 lineto closepath");
            expect(eps).toContain("1 0 0 setrgbcolor");
        });
    });
});
