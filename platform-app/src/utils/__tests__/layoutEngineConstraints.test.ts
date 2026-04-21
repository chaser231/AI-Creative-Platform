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

describe("applyAllAutoLayouts — cascade honours LayerConstraints on unmanaged children", () => {
    it("PR-4: absolute child inside an AL frame respects {right, bottom} when parent hug-shrinks", () => {
        // Outer hug-hug AL frame. Managed rect 50×50 + absolute 20×20 pinned to right-bottom.
        // Frame starts 100×100 (with 10 padding and one 50×50 child, hug target is 70×70).
        // The hug shrink (dw=-30, dh=-30) must push the {right,bottom} absolute child from
        // (80,80) to (50,50) to preserve its 0-gap against the new right/bottom edges.
        const frame = makeFrame("outer", {
            width: 100,
            height: 100,
            layoutMode: "horizontal",
            paddingTop: 10,
            paddingRight: 10,
            paddingBottom: 10,
            paddingLeft: 10,
            primaryAxisSizingMode: "auto",
            counterAxisSizingMode: "auto",
            childIds: ["managed", "abs"],
        });

        const managed = makeRect("managed", { x: 0, y: 0, width: 50, height: 50 });

        const abs = makeRect("abs", {
            x: 80,
            y: 80,
            width: 20,
            height: 20,
            isAbsolutePositioned: true,
            constraints: { horizontal: "right", vertical: "bottom" },
        });

        const layers: Layer[] = [frame, managed, abs];
        const result = applyAllAutoLayouts(layers);

        const f = getLayer<FrameLayer>(result, "outer");
        expect(f.width).toBe(70);
        expect(f.height).toBe(70);

        const a = getLayer<RectangleLayer>(result, "abs");
        expect(a.x).toBe(50);
        expect(a.y).toBe(50);
        expect(a.width).toBe(20);
        expect(a.height).toBe(20);
    });

    it("PR-10: absolute AL-child with {stretch, top} is resized AND its managed grandchildren repack", () => {
        // Outer vertical hug-hug AL frame, initially 300×100.
        // - Managed child: rect 200×50 (this one drives outer's hug size).
        // - Absolute child: frame B (horizontal AL, fixed 300×50) with {stretch, top} constraints.
        //   Frame B has one managed grandchild: rect 50×30 with layoutSizingWidth="fill".
        //
        // Expected flow inside applyAllAutoLayouts:
        //   1. Bottom-up AL pass: frame B stays 300×50; grandchild fills to 300×30.
        //   2. Bottom-up AL pass: outer hug shrinks from 300×100 to 200×50 (from rect only).
        //   3. Cascade: outer delta dw=-100, dh=-50. Frame B is unmanaged — {stretch,top}
        //      resizes B to 200×50. Size changed → re-run AL for B, grandchild refills to 200.
        const outer = makeFrame("outer", {
            x: 0,
            y: 0,
            width: 300,
            height: 100,
            layoutMode: "vertical",
            primaryAxisSizingMode: "auto",
            counterAxisSizingMode: "auto",
            childIds: ["rect", "B"],
        });

        const rect = makeRect("rect", { x: 0, y: 0, width: 200, height: 50 });

        const B = makeFrame("B", {
            x: 0,
            y: 50,
            width: 300,
            height: 50,
            layoutMode: "horizontal",
            primaryAxisSizingMode: "fixed",
            counterAxisSizingMode: "fixed",
            isAbsolutePositioned: true,
            constraints: { horizontal: "stretch", vertical: "top" },
            childIds: ["gc"],
        });

        const gc = makeRect("gc", {
            x: 0,
            y: 50,
            width: 50,
            height: 30,
            layoutSizingWidth: "fill",
            layoutSizingHeight: "fixed",
        });

        const layers: Layer[] = [outer, rect, B, gc];
        const result = applyAllAutoLayouts(layers);

        const o = getLayer<FrameLayer>(result, "outer");
        expect(o.width).toBe(200);
        expect(o.height).toBe(50);

        const b = getLayer<FrameLayer>(result, "B");
        expect(b.width).toBe(200);
        expect(b.height).toBe(50);
        expect(b.x).toBe(0);
        expect(b.y).toBe(50);

        const gOut = getLayer<RectangleLayer>(result, "gc");
        expect(gOut.width).toBe(200);
        expect(gOut.height).toBe(30);
    });
});
