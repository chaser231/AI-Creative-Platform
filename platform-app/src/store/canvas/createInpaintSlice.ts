/**
 * Inpaint Slice — exclusive canvas mode for AI mask-based editing.
 *
 * Mirrors the Generative Expand slice in shape: turning the mode on selects
 * a single image layer as the inpaint target and hides competing UI overlays
 * (Selection Transformer, ExpandOverlay, gradient handles).
 *
 * Stroke buffers DO NOT live here — see useInpaintMask + InpaintContext.
 * Zustand notifies on every state change, which is fine for a one-shot
 * `inpaintMode` flag but catastrophic at 60+ Hz mousemove points.
 *
 * Activation rules (mirrors setExpandMode):
 *   • The current selection must be a single image layer. Anything else
 *     keeps the mode off.
 *   • Toggling to `false` clears the target id so we never leak a stale
 *     reference into the overlay.
 */

import type { StateCreator } from "zustand";
import type { CanvasStore } from "./types";

export type InpaintSlice = Pick<CanvasStore,
    | "inpaintMode"
    | "inpaintTargetLayerId"
    | "setInpaintMode"
    | "resetInpaintMode"
>;

export const createInpaintSlice: StateCreator<CanvasStore, [], [], InpaintSlice> = (set, get) => ({
    inpaintMode: false,
    inpaintTargetLayerId: null,

    setInpaintMode: (active) => {
        if (active) {
            const { selectedLayerIds, layers } = get();
            const targetId = selectedLayerIds[0] || null;
            const targetLayer = targetId ? layers.find((l) => l.id === targetId) : null;
            if (!targetLayer || targetLayer.type !== "image") {
                set({ inpaintMode: false, inpaintTargetLayerId: null });
                return;
            }
            // Turning on inpaint should switch off the other exclusive modes
            // so the canvas surface owns exactly one overlay at a time.
            set({
                inpaintMode: true,
                inpaintTargetLayerId: targetId,
                expandMode: false,
                expandTargetLayerId: null,
                activeGradientEditorTarget: null,
            });
        } else {
            set({ inpaintMode: false, inpaintTargetLayerId: null });
        }
    },

    resetInpaintMode: () => {
        set({ inpaintMode: false, inpaintTargetLayerId: null });
    },
});
