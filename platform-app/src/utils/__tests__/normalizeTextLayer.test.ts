import { describe, it, expect } from "vitest";
import type { TextLayer } from "@/types";
import {
    normalizeTextLayer,
    textAdjustFromSizing,
    sizingFromTextAdjust,
} from "@/utils/normalizeTextLayer";

function makeText(overrides: Partial<TextLayer> = {}): TextLayer {
    return {
        id: "t",
        type: "text",
        name: "t",
        x: 0,
        y: 0,
        width: 120,
        height: 40,
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

describe("textAdjustFromSizing / sizingFromTextAdjust (canonical matrix)", () => {
    it("maps layout-sizing pairs to textAdjust", () => {
        expect(textAdjustFromSizing("hug", "hug")).toBe("auto_width");
        expect(textAdjustFromSizing("fixed", "hug")).toBe("auto_height");
        expect(textAdjustFromSizing("fill", "hug")).toBe("auto_height");
        expect(textAdjustFromSizing("fixed", "fixed")).toBe("fixed");
        expect(textAdjustFromSizing("fill", "fill")).toBe("fixed");
        expect(textAdjustFromSizing("fixed", "fill")).toBe("fixed");
        // edge: hug width wins
        expect(textAdjustFromSizing("hug", "fixed")).toBe("auto_width");
        expect(textAdjustFromSizing("hug", "fill")).toBe("auto_width");
    });

    it("maps textAdjust to its canonical (fill-free) layout-sizing pair", () => {
        expect(sizingFromTextAdjust("auto_width")).toEqual({ width: "hug", height: "hug" });
        expect(sizingFromTextAdjust("auto_height")).toEqual({ width: "fixed", height: "hug" });
        expect(sizingFromTextAdjust("fixed")).toEqual({ width: "fixed", height: "fixed" });
    });

    it("round-trips textAdjust → sizing → textAdjust", () => {
        for (const adj of ["auto_width", "auto_height", "fixed"] as const) {
            const s = sizingFromTextAdjust(adj);
            expect(textAdjustFromSizing(s.width, s.height)).toBe(adj);
        }
    });
});

describe("normalizeTextLayer — textAdjust is the changed intent", () => {
    it("derives layout-sizing from a new textAdjust (and drops fill)", () => {
        const base = makeText({ textAdjust: "fixed", layoutSizingWidth: "fill", layoutSizingHeight: "fill" });

        const toAutoWidth = normalizeTextLayer({ ...base, textAdjust: "auto_width" }, ["textAdjust"]);
        expect(toAutoWidth.layoutSizingWidth).toBe("hug");
        expect(toAutoWidth.layoutSizingHeight).toBe("hug");

        const toAutoHeight = normalizeTextLayer({ ...base, textAdjust: "auto_height" }, ["textAdjust"]);
        expect(toAutoHeight.layoutSizingWidth).toBe("fixed");
        expect(toAutoHeight.layoutSizingHeight).toBe("hug");

        const toFixed = normalizeTextLayer({ ...base, textAdjust: "fixed" }, ["textAdjust"]);
        expect(toFixed.layoutSizingWidth).toBe("fixed");
        expect(toFixed.layoutSizingHeight).toBe("fixed");
    });
});

describe("normalizeTextLayer — layout-sizing is the changed intent", () => {
    const cases: Array<{
        w: NonNullable<TextLayer["layoutSizingWidth"]>;
        h: NonNullable<TextLayer["layoutSizingHeight"]>;
        expected: NonNullable<TextLayer["textAdjust"]>;
    }> = [
        { w: "hug", h: "hug", expected: "auto_width" },
        { w: "fixed", h: "hug", expected: "auto_height" },
        { w: "fill", h: "hug", expected: "auto_height" },
        { w: "fixed", h: "fixed", expected: "fixed" },
        { w: "fill", h: "fill", expected: "fixed" },
        { w: "fixed", h: "fill", expected: "fixed" },
        { w: "hug", h: "fixed", expected: "auto_width" },
    ];

    for (const { w, h, expected } of cases) {
        it(`(${w} × ${h}) ⇒ textAdjust ${expected}`, () => {
            const layer = makeText({ textAdjust: "fixed", layoutSizingWidth: w, layoutSizingHeight: h });
            const out = normalizeTextLayer(layer, ["layoutSizingWidth", "layoutSizingHeight"]);
            expect(out.textAdjust).toBe(expected);
            // layout-sizing is the source of truth here, so it is preserved as-is
            expect(out.layoutSizingWidth).toBe(w);
            expect(out.layoutSizingHeight).toBe(h);
        });
    }

    it("hug on width makes the 'Hug' option functional (auto_width)", () => {
        const layer = makeText({ textAdjust: "fixed", layoutSizingWidth: "hug", layoutSizingHeight: "fixed" });
        const out = normalizeTextLayer(layer, ["layoutSizingWidth"]);
        expect(out.textAdjust).toBe("auto_width");
    });
});

describe("normalizeTextLayer — manual width/height edits pin the axis to fixed", () => {
    it("manual width edit on auto_width ⇒ auto_height (fixed width, hug height)", () => {
        const layer = makeText({ textAdjust: "auto_width", layoutSizingWidth: "hug", layoutSizingHeight: "hug", width: 200 });
        const out = normalizeTextLayer(layer, ["width"]);
        expect(out.layoutSizingWidth).toBe("fixed");
        expect(out.layoutSizingHeight).toBe("hug");
        expect(out.textAdjust).toBe("auto_height");
    });

    it("manual height edit on auto_height ⇒ fixed", () => {
        const layer = makeText({ textAdjust: "auto_height", layoutSizingWidth: "fixed", layoutSizingHeight: "hug", height: 200 });
        const out = normalizeTextLayer(layer, ["height"]);
        expect(out.layoutSizingHeight).toBe("fixed");
        expect(out.textAdjust).toBe("fixed");
    });

    it("transformer drag (width + height) ⇒ fixed on both axes", () => {
        const layer = makeText({ textAdjust: "auto_width", layoutSizingWidth: "hug", layoutSizingHeight: "hug" });
        const out = normalizeTextLayer(layer, ["x", "y", "width", "height", "rotation"]);
        expect(out.layoutSizingWidth).toBe("fixed");
        expect(out.layoutSizingHeight).toBe("fixed");
        expect(out.textAdjust).toBe("fixed");
    });
});

describe("normalizeTextLayer — guards and invariants", () => {
    it("returns the same layer reference when no sizing-relevant key changed", () => {
        const layer = makeText({ textAdjust: "auto_width" });
        const out = normalizeTextLayer(layer, ["fill", "name", "opacity"]);
        expect(out).toBe(layer);
    });

    it("reconciles a legacy inconsistent layer when called without changedKeys (sizing wins)", () => {
        // textAdjust says fixed, but layout-sizing says hug/hug → auto_width
        const layer = makeText({ textAdjust: "fixed", layoutSizingWidth: "hug", layoutSizingHeight: "hug" });
        const out = normalizeTextLayer(layer);
        expect(out.textAdjust).toBe("auto_width");
    });

    it("never touches paragraph align or vertical align", () => {
        const layer = makeText({ align: "center", verticalAlign: "middle", textAdjust: "auto_width" });
        const out = normalizeTextLayer(layer, ["textAdjust"]);
        expect(out.align).toBe("center");
        expect(out.verticalAlign).toBe("middle");
    });
});
