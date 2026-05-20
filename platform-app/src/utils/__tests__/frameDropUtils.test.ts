import { describe, expect, it } from "vitest";
import { canLayerFitInFrame } from "@/utils/frameDropUtils";

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
