import { describe, expect, it } from "vitest";
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

describe("generateCustomResize", () => {
    it("selects the nearest source format by aspect ratio", () => {
        const wide = text({ id: "wide-text", name: "Wide Headline" });
        const result = generateCustomResize(
            {
                layers: [text({ id: "square-text", name: "Square Headline" })],
                activeResizeId: "master",
                canvasWidth: 600,
                canvasHeight: 600,
                resizes: [
                    resize({ id: "master", width: 600, height: 600, isMaster: true }),
                    resize({ id: "wide", name: "Wide", width: 1200, height: 600, layerSnapshot: [wide] }),
                    resize({ id: "tall", name: "Tall", width: 600, height: 1200, layerSnapshot: [text({ id: "tall-text", name: "Tall Headline" })] }),
                ],
            },
            { id: "target", name: "Target", width: 1000, height: 500 },
        );

        expect(result.sourceResizeId).toBe("wide");
        expect(result.resize.layerSnapshot?.[0]?.name).toBe("Wide Headline");
    });

    it("projects root layer constraints to the target artboard", () => {
        const result = generateCustomResize(
            {
                layers: [
                    rect({
                        id: "right-bottom",
                        x: 70,
                        y: 70,
                        width: 20,
                        height: 20,
                        constraints: { horizontal: "right", vertical: "bottom" },
                    }),
                ],
                activeResizeId: "master",
                canvasWidth: 100,
                canvasHeight: 100,
                resizes: [resize({ id: "master", width: 100, height: 100, isMaster: true })],
            },
            { id: "target", name: "Target", width: 200, height: 300 },
        );

        expect(result.resize.layerSnapshot?.[0]).toMatchObject({
            x: 170,
            y: 270,
            width: 20,
            height: 20,
        });
    });

    it("projects left, right, center, stretch, and scale constraints", () => {
        const result = generateCustomResize(
            {
                layers: [
                    rect({
                        id: "left-top",
                        name: "Left top",
                        x: 10,
                        y: 20,
                        width: 30,
                        height: 40,
                        constraints: { horizontal: "left", vertical: "top" },
                    }),
                    rect({
                        id: "right-bottom",
                        name: "Right bottom",
                        x: 60,
                        y: 50,
                        width: 30,
                        height: 40,
                        constraints: { horizontal: "right", vertical: "bottom" },
                    }),
                    rect({
                        id: "center",
                        name: "Center",
                        x: 35,
                        y: 30,
                        width: 30,
                        height: 40,
                        constraints: { horizontal: "center", vertical: "center" },
                    }),
                    rect({
                        id: "stretch",
                        name: "Stretch",
                        x: 10,
                        y: 20,
                        width: 30,
                        height: 40,
                        constraints: { horizontal: "stretch", vertical: "stretch" },
                    }),
                    rect({
                        id: "scale",
                        name: "Scale",
                        x: 10,
                        y: 20,
                        width: 30,
                        height: 40,
                        constraints: { horizontal: "scale", vertical: "scale" },
                    }),
                ],
                activeResizeId: "master",
                canvasWidth: 100,
                canvasHeight: 100,
                resizes: [resize({ id: "master", width: 100, height: 100, isMaster: true })],
            },
            { id: "target", name: "Target", width: 200, height: 300 },
        );

        const byName = new Map(result.resize.layerSnapshot?.map((layer) => [layer.name, layer]));
        expect(byName.get("Left top")).toMatchObject({ x: 10, y: 20, width: 30, height: 40 });
        expect(byName.get("Right bottom")).toMatchObject({ x: 160, y: 250, width: 30, height: 40 });
        expect(byName.get("Center")).toMatchObject({ x: 85, y: 130, width: 30, height: 40 });
        expect(byName.get("Stretch")).toMatchObject({ x: 10, y: 20, width: 130, height: 240 });
        expect(byName.get("Scale")).toMatchObject({ x: 20, y: 60, width: 60, height: 120 });
    });

    it("preserves frame child relationships after cloning and projection", () => {
        const child = rect({ id: "child", name: "Child", x: 10, y: 10, width: 20, height: 20 });
        const parent = frame({
            id: "parent",
            name: "Parent",
            width: 80,
            height: 80,
            childIds: ["child"],
            constraints: { horizontal: "scale", vertical: "scale" },
        });

        const result = generateCustomResize(
            {
                layers: [parent, child],
                activeResizeId: "master",
                canvasWidth: 100,
                canvasHeight: 100,
                resizes: [resize({ id: "master", width: 100, height: 100, isMaster: true })],
            },
            { id: "target", name: "Target", width: 200, height: 200 },
        );

        const generatedFrame = result.resize.layerSnapshot?.find((layer): layer is FrameLayer => layer.type === "frame");
        const generatedChild = result.resize.layerSnapshot?.find((layer) => layer.name === "Child");
        expect(generatedFrame?.childIds).toEqual([generatedChild?.id]);
        expect(generatedFrame?.childIds[0]).not.toBe("child");
    });

    it("runs auto-layout after projection", () => {
        const first = rect({ id: "first", name: "First", x: 90, y: 90, width: 10, height: 10 });
        const second = rect({ id: "second", name: "Second", x: 90, y: 90, width: 10, height: 10 });
        const autoFrame = frame({
            id: "auto-frame",
            name: "Auto frame",
            width: 100,
            height: 30,
            childIds: ["first", "second"],
            layoutMode: "horizontal",
            paddingLeft: 10,
            paddingTop: 5,
            spacing: 4,
        });

        const result = generateCustomResize(
            {
                layers: [autoFrame, first, second],
                activeResizeId: "master",
                canvasWidth: 100,
                canvasHeight: 100,
                resizes: [resize({ id: "master", width: 100, height: 100, isMaster: true })],
            },
            { id: "target", name: "Target", width: 100, height: 100 },
        );

        const generatedFrame = result.resize.layerSnapshot?.find((layer): layer is FrameLayer => layer.type === "frame");
        const generatedChildren = generatedFrame?.childIds
            .map((id) => result.resize.layerSnapshot?.find((layer) => layer.id === id))
            .filter((layer): layer is Layer => !!layer);

        expect(generatedChildren?.[0]).toMatchObject({ x: 10, y: 5 });
        expect(generatedChildren?.[1]).toMatchObject({ x: 24, y: 5 });
    });

    it("scales and clamps text font size", () => {
        const result = generateCustomResize(
            {
                layers: [
                    text({
                        id: "headline",
                        fontSize: 30,
                        responsive: { minFontSize: 10, maxFontSize: 40 },
                    }),
                ],
                activeResizeId: "master",
                canvasWidth: 100,
                canvasHeight: 100,
                resizes: [resize({ id: "master", width: 100, height: 100, isMaster: true })],
            },
            { id: "target", name: "Target", width: 400, height: 400 },
        );

        expect((result.resize.layerSnapshot?.[0] as TextLayer).fontSize).toBe(40);
    });

    it("fills the artboard for background behavior", () => {
        const result = generateCustomResize(
            {
                layers: [
                    rect({
                        id: "bg",
                        name: "Background",
                        x: 20,
                        y: 20,
                        width: 40,
                        height: 40,
                        responsive: { behavior: "background" },
                    }),
                ],
                activeResizeId: "master",
                canvasWidth: 100,
                canvasHeight: 100,
                resizes: [resize({ id: "master", width: 100, height: 100, isMaster: true })],
            },
            { id: "target", name: "Target", width: 320, height: 180 },
        );

        expect(result.resize.layerSnapshot?.[0]).toMatchObject({
            x: 0,
            y: 0,
            width: 320,
            height: 180,
        });
    });

    it("creates content/style-only bindings to master layers", () => {
        const masterText = text({ id: "master-headline", slotId: "headline", name: "Headline" });
        const wideText = text({ id: "wide-headline", slotId: "headline", name: "Headline", x: 40 });

        const result = generateCustomResize(
            {
                layers: [masterText],
                activeResizeId: "master",
                canvasWidth: 100,
                canvasHeight: 100,
                resizes: [
                    resize({ id: "master", width: 100, height: 100, isMaster: true }),
                    resize({
                        id: "wide",
                        width: 200,
                        height: 100,
                        layerSnapshot: [wideText],
                        layerBindings: [{
                            masterLayerId: "master-headline",
                            targetLayerId: "wide-headline",
                            syncContent: true,
                            syncStyle: true,
                            syncSize: false,
                            syncPosition: false,
                        }],
                    }),
                ],
            },
            { id: "target", name: "Target", width: 400, height: 200 },
        );

        expect(result.sourceResizeId).toBe("wide");
        expect(result.resize.layerBindings).toHaveLength(1);
        expect(result.resize.layerBindings?.[0]).toMatchObject({
            masterLayerId: "master-headline",
            syncContent: true,
            syncStyle: true,
            syncSize: false,
            syncPosition: false,
        });
        expect(result.resize.layerBindings?.[0]?.targetLayerId).toBe(result.resize.layerSnapshot?.[0]?.id);
    });
});
