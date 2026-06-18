import { describe, expect, it } from "vitest";
import { applySliceAlignment, describeSliceAlignment } from "../sliceAlignment";
import type {
    FrameLayer,
    Layer,
    RectangleLayer,
    SliceAlignSettings,
    SliceLayer,
    TextLayer,
} from "@/types";

function rect(o: Partial<RectangleLayer> = {}): RectangleLayer {
    return {
        id: "rect",
        type: "rectangle",
        name: "Rect",
        x: 0, y: 0, width: 100, height: 100,
        rotation: 0, visible: true, locked: false,
        fill: "#fff", stroke: "", strokeWidth: 0, cornerRadius: 0,
        ...o,
    };
}

function text(o: Partial<TextLayer> = {}): TextLayer {
    return {
        id: "text",
        type: "text",
        name: "Text",
        x: 0, y: 0, width: 100, height: 40,
        rotation: 0, visible: true, locked: false,
        text: "Hi", fontSize: 20, fontFamily: "Inter", fontWeight: "700",
        fill: "#111", align: "left", letterSpacing: 0, lineHeight: 1.2,
        textAdjust: "fixed",
        ...o,
    };
}

function frame(o: Partial<FrameLayer> = {}): FrameLayer {
    return {
        id: "frame",
        type: "frame",
        name: "Frame",
        x: 0, y: 0, width: 100, height: 100,
        rotation: 0, visible: true, locked: false,
        fill: "#fff", stroke: "", strokeWidth: 0, cornerRadius: 0,
        clipContent: false, childIds: [],
        ...o,
    };
}

function slice(o: Partial<SliceLayer> = {}): SliceLayer {
    return {
        id: "slice",
        type: "slice",
        name: "Slice",
        x: 0, y: 0, width: 100, height: 100,
        rotation: 0, visible: true, locked: false,
        ...o,
    };
}

const align = (mode: SliceAlignSettings["mode"], scope: SliceAlignSettings["scope"]): SliceAlignSettings => ({ mode, scope });

// Two vertical slices: cell0 = 0..100, cell1 = 100..200 (axisX only).
const verticalSlices = (): SliceLayer[] => [
    slice({ id: "s0", x: 0, y: 0, width: 100, height: 200 }),
    slice({ id: "s1", x: 100, y: 0, width: 100, height: 200 }),
];

describe("applySliceAlignment — no-op cases", () => {
    it("returns the same array when there are no slices", () => {
        const layers: Layer[] = [text({ id: "t", sliceAlign: align("avoid_cut", "layer") })];
        const result = applySliceAlignment(layers);
        expect(result.layers).toBe(layers);
        expect(result.diagnostics).toEqual([]);
    });

    it("is a no-op when slices form a single cell (no active cut-lines)", () => {
        const layers: Layer[] = [
            slice({ id: "s0", x: 0, y: 0, width: 200, height: 200 }),
            text({ id: "t", x: 80, width: 40, sliceAlign: align("avoid_cut", "layer") }),
        ];
        const result = applySliceAlignment(layers);
        expect(result.layers).toBe(layers);
    });

    it("is a no-op when no layer is flagged", () => {
        const layers: Layer[] = [...verticalSlices(), text({ id: "t", x: 80, width: 40 })];
        const result = applySliceAlignment(layers);
        expect(result.layers).toBe(layers);
    });
});

