/**
 * Selection Slice — Layer selection, alignment, batch updates
 */

import type { StateCreator } from "zustand";
import type { CanvasStore, Layer, FrameLayer, HistorySnapshot } from "./types";
import { MAX_HISTORY } from "./types";
import { applyAllAutoLayouts } from "@/utils/layoutEngine";

export type SelectionSlice = Pick<CanvasStore,
    | "selectedLayerIds"
    | "selectLayer" | "toggleSelection" | "addToSelection" | "removeFromSelection"
    | "alignSelectedLayers" | "batchUpdateLayers"
>;

export const createSelectionSlice: StateCreator<CanvasStore, [], [], SelectionSlice> = (set, get) => ({
    selectedLayerIds: [],

    selectLayer: (id) => {
        if (id === null) {
            set({ selectedLayerIds: [] });
        } else if (Array.isArray(id)) {
            set({ selectedLayerIds: id });
        } else {
            set({ selectedLayerIds: [id] });
        }
    },

    toggleSelection: (id) => {
        set((state) => ({
            selectedLayerIds: state.selectedLayerIds.includes(id)
                ? state.selectedLayerIds.filter((sid) => sid !== id)
                : [...state.selectedLayerIds, id],
        }));
    },

    addToSelection: (id) => {
        set((state) => ({
            selectedLayerIds: state.selectedLayerIds.includes(id)
                ? state.selectedLayerIds
                : [...state.selectedLayerIds, id],
        }));
    },

    removeFromSelection: (id) => {
        set((state) => ({
            selectedLayerIds: state.selectedLayerIds.filter((sid) => sid !== id),
        }));
    },

    alignSelectedLayers: (alignment) => {
        set((state) => {
            const { layers, selectedLayerIds, canvasWidth, canvasHeight } = state;
            if (selectedLayerIds.length === 0) return state;

            const selectedLayers = layers.filter(l => selectedLayerIds.includes(l.id));

            const isInsideAL = selectedLayers.some(layer => {
                const parent = layers.find(l => l.type === "frame" && (l as FrameLayer).childIds.includes(layer.id)) as FrameLayer | undefined;
                return parent?.layoutMode && parent.layoutMode !== "none";
            });
            if (isInsideAL) return state;

            const snapshot: HistorySnapshot = {
                layers: state.layers,
                masterComponents: state.masterComponents,
                componentInstances: state.componentInstances,
                selectedLayerIds: state.selectedLayerIds,
            };

            const updates: { id: string; changes: Partial<Layer> }[] = [];

            if (selectedLayers.length === 1) {
                const layer = selectedLayers[0];
                const parentFrame = layers.find(l => l.type === "frame" && (l as FrameLayer).childIds.includes(layer.id)) as FrameLayer | undefined;

                const parentX = parentFrame ? parentFrame.x : 0;
                const parentY = parentFrame ? parentFrame.y : 0;
                const parentW = parentFrame ? parentFrame.width : canvasWidth;
                const parentH = parentFrame ? parentFrame.height : canvasHeight;

                let newX = layer.x;
                let newY = layer.y;

                switch (alignment) {
                    case "left": newX = parentX; break;
                    case "center": newX = parentX + (parentW - layer.width) / 2; break;
                    case "right": newX = parentX + parentW - layer.width; break;
                    case "top": newY = parentY; break;
                    case "middle": newY = parentY + (parentH - layer.height) / 2; break;
                    case "bottom": newY = parentY + parentH - layer.height; break;
                }

                updates.push({ id: layer.id, changes: { x: newX, y: newY } });
            } else {
                const minX = Math.min(...selectedLayers.map(l => l.x));
                const maxX = Math.max(...selectedLayers.map(l => l.x + l.width));
                const minY = Math.min(...selectedLayers.map(l => l.y));
                const maxY = Math.max(...selectedLayers.map(l => l.y + l.height));

                selectedLayers.forEach(layer => {
                    let newX = layer.x;
                    let newY = layer.y;

                    switch (alignment) {
                        case "left": newX = minX; break;
                        case "center": newX = minX + (maxX - minX - layer.width) / 2; break;
                        case "right": newX = maxX - layer.width; break;
                        case "top": newY = minY; break;
                        case "middle": newY = minY + (maxY - minY - layer.height) / 2; break;
                        case "bottom": newY = maxY - layer.height; break;
                    }

                    updates.push({ id: layer.id, changes: { x: newX, y: newY } });
                });
            }

            let currentLayers = [...layers];
            updates.forEach(update => {
                const targetLayer = currentLayers.find(l => l.id === update.id);
                if (!targetLayer) return;

                let dx = 0;
                let dy = 0;
                if (targetLayer.type === "frame" && (update.changes.x !== undefined || update.changes.y !== undefined)) {
                    if (update.changes.x !== undefined) dx = (update.changes.x as number) - targetLayer.x;
                    if (update.changes.y !== undefined) dy = (update.changes.y as number) - targetLayer.y;
                }

                const childrenIdsToMove = new Set<string>();
                if ((dx !== 0 || dy !== 0) && targetLayer.type === "frame") {
                    const collect = (fid: string) => {
                        const f = currentLayers.find(l => l.id === fid) as FrameLayer;
                        if (f && f.childIds) {
                            f.childIds.forEach(cid => {
                                childrenIdsToMove.add(cid);
                                const child = currentLayers.find(l => l.id === cid);
                                if (child?.type === "frame") collect(cid);
                            });
                        }
                    };
                    collect(update.id);
                }

                currentLayers = currentLayers.map(l => {
                    if (l.id === update.id) return { ...l, ...update.changes } as Layer;
                    if (childrenIdsToMove.has(l.id)) {
                        return { ...l, x: l.x + dx, y: l.y + dy } as Layer;
                    }
                    return l;
                });
            });

            const newLayers = applyAllAutoLayouts(currentLayers);

            return {
                history: [...state.history, snapshot].slice(-MAX_HISTORY),
                future: [],
                layers: newLayers,
            };
        });
    },

    batchUpdateLayers: (updates) => {
        set((state) => {
            if (updates.length === 0) return state;

            const snapshot: HistorySnapshot = {
                layers: state.layers,
                masterComponents: state.masterComponents,
                componentInstances: state.componentInstances,
                selectedLayerIds: state.selectedLayerIds,
            };

            let currentLayers = state.layers;

            updates.forEach(update => {
                const targetLayer = currentLayers.find(l => l.id === update.id);
                if (!targetLayer) return;

                let dx = 0;
                let dy = 0;
                if (targetLayer.type === "frame" && (update.changes.x !== undefined || update.changes.y !== undefined)) {
                    if (update.changes.x !== undefined) dx = (update.changes.x as number) - targetLayer.x;
                    if (update.changes.y !== undefined) dy = (update.changes.y as number) - targetLayer.y;
                }

                const childrenIdsToMove = new Set<string>();
                if ((dx !== 0 || dy !== 0) && targetLayer.type === "frame") {
                    const collect = (fid: string) => {
                        const f = currentLayers.find(l => l.id === fid) as FrameLayer;
                        if (f && f.childIds) {
                            f.childIds.forEach(cid => {
                                childrenIdsToMove.add(cid);
                                const child = currentLayers.find(l => l.id === cid);
                                if (child?.type === "frame") collect(cid);
                            });
                        }
                    };
                    collect(update.id);
                }

                currentLayers = currentLayers.map(l => {
                    if (l.id === update.id) return { ...l, ...update.changes } as Layer;
                    if (childrenIdsToMove.has(l.id)) {
                        return { ...l, x: l.x + dx, y: l.y + dy } as Layer;
                    }
                    return l;
                });
            });

            return {
                history: [...state.history, snapshot].slice(-MAX_HISTORY),
                future: [],
                layers: currentLayers,
            };
        });
    },
});
