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
    it("applies constraints when a non-auto-layout frame is resized", () => {
        const beforeFrame = makeFrame("frame", {
            width: 100,
            height: 100,
            childIds: ["pinned"],
        });
        const afterFrame = makeFrame("frame", {
            width: 200,
            height: 150,
            childIds: ["pinned"],
        });
        const pinned = makeRect("pinned", {
            x: 80,
            y: 70,
            width: 20,
            height: 30,
            constraints: { horizontal: "right", vertical: "bottom" },
        });

        const result = applyAllAutoLayouts([afterFrame, pinned], [beforeFrame, pinned]);
        const out = getLayer<RectangleLayer>(result, "pinned");

        expect(out.x).toBe(180);
        expect(out.y).toBe(120);
    });

    it("translates children exactly once when a frame moves", () => {
        const beforeFrame = makeFrame("frame", {
            x: 10,
            y: 20,
            width: 100,
            height: 100,
            childIds: ["child"],
        });
        const afterFrame = makeFrame("frame", {
            x: 40,
            y: 50,
            width: 100,
            height: 100,
            childIds: ["child"],
        });
        const child = makeRect("child", {
            x: 30,
            y: 60,
            width: 20,
            height: 20,
        });

        const result = applyAllAutoLayouts([afterFrame, child], [beforeFrame, child]);
        const out = getLayer<RectangleLayer>(result, "child");

        expect(out.x).toBe(60);
        expect(out.y).toBe(90);
    });

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

    it("stretches children on the counter axis when counterAxisAlignItems is stretch", () => {
        const frame = makeFrame("frame", {
            width: 200,
            height: 100,
            layoutMode: "horizontal",
            paddingTop: 10,
            paddingBottom: 20,
            paddingLeft: 5,
            paddingRight: 5,
            counterAxisAlignItems: "stretch",
            childIds: ["child"],
        });
        const child = makeRect("child", { width: 40, height: 10 });

        const result = applyAllAutoLayouts([frame, child]);
        const out = getLayer<RectangleLayer>(result, "child");

        expect(out.y).toBe(10);
        expect(out.height).toBe(70);
    });

    it("does not create negative space-between gaps when children overflow", () => {
        const frame = makeFrame("frame", {
            width: 100,
            height: 50,
            layoutMode: "horizontal",
            paddingLeft: 0,
            paddingRight: 0,
            primaryAxisAlignItems: "space-between",
            childIds: ["a", "b"],
        });
        const a = makeRect("a", { width: 80, height: 10 });
        const b = makeRect("b", { width: 80, height: 10 });

        const result = applyAllAutoLayouts([frame, a, b]);

        expect(getLayer<RectangleLayer>(result, "a").x).toBe(0);
        expect(getLayer<RectangleLayer>(result, "b").x).toBe(80);
    });
});

