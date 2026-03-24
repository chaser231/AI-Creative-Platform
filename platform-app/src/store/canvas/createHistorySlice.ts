/**
 * History Slice — Undo/Redo + snapshot helper
 */

import type { StateCreator } from "zustand";
import type { CanvasStore, HistorySnapshot } from "./types";
import { MAX_HISTORY } from "./types";

export type HistorySlice = Pick<CanvasStore,
    | "history" | "historyIndex" | "future"
    | "undo" | "redo"
>;

export const createHistorySlice: StateCreator<CanvasStore, [], [], HistorySlice> = (set, get) => ({
    history: [],
    historyIndex: -1,
    future: [],

    undo: () => {
        const state = get();
        if (state.history.length === 0) return;
        const prev = state.history[state.history.length - 1];
        const currentSnapshot: HistorySnapshot = {
            layers: state.layers,
            masterComponents: state.masterComponents,
            componentInstances: state.componentInstances,
            selectedLayerIds: state.selectedLayerIds,
        };
        set({
            history: state.history.slice(0, -1),
            layers: prev.layers,
            masterComponents: prev.masterComponents,
            componentInstances: prev.componentInstances,
            selectedLayerIds: prev.selectedLayerIds,
            future: [currentSnapshot, ...state.future].slice(0, MAX_HISTORY),
        });
    },

    redo: () => {
        const state = get();
        if (state.future.length === 0) return;
        const next = state.future[0];
        const currentSnapshot: HistorySnapshot = {
            layers: state.layers,
            masterComponents: state.masterComponents,
            componentInstances: state.componentInstances,
            selectedLayerIds: state.selectedLayerIds,
        };
        set({
            future: state.future.slice(1),
            layers: next.layers,
            masterComponents: next.masterComponents,
            componentInstances: next.componentInstances,
            selectedLayerIds: next.selectedLayerIds,
            history: [...state.history, currentSnapshot].slice(-MAX_HISTORY),
        });
    },
});

/**
 * Helper: push a history snapshot before destructive operations.
 * Call this at the start of any action that modifies layers/masters/instances.
 */
export function pushSnapshot(set: (partial: Partial<CanvasStore>) => void, get: () => CanvasStore): void {
    const state = get();
    const snap: HistorySnapshot = {
        layers: state.layers,
        masterComponents: state.masterComponents,
        componentInstances: state.componentInstances,
        selectedLayerIds: state.selectedLayerIds,
    };
    set({ history: [...state.history, snap].slice(-MAX_HISTORY), future: [] });
}
