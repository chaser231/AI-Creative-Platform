import { describe, expect, it } from "vitest";
import { looksLikeSvg, importedVectorToOverrides, parseInlineSvgViewBox, __test__ } from "../svgImport";
import { pathDataToSubpaths, parseSvgPathToAbsSubpaths } from "../vectorGeometry";

// Note: `parseSvgToVector` depends on `DOMParser`, which isn't available in the
// repo's `node` vitest environment, so the DOM path is exercised at runtime in
// the browser. Here we cover the pure helpers and the path→geometry pipeline
// that backs it.

describe("svgImport", () => {
    it("parses inline SVG viewBox", () => {
        expect(parseInlineSvgViewBox('<svg viewBox="10 20 80 60"></svg>')).toEqual({
            x: 10,
            y: 20,
            width: 80,
            height: 60,
        });
        expect(parseInlineSvgViewBox("<svg></svg>")).toBeNull();
    });

    it("detects svg markup", () => {
        expect(looksLikeSvg("<svg viewBox='0 0 10 10'></svg>")).toBe(true);
        expect(looksLikeSvg("<svg>\n</svg>")).toBe(true);
        expect(looksLikeSvg("hello world")).toBe(false);
        expect(looksLikeSvg("<svganimate>")).toBe(false);
    });

    it("scales an imported vector into layer overrides under maxSize", () => {
        const { subpaths } = pathDataToSubpaths("M 0 0 L 800 0 L 800 400 Z");
        const overrides = importedVectorToOverrides(
            { subpaths, width: 800, height: 400, fill: "#abcdef", fillRule: "nonzero" },
            { x: 10, y: 20, maxSize: 400, name: "Logo" },
        );
        expect(overrides.name).toBe("Logo");
        expect(overrides.x).toBe(10);
        expect(overrides.y).toBe(20);
        // 800x400 scaled to fit 400 → halved.
        expect(overrides.width).toBe(400);
        expect(overrides.height).toBe(200);
        expect(overrides.fill).toBe("#abcdef");
        expect(overrides.fillEnabled).toBe(true);
        expect(overrides.strokeEnabled).toBe(false);
    });

    it("enables stroke when the imported vector carries one", () => {
        const { subpaths } = pathDataToSubpaths("M 0 0 L 10 0");
        const overrides = importedVectorToOverrides(
            { subpaths, width: 10, height: 1, fill: "none", fillRule: "nonzero", stroke: "#111", strokeWidth: 2 },
            { x: 0, y: 0 },
        );
        expect(overrides.strokeEnabled).toBe(true);
        expect(overrides.stroke).toBe("#111");
        expect(overrides.strokeWidth).toBe(2);
    });

    it("parses transform attributes into matrices", () => {
        const { parseTransform } = __test__;
        expect(parseTransform("translate(10 20)")).toEqual([1, 0, 0, 1, 10, 20]);
        expect(parseTransform("scale(2 3)")).toEqual([2, 0, 0, 3, 0, 0]);
        expect(parseTransform("matrix(1 2 3 4 5 6)")).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("composes multiple transforms left-to-right (outermost first)", () => {
        const { parseTransform, applyMatrix } = __test__;
        // translate then scale: (1,1) -> scale 2 = (2,2) -> translate(+10,+10) = (12,12)
        const m = parseTransform("translate(10 10) scale(2)");
        expect(applyMatrix(m, 1, 1)).toEqual({ x: 12, y: 12 });
    });

    it("applies a 90deg rotation correctly", () => {
        const { parseTransform, applyMatrix } = __test__;
        const m = parseTransform("rotate(90)");
        const p = applyMatrix(m, 1, 0);
        expect(p.x).toBeCloseTo(0, 6);
        expect(p.y).toBeCloseTo(1, 6);
    });

    it("translates geometry into the right place", () => {
        const { parseTransform, applyMatrix } = __test__;
        const abs = parseSvgPathToAbsSubpaths("M 0 0 L 10 0");
        const m = parseTransform("translate(100 50)");
        const moved = applyMatrix(m, abs[0].points[1].x, abs[0].points[1].y);
        expect(moved).toEqual({ x: 110, y: 50 });
    });

});