describe("applyAllAutoLayouts — self-anchor on hug resize", () => {
    // Reused setup: a vertical hug-on-primary frame with two stacked rects.
    // Initial frame.height = 100 (oversized); intrinsic height = 50+50 = 100,
    // so by default the hug resolves to no change. We force a bigger child to
    // see the frame grow, and the constraint decides which edge stays put.

    it("vertical:bottom — frame grows upward (bottom edge pinned) and children follow", () => {
        const frame = makeFrame("frame", {
            x: 100,
            y: 200,
            width: 50,
            height: 60,
            layoutMode: "vertical",
            primaryAxisSizingMode: "auto",
            constraints: { horizontal: "left", vertical: "bottom" },
            childIds: ["a", "b"],
        });
        // Two 50×40 rects + 0 spacing → intrinsic height = 80. dh = +20.
        // Bottom anchor: frame.y must shift -20 (200 → 180), bottom edge
        // (260) stays put. Children get repositioned inside the new frame
        // and must move up with it.
        const a = makeRect("a", { x: 100, y: 200, width: 50, height: 40 });
        const b = makeRect("b", { x: 100, y: 240, width: 50, height: 40 });

        const result = applyAllAutoLayouts([frame, a, b]);

        const f = getLayer<FrameLayer>(result, "frame");
        expect(f.x).toBe(100);
        expect(f.y).toBe(180);
        expect(f.height).toBe(80);

        // Bottom edge invariant: y + height should equal the original bottom.
        expect(f.y + f.height).toBe(260);

        // Children stack from the new top inside the (now taller) frame.
        const aOut = getLayer<RectangleLayer>(result, "a");
        const bOut = getLayer<RectangleLayer>(result, "b");
        expect(aOut.y).toBe(180);
        expect(bOut.y).toBe(220);
    });

    it("vertical:center — frame grows symmetrically around its centre", () => {
        const frame = makeFrame("frame", {
            x: 100,
            y: 200,
            width: 50,
            height: 60,
            layoutMode: "vertical",
            primaryAxisSizingMode: "auto",
            constraints: { horizontal: "left", vertical: "center" },
            childIds: ["a", "b"],
        });
        const a = makeRect("a", { x: 100, y: 200, width: 50, height: 40 });
        const b = makeRect("b", { x: 100, y: 240, width: 50, height: 40 });

        const result = applyAllAutoLayouts([frame, a, b]);

        const f = getLayer<FrameLayer>(result, "frame");
        // dh = +20 → frame y shifts -10 (split evenly), height grows by 20.
        expect(f.y).toBe(190);
        expect(f.height).toBe(80);
        // Centre invariant: y + height/2 stays the same (230).
        expect(f.y + f.height / 2).toBe(230);
    });

    it("horizontal:right — hug-shrink keeps the right edge pinned", () => {
        // Mirror of PR-4 with a right-anchored frame: hug shrinks the
        // frame from 100×100 to 70×70 (managed 50×50 + padding 10), and
        // the right edge (x=200) must stay put → frame.x shifts from
        // 100 to 130.
        const frame = makeFrame("outer", {
            x: 100,
            y: 0,
            width: 100,
            height: 100,
            layoutMode: "horizontal",
            paddingTop: 10,
            paddingRight: 10,
            paddingBottom: 10,
            paddingLeft: 10,
            primaryAxisSizingMode: "auto",
            counterAxisSizingMode: "auto",
            constraints: { horizontal: "right", vertical: "top" },
            childIds: ["managed"],
        });
        const managed = makeRect("managed", { x: 110, y: 10, width: 50, height: 50 });

        const result = applyAllAutoLayouts([frame, managed]);

        const f = getLayer<FrameLayer>(result, "outer");
        expect(f.width).toBe(70);
        expect(f.height).toBe(70);
        expect(f.x).toBe(130);
        expect(f.y).toBe(0);
        // Right edge invariant.
        expect(f.x + f.width).toBe(200);

        const m = getLayer<RectangleLayer>(result, "managed");
        // Managed child sits inside the frame at padding (10,10) → absolute (140, 10).
        expect(m.x).toBe(140);
        expect(m.y).toBe(10);
    });

    it("default (top/left) — frame grows down/right exactly as before", () => {
        const frame = makeFrame("frame", {
            x: 100,
            y: 200,
            width: 50,
            height: 60,
            layoutMode: "vertical",
            primaryAxisSizingMode: "auto",
            childIds: ["a", "b"],
        });
        const a = makeRect("a", { x: 100, y: 200, width: 50, height: 40 });
        const b = makeRect("b", { x: 100, y: 240, width: 50, height: 40 });

        const result = applyAllAutoLayouts([frame, a, b]);

        const f = getLayer<FrameLayer>(result, "frame");
        // No constraints → top-left anchor; frame.y unchanged, height grows.
        expect(f.x).toBe(100);
        expect(f.y).toBe(200);
        expect(f.height).toBe(80);
    });
});
