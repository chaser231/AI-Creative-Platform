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
import { computeConstrainedPosition, getContentSourceUpdates } from "./helpers";
import { cloneLayerTree } from "@/utils/cloneLayerTree";
import { applyCascade, type CascadeContext } from "./bindingCascade";

function applyArtboardConstraintsToRootLayers(
    layers: Layer[],
    oldSize: { width: number; height: number },
    newSize: { width: number; height: number },
): Layer[] {
    if (
        Math.abs(oldSize.width - newSize.width) < 0.01 &&
        Math.abs(oldSize.height - newSize.height) < 0.01
    ) {
        return layers;
    }

    const childIds = new Set<string>();
    for (const layer of layers) {
        if (layer.type === "frame") {
            for (const childId of layer.childIds) childIds.add(childId);
        }
    }

    const delta = {
        oldX: 0,
        oldY: 0,
        oldWidth: oldSize.width,
        oldHeight: oldSize.height,
        newX: 0,
        newY: 0,
        newWidth: newSize.width,
        newHeight: newSize.height,
    };

    return layers.map((layer) => {
        if (childIds.has(layer.id)) return layer;
        return { ...layer, ...computeConstrainedPosition(layer, delta) } as Layer;
    });
}

export type ResizeSlice = Pick<CanvasStore,
    | "resizes" | "activeResizeId" | "canvasWidth" | "canvasHeight"
    | "addResize" | "removeResize" | "renameResize" | "resizeFormat" | "duplicateResize"
    | "setActiveResize" | "syncLayersToResize" | "toggleInstanceMode"
    | "setCanvasSize"
    | "promoteFormatToMaster" | "demoteFormatFromMaster"
    | "setFormatBindings" | "unbindFormat"
>;

