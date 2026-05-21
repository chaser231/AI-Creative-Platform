/**
 * Shared helpers for exiting exclusive canvas edit modes (inpaint / expand).
 */

import type { CanvasStore } from "./types";
import { DEFAULT_EXPAND_PADDING } from "./types";

/** Primary selected layer id, or null when nothing is selected. */
export function getPrimarySelectedLayerId(selectedLayerIds: string[]): string | null {
    return selectedLayerIds[0] ?? null;
}

/**
 * When selection changes, exit expand/inpaint if the new primary selection
 * no longer matches the frozen target layer.
 */
export function getEditModeExitPatchesForSelection(
    state: Pick<
        CanvasStore,
        | "selectedLayerIds"
        | "expandMode"
        | "expandTargetLayerId"
        | "inpaintMode"
        | "inpaintTargetLayerId"
    >,
    nextPrimaryId: string | null,
): Partial<CanvasStore> {
    const patches: Partial<CanvasStore> = {};

    if (
        state.expandMode
        && state.expandTargetLayerId
        && nextPrimaryId !== state.expandTargetLayerId
    ) {
        patches.expandMode = false;
        patches.expandTargetLayerId = null;
        patches.expandPadding = { ...DEFAULT_EXPAND_PADDING };
    }

    if (
        state.inpaintMode
        && state.inpaintTargetLayerId
        && nextPrimaryId !== state.inpaintTargetLayerId
    ) {
        patches.inpaintMode = false;
        patches.inpaintTargetLayerId = null;
    }

    return patches;
}

/** Full reset of both exclusive edit modes (store flags only — mask lives in context). */
export function getFullEditModeExitPatches(): Partial<CanvasStore> {
    return {
        expandMode: false,
        expandTargetLayerId: null,
        expandPadding: { ...DEFAULT_EXPAND_PADDING },
        inpaintMode: false,
        inpaintTargetLayerId: null,
    };
}

/** Exit edit modes when a target layer is removed from the canvas. */
export function getEditModeExitPatchesForRemovedLayers(
    state: Pick<
        CanvasStore,
        "expandMode" | "expandTargetLayerId" | "inpaintMode" | "inpaintTargetLayerId"
    >,
    removedIds: Set<string>,
): Partial<CanvasStore> {
    const patches: Partial<CanvasStore> = {};
    if (state.expandMode && state.expandTargetLayerId && removedIds.has(state.expandTargetLayerId)) {
        patches.expandMode = false;
        patches.expandTargetLayerId = null;
        patches.expandPadding = { ...DEFAULT_EXPAND_PADDING };
    }
    if (state.inpaintMode && state.inpaintTargetLayerId && removedIds.has(state.inpaintTargetLayerId)) {
        patches.inpaintMode = false;
        patches.inpaintTargetLayerId = null;
    }
    return patches;
}
