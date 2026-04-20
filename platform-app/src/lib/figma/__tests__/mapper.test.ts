import { describe, it, expect } from "vitest";
import type { FrameLayer, ImageLayer, RectangleLayer, TextLayer } from "@/types";
import { mapFigmaDocument, rgbaToHex } from "../mapper";
import {
    autoLayoutFixture,
    componentInstanceFixture,
    imageFillFixture,
    instanceBeforeMasterFixture,
    simpleBannerFixture,
    vectorFallbackFixture,
} from "./fixtures";

describe("rgbaToHex", () => {
    it("emits lowercase 6-digit hex for opaque colors", () => {
        expect(rgbaToHex({ r: 1, g: 0, b: 0, a: 1 })).toBe("#ff0000");
        expect(rgbaToHex({ r: 0, g: 0.5, b: 1, a: 1 })).toBe("#0080ff");
    });
    it("emits 8-digit hex with alpha when not fully opaque", () => {
        expect(rgbaToHex({ r: 1, g: 1, b: 1, a: 0.5 })).toBe("#ffffff80");
    });
    it("folds extraOpacity into the alpha channel", () => {
        expect(rgbaToHex({ r: 0, g: 0, b: 0, a: 1 }, 0.5)).toBe("#00000080");
    });
});

describe("mapFigmaDocument — simple banner", () => {
    it("produces one page with one frame of the expected size", () => {
        const res = mapFigmaDocument(simpleBannerFixture.document, simpleBannerFixture.components);
        expect(res.pages).toHaveLength(1);
        const page = res.pages[0];
        expect(page.frames).toHaveLength(1);
        expect(page.frames[0].width).toBe(1080);
        expect(page.frames[0].height).toBe(1080);
    });

    it("emits a root FrameLayer with the solid background", () => {
        const res = mapFigmaDocument(simpleBannerFixture.document, simpleBannerFixture.components);
        const layers = res.pages[0].frames[0].layers;
        const root = layers[0] as FrameLayer;
        expect(root.type).toBe("frame");
        expect(root.fill).toBe("#3366ff"); // r=0.2,g=0.4,b=1
        expect(root.fillEnabled).toBe(true);
        expect(root.x).toBe(0);
        expect(root.y).toBe(0);
        expect(root.childIds).toHaveLength(2);
    });

    it("maps TEXT nodes with style, letter-spacing and line-height", () => {
        const res = mapFigmaDocument(simpleBannerFixture.document, simpleBannerFixture.components);
        const layers = res.pages[0].frames[0].layers;
        const text = layers.find((l) => l.type === "text") as TextLayer;
        expect(text).toBeTruthy();
        expect(text.text).toBe("Big Headline");
        expect(text.fontSize).toBe(96);
        expect(text.fontFamily).toBe("Inter");
        expect(text.fontWeight).toBe("700");
        expect(text.align).toBe("center");
        expect(text.fill).toBe("#ffffff");
        expect(text.textTransform).toBe("uppercase");
        // 115.2 / 96 = 1.2
        expect(text.lineHeight).toBeCloseTo(1.2, 3);
    });

    it("maps RECTANGLE nodes with cornerRadius and constraints", () => {
        const res = mapFigmaDocument(simpleBannerFixture.document, simpleBannerFixture.components);
        const layers = res.pages[0].frames[0].layers;
        const rect = layers.find((l) => l.type === "rectangle") as RectangleLayer;
        expect(rect).toBeTruthy();
        expect(rect.cornerRadius).toBe(30);
        expect(rect.fill).toBe("#ffcc00");
        expect(rect.constraints).toEqual({ horizontal: "center", vertical: "bottom" });
    });

    it("preserves figmaNodeId in layer metadata", () => {
        const res = mapFigmaDocument(simpleBannerFixture.document, simpleBannerFixture.components);
        const layers = res.pages[0].frames[0].layers;
        const text = layers.find((l) => l.type === "text") as TextLayer;
        expect(text.metadata?.figmaNodeId).toBe("2:1");
    });
});

describe("mapFigmaDocument — auto-layout", () => {
    it("maps Figma HORIZONTAL + SPACE_BETWEEN to our axis semantics", () => {
        const res = mapFigmaDocument(autoLayoutFixture.document, autoLayoutFixture.components);
        const root = res.pages[0].frames[0].layers[0] as FrameLayer;
        expect(root.layoutMode).toBe("horizontal");
        expect(root.primaryAxisAlignItems).toBe("space-between");
        expect(root.counterAxisAlignItems).toBe("center");
        expect(root.paddingLeft).toBe(16);
        expect(root.paddingRight).toBe(16);
        expect(root.paddingTop).toBe(8);
        expect(root.spacing).toBe(12);
        expect(root.primaryAxisSizingMode).toBe("fixed");
        expect(root.counterAxisSizingMode).toBe("auto");
    });
});

