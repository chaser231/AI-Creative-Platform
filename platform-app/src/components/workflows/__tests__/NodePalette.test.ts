import { describe, expect, it } from "vitest";
import {
    getNodePaletteGroups,
    getWorkflowPresetPaletteItems,
    shouldClosePaletteForPointerTarget,
} from "../NodePalette";

describe("getNodePaletteGroups", () => {
    it("returns all registry groups when no filter or query is active", () => {
        const groups = getNodePaletteGroups({ activeFilter: "all", query: "" });

        expect(groups.map((group) => group.category)).toEqual([
            "input",
            "ai",
            "transform",
            "output",
        ]);
        expect(groups.flatMap((group) => group.items).map((item) => item.type)).toContain(
            "imageInput",
        );
    });

    it("limits results to the active rail category", () => {
        const groups = getNodePaletteGroups({ activeFilter: "output", query: "" });

        expect(groups.map((group) => group.category)).toEqual(["output"]);
        expect(groups[0]?.items.map((item) => item.type)).toEqual([
            "preview",
            "assetOutput",
        ]);
    });

    it("searches display names and descriptions inside the active filter", () => {
        const groups = getNodePaletteGroups({
            activeFilter: "transform",
            query: "блюр",
        });

        expect(groups).toHaveLength(1);
        expect(groups[0]?.category).toBe("transform");
        expect(groups[0]?.items.map((item) => item.type)).toEqual(["blur"]);
    });
});

describe("shouldClosePaletteForPointerTarget", () => {
    it("keeps the flyout open for pointer targets inside the palette root", () => {
        const insideTarget = {};
        const root = { contains: (target: unknown) => target === insideTarget };

        expect(shouldClosePaletteForPointerTarget(root, insideTarget)).toBe(false);
    });

    it("closes the flyout for pointer targets outside the palette root", () => {
        const root = { contains: () => false };

        expect(shouldClosePaletteForPointerTarget(root, {})).toBe(true);
    });

    it("does not close when the root or target is unavailable", () => {
        const root = { contains: () => false };

        expect(shouldClosePaletteForPointerTarget(null, {})).toBe(false);
        expect(shouldClosePaletteForPointerTarget(root, null)).toBe(false);
    });
});

describe("getWorkflowPresetPaletteItems", () => {
    it("returns create links for workflow preset entrypoints", () => {
        expect(getWorkflowPresetPaletteItems().map((item) => item.href)).toEqual([
            "/workflows/new?preset=product-reflection-pipeline",
            "/workflows/new?preset=remove-background-preview",
            "/workflows/new?preset=asset-transform-save",
        ]);
    });
});
