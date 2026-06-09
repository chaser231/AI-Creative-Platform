import { describe, expect, it } from "vitest";
import { applyAllAutoLayouts } from "@/utils/layoutEngine";
import {
    AdaptationPresets,
    runAdaptationPipeline,
} from "@/services/adaptationPipeline";
import { projectTree } from "@/services/adaptationProjection";
import { generateCustomResize } from "@/services/customResizeService";
import type { FrameLayer, Layer, RectangleLayer, ResizeFormat, TextLayer } from "@/types";

function rect(overrides: Partial<RectangleLayer> = {}): RectangleLayer {
    return {
        id: "rect",
        type: "rectangle",
        name: "Rect",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        visible: true,
        locked: false,
        fill: "#FFFFFF",
        stroke: "",
        strokeWidth: 0,
        cornerRadius: 0,
        ...overrides,
    };
}

function text(overrides: Partial<TextLayer> = {}): TextLayer {
    return {
        id: "text",
        type: "text",
        name: "Headline",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        rotation: 0,
        visible: true,
        locked: false,
        text: "Hello",
        fontSize: 20,
        fontFamily: "Inter",
        fontWeight: "700",
        fill: "#111111",
        align: "left",
        letterSpacing: 0,
        lineHeight: 1.2,
        textAdjust: "fixed",
        ...overrides,
    };
}

function frame(overrides: Partial<FrameLayer> = {}): FrameLayer {
    return {
        id: "frame",
        type: "frame",
        name: "Frame",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        visible: true,
        locked: false,
        fill: "#FFFFFF",
        stroke: "",
        strokeWidth: 0,
        cornerRadius: 0,
        clipContent: false,
        childIds: [],
        ...overrides,
    };
}

function resize(overrides: Partial<ResizeFormat> = {}): ResizeFormat {
    return {
        id: "master",
        name: "Master",
        width: 100,
        height: 100,
        label: "100 × 100",
        instancesEnabled: false,
        ...overrides,
    };
}

function legacyManualAdapt(
    layers: Layer[],
    oldSize: { width: number; height: number },
    newSize: { width: number; height: number },
): Layer[] {
    return applyAllAutoLayouts(projectTree(layers, oldSize, newSize, { scaleFonts: false }));
}

describe("runAdaptationPipeline", () => {
    const sourceSize = { width: 100, height: 100 };
    const targetSize = { width: 200, height: 300 };

    it("manualResize preset matches legacy adaptLayersToArtboard behavior", () => {
        const fixtures: Layer[][] = [
            [rect({ id: "r1", x: 10, y: 20, width: 30, height: 40, constraints: { horizontal: "left", vertical: "top" } })],
            [
                frame({ id: "f1", width: 80, height: 80, childIds: ["c1"], constraints: { horizontal: "scale", vertical: "scale" } }),
                rect({ id: "c1", x: 10, y: 10, width: 20, height: 20 }),
            ],
            [
                frame({
                    id: "al",
                    width: 100,
                    height: 30,
                    childIds: ["a", "b"],
                    layoutMode: "horizontal",
                    paddingLeft: 10,
                    spacing: 4,
                }),
                rect({ id: "a", x: 0, y: 0, width: 10, height: 10 }),
                rect({ id: "b", x: 0, y: 0, width: 10, height: 10 }),
            ],
            [text({ id: "t1", fontSize: 24, x: 5, y: 5, width: 90, height: 40 })],
        ];

        for (const layers of fixtures) {
            const legacy = legacyManualAdapt(layers, sourceSize, targetSize);
            const pipeline = runAdaptationPipeline(
                layers,
                sourceSize,
                targetSize,
                AdaptationPresets.manualResize,
            ).layers;
            expect(pipeline).toEqual(legacy);
        }
    });

    it("manualResize preset does not scale fonts or emit diagnostics", () => {
        const layers = [text({ id: "headline", fontSize: 24 })];
        const { layers: adapted, diagnostics } = runAdaptationPipeline(
            layers,
            sourceSize,
            targetSize,
            AdaptationPresets.manualResize,
        );

        expect(adapted[0]?.type === "text" ? adapted[0].fontSize : undefined).toBe(24);
        expect(diagnostics).toEqual([]);
    });

    it("full preset matches generateCustomResize layer output for the same source", () => {
        const layers = [
            rect({
                id: "stretch",
                name: "Stretch",
                x: 10,
                y: 20,
                width: 30,
                height: 40,
                constraints: { horizontal: "stretch", vertical: "stretch" },
            }),
            text({ id: "headline", name: "Headline", fontSize: 20, x: 5, y: 50, width: 90, height: 40 }),
        ];

        const custom = generateCustomResize(
            {
                layers,
                activeResizeId: "master",
                canvasWidth: 100,
                canvasHeight: 100,
                resizes: [resize({ id: "master", width: 100, height: 100, isMaster: true })],
            },
            { id: "target", name: "Target", width: 200, height: 300 },
        );

        const { layers: piped } = runAdaptationPipeline(
            layers,
            sourceSize,
            targetSize,
            AdaptationPresets.full,
        );

        expect(geometryByName(piped)).toEqual(geometryByName(custom.resize.layerSnapshot));
    });
});

function geometryByName(layers: Layer[] | undefined): Record<string, { x: number; y: number; width: number; height: number; fontSize?: number }> {
    const out: Record<string, { x: number; y: number; width: number; height: number; fontSize?: number }> = {};
    for (const layer of layers ?? []) {
        out[layer.name] = {
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
            ...(layer.type === "text" ? { fontSize: layer.fontSize } : {}),
        };
    }
    return out;
}
