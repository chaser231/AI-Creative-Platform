import { describe, expect, it } from "vitest";
import {
    autoLayoutAxesToScreenAlign,
    screenAlignToAutoLayoutAxes,
    swapAlignmentsForDirectionChange,
} from "@/utils/autoLayoutAlignGrid";

describe("autoLayoutAlignGrid", () => {
    it("maps horizontal screen positions to primary/counter axes", () => {
        expect(screenAlignToAutoLayoutAxes("horizontal", "left", "top")).toEqual({
            primaryAxisAlignItems: "flex-start",
            counterAxisAlignItems: "flex-start",
        });
        expect(screenAlignToAutoLayoutAxes("horizontal", "left", "bottom")).toEqual({
            primaryAxisAlignItems: "flex-start",
            counterAxisAlignItems: "flex-end",
        });
        expect(screenAlignToAutoLayoutAxes("horizontal", "right", "bottom")).toEqual({
            primaryAxisAlignItems: "flex-end",
            counterAxisAlignItems: "flex-end",
        });
    });

    it("maps vertical screen positions with swapped axes", () => {
        expect(screenAlignToAutoLayoutAxes("vertical", "left", "bottom")).toEqual({
            primaryAxisAlignItems: "flex-end",
            counterAxisAlignItems: "flex-start",
        });
        expect(screenAlignToAutoLayoutAxes("vertical", "right", "top")).toEqual({
            primaryAxisAlignItems: "flex-start",
            counterAxisAlignItems: "flex-end",
        });
    });

    it("round-trips screen alignment for horizontal layout", () => {
        const cases = [
            ["left", "top"],
            ["center", "center"],
            ["right", "bottom"],
        ] as const;

        for (const [h, v] of cases) {
            const axes = screenAlignToAutoLayoutAxes("horizontal", h, v);
            expect(autoLayoutAxesToScreenAlign("horizontal", axes.primaryAxisAlignItems, axes.counterAxisAlignItems)).toEqual({ h, v });
        }
    });

    it("round-trips screen alignment for vertical layout", () => {
        const cases = [
            ["left", "top"],
            ["center", "center"],
            ["right", "bottom"],
        ] as const;

        for (const [h, v] of cases) {
            const axes = screenAlignToAutoLayoutAxes("vertical", h, v);
            expect(autoLayoutAxesToScreenAlign("vertical", axes.primaryAxisAlignItems, axes.counterAxisAlignItems)).toEqual({ h, v });
        }
    });

    it("swaps alignments when direction changes to preserve visual position", () => {
        expect(swapAlignmentsForDirectionChange("flex-start", "flex-end")).toEqual({
            primaryAxisAlignItems: "flex-end",
            counterAxisAlignItems: "flex-start",
        });
    });
});
