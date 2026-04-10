/**
 * Resize Slice — Format management, syncLayersToResize, toggleInstanceMode
 *
 * Supports two modes:
 * 1. Legacy master/instance mode — when masterComponents exist
 * 2. Snapshot/page mode — each format stores its own independent layers
 */

import type { StateCreator } from "zustand";
import type { CanvasStore, Layer, ComponentProps, ResizeFormat } from "./types";
import { DEFAULT_RESIZE } from "./types";
import { v4 as uuid } from "uuid";
import { applyLayout, applyAllAutoLayouts } from "@/utils/layoutEngine";
import { applyConstraints } from "@/utils/resizeUtil";
import { getContentSourceUpdates } from "./helpers";
import { cloneLayerTree } from "@/utils/cloneLayerTree";

export type ResizeSlice = Pick<CanvasStore,
    | "resizes" | "activeResizeId" | "canvasWidth" | "canvasHeight"
    | "addResize" | "removeResize" | "renameResize"
    | "setActiveResize" | "syncLayersToResize" | "toggleInstanceMode"
    | "setCanvasSize"
>;

export const createResizeSlice: StateCreator<CanvasStore, [], [], ResizeSlice> = (set, get) => ({
    resizes: [DEFAULT_RESIZE],
    activeResizeId: "master",
    canvasWidth: DEFAULT_RESIZE.width,
    canvasHeight: DEFAULT_RESIZE.height,

    addResize: (format: ResizeFormat) => {
        const state = get();

        // ── Legacy master/instance mode ──
        if (state.masterComponents.length > 0) {
            const masterFormat = state.resizes.find((r) => r.id === "master");
            const mw = masterFormat?.width || 1080;
            const mh = masterFormat?.height || 1080;

            const newInstances = state.masterComponents.map((m) => {
                const initialProps = { ...m.props };
                let finalProps = initialProps;

                if (m.slotId) {
                    const mockLayer = {
                        ...initialProps,
                        id: uuid(),
                        name: m.name,
                        type: m.type,
                        masterId: m.id,
                        slotId: m.slotId
                    } as Layer;

                    const [layouted] = applyLayout([mockLayer], format);
                    if (layouted) {
                        finalProps = {
                            ...initialProps,
                            x: layouted.x,
                            y: layouted.y,
                            width: layouted.width,
                            height: layouted.height
                        } as ComponentProps;
                    }
                } else {
                    const constrained = applyConstraints(
                        m.props,
                        { width: mw, height: mh },
                        { width: format.width, height: format.height }
                    );
                    finalProps = {
                        ...finalProps,
                        ...constrained
                    } as ComponentProps;
                }

                return {
                    id: uuid(),
                    masterId: m.id,
                    resizeId: format.id,
                    localProps: finalProps,
                };
            });
            set((s) => ({
                resizes: [...s.resizes, format],
                componentInstances: [...s.componentInstances, ...newInstances],
            }));
            return;
        }

        // ── Snapshot/page mode ──
        // format.layerSnapshot is set by the caller:
        //   - cloned layers (from ResizePanel dialog "clone")
        //   - empty array (from ResizePanel dialog "empty")
        //   - or pre-existing snapshot from loaded data
        const formatWithSnapshot: ResizeFormat = {
            ...format,
            layerSnapshot: format.layerSnapshot ?? [],
        };

        set((s) => ({
            resizes: [...s.resizes, formatWithSnapshot],
        }));
    },

    removeResize: (resizeId) => {
        if (resizeId === "master") return;
        const state = get();
        const wasActive = state.activeResizeId === resizeId;

        set((s) => ({
            resizes: s.resizes.filter((r) => r.id !== resizeId),
            componentInstances: s.componentInstances.filter((i) => i.resizeId !== resizeId),
            activeResizeId: wasActive ? (s.resizes[0]?.id || "master") : s.activeResizeId,
        }));

        // If the deleted format was active, switch to the first available
        if (wasActive) {
            get().setActiveResize(get().resizes[0]?.id || "master");
        }
    },

    renameResize: (resizeId, name) => {
        set((state) => ({
            resizes: state.resizes.map((r) =>
                r.id === resizeId ? { ...r, name } : r
            ),
        }));
    },

    setActiveResize: (resizeId) => {
        const state = get();
        const targetResize = state.resizes.find((r) => r.id === resizeId);
        if (!targetResize) return;
        if (resizeId === state.activeResizeId) return;

        // ── Snapshot mode: save current → load target ──
        // Always save current layers as the active format's snapshot.
        // This ensures we don't lose edits when switching formats.
        const updatedResizes = state.resizes.map(r =>
            r.id === state.activeResizeId
                ? { ...r, layerSnapshot: [...state.layers] }
                : r
        );

        // Check if we have masterComponents (legacy mode)
        const hasLegacyMasters = state.masterComponents.length > 0;

        // Determine target layers:
        // 1. If target has a snapshot → use it
        // 2. If legacy mode → will be resolved by syncLayersToResize
        // 3. Otherwise → empty (new format)
        let targetLayers: Layer[];
        if (targetResize.layerSnapshot && targetResize.layerSnapshot.length > 0) {
            targetLayers = targetResize.layerSnapshot;
        } else if (hasLegacyMasters) {
            // Let syncLayersToResize handle it (legacy path)
            targetLayers = state.layers;
        } else {
            // No snapshot and no masters — empty page
            targetLayers = [];
        }

        set({
            resizes: updatedResizes,
            activeResizeId: resizeId,
            canvasWidth: targetResize.width,
            canvasHeight: targetResize.height,
            layers: targetLayers,
            selectedLayerIds: [],
        });

        // In legacy mode, still run syncLayersToResize for master/instance mapping
        if (hasLegacyMasters) {
            get().syncLayersToResize();
        }
    },

    syncLayersToResize: () => {
        const state = get();
        const { masterComponents, componentInstances, activeResizeId, resizes, layers } = state;

        // If no masterComponents (raw canvas state, e.g. from template editor),
        // just re-run auto-layouts without trying to sync master/instance architecture.
        // Without masters, the format system can't remap properties between resizes.
        if (masterComponents.length === 0) {
            set({ layers: applyAllAutoLayouts([...layers]) });
            return;
        }

        if (activeResizeId === "master") {
            const newLayers: Layer[] = layers.map((existingLayer) => {
                const m = masterComponents.find((mc) => mc.id === existingLayer.masterId);
                if (!m) return existingLayer;

                return {
                    ...existingLayer,
                    ...m.props,
                    id: existingLayer.id,
                    name: m.name,
                    masterId: m.id,
                    type: m.type,
                } as Layer;
            });
            set({ layers: applyAllAutoLayouts(newLayers) });
        } else {
            const resize = resizes.find((r) => r.id === activeResizeId);
            const newLayers: Layer[] = layers.map((existingLayer) => {
                const m = masterComponents.find((mc) => mc.id === existingLayer.masterId);
                if (!m) return existingLayer;

                const instance = componentInstances.find(
                    (i) => i.masterId === m.id && i.resizeId === activeResizeId
                );

                if (instance) {
                    let props = { ...instance.localProps };
                    if (resize?.instancesEnabled) {
                        const contentUpdates = getContentSourceUpdates(m);
                        if (props.detachedSizeSync) {
                            delete contentUpdates.width;
                            delete contentUpdates.height;
                        }
                        props = { ...props, ...contentUpdates } as ComponentProps;
                    }
                    return {
                        ...existingLayer,
                        ...props,
                        id: existingLayer.id,
                        name: m.name,
                        masterId: m.id,
                    } as Layer;
                } else {
                    return {
                        ...existingLayer,
                        ...m.props,
                        id: existingLayer.id,
                        name: m.name,
                        masterId: m.id,
                    } as Layer;
                }
            });
            set({ layers: applyAllAutoLayouts(newLayers) });
        }
    },

    toggleInstanceMode: (resizeId) => {
        if (resizeId === "master") return;
        set((state) => ({
            resizes: state.resizes.map((r) =>
                r.id === resizeId ? { ...r, instancesEnabled: !r.instancesEnabled } : r
            ),
        }));
    },

    setCanvasSize: (width, height) => {
        const state = get();
        set({
            canvasWidth: width,
            canvasHeight: height,
            resizes: state.activeResizeId === "master"
                ? state.resizes.map((r) =>
                    r.id === "master"
                        ? { ...r, width, height, label: `${width} × ${height}` }
                        : r
                )
                : state.resizes,
        });
    },
});
