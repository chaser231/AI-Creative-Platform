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
        width: 100,
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

function makeVerticalHugFrame(id: string, childIds: string[]): FrameLayer {
    return {
        id,
        type: "frame",
        name: id,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        rotation: 0,
        visible: true,
        locked: false,
        fill: "#ffffff",
        stroke: "#000000",
        strokeWidth: 0,
        cornerRadius: 0,
        clipContent: false,
        childIds,
        layoutMode: "vertical",
        paddingTop: 10,
        paddingRight: 10,
        paddingBottom: 10,
        paddingLeft: 10,
        spacing: 10,
        primaryAxisSizingMode: "auto",
        counterAxisSizingMode: "auto",
        primaryAxisAlignItems: "flex-start",
        counterAxisAlignItems: "flex-start",
    } as FrameLayer;
}

function getLayer<T extends Layer>(layers: Layer[], id: string): T {
    const l = layers.find(x => x.id === id);
    if (!l) throw new Error(`Layer ${id} not found`);
    return l as T;
}

describe("applyAllAutoLayouts — visibility affects hug sizing", () => {
    it("excludes invisible children from hug size and shifts siblings into their slot", () => {
        const frame = makeVerticalHugFrame("frame", ["a", "b", "c"]);
        const a = makeRect("a");
        const b = makeRect("b");
        const c = makeRect("c");

        let layers: Layer[] = [frame, a, b, c];

        layers = applyAllAutoLayouts(layers);

        {
            const f = getLayer<FrameLayer>(layers, "frame");
            expect(f.width).toBe(120);
            expect(f.height).toBe(190);
            expect(getLayer<RectangleLayer>(layers, "a").y).toBe(10);
            expect(getLayer<RectangleLayer>(layers, "b").y).toBe(70);
            expect(getLayer<RectangleLayer>(layers, "c").y).toBe(130);
            expect(getLayer<RectangleLayer>(layers, "a").x).toBe(10);
        }

        layers = layers.map(l => (l.id === "b" ? ({ ...l, visible: false } as Layer) : l));
        const bYBeforeHide = getLayer<RectangleLayer>(layers, "b").y;

        layers = applyAllAutoLayouts(layers);

        {
            const f = getLayer<FrameLayer>(layers, "frame");
            expect(f.width).toBe(120);
            expect(f.height).toBe(130);
            expect(getLayer<RectangleLayer>(layers, "a").y).toBe(10);
            expect(getLayer<RectangleLayer>(layers, "c").y).toBe(70);
            expect(getLayer<RectangleLayer>(layers, "b").y).toBe(bYBeforeHide);
            expect(getLayer<RectangleLayer>(layers, "b").visible).toBe(false);
        }

        layers = layers.map(l => (l.id === "b" ? ({ ...l, visible: true } as Layer) : l));
        layers = applyAllAutoLayouts(layers);

        {
            const f = getLayer<FrameLayer>(layers, "frame");
            expect(f.width).toBe(120);
            expect(f.height).toBe(190);
            expect(getLayer<RectangleLayer>(layers, "a").y).toBe(10);
            expect(getLayer<RectangleLayer>(layers, "b").y).toBe(70);
            expect(getLayer<RectangleLayer>(layers, "c").y).toBe(130);
        }
    });
});