describe("mapFigmaDocument — image fills", () => {
    it("converts a rectangle with an IMAGE fill into an ImageLayer", () => {
        const res = mapFigmaDocument(imageFillFixture.document, imageFillFixture.components);
        const frame = res.pages[0].frames[0];
        const image = frame.layers.find((l) => l.type === "image") as ImageLayer;
        expect(image).toBeTruthy();
        expect(image.objectFit).toBe("cover");
        expect(image.src).toBe(""); // worker will populate later
        expect(image.metadata?.figmaImageRef).toBe("img-ref-abc123");
        // And we recorded the imageRef for later hydration
        expect(frame.imageRefs).toEqual([
            { imageRef: "img-ref-abc123", targetLayerId: image.id },
        ]);
    });
});

describe("mapFigmaDocument — components & instances", () => {
    it("links an INSTANCE layer back to its COMPONENT master via masterId", () => {
        const res = mapFigmaDocument(
            componentInstanceFixture.document,
            componentInstanceFixture.components,
        );
        const frames = res.pages[0].frames;
        expect(frames).toHaveLength(2);
        const master = frames[0].layers[0];
        const instance = frames[1].layers[0];
        expect(master.metadata?.figmaOriginalType).toBe("COMPONENT");
        expect(instance.metadata?.figmaOriginalType).toBe("INSTANCE");
        expect(instance.masterId).toBe(master.id);
        expect(res.report.stats.instancesCreated).toBe(1);
    });

    it("resolves INSTANCE → COMPONENT even when the instance is visited first (C2 regression)", () => {
        // Page with the instance is listed BEFORE the page defining the
        // component. Without the two-pass scan in mapFigmaDocument, the
        // `masterId` link is silently dropped.
        const res = mapFigmaDocument(
            instanceBeforeMasterFixture.document,
            instanceBeforeMasterFixture.components,
        );
        expect(res.pages).toHaveLength(2);
        const instance = res.pages[0].frames[0];
        const master = res.pages[1].frames[0];
        expect(instance.layers[0].metadata?.figmaOriginalType).toBe("INSTANCE");
        expect(master.layers[0].metadata?.figmaOriginalType).toBe("COMPONENT");
        expect(instance.layers[0].masterId).toBe(master.layers[0].id);
        expect(res.report.stats.instancesCreated).toBe(1);
    });
});

describe("mapFigmaDocument — vector fallback", () => {
    it("rasterises VECTOR nodes to an ImageLayer and queues them for render", () => {
        const res = mapFigmaDocument(vectorFallbackFixture.document, vectorFallbackFixture.components, {
            preserveVectorsAsImages: true,
        });
        const frame = res.pages[0].frames[0];
        const image = frame.layers.find((l) => l.type === "image") as ImageLayer;
        expect(image).toBeTruthy();
        expect(image.metadata?.figmaOriginalType).toBe("VECTOR");
        expect(frame.nodesToRender).toEqual([
            { nodeId: "2:1", targetLayerId: image.id, format: "svg" },
        ]);
        expect(res.report.warnings.some((w) => w.reason === "vector_rasterized")).toBe(true);
    });

    it("skips vector nodes when preserveVectorsAsImages=false", () => {
        const res = mapFigmaDocument(
            vectorFallbackFixture.document,
            vectorFallbackFixture.components,
            { preserveVectorsAsImages: false },
        );
        const frame = res.pages[0].frames[0];
        expect(frame.layers.find((l) => l.type === "image")).toBeUndefined();
        expect(res.report.skippedNodes.some((s) => s.nodeType === "VECTOR")).toBe(true);
    });
});

describe("mapFigmaDocument — report stats", () => {
    it("counts pages, nodes, and created layers", () => {
        const res = mapFigmaDocument(simpleBannerFixture.document, simpleBannerFixture.components);
        expect(res.report.stats.pagesSeen).toBe(1);
        // 2 children inside the root frame
        expect(res.report.stats.nodesSeen).toBe(2);
        // root + 2 children = 3 layers
        expect(res.report.stats.layersCreated).toBe(3);
    });
});
