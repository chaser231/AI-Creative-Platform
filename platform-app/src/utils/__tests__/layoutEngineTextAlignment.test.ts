import { describe, it, expect } from "vitest";
import type { FrameLayer, Layer, TextLayer } from "@/types";
import { applyAllAutoLayouts, preserveAutoWidthTextAnchors } from "@/utils/layoutEngine";

function makeText(id: string, overrides: Partial<TextLayer> = {}): TextLayer {
    return {
        id,
        type: "text",
        name: id,
        x: 100,
        y: 40,
        width: 40,
        height: 20,
        rotation: 0,
        visible: true,
        locked: false,
        text: "Text",
        fontSize: 16,
        fontFamily: "Inter",
        fontWeight: "400",
        fill: "#000000",
        align: "left",
        letterSpacing: 0,
        lineHeight: 1.2,
        textAdjust: "auto_width",
        ...overrides,
    } as TextLayer;
}

function makeFrame(id: string, overrides: Partial<FrameLayer> = {}): FrameLayer {
    return {
        id,
        type: "frame",
        name: id,
        x: 0,
        y: 0,
        width: 300,
        height: 80,
        rotation: 0,
        visible: true,
        locked: false,
        fill: "#ffffff",
        stroke: "#000000",
        strokeWidth: 0,
        cornerRadius: 0,
        clipContent: false,
        childIds: [],
        layoutMode: "none",
        paddingTop: 10,
        paddingRight: 10,
        paddingBottom: 10,
        paddingLeft: 10,
        spacing: 0,
        primaryAxisSizingMode: "fixed",
        counterAxisSizingMode: "fixed",
        primaryAxisAlignItems: "flex-start",
        counterAxisAlignItems: "flex-start",
        ...overrides,
    } as FrameLayer;
}

function getLayer<T extends Layer>(layers: Layer[], id: string): T {
    const l = layers.find(x => x.id === id);
    if (!l) throw new Error(`Layer ${id} not found`);
    return l as T;
}

describe("auto-width text alignment anchors", () => {
    it("keeps centered and right-aligned root text anchored while width grows", () => {
        const centerPrev = makeText("center", { align: "center", x: 100, width: 40 });
        const centerNext = makeText("center", { align: "center", x: 100, width: 80 });
        const [centerOut] = preserveAutoWidthTextAnchors([centerPrev], [centerNext]) as TextLayer[];
        expect(centerOut.x + centerOut.width / 2).toBe(120);
        expect(centerOut.x).toBe(80);

        const rightPrev = makeText("right", { align: "right", x: 100, width: 40 });
        const rightNext = makeText("right", { align: "right", x: 100, width: 80 });
        const [rightOut] = preserveAutoWidthTextAnchors([rightPrev], [rightNext]) as TextLayer[];
        expect(rightOut.x + rightOut.width).toBe(140);
        expect(rightOut.x).toBe(60);
    });

    it("applies the same anchor behavior inside non-auto-layout frames", () => {
        const frame = makeFrame("frame", { childIds: ["text"] });
        const prevText = makeText("text", { align: "center", x: 50, width: 40 });
        const nextText = makeText("text", { align: "center", x: 50, width: 90 });

        const result = applyAllAutoLayouts([frame, nextText], [frame, prevText]);
        const text = getLayer<TextLayer>(result, "text");

        expect(text.x + text.width / 2).toBe(70);
    });

    it("keeps managed auto-layout text anchored after intrinsic auto-width measurement changes", () => {
        const frame = makeFrame("frame", {
            layoutMode: "horizontal",
            childIds: ["text"],
        });
        const prevInput: Layer[] = [
            frame,
            makeText("text", { align: "right", x: 10, y: 10, text: "Hi" }),
        ];
        const prev = applyAllAutoLayouts(prevInput);
        const prevText = getLayer<TextLayer>(prev, "text");

        const nextInput = prev.map((layer) =>
            layer.id === "text"
                ? ({ ...layer, text: "Much longer text" } as TextLayer)
                : layer
        );
        const next = applyAllAutoLayouts(nextInput, prev);
        const nextText = getLayer<TextLayer>(next, "text");

        expect(nextText.width).toBeGreaterThan(prevText.width);
        expect(nextText.x + nextText.width).toBeCloseTo(prevText.x + prevText.width, 3);
    });

    it("keeps bottom and middle aligned auto-height text anchored while height grows", () => {
        const bottomPrev = makeText("bottom", {
            textAdjust: "auto_height",
            verticalAlign: "bottom",
            y: 100,
            height: 40,
            width: 120,
        });
        const bottomNext = makeText("bottom", {
            textAdjust: "auto_height",
            verticalAlign: "bottom",
            y: 100,
            height: 90,
            width: 120,
        });
        const [bottomOut] = preserveAutoWidthTextAnchors([bottomPrev], [bottomNext]) as TextLayer[];
        expect(bottomOut.y + bottomOut.height).toBe(140);
        expect(bottomOut.y).toBe(50);

        const middlePrev = makeText("middle", {
            textAdjust: "auto_height",
            verticalAlign: "middle",
            y: 100,
            height: 40,
            width: 120,
        });
        const middleNext = makeText("middle", {
            textAdjust: "auto_height",
            verticalAlign: "middle",
            y: 100,
            height: 90,
            width: 120,
        });
        const [middleOut] = preserveAutoWidthTextAnchors([middlePrev], [middleNext]) as TextLayer[];
        expect(middleOut.y + middleOut.height / 2).toBe(120);
        expect(middleOut.y).toBe(75);
    });
});
