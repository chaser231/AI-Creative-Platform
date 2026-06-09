import { describe, expect, it } from "vitest";
import { layersToSvg, layersToSvgFragment } from "../svgExport";
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

    it("sizes a fragment to the combined layer bounds", () => {
        const rect = baseLayer({ id: "r3", type: "rectangle", x: 20, y: 30, width: 40, height: 50, fill: "#000", stroke: "", strokeWidth: 0, cornerRadius: 0 }) as RectangleLayer;
        const svg = layersToSvgFragment([rect]);
        expect(svg).toContain('width="40"');
        expect(svg).toContain('height="50"');
        // The single layer shifts to origin.
        expect(svg).toContain("translate(0 0)");
    });
});
