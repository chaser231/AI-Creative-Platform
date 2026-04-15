/**
 * Layer Slice — Layer CRUD, frame ops, ordering, visibility/lock
 */

import type { StateCreator } from "zustand";
import type {
    CanvasStore,
    Layer, TextLayer, RectangleLayer, ImageLayer, BadgeLayer, FrameLayer,
    MasterComponent, ComponentInstance, ComponentProps,
    HistorySnapshot,
} from "./types";
import { MAX_HISTORY } from "./types";
import { CONTENT_SOURCE_KEYS } from "@/types";
import { v4 as uuid } from "uuid";
import { applyAllAutoLayouts } from "@/utils/layoutEngine";
import {
    syncFrameChildIdsToMasters,
    syncFrameChildIdsToInstances,
    syncDerivedLayoutToSource,
} from "./helpers";
import { pushSnapshot } from "./createHistorySlice";
import { useBrandKitStore } from "@/store/brandKitStore";
import { applyCascade, type CascadeContext } from "./bindingCascade";

// Throttle timer for updateLayer history
let _updateHistoryTimer: ReturnType<typeof setTimeout> | null = null;
let _updateHistoryPushed = false;

function getDefaultTextFontFamily() {
    return useBrandKitStore.getState().brandKit.fonts[0]?.name || "Inter";
}

export type LayerSlice = Pick<CanvasStore,
    | "layers"
    | "addTextLayer" | "addRectangleLayer" | "addImageLayer" | "addBadgeLayer" | "addFrameLayer"
    | "updateLayer" | "removeLayer"
    | "deleteSelectedLayers" | "duplicateSelectedLayers" | "duplicateLayer"
    | "reorderLayers" | "reorderLayer"
    | "toggleLayerVisibility" | "toggleLayerLock"
    | "bringToFront" | "sendToBack"
    | "moveLayerToFrame" | "removeLayerFromFrame"
    | "pasteLayers"
>;

// ─── Helper: create layer + master + instances for all add* actions ──

function createLayerWithMasterAndInstances<T extends Layer>(
    layer: T,
    masterProps: ComponentProps,
    masterName: string,
    masterType: Layer["type"],
    slotId: string | undefined,
    state: CanvasStore,
): {
    layer: T;
    master: MasterComponent;
    instances: ComponentInstance[];
} {
    const masterId = uuid();
    const master: MasterComponent = {
        id: masterId,
        type: masterType,
        name: masterName,
        slotId,
        props: masterProps,
    };
    const instances: ComponentInstance[] = state.resizes
        .filter((r) => r.id !== "master")
        .map((r) => ({
            id: uuid(),
            masterId,
            resizeId: r.id,
            localProps: { ...masterProps },
        }));

    return {
        layer: { ...layer, masterId } as T,
        master,
        instances,
    };
}

function syncSnapshotFormats(
    resizes: CanvasStore["resizes"],
    activeResizeId: string,
    nextLayers: Layer[],
    prevLayers?: Layer[],
): CanvasStore["resizes"] {
    const activeResize = resizes.find((resize) => resize.id === activeResizeId);
    if (!activeResize) return resizes;

    const masterArtboard = { width: activeResize.width, height: activeResize.height };

    let changed = false;

    const nextResizes = resizes.map((resize) => {
        if (resize.id === activeResizeId) {
            if (resize.layerSnapshot === undefined) return resize;
            changed = true;
            return { ...resize, layerSnapshot: nextLayers };
        }

        if (!activeResize.isMaster || !resize.layerSnapshot || !resize.layerBindings?.length) {
            return resize;
        }

        const context: CascadeContext = {
            masterArtboard,
            targetArtboard: { width: resize.width, height: resize.height },
        };
        const cascadedSnapshot = applyCascade(
            resize.layerSnapshot, nextLayers, resize.layerBindings, context, prevLayers,
        );
        if (cascadedSnapshot === resize.layerSnapshot) return resize;

        changed = true;
        return { ...resize, layerSnapshot: applyAllAutoLayouts(cascadedSnapshot) };
    });

    return changed ? nextResizes : resizes;
}

