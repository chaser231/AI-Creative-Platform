import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TextLayer } from "@/types";
import { getTextRenderOffsetY, getTextTrimMetrics, isTextTrimActive, measureTextLayer } from "@/utils/layoutEngine";

// Asymmetric font metrics returned for every sample so we can assert the trim
// formula exactly. fontBounding A/D = 28/8, ink ascent/descent = 24/6.
const FAKE = {
    actualBoundingBoxAscent: 24,
    actualBoundingBoxDescent: 6,
    fontBoundingBoxAscent: 28,
    fontBoundingBoxDescent: 8,
};

function makeText(overrides: Partial<TextLayer> = {}): TextLayer {
    return {
        id: "t",
        type: "text",
        name: "t",
        x: 0,
        y: 0,
        width: 200,
        height: 40,
        rotation: 0,
        visible: true,
        locked: false,
        text: "Hello",
        fontSize: 100,
        fontFamily: "Inter",
        fontWeight: "400",
        fill: "#000000",
        align: "left",
        letterSpacing: 0,
        lineHeight: 2,
        textAdjust: "auto_width",
        ...overrides,
    } as TextLayer;
}

describe("unified text metrics (Phase 2.1)", () => {
    beforeAll(() => {
        const fakeContext = {
            font: "",
            fillStyle: "",
            textBaseline: "",
            clearRect: () => undefined,
            fillRect: () => undefined,
            getImageData: () => ({ data: new Uint8ClampedArray(400) }),
            save: () => undefined,
            restore: () => undefined,
            measureText: (value: string) => ({
                width: value.length <= 1 ? 10 : value.length * 6,
                ...FAKE,
            }),
            fillText: () => undefined,
            strokeText: () => undefined,
            setAttr: () => undefined,
        };
        vi.stubGlobal("window", globalThis);
        vi.stubGlobal("document", {
            createElement: (tagName: string) => tagName === "canvas"
                ? { style: {}, getContext: () => fakeContext }
                : {},
            fonts: { ready: Promise.resolve() },
        });
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    it("derives trim top/bottom from the Konva baseline formula", () => {
        // L = fontSize * lineHeight = 200; A=28, D=8, inkAscent=24, inkDescent=6
        // top    = L/2 + (A - D)/2 - inkAscent = 100 + 10 - 24 = 86
        // bottom = L/2 - (A - D)/2 - inkDescent = 100 - 10 - 6  = 84
        const { top, bottom, total } = getTextTrimMetrics(makeText({ verticalTrim: true }));
        expect(top).toBeCloseTo(86, 5);
        expect(bottom).toBeCloseTo(84, 5);
        expect(total).toBeCloseTo(170, 5);
    });

    it("baseline trim removes the descender (bottom cut to baseline)", () => {
        // bottom = L/2 - (A - D)/2 - 0 = 90
        const baseline = getTextTrimMetrics(makeText({ baselineTrim: true }));
        expect(baseline.bottom).toBeCloseTo(90, 5);
        const vertical = getTextTrimMetrics(makeText({ verticalTrim: true }));
        expect(baseline.bottom).toBeGreaterThan(vertical.bottom);
    });

    it("trimmed container height equals raw height minus trim total (one engine)", () => {
        const raw = measureTextLayer(makeText({ verticalTrim: false }));
        const trimmed = measureTextLayer(makeText({ verticalTrim: true }));
        const { total } = getTextTrimMetrics(makeText({ verticalTrim: true }));
        expect(raw.height - trimmed.height).toBeCloseTo(total, 5);
    });

    it("multi-word family names are handled identically (font string is quoted)", () => {
        // Regression: an unquoted `400 100px YS Display` is invalid CSS shorthand;
        // the unified provider quotes multi-word families so metrics resolve the
        // same as a single-word family instead of silently falling back.
        const single = getTextTrimMetrics(makeText({ verticalTrim: true, fontFamily: "Inter" }));
        const multi = getTextTrimMetrics(makeText({ verticalTrim: true, fontFamily: "YS Display" }));
        expect(multi.top).toBeCloseTo(single.top, 5);
        expect(multi.bottom).toBeCloseTo(single.bottom, 5);
    });
});

describe("line-height <-> container height contract (Phase 2.2)", () => {
    beforeAll(() => {
        const fakeContext = {
            font: "",
            fillStyle: "",
            textBaseline: "",
            clearRect: () => undefined,
            fillRect: () => undefined,
            getImageData: () => ({ data: new Uint8ClampedArray(400) }),
            save: () => undefined,
            restore: () => undefined,
            measureText: (value: string) => ({
                width: value.length <= 1 ? 10 : value.length * 6,
                ...FAKE,
            }),
            fillText: () => undefined,
            strokeText: () => undefined,
            setAttr: () => undefined,
        };
        vi.stubGlobal("window", globalThis);
        vi.stubGlobal("document", {
            createElement: (tagName: string) => tagName === "canvas"
                ? { style: {}, getContext: () => fakeContext }
                : {},
            fonts: { ready: Promise.resolve() },
        });
    });
    afterAll(() => vi.unstubAllGlobals());

    it("trim OFF: container height grows with line-height", () => {
        const tight = measureTextLayer(makeText({ verticalTrim: false, lineHeight: 1.2 }));
        const loose = measureTextLayer(makeText({ verticalTrim: false, lineHeight: 2 }));
        expect(loose.height).toBeGreaterThan(tight.height);
    });

    it("trim ON, single line: height is invariant to line-height while top grows (glyph stays hugged)", () => {
        const tight = makeText({ verticalTrim: true, lineHeight: 1.2 });
        const loose = makeText({ verticalTrim: true, lineHeight: 2 });
        // Single trimmed line hugs the ink box (ascent + descent), independent of L.
        expect(measureTextLayer(tight).height).toBeCloseTo(measureTextLayer(loose).height, 5);
        // The render offset (top) grows with line-height so the glyph keeps hugging
        // the box top instead of drifting upward.
        expect(getTextTrimMetrics(loose).top).toBeGreaterThan(getTextTrimMetrics(tight).top);
    });

    it("trim ON, multi-line: container height grows with line-height (inner gaps)", () => {
        const tight = measureTextLayer(makeText({ verticalTrim: true, lineHeight: 1.2, text: "Hello\nWorld" }));
        const loose = measureTextLayer(makeText({ verticalTrim: true, lineHeight: 2, text: "Hello\nWorld" }));
        expect(loose.height).toBeGreaterThan(tight.height);
    });

    it("maxLines cap does not collapse the box at line-height < 1 (cap floored to ink)", () => {
        // Regression for the reported "thin strip" bug: a heading with
        // responsive.maxLines and line-height 1% used to clamp to ~0.5px.
        const collapsed = measureTextLayer(makeText({
            textAdjust: "auto_height",
            lineHeight: 0.01,
            responsive: { maxLines: 1 } as TextLayer["responsive"],
        }));
        // FAKE ink ascent+descent = 30; the box hugs that instead of collapsing.
        expect(collapsed.height).toBeGreaterThanOrEqual(30);
    });
});

describe("fixed mode = no resize (Phase 2.3)", () => {
    beforeAll(() => {
        const fakeContext = {
            font: "",
            fillStyle: "",
            textBaseline: "",
            clearRect: () => undefined,
            fillRect: () => undefined,
            getImageData: () => ({ data: new Uint8ClampedArray(400) }),
            save: () => undefined,
            restore: () => undefined,
            measureText: (value: string) => ({
                width: value.length <= 1 ? 10 : value.length * 6,
                ...FAKE,
            }),
            fillText: () => undefined,
            strokeText: () => undefined,
            setAttr: () => undefined,
        };
        vi.stubGlobal("window", globalThis);
        vi.stubGlobal("document", {
            createElement: (tagName: string) => tagName === "canvas"
                ? { style: {}, getContext: () => fakeContext }
                : {},
            fonts: { ready: Promise.resolve() },
        });
    });
    afterAll(() => vi.unstubAllGlobals());

    const fixed = (overrides: Partial<TextLayer> = {}) =>
        makeText({ textAdjust: "fixed", width: 200, height: 80, ...overrides });

    it("keeps stored width/height regardless of line-height", () => {
        expect(measureTextLayer(fixed({ lineHeight: 1 }))).toEqual({ width: 200, height: 80 });
        expect(measureTextLayer(fixed({ lineHeight: 3 }))).toEqual({ width: 200, height: 80 });
    });

    it("box is invariant to verticalAlign (alignment only shifts glyphs in Konva render)", () => {
        const top = measureTextLayer(fixed({ verticalAlign: "top" }));
        const middle = measureTextLayer(fixed({ verticalAlign: "middle" }));
        const bottom = measureTextLayer(fixed({ verticalAlign: "bottom" }));
        expect(top).toEqual(middle);
        expect(middle).toEqual(bottom);
    });

    it("never activates trim, so the renderer applies offsetY = 0 (no upward drift)", () => {
        expect(isTextTrimActive(fixed({ verticalTrim: true }))).toBe(false);
        expect(isTextTrimActive(fixed({ baselineTrim: true }))).toBe(false);
    });
});

describe("canonical render offset / no glyph drift (Phase 4)", () => {
    beforeAll(() => {
        const fakeContext = {
            font: "",
            fillStyle: "",
            textBaseline: "",
            clearRect: () => undefined,
            fillRect: () => undefined,
            getImageData: () => ({ data: new Uint8ClampedArray(400) }),
            save: () => undefined,
            restore: () => undefined,
            measureText: (value: string) => ({
                width: value.length <= 1 ? 10 : value.length * 6,
                ...FAKE,
            }),
            fillText: () => undefined,
            strokeText: () => undefined,
            setAttr: () => undefined,
        };
        vi.stubGlobal("window", globalThis);
        vi.stubGlobal("document", {
            createElement: (tagName: string) => tagName === "canvas"
                ? { style: {}, getContext: () => fakeContext }
                : {},
            fonts: { ready: Promise.resolve() },
        });
    });
    afterAll(() => vi.unstubAllGlobals());

    // FAKE: A=28, D=8, inkAscent=24; fontSize=100.
    // offset(lineHeight) = L/2 + (A-D)/2 - inkAscent = 50*lineHeight + 10 - 24.
    const auto = (overrides: Partial<TextLayer> = {}) =>
        makeText({ textAdjust: "auto_height", verticalTrim: false, ...overrides });

    it("trim OFF + line-height >= 1: offset is 0 (existing render unchanged)", () => {
        expect(getTextRenderOffsetY(auto({ lineHeight: 1 }))).toBe(0);
        expect(getTextRenderOffsetY(auto({ lineHeight: 2 }))).toBe(0);
    });

    it("trim OFF + line-height < 1: applies the UNCLAMPED baseline offset (anti-drift)", () => {
        // lineHeight 0.01 → L=1 → 0.5 + 10 - 24 = -13.5 (negative: pushes glyphs
        // back DOWN so they hug the ink-floored box instead of drifting up).
        expect(getTextRenderOffsetY(auto({ lineHeight: 0.01 }))).toBeCloseTo(-13.5, 5);
    });

    it("tighter line-height never lets the first line drift up (offset decreases monotonically)", () => {
        const lh09 = getTextRenderOffsetY(auto({ lineHeight: 0.9 }));
        const lh05 = getTextRenderOffsetY(auto({ lineHeight: 0.5 }));
        const lh001 = getTextRenderOffsetY(auto({ lineHeight: 0.01 }));
        expect(lh09).toBeGreaterThan(lh05);
        expect(lh05).toBeGreaterThan(lh001);
    });

    it("the offset pins the first line's ink top to the floored single-line box top", () => {
        // Single line with a line box tighter than the ink (here L=10 < ink=30):
        // the box is floored to ink height (inkAscent + inkDescent). With Konva
        // placing the baseline at (A-D)/2 + L/2, applying this offset lands the
        // baseline at inkAscent — ink top at the box top (y=0) and ink bottom at
        // the box bottom.
        const layer = auto({ lineHeight: 0.1 });
        const L = layer.fontSize * (layer.lineHeight as number);
        const A = FAKE.fontBoundingBoxAscent;
        const D = FAKE.fontBoundingBoxDescent;
        const inkAscent = FAKE.actualBoundingBoxAscent;
        const offset = getTextRenderOffsetY(layer);
        const baselineInBox = (A - D) / 2 + L / 2 - offset;
        expect(baselineInBox).toBeCloseTo(inkAscent, 5); // ink top hugs box top
        const boxHeight = measureTextLayer(layer).height; // floored to ink
        expect(baselineInBox + FAKE.actualBoundingBoxDescent).toBeCloseTo(boxHeight, 5);
    });

    it("trim ON: offset equals the clamped trim top (existing trim path is preserved)", () => {
        const t = makeText({ verticalTrim: true, lineHeight: 2 });
        expect(getTextRenderOffsetY(t)).toBeCloseTo(getTextTrimMetrics(t).top, 5);
    });

    it("fixed mode keeps offset 0 for any line-height (verticalAlign owns placement)", () => {
        expect(getTextRenderOffsetY(makeText({ textAdjust: "fixed", lineHeight: 0.01 }))).toBe(0);
        expect(getTextRenderOffsetY(makeText({ textAdjust: "fixed", lineHeight: 2 }))).toBe(0);
    });

    it("multi-word family resolves identically (quoted font string, no fallback)", () => {
        const single = getTextRenderOffsetY(auto({ lineHeight: 0.5, fontFamily: "Inter" }));
        const multi = getTextRenderOffsetY(auto({ lineHeight: 0.5, fontFamily: "YS Display" }));
        expect(multi).toBeCloseTo(single, 5);
    });
});
