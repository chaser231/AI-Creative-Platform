import type { StateCreator } from "zustand";
import type { RunStateSlice, WorkflowStore } from "./types";

/**
 * Phase 4: pure state slice. Side effects (the executor + tRPC calls) live
 * in `useWorkflowRun` so they can grab deps from React context. This slice
 * just exposes setters that the hook drives via callbacks.
 */
export const createRunStateSlice: StateCreator<WorkflowStore, [], [], RunStateSlice> = (
    set,
) => ({
    runState: {},
    runResults: {},
    runError: null,
    isRunning: false,

    setNodeRunStatus: (id, status) =>
        set((state) => ({ runState: { ...state.runState, [id]: status } })),

    setNodeResult: (id, result) =>
        set((state) => ({ runResults: { ...state.runResults, [id]: result } })),

    setRunError: (runError) => set({ runError }),

    setIsRunning: (isRunning) => set({ isRunning }),

    resetRunState: () =>
        set({ runState: {}, runResults: {}, runError: null, isRunning: false }),
});
