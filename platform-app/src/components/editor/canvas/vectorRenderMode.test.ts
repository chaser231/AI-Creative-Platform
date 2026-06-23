import { describe, expect, it } from "vitest";
import type { VectorAnchor, VectorSubpath } from "@/types";
import { resolveReadOnlyVectorRenderMode } from "./vectorRenderMode";

const anchor = (x: number, y: number): VectorAnchor => ({ x, y, type: "corner" });

const renderableSubpath: VectorSubpath = {
    points: [anchor(0, 0), anchor(1, 0), anchor(1, 1)],
    closed: true,
};

const emptySubpath: VectorSubpath = { points: [], closed: false };

describe("resolveReadOnlyVectorRenderMode", () => {
    it("prefers inlineSvg even when subpaths are empty (complex boolean/even-odd Figma vector)", () => {
        // This is the Issue 2 regression: inactive overview tiles + PreviewCanvas
        // previously ignored inlineSvg and drew an empty <Path>.
        expect(
            resolveReadOnlyVectorRenderMode({
                inlineSvg: "<svg><path d='M0 0 Z'/></svg>",
                subpaths: [emptySubpath],
                rawSvgPath: undefined,
            }),
        ).toEqual({ kind: "inline" });
    });

    it("prefers inlineSvg over both subpaths and rawSvgPath", () => {
        expect(
            resolveReadOnlyVectorRenderMode({
                inlineSvg: "<svg/>",
                subpaths: [renderableSubpath],
                rawSvgPath: "M0 0 L1 1",
            }),
        ).toEqual({ kind: "inline" });
    });

    it("uses subpaths when there is renderable geometry and no inlineSvg", () => {
        expect(
            resolveReadOnlyVectorRenderMode({
                inlineSvg: undefined,
                subpaths: [renderableSubpath],
                rawSvgPath: "M0 0 L1 1",
            }),
        ).toEqual({ kind: "path", source: "subpaths" });
    });

    it("falls back to raw path when subpaths are empty and there is no inlineSvg", () => {
        expect(
            resolveReadOnlyVectorRenderMode({
                inlineSvg: undefined,
                subpaths: [emptySubpath],
                rawSvgPath: "M0 0 L1 1",
            }),
        ).toEqual({ kind: "path", source: "raw" });
    });

    it("treats an empty-string inlineSvg as absent", () => {
        expect(
            resolveReadOnlyVectorRenderMode({
                inlineSvg: "",
                subpaths: [renderableSubpath],
                rawSvgPath: undefined,
            }),
        ).toEqual({ kind: "path", source: "subpaths" });
    });
});
