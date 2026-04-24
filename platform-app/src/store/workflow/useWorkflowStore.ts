/**
 * useWorkflowStore — composed Zustand store for the node editor.
 *
 * Mirrors the `canvasStore` pattern: slices are combined in a single
 * `create()` so consumers keep importing one hook regardless of how the
 * state is internally split.
 */

import { create } from "zustand";
import type { WorkflowStore } from "./types";
import { createGraphSlice } from "./createGraphSlice";
import { createViewportSlice } from "./createViewportSlice";
import { createRunStateSlice } from "./createRunStateSlice";

export const useWorkflowStore = create<WorkflowStore>((...args) => ({
    ...createGraphSlice(...args),
    ...createViewportSlice(...args),
    ...createRunStateSlice(...args),
}));

export type { WorkflowStore } from "./types";