export const createResizeSlice: StateCreator<CanvasStore, [], [], ResizeSlice> = (set, get) => ({
    resizes: [DEFAULT_RESIZE],
    activeResizeId: "master",
    canvasWidth: DEFAULT_RESIZE.width,
    canvasHeight: DEFAULT_RESIZE.height,

    addResize: (format: ResizeFormat) => {
        const state = get();

        // ── Snapshot mode: caller provided layerSnapshot explicitly ──
        // This takes priority regardless of masterComponents presence.
        // "clone" = layers from current format, "empty" = []
        // Snapshot formats are independent — no instances needed.
        if (format.layerSnapshot !== undefined) {
            set((s) => ({
                resizes: [...s.resizes, { ...format }],
            }));
            return;
        }

        // ── Legacy master/instance mode (no snapshot provided) ──
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

        // ── Fallback: no masters, no snapshot — just add the format ──
        set((s) => ({
            resizes: [...s.resizes, { ...format, layerSnapshot: [] }],
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

    resizeFormat: (resizeId, width, height) => {
        const state = get();
        const newLabel = `${width} × ${height}`;
        const target = state.resizes.find((r) => r.id === resizeId);
        if (!target) return;

        const oldSize = { width: target.width, height: target.height };
        const newSize = { width, height };
        const resizedActiveLayers = state.activeResizeId === resizeId
            ? applyAllAutoLayouts(
                applyArtboardConstraintsToRootLayers(state.layers, oldSize, newSize),
                state.layers,
            )
            : state.layers;

        set({
            resizes: state.resizes.map((r) =>
                r.id === resizeId
                    ? {
                        ...r,
                        width,
                        height,
                        label: newLabel,
                        layerSnapshot: state.activeResizeId === resizeId
                            ? resizedActiveLayers
                            : r.layerSnapshot
                                ? applyAllAutoLayouts(
                                    applyArtboardConstraintsToRootLayers(r.layerSnapshot, oldSize, newSize),
                                    r.layerSnapshot,
                                )
                                : r.layerSnapshot,
                    }
                    : r
            ),
            ...(state.activeResizeId === resizeId ? { layers: resizedActiveLayers } : {}),
            // If resizing the active format, also update canvas dimensions
            ...(state.activeResizeId === resizeId ? { canvasWidth: width, canvasHeight: height } : {}),
        });
    },

    duplicateResize: (resizeId) => {
        const state = get();
        const source = state.resizes.find(r => r.id === resizeId);
        if (!source) return;

        // Get source layers: if source is active, use current layers; otherwise snapshot
        const sourceLayers = state.activeResizeId === resizeId
            ? state.layers
            : (source.layerSnapshot ?? []);

        const newFormat: ResizeFormat = {
            ...source,
            id: `dup-${Date.now()}`,
            name: `${source.name} (копия)`,
            isMaster: undefined, // never duplicate master status
            layerBindings: undefined, // don't copy bindings
            layerSnapshot: cloneLayerTree(sourceLayers),
        };

        set((s) => ({
            resizes: [...s.resizes, newFormat],
        }));
    },

    setActiveResize: (resizeId) => {
        const state = get();
        const targetResize = state.resizes.find((r) => r.id === resizeId);
        if (!targetResize) return;
        if (resizeId === state.activeResizeId) return;

        // Diagnostic: trace what image src is carried where during format switches.
        const imgSrcOf = (layers: Layer[] | undefined) =>
            (layers ?? []).filter(l => l.type === "image").map(l => ({
                id: l.id,
                src: ((l as { src?: string }).src ?? "").slice(-80),
            }));
        console.log("[cascade] setActiveResize", {
            from: state.activeResizeId,
            to: resizeId,
            fromLayers: imgSrcOf(state.layers),
            targetSnapshot: imgSrcOf(targetResize.layerSnapshot),
            targetBindings: targetResize.layerBindings?.length ?? 0,
        });

        // Always save current layers as the active format's snapshot.
        // This ensures we don't lose edits when switching formats.
        const updatedResizes = state.resizes.map(r =>
            r.id === state.activeResizeId
                ? { ...r, layerSnapshot: [...state.layers] }
                : r
        );

        // Determine if TARGET format is snapshot-based:
        // snapshot-based = has layerSnapshot defined (even if empty [])
        // legacy = no layerSnapshot → use master/instance sync
        const isTargetSnapshotBased = targetResize.layerSnapshot !== undefined;

        let targetLayers: Layer[];
        if (isTargetSnapshotBased) {
            // Snapshot mode: load the snapshot directly
            targetLayers = targetResize.layerSnapshot!;
        } else if (state.masterComponents.length > 0) {
            // Legacy format: syncLayersToResize will rebuild from instances
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

        // Only run syncLayersToResize for legacy (non-snapshot) formats
        if (!isTargetSnapshotBased && state.masterComponents.length > 0) {
            get().syncLayersToResize();
        }

        // ── Phase 2: Cascade master changes to bound snapshot formats ──
        if (isTargetSnapshotBased && targetResize.layerBindings && targetResize.layerBindings.length > 0) {
            const currentState = get();
            // Find the master format
            const masterFormat = currentState.resizes.find(r => r.isMaster);
            if (masterFormat) {
                // Get the master's layers (could be the saved snapshot or current layers)
                const masterLayers = masterFormat.id === currentState.activeResizeId
                    ? currentState.layers
                    : (masterFormat.layerSnapshot ?? []);

                // But we just switched TO this format, so activeResizeId is now this format.
                // Master layers come from masterFormat.layerSnapshot (saved last time master was active)
                // OR from updatedResizes if master was the format we just left.
                const resolvedMasterLayers = updatedResizes.find(r => r.id === masterFormat.id)?.layerSnapshot ?? masterLayers;

                const context: CascadeContext = {
                    masterArtboard: { width: masterFormat.width, height: masterFormat.height },
                    targetArtboard: { width: targetResize.width, height: targetResize.height },
                };
                const rawCascadedLayers = applyCascade(
                    currentState.layers,
                    resolvedMasterLayers,
                    targetResize.layerBindings,
                    context,
                );

                if (rawCascadedLayers !== currentState.layers) {
                    const cascadedLayers = applyAllAutoLayouts(rawCascadedLayers);
                    console.log("[cascade] phase-2 applyCascade on switch", {
                        target: resizeId,
                        bindings: targetResize.layerBindings?.length ?? 0,
                        beforeFirstImage: imgSrcOf(currentState.layers)[0],
                        afterFirstImage: imgSrcOf(cascadedLayers)[0],
                    });
                    set({
                        layers: cascadedLayers,
                        resizes: currentState.resizes.map((resize) =>
                            resize.id === resizeId
                                ? { ...resize, layerSnapshot: cascadedLayers }
                                : resize
                        ),
                    });
                } else {
                    console.log("[cascade] phase-2 applyCascade produced no change on switch", {
                        target: resizeId,
                    });
                }
            }
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
        const oldSize = { width: state.canvasWidth, height: state.canvasHeight };
        const newSize = { width, height };
        const resizedLayers = applyAllAutoLayouts(
            applyArtboardConstraintsToRootLayers(state.layers, oldSize, newSize),
            state.layers,
        );

        set({
            canvasWidth: width,
            canvasHeight: height,
            layers: resizedLayers,
            resizes: state.resizes.map((r) =>
                r.id === state.activeResizeId
                    ? { ...r, width, height, label: `${width} × ${height}`, layerSnapshot: resizedLayers }
                    : r
            ),
        });
    },

    // ── Phase 2: Master binding actions ──────────────────

    promoteFormatToMaster: (formatId) => {
        set((state) => ({
            resizes: state.resizes.map((r) => ({
                ...r,
                isMaster: r.id === formatId ? true : undefined,
            })),
        }));
    },

    demoteFormatFromMaster: (formatId) => {
        set((state) => ({
            resizes: state.resizes.map((r) =>
                r.id === formatId ? { ...r, isMaster: undefined } : r
            ),
        }));
    },

    setFormatBindings: (formatId, bindings) => {
        set((state) => {
            const nextResizes = state.resizes.map((resize) =>
                resize.id === formatId ? { ...resize, layerBindings: bindings } : resize
            );

            const targetResize = nextResizes.find((resize) => resize.id === formatId);
            const masterFormat = nextResizes.find((resize) => resize.isMaster);

            if (!targetResize?.layerSnapshot || !masterFormat) {
                return { resizes: nextResizes };
            }

            const masterLayers = masterFormat.id === state.activeResizeId
                ? state.layers
                : (masterFormat.layerSnapshot ?? []);
            const targetLayers = formatId === state.activeResizeId
                ? state.layers
                : targetResize.layerSnapshot;
            const context: CascadeContext = {
                masterArtboard: { width: masterFormat.width, height: masterFormat.height },
                targetArtboard: { width: targetResize.width, height: targetResize.height },
            };
            const cascadedLayers = applyAllAutoLayouts(
                applyCascade(targetLayers, masterLayers, bindings, context)
            );

            const finalResizes = nextResizes.map((resize) =>
                resize.id === formatId
                    ? { ...resize, layerSnapshot: cascadedLayers }
                    : resize
            );

            if (formatId === state.activeResizeId) {
                return {
                    resizes: finalResizes,
                    layers: cascadedLayers,
                };
            }

            return { resizes: finalResizes };
        });
    },

    unbindFormat: (formatId) => {
        set((state) => ({
            resizes: state.resizes.map((r) =>
                r.id === formatId ? { ...r, layerBindings: undefined } : r
            ),
        }));
    },
});

