import { describe, it, expect } from "vitest";
import type { FrameLayer, Layer, TextLayer } from "@/types";
import { applyAllAutoLayouts } from "@/utils/layoutEngine";

const LONG_TEXT = "This is a fairly long sentence that must wrap onto multiple lines when constrained.";

function makeText(id: string, overrides: Partial<TextLayer> = {}): TextLayer {
    return {
        id,
        type: "text",
        name: id,
        x: 0,
        y: 0,
        width: 120,
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
        width: 200,
        height: 300,
        rotation: 0,
        visible: true,
        locked: false,
        fill: "#ffffff",
        stroke: "#000000",
        strokeWidth: 0,
        cornerRadius: 0,
        clipContent: false,
        childIds: [],
        layoutMode: "vertical",
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

describe("layout engine — text sizing matrix (fill / hug / stretch)", () => {
    it("auto_width + flex-start ⇒ x = paddingLeft (not centered)", () => {
        const frame = makeFrame("frame", { width: 400, paddingLeft: 12, counterAxisAlignItems: "flex-start", childIds: ["t"] });
        const result = applyAllAutoLayouts([frame, makeText("t", { align: "center" })]);
        const text = getLayer<TextLayer>(result, "t");
        const f = getLayer<FrameLayer>(result, "frame");
        expect(text.x).toBeCloseTo(f.x + 12, 3);
    });

    it("hug (auto_width) ⇒ intrinsic width, narrower than the frame", () => {
        const frame = makeFrame("frame", { width: 400, counterAxisAlignItems: "flex-start", childIds: ["t"] });
        const result = applyAllAutoLayouts([frame, makeText("t", { text: "Hi" })]);
        const text = getLayer<TextLayer>(result, "t");
        expect(text.width).toBeLessThan(400);
    });

    it("fill width (auto_height) ⇒ wraps to frame inner width", () => {
        const frame = makeFrame("frame", { width: 200, childIds: ["t"] });
        const result = applyAllAutoLayouts([
            frame,
            makeText("t", { textAdjust: "auto_height", layoutSizingWidth: "fill", layoutSizingHeight: "hug", text: LONG_TEXT }),
        ]);
        const text = getLayer<TextLayer>(result, "t");
        expect(text.width).toBeCloseTo(200, 0);
        // wrapped long text spans more than one line
        expect(text.height).toBeGreaterThan(16 * 1.2 + 1);
    });

    it("REGRESSION 1.3: fill on un-normalized auto_width does NOT revert to intrinsic", () => {
        // Legacy data: textAdjust still auto_width while layoutSizingWidth=fill.
        // The engine must wrap to the frame width instead of snapping back to the
        // (much wider) single-line intrinsic width.
        const frame = makeFrame("frame", { width: 200, childIds: ["t"] });
        const result = applyAllAutoLayouts([
            frame,
            makeText("t", { textAdjust: "auto_width", layoutSizingWidth: "fill", text: LONG_TEXT }),
        ]);
        const text = getLayer<TextLayer>(result, "t");
        expect(text.width).toBeCloseTo(200, 0);
    });

    it("counterAxisAlignItems=stretch ⇒ auto_width text stretches to frame width (not intrinsic)", () => {
        const frame = makeFrame("frame", { width: 200, counterAxisAlignItems: "stretch", childIds: ["t"] });
        const result = applyAllAutoLayouts([
            frame,
            makeText("t", { textAdjust: "auto_width", text: LONG_TEXT }),
        ]);
        const text = getLayer<TextLayer>(result, "t");
        expect(text.width).toBeCloseTo(200, 0);
    });
});
