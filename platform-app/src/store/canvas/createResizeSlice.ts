/**
 * Resize Slice — Format management, syncLayersToResize, toggleInstanceMode
 *
 * Supports two modes:
 * 1. Legacy master/instance mode — when masterComponents exist
 * 2. Snapshot/page mode — each format stores its own independent layers
 */

import type { StateCreator } from "zustand";
import type { CanvasStore, Layer, ComponentProps, ComponentInstance, ResizeFormat, LayerBinding } from "./types";
import { migrateLegacyBinding } from "@/types";
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

    setActiveResize: (resizeId) => {
        const state = get();
        const targetResize = state.resizes.find((r) => r.id === resizeId);
        if (!targetResize) return;
        if (resizeId === state.activeResizeId) return;

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

                // Apply cascade
                const cascadedLayers = applyCascade(
                    currentState.layers,  // target format's loaded snapshot
                    resolvedMasterLayers, // master's layers
                    targetResize.layerBindings
                );

                if (cascadedLayers !== currentState.layers) {
                    set({ layers: cascadedLayers });
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
        set({
            canvasWidth: width,
            canvasHeight: height,
            resizes: state.resizes.map((r) =>
                r.id === state.activeResizeId
                    ? { ...r, width, height, label: `${width} × ${height}` }
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
        set((state) => ({
            resizes: state.resizes.map((r) =>
                r.id === formatId ? { ...r, layerBindings: bindings } : r
            ),
        }));
    },

    unbindFormat: (formatId) => {
        set((state) => ({
            resizes: state.resizes.map((r) =>
                r.id === formatId ? { ...r, layerBindings: undefined } : r
            ),
        }));
    },
});

// ── Cascade helper ──────────────────────────────────────

/** Property sets for each sync category */
const CONTENT_PROPS = ['text', 'src', 'label'] as const;
const STYLE_PROPS = [
    'fill', 'stroke', 'strokeWidth', 'fontSize', 'fontFamily', 'fontWeight',
    'align', 'letterSpacing', 'lineHeight', 'cornerRadius', 'objectFit',
    'textColor', 'textAdjust', 'truncateText', 'verticalTrim',
] as const;
const SIZE_PROPS = ['width', 'height'] as const;
const POSITION_PROPS = ['x', 'y', 'rotation'] as const;

/**
 * Build the list of properties to sync based on binding flags.
 * Auto-migrates legacy syncMode if flags are missing.
 */
function getPropsForBinding(binding: LayerBinding): readonly string[] {
    // Auto-migrate legacy syncMode if flags aren't set
    if (binding.syncContent === undefined && binding.syncMode) {
        const migrated = migrateLegacyBinding(binding);
        return getPropsForBinding(migrated);
    }

    const props: string[] = [];
    if (binding.syncContent) props.push(...CONTENT_PROPS);
    if (binding.syncStyle) props.push(...STYLE_PROPS);
    if (binding.syncSize) props.push(...SIZE_PROPS);
    if (binding.syncPosition) props.push(...POSITION_PROPS);
    return props;
}

/**
 * Apply master cascade to target layers based on bindings.
 * Returns updated layers array (or same reference if no changes).
 */
function applyCascade(
    targetLayers: Layer[],
    masterLayers: Layer[],
    bindings: LayerBinding[],
): Layer[] {
    if (bindings.length === 0 || masterLayers.length === 0) return targetLayers;

    const masterMap = new Map<string, Layer>();
    masterLayers.forEach(l => masterMap.set(l.id, l));

    let changed = false;
    const result = targetLayers.map(layer => {
        const rawBinding = bindings.find(b => b.targetLayerId === layer.id);
        if (!rawBinding) return layer;

        // Auto-migrate legacy binding on the fly
        const binding = rawBinding.syncContent !== undefined
            ? rawBinding
            : migrateLegacyBinding(rawBinding);

        // Check if all flags are off (equivalent to 'none')
        if (!binding.syncContent && !binding.syncStyle && !binding.syncSize && !binding.syncPosition) {
            return layer;
        }

        const masterLayer = masterMap.get(binding.masterLayerId);
        if (!masterLayer) return layer;

        const propsToSync = getPropsForBinding(binding);
        const updates: Record<string, unknown> = {};
        let hasUpdate = false;

        for (const prop of propsToSync) {
            const masterVal = (masterLayer as unknown as Record<string, unknown>)[prop];
            const targetVal = (layer as unknown as Record<string, unknown>)[prop];
            if (masterVal !== undefined && masterVal !== targetVal) {
                updates[prop] = masterVal;
                hasUpdate = true;
            }
        }

        if (hasUpdate) {
            changed = true;
            return { ...layer, ...updates } as Layer;
        }
        return layer;
    });

    return changed ? result : targetLayers;
}
