import { describe, it, expect } from "vitest";
import type { FrameLayer, Layer, RectangleLayer } from "@/types";
import { applyAllAutoLayouts } from "@/utils/layoutEngine";

function makeRect(id: string, overrides: Partial<RectangleLayer> = {}): RectangleLayer {
    return {
        id,
        type: "rectangle",
        name: id,
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        rotation: 0,
        visible: true,
        locked: false,
        fill: "#000000",
        stroke: "#000000",
        strokeWidth: 0,
        cornerRadius: 0,
        ...overrides,
    } as RectangleLayer;
}

function makeFrame(id: string, overrides: Partial<FrameLayer>): FrameLayer {
    return {
        id,
        type: "frame",
        name: id,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
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
        paddingTop: 0,
        paddingRight: 0,
        paddingBottom: 0,
        paddingLeft: 0,
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

describe("applyAllAutoLayouts — nested hug frames", () => {
    it("resolves nested hug horizontal frame width from two fixed rects", () => {
        const inner = makeFrame("inner", {
            width: 200,
            height: 80,
            layoutMode: "horizontal",
            layoutSizingWidth: "hug",
            layoutSizingHeight: "hug",
            primaryAxisSizingMode: "auto",
            counterAxisSizingMode: "auto",
            paddingLeft: 5,
            paddingRight: 5,
            paddingTop: 5,
            paddingBottom: 5,
            spacing: 10,
            childIds: ["a", "b"],
        });
        const a = makeRect("a", { width: 40, height: 30 });
        const b = makeRect("b", { width: 60, height: 30 });
        const outer = makeFrame("outer", {
            width: 300,
            height: 200,
            layoutMode: "horizontal",
            primaryAxisSizingMode: "auto",
            counterAxisSizingMode: "auto",
            paddingLeft: 10,
            paddingRight: 10,
            paddingTop: 10,
            paddingBottom: 10,
            spacing: 0,
            childIds: ["inner"],
        });

        const result = applyAllAutoLayouts([outer, inner, a, b]);

        const innerOut = getLayer<FrameLayer>(result, "inner");
        expect(innerOut.width).toBe(120);
        expect(innerOut.height).toBe(40);

        const outerOut = getLayer<FrameLayer>(result, "outer");
        expect(outerOut.width).toBe(140);
        expect(outerOut.height).toBe(60);
    });

    it("sizes a nested hug frame to its children inside a fixed parent", () => {
        const inner = makeFrame("inner", {
            width: 50,
            height: 50,
            layoutMode: "horizontal",
            layoutSizingWidth: "hug",
            layoutSizingHeight: "hug",
            primaryAxisSizingMode: "auto",
            counterAxisSizingMode: "auto",
            paddingLeft: 0,
            paddingRight: 0,
            paddingTop: 0,
            paddingBottom: 0,
            spacing: 10,
            childIds: ["a", "b"],
        });
        const a = makeRect("a", { width: 80, height: 40 });
        const b = makeRect("b", { width: 20, height: 40 });
        const outer = makeFrame("outer", {
            width: 300,
            height: 200,
            layoutMode: "horizontal",
            primaryAxisSizingMode: "fixed",
            counterAxisSizingMode: "fixed",
            paddingLeft: 0,
            paddingRight: 0,
            paddingTop: 0,
            paddingBottom: 0,
            spacing: 0,
            childIds: ["inner"],
        });

        const result = applyAllAutoLayouts([outer, inner, a, b]);

        const innerOut = getLayer<FrameLayer>(result, "inner");
        expect(innerOut.width).toBe(110);
        expect(innerOut.height).toBe(40);

        const outerOut = getLayer<FrameLayer>(result, "outer");
        expect(outerOut.width).toBe(300);
        expect(outerOut.height).toBe(200);
    });
});
