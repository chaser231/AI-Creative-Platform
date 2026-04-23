import type { StateCreator } from "zustand";
import type { RunStateSlice, WorkflowStore } from "./types";

/**
 * Phase 2 stub: UI references `runState[nodeId]` for future styling hooks,
 * but the runtime that writes into it lives in Phase 4. Keeping the slice
 * here now means node components can render status badges from day one
 * without a refactor when executor lands.
 */
export const createRunStateSlice: StateCreator<WorkflowStore, [], [], RunStateSlice> = (set) => ({
    runState: {},
    setNodeRunStatus: (id, status) =>
        set((state) => ({ runState: { ...state.runState, [id]: status } })),
    resetRunState: () => set({ runState: {} }),
});
