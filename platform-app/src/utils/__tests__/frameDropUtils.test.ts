import { describe, expect, it } from "vitest";
import { canLayerFitInFrame, collectAncestorFrameIds } from "@/utils/frameDropUtils";

describe("canLayerFitInFrame", () => {
    it("allows layer with equal dimensions", () => {
        expect(canLayerFitInFrame({ width: 100, height: 80 }, { width: 100, height: 80 })).toBe(true);
    });

    it("allows layer smaller than frame", () => {
        expect(canLayerFitInFrame({ width: 50, height: 40 }, { width: 100, height: 80 })).toBe(true);
    });

    it("rejects layer wider than frame", () => {
        expect(canLayerFitInFrame({ width: 101, height: 80 }, { width: 100, height: 80 })).toBe(false);
    });

    it("rejects layer taller than frame", () => {
        expect(canLayerFitInFrame({ width: 100, height: 81 }, { width: 100, height: 80 })).toBe(false);
    });
});

describe("collectAncestorFrameIds", () => {
    it("returns empty set for a top-level layer", () => {
        const layers = [
            { id: "rect-1", type: "rectangle" as const },
            { id: "frame-1", type: "frame" as const, childIds: [] },
        ];
        expect(collectAncestorFrameIds("rect-1", layers)).toEqual(new Set());
    });

    it("returns the immediate parent frame for a direct child", () => {
        const layers = [
            { id: "rect-1", type: "rectangle" as const },
            { id: "frame-1", type: "frame" as const, childIds: ["rect-1"] },
        ];
        expect(collectAncestorFrameIds("rect-1", layers)).toEqual(new Set(["frame-1"]));
    });

    it("walks all the way up nested frames", () => {
        const layers = [
            { id: "leaf", type: "rectangle" as const },
            { id: "inner", type: "frame" as const, childIds: ["leaf"] },
            { id: "outer", type: "frame" as const, childIds: ["inner"] },
        ];
        expect(collectAncestorFrameIds("leaf", layers)).toEqual(new Set(["inner", "outer"]));
    });

    it("does not include sibling frames or unrelated frames", () => {
        const layers = [
            { id: "leaf", type: "rectangle" as const },
            { id: "frame-a", type: "frame" as const, childIds: ["leaf"] },
            { id: "frame-b", type: "frame" as const, childIds: [] },
        ];
        expect(collectAncestorFrameIds("leaf", layers)).toEqual(new Set(["frame-a"]));
    });

    it("does not loop forever on cyclic data", () => {
        // Defensive: shouldn't happen in practice, but guards against hangs.
        const layers = [
            { id: "frame-a", type: "frame" as const, childIds: ["frame-b"] },
            { id: "frame-b", type: "frame" as const, childIds: ["frame-a"] },
        ];
        const result = collectAncestorFrameIds("frame-a", layers);
        expect(result.has("frame-a") || result.has("frame-b")).toBe(true);
        // ensure the function returns at all (no infinite loop)
        expect(result.size).toBeLessThanOrEqual(layers.length);
    });
});
