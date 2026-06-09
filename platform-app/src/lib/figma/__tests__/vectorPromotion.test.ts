import { describe, expect, it } from "vitest";
import type { ImageLayer } from "@/types";
import { promoteFigmaVectorLayers } from "../vectorPromotion";

const subtractSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path fill="#ffffff" fill-rule="evenodd" d="M10 10 H90 V90 H10 Z M30 30 H70 V70 H30 Z"/>
</svg>`;

describe("promoteFigmaVectorLayers", () => {
    it("converts BOOLEAN_OPERATION ImageLayer to VectorLayer with inlineSvg", () => {
        const image: ImageLayer = {
            id: "layer-1",
            type: "image",
            name: "Subtract",
            x: 10,
            y: 20,
            width: 200,
            height: 100,
            rotation: 0,
            visible: true,
            locked: false,
            src: "",
            objectFit: "contain",
            metadata: { figmaNodeId: "1:2", figmaOriginalType: "BOOLEAN_OPERATION" },
        };

        const [layer] = promoteFigmaVectorLayers(
            [image],
            {
                "layer-1": {
                    subpaths: [],
                    inlineSvg: subtractSvg,
                    rawSvgPath: "M10 10 H90 V90 H10 Z M30 30 H70 V70 H30 Z",
                    fill: "#ffffff",
                    fillRule: "evenodd",
                },
            },
            { "layer-1": "https://cdn.example/subtract.svg" },
        );

        expect(layer.type).toBe("vector");
        if (layer.type !== "vector") return;
        expect(layer.inlineSvg).toContain("evenodd");
        expect(layer.src).toBe("https://cdn.example/subtract.svg");
        expect(layer.width).toBe(200);
    });

    it("keeps regular raster images as ImageLayer", () => {
        const image: ImageLayer = {
            id: "img-1",
            type: "image",
            name: "Photo",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            visible: true,
            locked: false,
            src: "",
            objectFit: "cover",
            metadata: { figmaOriginalType: "RECTANGLE" },
        };

        const [layer] = promoteFigmaVectorLayers([image], {}, { "img-1": "https://cdn.example/photo.png" });
        expect(layer.type).toBe("image");
        if (layer.type === "image") expect(layer.src).toBe("https://cdn.example/photo.png");
    });
});
