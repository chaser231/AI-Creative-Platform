/**
 * Canvas Store — Barrel
 *
 * Composes all domain slices into a single Zustand store.
 * External consumers continue importing `useCanvasStore` from this file.
 *
 * Slices:
 *  - Viewport   → zoom, stage, artboard, snap, mode, text editing
 *  - History    → undo/redo
 *  - Layer      → CRUD, frame ops, ordering, visibility/lock
 *  - Selection  → select/toggle/align/batch
 *  - Component  → master/instance cascading
 *  - Resize     → format management, syncLayersToResize
 *  - Template   → loadTemplatePack, applySmartResize, resetCanvas
 */

import { create } from "zustand";
import type { CanvasStore } from "./canvas/types";
import { createViewportSlice } from "./canvas/createViewportSlice";
import { createHistorySlice } from "./canvas/createHistorySlice";
import { createLayerSlice } from "./canvas/createLayerSlice";
import { createSelectionSlice } from "./canvas/createSelectionSlice";
import { createComponentSlice } from "./canvas/createComponentSlice";
import { createResizeSlice } from "./canvas/createResizeSlice";
import { createTemplateSlice } from "./canvas/createTemplateSlice";
import { createPaletteSlice } from "./canvas/createPaletteSlice";

// ─── Re-exports for backwards compatibility ─────────────
export { computeConstrainedPosition } from "./canvas/helpers";
export type { ArtboardProps, FrameResizeDelta, CanvasStore } from "./canvas/types";

// ─── Composed Store ─────────────────────────────────────
export const useCanvasStore = create<CanvasStore>((...args) => ({
    ...createViewportSlice(...args),
    ...createHistorySlice(...args),
    ...createLayerSlice(...args),
    ...createSelectionSlice(...args),
    ...createComponentSlice(...args),
    ...createResizeSlice(...args),
    ...createTemplateSlice(...args),
    ...createPaletteSlice(...args),
}));
