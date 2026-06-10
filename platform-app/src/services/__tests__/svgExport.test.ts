import { describe, expect, it } from "vitest";
import { layersToSvg, layersToSvgFragment, layersToSvgSliceRegion } from "../svgExport";
import type { Layer, RectangleLayer, VectorLayer } from "@/types";

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

describe("svgExport", () => {
    it("wraps the document with width/height and viewBox", () => {
        const svg = layersToSvg({ layers: [], width: 200, height: 120 });
        expect(svg).toContain('width="200"');
        expect(svg).toContain('height="120"');
        expect(svg).toContain('viewBox="0 0 200 120"');
    });

    it("emits a path for a vector layer", () => {
        const vector: VectorLayer = baseLayer({
            id: "v1",
            type: "vector",
            width: 100,
            height: 100,
            fill: "#ff0000",
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
        const svg = layersToSvg({ layers: [vector], width: 100, height: 100, background: false });
        expect(svg).toContain("<path");
        expect(svg).toContain("M 0 0 L 100 0 L 50 100 L 0 0 Z");
        expect(svg).toContain('fill="#ff0000"');
    });

    it("registers a linear gradient in defs", () => {
        const rect: RectangleLayer = baseLayer({
            id: "r1",
            type: "rectangle",
            width: 100,
            height: 100,
            stroke: "",
            strokeWidth: 0,
            cornerRadius: 0,
            fill: {
                kind: "gradient",
                gradientType: "linear",
                stops: [
                    { id: "a", offset: 0, color: "#000000", opacity: 1 },
                    { id: "b", offset: 1, color: "#ffffff", opacity: 1 },
                ],
                angle: 0,
                start: { x: 0, y: 0 },
                end: { x: 1, y: 0 },
            },
        }) as RectangleLayer;
        const svg = layersToSvg({ layers: [rect], width: 100, height: 100, background: false });
        expect(svg).toContain("<defs>");
        expect(svg).toContain("<linearGradient");
        expect(svg).toMatch(/fill="url\(#grad\d+\)"/);
    });

    it("skips invisible layers", () => {
        const rect = baseLayer({ id: "r2", type: "rectangle", fill: "#000", stroke: "", strokeWidth: 0, cornerRadius: 0, visible: false }) as RectangleLayer;
        const svg = layersToSvg({ layers: [rect], width: 100, height: 100, background: false });
        expect(svg).not.toContain("<rect");
    });

    it("renders outlined text as a path instead of <text>", () => {
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
        const svg = layersToSvg({ layers: [text], width: 100, height: 100, background: false, outlinedText: outlined });
        expect(svg).toContain('<path d="M 0 0 L 10 0 L 10 10 Z" fill="#112233"');
        expect(svg).not.toContain("<text");
    });

    it("emits numeric font-weight for named weights in the <text> fallback", () => {
        const text = baseLayer({
            id: "tw",
            type: "text",
            width: 200,
            height: 60,
            text: "МАРКЕТА",
            fill: "#000000",
            fillEnabled: true,
            fontSize: 40,
            fontFamily: "YS Compressed",
            fontWeight: "Heavy",
            align: "left",
            lineHeight: 1.2,
            letterSpacing: 0,
        }) as Layer;
        const svg = layersToSvg({ layers: [text], width: 200, height: 100, background: false });
        expect(svg).toContain("<text");
        expect(svg).toContain('font-weight="800"');
        expect(svg).not.toContain('font-weight="Heavy"');
    });

    it("embeds raster images as data-URIs when provided", () => {
        const image = baseLayer({
            id: "i1",
            type: "image",
            width: 50,
            height: 50,
            src: "https://example.com/pic.png",
        }) as Layer;
        const images = new Map([["i1", "data:image/png;base64,AAAA"]]);
        const svg = layersToSvg({ layers: [image], width: 100, height: 100, background: false, embeddedImages: images });
        expect(svg).toContain("data:image/png;base64,AAAA");
        expect(svg).not.toContain("https://example.com/pic.png");
    });

    it("flattens inlineSvg vectors into a transformed group (Figma-friendly)", () => {
        const vector: VectorLayer = baseLayer({
            id: "v2",
            type: "vector",
            width: 200,
            height: 200,
            fill: "#fff",
            fillEnabled: true,
            inlineSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 80 60"><path d="M10 20 H90 V80 H10 Z" fill="#fff"/></svg>',
        }) as VectorLayer;
        const svg = layersToSvg({ layers: [vector], width: 200, height: 200, background: false });
        expect(svg).toContain("<g transform=");
        expect(svg).not.toContain("<svg x=");
    });

    it("sizes a fragment to the combined layer bounds", () => {
        const rect = baseLayer({ id: "r3", type: "rectangle", x: 20, y: 30, width: 40, height: 50, fill: "#000", stroke: "", strokeWidth: 0, cornerRadius: 0 }) as RectangleLayer;
        const svg = layersToSvgFragment([rect]);
        expect(svg).toContain('width="40"');
        expect(svg).toContain('height="50"');
        // The single layer shifts to origin.
        expect(svg).toContain("translate(0 0)");
    });

    describe("layersToSvgSliceRegion", () => {
        const triangle = (): VectorLayer => baseLayer({
            id: "v-slice",
            type: "vector",
            x: 250,
            y: 0,
            width: 100,
            height: 100,
            fill: "#ff0000",
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

        it("sizes the document to the slice rect, not the artboard", () => {
            const svg = layersToSvgSliceRegion({
                layers: [triangle()],
                width: 900,
                height: 300,
                background: false,
                rect: { x: 300, y: 0, width: 300, height: 300 },
            });
            expect(svg).toContain('width="300"');
            expect(svg).toContain('height="300"');
            expect(svg).toContain('viewBox="0 0 300 300"');
        });

        it("installs a root rect clipPath and shifts via a wrapper group", () => {
            const svg = layersToSvgSliceRegion({
                layers: [triangle()],
                width: 900,
                height: 300,
                background: false,
                rect: { x: 300, y: 0, width: 300, height: 300 },
            });
            expect(svg).toMatch(/<clipPath id="sliceClip\d+"><rect x="0" y="0" width="300" height="300" \/><\/clipPath>/);
            expect(svg).toMatch(/<g clip-path="url\(#sliceClip\d+\)"><g transform="translate\(-300 0\)">/);
        });

        it("keeps vector geometry intact for layers crossing the slice boundary", () => {
            // The triangle (x 250..350) straddles the boundary at x=300, yet its
            // path data must stay identical to the unclipped export.
            const svg = layersToSvgSliceRegion({
                layers: [triangle()],
                width: 900,
                height: 300,
                background: false,
                rect: { x: 300, y: 0, width: 300, height: 300 },
            });
            expect(svg).toContain("M 0 0 L 100 0 L 50 100 L 0 0 Z");
            // The layer keeps its own absolute transform inside the shifted group.
            expect(svg).toContain("translate(250 0)");
        });

        it("includes the artboard background sized to the artboard", () => {
            const svg = layersToSvgSliceRegion({
                layers: [],
                width: 900,
                height: 300,
                artboardFill: "#ABCDEF",
                rect: { x: 300, y: 0, width: 300, height: 300 },
            });
            expect(svg).toContain('<rect x="0" y="0" width="900" height="300" fill="#ABCDEF"');
        });

        it("does not render slice layers themselves", () => {
            const slice = baseLayer({ id: "s1", type: "slice", x: 0, y: 0, width: 300, height: 300 }) as Layer;
            const svg = layersToSvgSliceRegion({
                layers: [slice],
                width: 900,
                height: 300,
                background: false,
                rect: { x: 0, y: 0, width: 300, height: 300 },
            });
            // The shift wrapper stays empty — the slice produced no content.
            expect(svg).toMatch(/<g transform="translate\(0 0\)"><\/g>/);
        });
    });
});
