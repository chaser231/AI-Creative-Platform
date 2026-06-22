/**
 * Layout Grid Slice — per-format safe-zone grids (Figma-like).
 *
 * Grids are stored directly on the active `ResizeFormat.layoutGrids`, so they
 * are per-format, travel with the format (and templates), and round-trip
 * through persistence and history without any working/snapshot mirroring.
 */

import type { StateCreator } from "zustand";
import type { CanvasStore } from "./types";
import type { LayoutGrid, LayoutGridType } from "@/types";
import { createDefaultLayoutGrid } from "@/types";
import { v4 as uuid } from "uuid";
import { pushSnapshot } from "./createHistorySlice";

export type LayoutGridSlice = Pick<CanvasStore,
    | "layoutGridsVisible"
    | "addLayoutGrid" | "updateLayoutGrid" | "removeLayoutGrid" | "reorderLayoutGrid"
    | "toggleLayoutGridsVisible" | "setLayoutGridsVisible"
>;

/** Stable empty reference so the selector doesn't churn `useShallow` consumers. */
const EMPTY_GRIDS: LayoutGrid[] = [];

/** Read the active format's layout grids (empty array if none). */
export function selectActiveLayoutGrids(state: CanvasStore): LayoutGrid[] {
    return state.resizes.find((r) => r.id === state.activeResizeId)?.layoutGrids ?? EMPTY_GRIDS;
}

/** Apply an updater to the active format's grids with an undo snapshot. */
function writeActiveGrids(
    set: (partial: Partial<CanvasStore>) => void,
    get: () => CanvasStore,
    updater: (grids: LayoutGrid[]) => LayoutGrid[],
): void {
    pushSnapshot(set, get);
    const state = get();
    set({
        resizes: state.resizes.map((r) =>
            r.id === state.activeResizeId
                ? { ...r, layoutGrids: updater(r.layoutGrids ?? []) }
                : r,
        ),
    });
}

export const createLayoutGridSlice: StateCreator<CanvasStore, [], [], LayoutGridSlice> = (set, get) => ({
    layoutGridsVisible: true,

    addLayoutGrid: (type: LayoutGridType) => {
        const id = uuid();
        writeActiveGrids(set, get, (grids) => [...grids, createDefaultLayoutGrid(id, type)]);
        return id;
    },

    updateLayoutGrid: (id, patch) => {
        writeActiveGrids(set, get, (grids) =>
            grids.map((g) => {
                if (g.id !== id) return g;
                // Switching type rebuilds from per-type defaults (preserving the
                // shared id/visibility/appearance) so stale type-specific fields
                // (e.g. columns' `count`/`align`) don't linger on the new type.
                if (patch.type && patch.type !== g.type) {
                    const base = createDefaultLayoutGrid(g.id, patch.type);
                    return { ...base, visible: g.visible, color: g.color, opacity: g.opacity, ...patch };
                }
                return { ...g, ...patch };
            }),
        );
    },

    removeLayoutGrid: (id) => {
        writeActiveGrids(set, get, (grids) => grids.filter((g) => g.id !== id));
    },

    reorderLayoutGrid: (id, mode) => {
        writeActiveGrids(set, get, (grids) => {
            const index = grids.findIndex((g) => g.id === id);
            if (index === -1) return grids;
            const next = [...grids];
            const [item] = next.splice(index, 1);
            const target =
                mode === "up" ? Math.max(0, index - 1)
                    : mode === "down" ? Math.min(next.length, index + 1)
                        : mode === "top" ? 0
                            : next.length;
            next.splice(target, 0, item);
            return next;
        });
    },

    toggleLayoutGridsVisible: () => {
        set({ layoutGridsVisible: !get().layoutGridsVisible });
    },

    setLayoutGridsVisible: (value: boolean) => {
        set({ layoutGridsVisible: value });
    },
});