export const createLayerSlice: StateCreator<CanvasStore, [], [], LayerSlice> = (set, get) => ({
    layers: [],

    // ─── Layer creation ─────────────────────────────────

    addTextLayer: (overrides = {}) => {
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);
        const id = uuid();
        const layer: TextLayer = {
            id,
            type: "text",
            name: "Text",
            x: 100, y: 100, width: 300, height: 60,
            rotation: 0, visible: true, locked: false,
            text: "Type something",
            fontSize: 48, fontFamily: getDefaultTextFontFamily(), fontWeight: "600",
            fill: "#111827", align: "left",
            letterSpacing: 0, lineHeight: 1.2,
            textAdjust: "auto_width",
            truncateText: false, verticalTrim: false,
            ...overrides,
        };
        const state = get();
        const { layer: finalLayer, master, instances } = createLayerWithMasterAndInstances(
            layer,
            {
                type: "text", slotId: layer.slotId,
                x: layer.x, y: layer.y, width: layer.width, height: layer.height,
                rotation: layer.rotation, visible: layer.visible, locked: layer.locked,
                text: layer.text, fontSize: layer.fontSize, fontFamily: layer.fontFamily,
                fontWeight: layer.fontWeight, fill: layer.fill, align: layer.align,
                letterSpacing: layer.letterSpacing, lineHeight: layer.lineHeight,
                textAdjust: layer.textAdjust, truncateText: layer.truncateText,
                verticalTrim: layer.verticalTrim,
            },
            layer.name, "text", layer.slotId, state,
        );
        set((s) => ({
            layers: [...s.layers, finalLayer],
            masterComponents: [...s.masterComponents, master],
            componentInstances: [...s.componentInstances, ...instances],
            selectedLayerIds: [id],
            activeTool: "select",
        }));
    },

    addRectangleLayer: (overrides = {}) => {
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);
        const id = uuid();
        const layer: RectangleLayer = {
            id,
            type: "rectangle",
            name: "Rectangle",
            x: 100, y: 100, width: 200, height: 200,
            rotation: 0, visible: true, locked: false,
            fill: "#E5E7EB", stroke: "", strokeWidth: 0, cornerRadius: 0,
            ...overrides,
        };
        const state = get();
        const { layer: finalLayer, master, instances } = createLayerWithMasterAndInstances(
            layer,
            {
                type: "rectangle", slotId: layer.slotId,
                x: layer.x, y: layer.y, width: layer.width, height: layer.height,
                rotation: layer.rotation, visible: layer.visible, locked: layer.locked,
                fill: layer.fill, stroke: layer.stroke,
                strokeWidth: layer.strokeWidth, cornerRadius: layer.cornerRadius,
            },
            layer.name, "rectangle", layer.slotId, state,
        );
        set((s) => ({
            layers: [...s.layers, finalLayer],
            masterComponents: [...s.masterComponents, master],
            componentInstances: [...s.componentInstances, ...instances],
            selectedLayerIds: [id],
            activeTool: "select",
        }));
    },

    addImageLayer: (src, width, height) => {
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);
        const id = uuid();
        const layer: ImageLayer = {
            id,
            type: "image",
            name: "Image",
            x: 100, y: 100, width, height,
            rotation: 0, visible: true, locked: false,
            src,
            objectFit: "cover",
            focusX: 0.5,
            focusY: 0.5,
        };
        const state = get();
        const { layer: finalLayer, master, instances } = createLayerWithMasterAndInstances(
            layer,
            {
                type: "image", slotId: layer.slotId,
                x: layer.x, y: layer.y, width: layer.width, height: layer.height,
                rotation: layer.rotation, visible: layer.visible, locked: layer.locked,
                src: layer.src, objectFit: "cover",
                focusX: layer.focusX, focusY: layer.focusY,
            },
            layer.name, "image", layer.slotId, state,
        );
        set((s) => ({
            layers: [...s.layers, finalLayer],
            masterComponents: [...s.masterComponents, master],
            componentInstances: [...s.componentInstances, ...instances],
            selectedLayerIds: [id],
            activeTool: "select",
        }));
    },

    addBadgeLayer: (overrides = {}) => {
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);
        const id = uuid();
        const layer: BadgeLayer = {
            id,
            type: "badge",
            name: "Badge",
            x: 100, y: 100, width: 120, height: 36,
            rotation: 0, visible: true, locked: false,
            label: "NEW", shape: "pill",
            fill: "#6366F1", textColor: "#FFFFFF", fontSize: 14,
            ...overrides,
        };
        const state = get();
        const { layer: finalLayer, master, instances } = createLayerWithMasterAndInstances(
            layer,
            {
                type: "badge", slotId: layer.slotId,
                x: layer.x, y: layer.y, width: layer.width, height: layer.height,
                rotation: layer.rotation, visible: layer.visible, locked: layer.locked,
                label: layer.label, shape: layer.shape,
                fill: layer.fill, textColor: layer.textColor, fontSize: layer.fontSize,
            },
            layer.name, "badge", layer.slotId, state,
        );
        set((s) => ({
            layers: [...s.layers, finalLayer],
            masterComponents: [...s.masterComponents, master],
            componentInstances: [...s.componentInstances, ...instances],
            selectedLayerIds: [id],
            activeTool: "select",
        }));
    },

    addFrameLayer: (overrides = {}) => {
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);
        const id = uuid();
        const layer: FrameLayer = {
            id,
            type: "frame",
            name: "Frame",
            x: 100, y: 100, width: 400, height: 300,
            rotation: 0, visible: true, locked: false,
            fill: "#FFFFFF", stroke: "#E5E7EB", strokeWidth: 1,
            cornerRadius: 0, clipContent: true, childIds: [],
            ...overrides,
        };
        const state = get();
        const { layer: finalLayer, master, instances } = createLayerWithMasterAndInstances(
            layer,
            {
                type: "frame", slotId: layer.slotId,
                x: layer.x, y: layer.y, width: layer.width, height: layer.height,
                rotation: layer.rotation, visible: layer.visible, locked: layer.locked,
                fill: layer.fill, stroke: layer.stroke,
                strokeWidth: layer.strokeWidth, cornerRadius: layer.cornerRadius,
                clipContent: layer.clipContent, childIds: [],
            },
            layer.name, "frame", layer.slotId, state,
        );
        set((s) => ({
            layers: [...s.layers, finalLayer],
            masterComponents: [...s.masterComponents, master],
            componentInstances: [...s.componentInstances, ...instances],
            selectedLayerIds: [id],
            activeTool: "select",
        }));
    },

    // ─── updateLayer (with throttled history) ───────────

    updateLayer: (id, updates) => {
        if (!_updateHistoryPushed) {
            pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);
            _updateHistoryPushed = true;
        }
        if (_updateHistoryTimer) clearTimeout(_updateHistoryTimer);
        _updateHistoryTimer = setTimeout(() => { _updateHistoryPushed = false; }, 300);

        set((state) => {
            const computeUpdatedLayers = (currentLayers: Layer[], targetId: string, layerUpdates: Partial<Layer>): Layer[] => {
                const targetLayer = currentLayers.find(l => l.id === targetId);
                if (!targetLayer) return currentLayers;

                let dx = 0;
                let dy = 0;

                if (targetLayer.type === "frame" && (layerUpdates.x !== undefined || layerUpdates.y !== undefined)) {
                    if (layerUpdates.x !== undefined) dx = (layerUpdates.x as number) - targetLayer.x;
                    if (layerUpdates.y !== undefined) dy = (layerUpdates.y as number) - targetLayer.y;
                }

                const childrenIdsToMove = new Set<string>();
                if ((dx !== 0 || dy !== 0) && targetLayer.type === "frame") {
                    const collect = (fid: string) => {
                        const f = currentLayers.find(l => l.id === fid) as FrameLayer;
                        if (f && f.childIds) {
                            f.childIds.forEach(cid => {
                                if (childrenIdsToMove.has(cid)) return; // circular ref guard
                                childrenIdsToMove.add(cid);
                                const child = currentLayers.find(l => l.id === cid);
                                if (child?.type === "frame") collect(cid);
                            });
                        }
                    };
                    collect(targetId);
                }

                return currentLayers.map(l => {
                    if (l.id === targetId) return { ...l, ...layerUpdates } as Layer;
                    if (childrenIdsToMove.has(l.id)) {
                        return { ...l, x: l.x + dx, y: l.y + dy } as Layer;
                    }
                    return l;
                });
            };

            const newLayers = applyAllAutoLayouts(computeUpdatedLayers(state.layers, id, updates));
            const layer = newLayers.find((l) => l.id === id);
            const snapshotAwareResizes = syncSnapshotFormats(state.resizes, state.activeResizeId, newLayers, state.layers);
            const fontSyncUpdates = Object.fromEntries(
                Object.entries(updates).filter(([key]) => key === "fontFamily" || key === "fontWeight")
            ) as Partial<Layer>;
            const syncedResizes = Object.keys(fontSyncUpdates).length > 0
                ? snapshotAwareResizes.map((resize) => {
                    if (resize.id === state.activeResizeId || !resize.layerSnapshot) return resize;
                    const nextSnapshot = resize.layerSnapshot.map((snapshotLayer) =>
                        snapshotLayer.id === id && snapshotLayer.type === "text"
                            ? { ...snapshotLayer, ...fontSyncUpdates }
                            : snapshotLayer
                    );
                    return { ...resize, layerSnapshot: nextSnapshot };
                })
                : snapshotAwareResizes;

            if (!layer?.masterId) {
                return { layers: newLayers, resizes: syncedResizes };
            }

            if (state.activeResizeId === "master") {
                const master = state.masterComponents.find((m) => m.id === layer.masterId);
                if (!master) return { layers: newLayers, resizes: syncedResizes };

                const newMasters = state.masterComponents.map((m) =>
                    m.id === layer.masterId
                        ? { ...m, name: layer.name, props: { ...m.props, ...updates } as ComponentProps }
                        : m
                );

                const contentKeys = CONTENT_SOURCE_KEYS[master.type] || [];
                const contentUpdates: Record<string, unknown> = {};
                let hasContentChange = false;
                for (const key of contentKeys) {
                    if (key in updates) {
                        contentUpdates[key] = (updates as Record<string, unknown>)[key];
                        hasContentChange = true;
                    }
                }

                let newInstances = state.componentInstances;
                if (hasContentChange) {
                    newInstances = state.componentInstances.map((inst) => {
                        if (inst.masterId !== layer.masterId) return inst;
                        const resize = state.resizes.find((r) => r.id === inst.resizeId);
                        if (!resize?.instancesEnabled) return inst;
                        return {
                            ...inst,
                            localProps: { ...inst.localProps, ...contentUpdates } as ComponentProps,
                        };
                    });
                }

                const derivedSync = syncDerivedLayoutToSource(
                    state.layers, newLayers, newMasters, newInstances, state.activeResizeId
                );

                return {
                    layers: newLayers,
                    resizes: syncedResizes,
                    masterComponents: derivedSync.masterComponents,
                    componentInstances: derivedSync.componentInstances,
                };
            } else {
                const newInstances = state.componentInstances.map((inst) => {
                    if (inst.masterId !== layer.masterId || inst.resizeId !== state.activeResizeId) {
                        return inst;
                    }
                    return {
                        ...inst,
                        localProps: { ...inst.localProps, ...updates } as ComponentProps,
                    };
                });

                const derivedSync = syncDerivedLayoutToSource(
                    state.layers, newLayers, state.masterComponents, newInstances, state.activeResizeId
                );

                return {
                    layers: newLayers,
                    resizes: syncedResizes,
                    masterComponents: derivedSync.masterComponents,
                    componentInstances: derivedSync.componentInstances,
                };
            }
        });
    },

    // ─── removeLayer ────────────────────────────────────

    removeLayer: (id) => {
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);
        set((state) => {
            const layer = state.layers.find((l) => l.id === id);
            const idsToRemove = new Set<string>([id]);
            if (layer?.type === "frame") {
                const collectChildren = (frameLayer: FrameLayer) => {
                    for (const childId of frameLayer.childIds) {
                        idsToRemove.add(childId);
                        const child = state.layers.find((l) => l.id === childId);
                        if (child?.type === "frame") collectChildren(child as FrameLayer);
                    }
                };
                collectChildren(layer as FrameLayer);
            }
            const newLayers = state.layers
                .filter((l) => !idsToRemove.has(l.id))
                .map((l) => {
                    if (l.type === "frame" && (l as FrameLayer).childIds.includes(id)) {
                        return { ...l, childIds: (l as FrameLayer).childIds.filter((c) => c !== id) } as Layer;
                    }
                    return l;
                });
            const masterIdsToRemove = new Set(
                state.layers.filter((l) => idsToRemove.has(l.id) && l.masterId).map((l) => l.masterId!)
            );
            return {
                layers: applyAllAutoLayouts(newLayers),
                selectedLayerIds: state.selectedLayerIds.filter((sid) => !idsToRemove.has(sid)),
                masterComponents: state.masterComponents.filter((m) => !masterIdsToRemove.has(m.id)),
                componentInstances: state.componentInstances.filter((i) => !masterIdsToRemove.has(i.masterId)),
            };
        });
    },

    // ─── deleteSelectedLayers ───────────────────────────

    deleteSelectedLayers: () => {
        const state = get();
        const { selectedLayerIds } = state;
        if (selectedLayerIds.length === 0) return;

        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);

        set((state) => {
            const idsToRemove = new Set<string>();
            const layersMap = new Map(state.layers.map(l => [l.id, l]));

            const collect = (id: string) => {
                if (idsToRemove.has(id)) return;
                idsToRemove.add(id);
                const layer = layersMap.get(id);
                if (layer?.type === "frame") {
                    (layer as FrameLayer).childIds.forEach(collect);
                }
            };

            selectedLayerIds.forEach(collect);

            const newLayers = state.layers
                .filter((l) => !idsToRemove.has(l.id))
                .map((l) => {
                    if (l.type === "frame") {
                        const fl = l as FrameLayer;
                        if (fl.childIds.some(cid => idsToRemove.has(cid))) {
                            return { ...l, childIds: fl.childIds.filter(cid => !idsToRemove.has(cid)) } as Layer;
                        }
                    }
                    return l;
                });

            const masterIdsToRemove = new Set(
                state.layers.filter((l) => idsToRemove.has(l.id) && l.masterId).map((l) => l.masterId!)
            );

            return {
                layers: applyAllAutoLayouts(newLayers),
                selectedLayerIds: [],
                masterComponents: state.masterComponents.filter((m) => !masterIdsToRemove.has(m.id)),
                componentInstances: state.componentInstances.filter((i) => !masterIdsToRemove.has(i.masterId)),
            };
        });
    },

    // ─── duplicateLayer ─────────────────────────────────

    duplicateLayer: (id) => {
        const state = get();
        const layer = state.layers.find((l) => l.id === id);
        if (!layer) return;
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);

        const newLayers: Layer[] = [];
        const newMasters: MasterComponent[] = [];
        const newInstances: ComponentInstance[] = [];

        const duplicateOne = (srcLayer: Layer, offsetX: number, offsetY: number): string => {
            const newId = uuid();
            const newName = srcLayer.name + " копия";
            const newLayer: Layer = {
                ...srcLayer,
                id: newId,
                name: newName,
                x: srcLayer.x + offsetX,
                y: srcLayer.y + offsetY,
                ...(srcLayer.type === "frame" ? { childIds: [] as string[] } : {}),
            } as Layer;

            const masterId = uuid();
            const master: MasterComponent = {
                id: masterId,
                name: newName,
                type: srcLayer.type,
                slotId: srcLayer.slotId,
                props: { ...newLayer } as ComponentProps,
            };
            delete (master.props as unknown as Record<string, unknown>).id;
            delete (master.props as unknown as Record<string, unknown>).masterId;

            newLayer.masterId = masterId;

            const instances: ComponentInstance[] = state.resizes
                .filter((r) => r.id !== "master")
                .map((r) => ({
                    id: uuid(),
                    masterId,
                    resizeId: r.id,
                    localProps: { ...master.props },
                }));

            newLayers.push(newLayer);
            newMasters.push(master);
            newInstances.push(...instances);

            return newId;
        };

        const newRootId = duplicateOne(layer, 20, 20);

        if (layer.type === "frame") {
            const frame = layer as FrameLayer;
            const rootDuplicate = newLayers.find((l) => l.id === newRootId) as FrameLayer;
            const duplicateChildren = (srcChildIds: string[], parentDuplicate: FrameLayer) => {
                for (const childId of srcChildIds) {
                    const child = state.layers.find((l) => l.id === childId);
                    if (!child) continue;
                    const newChildId = duplicateOne(child, 20, 20);
                    parentDuplicate.childIds.push(newChildId);
                    if (child.type === "frame") {
                        const childFrame = child as FrameLayer;
                        const childDuplicate = newLayers.find((l) => l.id === newChildId) as FrameLayer;
                        duplicateChildren(childFrame.childIds, childDuplicate);
                    }
                }
            };
            duplicateChildren(frame.childIds, rootDuplicate);
        }

        set((s) => ({
            layers: [...s.layers, ...newLayers],
            masterComponents: [...s.masterComponents, ...newMasters],
            componentInstances: [...s.componentInstances, ...newInstances],
            selectedLayerIds: [newRootId],
        }));
    },

    // ─── duplicateSelectedLayers ─────────────────────────

    duplicateSelectedLayers: () => {
        const state = get();
        const { selectedLayerIds } = state;
        if (selectedLayerIds.length === 0) return;

        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);

        const newLayers: Layer[] = [];
        const newMasters: MasterComponent[] = [];
        const newInstances: ComponentInstance[] = [];
        const newSelectedIds: string[] = [];

        const duplicateOne = (srcLayer: Layer, offsetX: number, offsetY: number): string => {
            const newId = uuid();
            const newName = srcLayer.name + " копия";
            const newLayer: Layer = {
                ...srcLayer,
                id: newId,
                name: newName,
                x: srcLayer.x + offsetX,
                y: srcLayer.y + offsetY,
                ...(srcLayer.type === "frame" ? { childIds: [] as string[] } : {}),
            } as Layer;

            const masterId = uuid();
            const master: MasterComponent = {
                id: masterId,
                name: newName,
                type: srcLayer.type,
                slotId: srcLayer.slotId,
                props: { ...newLayer } as ComponentProps,
            };
            delete (master.props as unknown as Record<string, unknown>).id;
            delete (master.props as unknown as Record<string, unknown>).masterId;

            newLayer.masterId = masterId;

            const instances: ComponentInstance[] = state.resizes
                .filter((r) => r.id !== "master")
                .map((r) => ({
                    id: uuid(),
                    masterId,
                    resizeId: r.id,
                    localProps: { ...master.props },
                }));

            newLayers.push(newLayer);
            newMasters.push(master);
            newInstances.push(...instances);

            return newId;
        };

        for (const id of selectedLayerIds) {
            const layer = state.layers.find((l) => l.id === id);
            if (!layer) continue;

            const newRootId = duplicateOne(layer, 20, 20);
            newSelectedIds.push(newRootId);

            if (layer.type === "frame") {
                const frame = layer as FrameLayer;
                const rootDuplicate = newLayers.find((l) => l.id === newRootId) as FrameLayer;
                const duplicateChildren = (srcChildIds: string[], parentDuplicate: FrameLayer) => {
                    for (const childId of srcChildIds) {
                        const child = state.layers.find((l) => l.id === childId);
                        if (!child) continue;
                        const newChildId = duplicateOne(child, 20, 20);
                        parentDuplicate.childIds.push(newChildId);
                        if (child.type === "frame") {
                            const childFrame = child as FrameLayer;
                            const childDuplicate = newLayers.find((l) => l.id === newChildId) as FrameLayer;
                            duplicateChildren(childFrame.childIds, childDuplicate);
                        }
                    }
                };
                duplicateChildren(frame.childIds, rootDuplicate);
            }
        }

        set((s) => ({
            layers: [...s.layers, ...newLayers],
            masterComponents: [...s.masterComponents, ...newMasters],
            componentInstances: [...s.componentInstances, ...newInstances],
            selectedLayerIds: newSelectedIds,
        }));
    },

    // ─── Ordering ───────────────────────────────────────

    bringToFront: (id) => {
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);
        set((state) => {
            const idx = state.layers.findIndex((l) => l.id === id);
            if (idx === -1 || idx === state.layers.length - 1) return state;
            const layers = [...state.layers];
            const [moved] = layers.splice(idx, 1);
            layers.push(moved);
            return { layers: applyAllAutoLayouts(layers) };
        });
    },

    sendToBack: (id) => {
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);
        set((state) => {
            const idx = state.layers.findIndex((l) => l.id === id);
            if (idx <= 0) return state;
            const layers = [...state.layers];
            const [moved] = layers.splice(idx, 1);
            layers.unshift(moved);
            return { layers: applyAllAutoLayouts(layers) };
        });
    },

    reorderLayers: (fromIndex, toIndex) => {
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);
        set((state) => {
            const layers = [...state.layers];
            const [moved] = layers.splice(fromIndex, 1);
            layers.splice(toIndex, 0, moved);
            const newLayers = applyAllAutoLayouts(layers);
            const derivedSync = syncDerivedLayoutToSource(
                state.layers, newLayers, state.masterComponents, state.componentInstances, state.activeResizeId
            );
            return { layers: newLayers, ...derivedSync };
        });
    },

    reorderLayer: (layerId, mode) => {
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);

        set((state) => {
            let layers = [...state.layers];

            const parentFrame = layers.find(l => l.type === "frame" && (l as FrameLayer).childIds.includes(layerId)) as FrameLayer | undefined;

            if (parentFrame) {
                const idx = parentFrame.childIds.indexOf(layerId);
                const maxIdx = parentFrame.childIds.length - 1;
                if (idx !== -1) {
                    const newChildIds = [...parentFrame.childIds];
                    newChildIds.splice(idx, 1);

                    if (mode === "top") newChildIds.push(layerId);
                    else if (mode === "bottom") newChildIds.unshift(layerId);
                    else if (mode === "up") newChildIds.splice(Math.min(maxIdx, idx + 1), 0, layerId);
                    else if (mode === "down") newChildIds.splice(Math.max(0, idx - 1), 0, layerId);

                    layers = layers.map(l => l.id === parentFrame.id ? { ...l, childIds: newChildIds } as FrameLayer : l);
                }
            } else {
                const idx = layers.findIndex(l => l.id === layerId);
                if (idx !== -1) {
                    const [moved] = layers.splice(idx, 1);
                    if (mode === "top") layers.push(moved);
                    else if (mode === "bottom") layers.unshift(moved);
                    else if (mode === "up") layers.splice(Math.min(layers.length, idx + 1), 0, moved);
                    else if (mode === "down") layers.splice(Math.max(0, idx - 1), 0, moved);
                }
            }

            const newLayers = applyAllAutoLayouts(layers);
            const derivedSync = syncDerivedLayoutToSource(
                state.layers, newLayers, state.masterComponents, state.componentInstances, state.activeResizeId
            );
            return { layers: newLayers, ...derivedSync };
        });
    },

    // ─── Frame operations ───────────────────────────────

    moveLayerToFrame: (layerId, frameId, dropIndex) => {
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);
        set((state) => {
            let newLayers = [...state.layers];

            const currentParent = newLayers.find(l => l.type === "frame" && (l as FrameLayer).childIds.includes(layerId)) as FrameLayer | undefined;
            if (currentParent && currentParent.id !== frameId) {
                newLayers = newLayers.map(l => l.id === currentParent.id ? { ...l, childIds: (l as FrameLayer).childIds.filter((id: string) => id !== layerId) } as FrameLayer : l);
            }

            newLayers = newLayers.map(l => {
                if (l.id === frameId && l.type === "frame") {
                    const childIds = (l as FrameLayer).childIds.filter((id: string) => id !== layerId);
                    if (dropIndex !== undefined && dropIndex >= 0) {
                        childIds.splice(dropIndex, 0, layerId);
                    } else {
                        childIds.push(layerId);
                    }
                    return { ...l, childIds } as Layer;
                }
                return l;
            });

            const newMasters = syncFrameChildIdsToMasters(newLayers, state.masterComponents);
            const newInstances = syncFrameChildIdsToInstances(newLayers, state.masterComponents, state.componentInstances, state.activeResizeId);
            return { layers: applyAllAutoLayouts(newLayers), masterComponents: newMasters, componentInstances: newInstances };
        });
    },

    removeLayerFromFrame: (layerId) => {
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);
        set((state) => {
            const newLayers = state.layers.map((l) => {
                if (l.type === "frame" && (l as FrameLayer).childIds.includes(layerId)) {
                    return { ...l, childIds: (l as FrameLayer).childIds.filter((c) => c !== layerId) } as Layer;
                }
                return l;
            });
            const newMasters = syncFrameChildIdsToMasters(newLayers, state.masterComponents);
            const newInstances = syncFrameChildIdsToInstances(newLayers, state.masterComponents, state.componentInstances, state.activeResizeId);
            return { layers: applyAllAutoLayouts(newLayers), masterComponents: newMasters, componentInstances: newInstances };
        });
    },

    // ─── Visibility / Lock ──────────────────────────────

    toggleLayerVisibility: (id) => {
        set((state) => ({
            layers: state.layers.map((l) =>
                l.id === id ? ({ ...l, visible: !l.visible } as Layer) : l
            ),
        }));
    },

    toggleLayerLock: (id) => {
        set((state) => ({
            layers: state.layers.map((l) => (l.id === id ? { ...l, locked: !l.locked } as Layer : l)),
        }));
    },

    // ─── pasteLayers (from clipboard) ───────────────────

    pasteLayers: (rawLayers) => {
        if (rawLayers.length === 0) return;
        const state = get();

        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);

        // Build old→new ID mapping
        const idMap = new Map<string, string>();
        for (const layer of rawLayers) {
            idMap.set(layer.id, uuid());
        }

        const OFFSET = 20;
        const newLayers: Layer[] = [];
        const newMasters: MasterComponent[] = [];
        const newInstances: ComponentInstance[] = [];
        const newSelectedIds: string[] = [];

        // Find root layers (those that are NOT children of any frame in the paste set)
        const allChildIds = new Set<string>();
        for (const layer of rawLayers) {
            if (layer.type === "frame") {
                for (const cid of (layer as FrameLayer).childIds) {
                    allChildIds.add(cid);
                }
            }
        }
        const rootLayerIds = new Set(
            rawLayers.filter(l => !allChildIds.has(l.id)).map(l => l.id)
        );

        for (const rawLayer of rawLayers) {
            const newId = idMap.get(rawLayer.id)!;
            const isRoot = rootLayerIds.has(rawLayer.id);

            const newLayer: Layer = {
                ...rawLayer,
                id: newId,
                // Only offset root layers (children stay relative to parent)
                x: isRoot ? rawLayer.x + OFFSET : rawLayer.x,
                y: isRoot ? rawLayer.y + OFFSET : rawLayer.y,
            } as Layer;

            // Remap frame childIds
            if (newLayer.type === "frame") {
                (newLayer as FrameLayer).childIds = (rawLayer as FrameLayer).childIds
                    .map(cid => idMap.get(cid) ?? cid)
                    .filter(cid => cid !== undefined);
            }

            // Clear old masterId — each pasted layer gets a fresh master
            delete (newLayer as any).masterId;

            // Create new master component
            const masterId = uuid();
            const propsClone = { ...newLayer } as any;
            delete propsClone.id;
            delete propsClone.masterId;

            const master: MasterComponent = {
                id: masterId,
                name: newLayer.name,
                type: newLayer.type,
                slotId: newLayer.slotId,
                props: propsClone as ComponentProps,
            };

            newLayer.masterId = masterId;

            // Create instances for other formats
            const instances: ComponentInstance[] = state.resizes
                .filter(r => r.id !== "master")
                .map(r => ({
                    id: uuid(),
                    masterId,
                    resizeId: r.id,
                    localProps: { ...master.props },
                }));

            newLayers.push(newLayer);
            newMasters.push(master);
            newInstances.push(...instances);

            if (isRoot) {
                newSelectedIds.push(newId);
            }
        }

        set((s) => ({
            layers: [...s.layers, ...newLayers],
            masterComponents: [...s.masterComponents, ...newMasters],
            componentInstances: [...s.componentInstances, ...newInstances],
            selectedLayerIds: newSelectedIds,
        }));
    },
});
