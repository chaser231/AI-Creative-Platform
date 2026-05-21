/**
 * Edit Mode Slice — centralized exit for inpaint + expand canvas modes.
 */

import type { StateCreator } from "zustand";
import type { CanvasStore } from "./types";
import { getFullEditModeExitPatches } from "./editModeHelpers";

export type EditModeSlice = Pick<CanvasStore, "exitCanvasEditModes">;

export const createEditModeSlice: StateCreator<CanvasStore, [], [], EditModeSlice> = (set) => ({
    exitCanvasEditModes: () => {
        set(getFullEditModeExitPatches());
    },
});