describe("applySliceAlignment — avoid_cut", () => {
    it("shifts a top-level layer (layer scope) into the nearest cell on X", () => {
        const layers: Layer[] = [
            ...verticalSlices(),
            text({ id: "t", x: 80, y: 10, width: 40, height: 40, sliceAlign: align("avoid_cut", "layer") }),
        ];
        const out = applySliceAlignment(layers).layers;
        const t = out.find((l) => l.id === "t")!;
        expect(t.x).toBe(60); // 80..120 → clamp into 0..100
        expect(t.isAbsolutePositioned).toBeUndefined(); // top-level: no detach needed
    });

    it("detaches and shifts a layer nested in an auto-layout frame (layer scope)", () => {
        const layers: Layer[] = [
            ...verticalSlices(),
            frame({ id: "f", x: 0, y: 0, width: 200, height: 60, layoutMode: "horizontal", childIds: ["a", "t"] }),
            rect({ id: "a", x: 0, y: 0, width: 10, height: 10 }),
            text({ id: "t", x: 80, y: 0, width: 40, height: 40, sliceAlign: align("avoid_cut", "layer") }),
        ];
        const out = applySliceAlignment(layers).layers;
        const t = out.find((l) => l.id === "t")!;
        expect(t.x).toBe(60);
        expect(t.isAbsolutePositioned).toBe(true);
    });

    it("moves the whole top-level frame subtree (frame scope)", () => {
        const layers: Layer[] = [
            ...verticalSlices(),
            frame({ id: "f", x: 0, y: 0, width: 60, height: 60, childIds: ["t"] }),
            text({ id: "t", x: 80, y: 10, width: 40, height: 40, sliceAlign: align("avoid_cut", "frame") }),
        ];
        const out = applySliceAlignment(layers).layers;
        const f = out.find((l) => l.id === "f")!;
        const t = out.find((l) => l.id === "t")!;
        // Target needs dx = -20 → whole frame + child shift by -20.
        expect(t.x).toBe(60);
        expect(f.x).toBe(-20);
        expect(t.isAbsolutePositioned).toBeUndefined();
    });

    it("emits a diagnostic and does not move when the layer is too large to fit", () => {
        const layers: Layer[] = [
            ...verticalSlices(),
            text({ id: "t", x: 20, y: 0, width: 150, height: 40, sliceAlign: align("avoid_cut", "layer") }),
        ];
        const result = applySliceAlignment(layers);
        const t = result.layers.find((l) => l.id === "t")!;
        expect(t.x).toBe(20); // unchanged
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]).toMatchObject({ layerId: "t", code: "cannot-avoid-cut" });
    });

    it("respects gap bands — lands fully inside a cell, never in the gap", () => {
        const layers: Layer[] = [
            slice({ id: "s0", x: 0, y: 0, width: 90, height: 100 }),
            slice({ id: "s1", x: 110, y: 0, width: 90, height: 100 }), // gap 90..110
            text({ id: "t", x: 85, y: 0, width: 30, height: 30, sliceAlign: align("avoid_cut", "layer") }),
        ];
        const out = applySliceAlignment(layers).layers;
        const t = out.find((l) => l.id === "t")!;
        expect(t.x).toBe(60); // 85..115 → clamp into cell0 0..90 → 60..90
    });

    it("operates on Y for horizontal slices", () => {
        const layers: Layer[] = [
            slice({ id: "s0", x: 0, y: 0, width: 200, height: 100 }),
            slice({ id: "s1", x: 0, y: 100, width: 200, height: 100 }),
            text({ id: "t", x: 0, y: 80, width: 40, height: 40, sliceAlign: align("avoid_cut", "layer") }),
        ];
        const out = applySliceAlignment(layers).layers;
        const t = out.find((l) => l.id === "t")!;
        expect(t.y).toBe(60);
        expect(t.x).toBe(0);
    });
});

describe("applySliceAlignment — fit", () => {
    const grid2x2 = (): SliceLayer[] => [
        slice({ id: "s0", x: 0, y: 0, width: 100, height: 100 }),
        slice({ id: "s1", x: 100, y: 0, width: 100, height: 100 }),
        slice({ id: "s2", x: 0, y: 100, width: 100, height: 100 }),
        slice({ id: "s3", x: 100, y: 100, width: 100, height: 100 }),
    ];

    it("scales a top-level layer to fill its nearest cell (layer scope)", () => {
        const layers: Layer[] = [
            ...grid2x2(),
            rect({ id: "r", x: 20, y: 20, width: 40, height: 40, sliceAlign: align("fit", "layer") }),
        ];
        const out = applySliceAlignment(layers).layers;
        const r = out.find((l) => l.id === "r")!;
        expect(r).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
    });

    it("scales font size proportionally for text fit", () => {
        const layers: Layer[] = [
            ...grid2x2(),
            text({ id: "t", x: 20, y: 20, width: 40, height: 40, fontSize: 20, sliceAlign: align("fit", "layer") }),
        ];
        const out = applySliceAlignment(layers).layers;
        const t = out.find((l) => l.id === "t") as TextLayer;
        expect(t.fontSize).toBe(50); // 20 * 2.5
    });

    it("scales the whole frame subtree (frame scope)", () => {
        const layers: Layer[] = [
            ...grid2x2(),
            frame({ id: "f", x: 10, y: 10, width: 40, height: 40, childIds: ["c"], sliceAlign: align("fit", "frame") }),
            rect({ id: "c", x: 20, y: 20, width: 20, height: 20 }),
        ];
        const out = applySliceAlignment(layers).layers;
        const f = out.find((l) => l.id === "f")!;
        const c = out.find((l) => l.id === "c")!;
        // scale = 100/40 = 2.5; frame fills cell0
        expect(f).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
        // child relative offset (10,10) * 2.5 = (25,25); size 20*2.5 = 50
        expect(c).toMatchObject({ x: 25, y: 25, width: 50, height: 50 });
    });
});

describe("describeSliceAlignment", () => {
    it("reports no grid when there are no slices", () => {
        const info = describeSliceAlignment(text({ id: "t" }), [text({ id: "t" })]);
        expect(info.hasGrid).toBe(false);
    });

    it("reports an active grid and feasibility for a fitting layer", () => {
        const layers: Layer[] = [...verticalSlices(), text({ id: "t", x: 80, width: 40 })];
        const info = describeSliceAlignment(layers[2], layers);
        expect(info.hasGrid).toBe(true);
        expect(info.axes).toEqual({ x: true, y: false });
        expect(info.avoidCutFeasible).toBe(true);
    });

    it("reports infeasible when the layer is wider than every cell", () => {
        const layers: Layer[] = [...verticalSlices(), text({ id: "t", x: 0, width: 150 })];
        const info = describeSliceAlignment(layers[2], layers);
        expect(info.avoidCutFeasible).toBe(false);
    });
});
