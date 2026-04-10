/**
 * Resize Slice — Format management, syncLayersToResize, toggleInstanceMode
 */

import type { StateCreator } from "zustand";
import type { CanvasStore, Layer, ComponentProps, ResizeFormat } from "./types";
import { DEFAULT_RESIZE } from "./types";
import { v4 as uuid } from "uuid";
import { applyLayout, applyAllAutoLayouts } from "@/utils/layoutEngine";
import { applyConstraints } from "@/utils/resizeUtil";
import { getContentSourceUpdates } from "./helpers";

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
    },

    removeResize: (resizeId) => {
        if (resizeId === "master") return;
        set((state) => ({
            resizes: state.resizes.filter((r) => r.id !== resizeId),
            componentInstances: state.componentInstances.filter((i) => i.resizeId !== resizeId),
            activeResizeId: state.activeResizeId === resizeId ? "master" : state.activeResizeId,
        }));
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
        const resize = state.resizes.find((r) => r.id === resizeId);
        if (!resize) return;
        set({
            activeResizeId: resizeId,
            canvasWidth: resize.width,
            canvasHeight: resize.height,
        });
        get().syncLayersToResize();
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
