import { describe, expect, it } from "vitest";
import {
    getEditModeExitPatchesForSelection,
    getEditModeExitPatchesForRemovedLayers,
    getFullEditModeExitPatches,
} from "@/store/canvas/editModeHelpers";

describe("editModeHelpers", () => {
    it("exits expand when selection changes away from expand target", () => {
        const patches = getEditModeExitPatchesForSelection(
            {
                selectedLayerIds: ["layer-b"],
                expandMode: true,
                expandTargetLayerId: "layer-a",
                inpaintMode: false,
                inpaintTargetLayerId: null,
            },
            "layer-b",
        );
        expect(patches.expandMode).toBe(false);
        expect(patches.expandTargetLayerId).toBeNull();
    });

    it("keeps expand when selection still matches target", () => {
        const patches = getEditModeExitPatchesForSelection(
            {
                selectedLayerIds: ["layer-a"],
                expandMode: true,
                expandTargetLayerId: "layer-a",
                inpaintMode: false,
                inpaintTargetLayerId: null,
            },
            "layer-a",
        );
        expect(patches.expandMode).toBeUndefined();
    });

    it("exits inpaint when selection is cleared", () => {
        const patches = getEditModeExitPatchesForSelection(
            {
                selectedLayerIds: [],
                expandMode: false,
                expandTargetLayerId: null,
                inpaintMode: true,
                inpaintTargetLayerId: "layer-a",
            },
            null,
        );
        expect(patches.inpaintMode).toBe(false);
        expect(patches.inpaintTargetLayerId).toBeNull();
    });

    it("exits modes when target layer is removed", () => {
        const patches = getEditModeExitPatchesForRemovedLayers(
            {
                expandMode: true,
                expandTargetLayerId: "layer-a",
                inpaintMode: true,
                inpaintTargetLayerId: "layer-b",
            },
            new Set(["layer-a"]),
        );
        expect(patches.expandMode).toBe(false);
        expect(patches.inpaintMode).toBeUndefined();
    });

    it("getFullEditModeExitPatches resets both modes", () => {
        const patches = getFullEditModeExitPatches();
        expect(patches.expandMode).toBe(false);
        expect(patches.inpaintMode).toBe(false);
    });
});
