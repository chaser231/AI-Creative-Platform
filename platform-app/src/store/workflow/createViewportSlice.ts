import type { StateCreator } from "zustand";
import type { ViewportSlice, WorkflowStore } from "./types";

export const createViewportSlice: StateCreator<WorkflowStore, [], [], ViewportSlice> = (set) => ({
    viewport: { x: 0, y: 0, zoom: 1 },
    setViewport: (viewport) => set({ viewport }),
});
