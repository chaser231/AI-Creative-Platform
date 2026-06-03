import { describe, expect, it } from "vitest";
import {
    STUDIO_LEFT_TOP_DEFAULT_RATIO,
    clampStudioLeftTopRatio,
    studioLeftTopRatioFromPointer,
} from "./studioPanelLayout";

describe("studioPanelLayout", () => {
    it("keeps the default ratio for invalid values", () => {
        expect(clampStudioLeftTopRatio(Number.NaN, 800)).toBe(STUDIO_LEFT_TOP_DEFAULT_RATIO);
        expect(clampStudioLeftTopRatio(0.4, 0)).toBe(STUDIO_LEFT_TOP_DEFAULT_RATIO);
    });

    it("clamps the top panel to its minimum height", () => {
        expect(clampStudioLeftTopRatio(0.05, 800)).toBe(0.2);
    });

    it("clamps the layers panel to its minimum height", () => {
        expect(clampStudioLeftTopRatio(0.95, 800)).toBe(0.725);
    });

    it("converts pointer position to a clamped ratio", () => {
        expect(studioLeftTopRatioFromPointer(300, 100, 800)).toBe(0.25);
        expect(studioLeftTopRatioFromPointer(50, 100, 800)).toBe(0.2);
    });
});
