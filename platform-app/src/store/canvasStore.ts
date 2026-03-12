import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type {
    Layer,
    TextLayer,
    RectangleLayer,
    ImageLayer,
    BadgeLayer,
    FrameLayer,
    ToolType,
    MasterComponent,
    ComponentInstance,
    ComponentProps,
    ResizeFormat,
    EditorMode,
    LayerConstraints,
} from "@/types";
import { CONTENT_SOURCE_KEYS, DEFAULT_CONSTRAINTS } from "@/types";
import { applyLayout } from "@/services/layoutEngine";
import { applyAllAutoLayouts } from "@/utils/layoutEngine";
import type { SlotMapping } from "@/services/slotMappingService";
import type { TemplatePack } from "@/services/templateService";
import { DEFAULT_SNAP_CONFIG } from "@/services/snapService";
import type { SnapConfig } from "@/services/snapService";

export interface ArtboardProps {
    fill: string;
    cornerRadius: number;
    clipContent: boolean;
    stroke: string;
    strokeWidth: number;
}

// ─── Constraint helpers ─────────────────────────────────
export interface FrameResizeDelta {
    oldX: number;
    oldY: number;
    oldWidth: number;
    oldHeight: number;
    newX: number;
    newY: number;
    newWidth: number;
    newHeight: number;
}

/**
 * Given a child's absolute position/size and the parent frame's old & new
 * bounds, returns the child's new absolute position/size that honours its
 * `constraints` setting.
 */
export function computeConstrainedPosition(
    child: { x: number; y: number; width: number; height: number; constraints?: LayerConstraints },
    delta: FrameResizeDelta,
): { x: number; y: number; width: number; height: number } {
    const c = child.constraints ?? DEFAULT_CONSTRAINTS;
    const { oldX, oldY, oldWidth, oldHeight, newX, newY, newWidth, newHeight } = delta;

    // Child offsets relative to the OLD frame
    const relX = child.x - oldX;
    const relY = child.y - oldY;
    const rightGap = oldWidth - (relX + child.width);
    const bottomGap = oldHeight - (relY + child.height);

    let outX = child.x;
    let outY = child.y;
    let outW = child.width;
    let outH = child.height;

    // ── HORIZONTAL ──
    switch (c.horizontal) {
        case "left":
            // Keep distance from left edge
            outX = newX + relX;
            break;
        case "right":
            // Keep distance from right edge
            outX = newX + newWidth - rightGap - child.width;
            break;
        case "center": {
            // Keep center ratio
            const centerRatio = (relX + child.width / 2) / oldWidth;
            outX = newX + centerRatio * newWidth - child.width / 2;
            break;
        }
        case "stretch":
            // Pin both left and right edges
            outX = newX + relX;
            outW = newWidth - relX - rightGap;
            break;
        case "scale": {
            // Scale proportionally
            const sx = newWidth / oldWidth;
            outX = newX + relX * sx;
            outW = child.width * sx;
            break;
        }
    }

    // ── VERTICAL ──
    switch (c.vertical) {
        case "top":
            outY = newY + relY;
            break;
        case "bottom":
            outY = newY + newHeight - bottomGap - child.height;
            break;
        case "center": {
            const centerRatio = (relY + child.height / 2) / oldHeight;
            outY = newY + centerRatio * newHeight - child.height / 2;
            break;
        }
        case "stretch":
            outY = newY + relY;
            outH = newHeight - relY - bottomGap;
            break;
        case "scale": {
            const sy = newHeight / oldHeight;
            outY = newY + relY * sy;
            outH = child.height * sy;
            break;
        }
    }

    return { x: outX, y: outY, width: Math.max(1, outW), height: Math.max(1, outH) };
}

const MAX_HISTORY = 50;

interface HistorySnapshot {
    layers: Layer[];
    masterComponents: MasterComponent[];
    componentInstances: ComponentInstance[];
    selectedLayerIds: string[];
}

// Throttle timer for updateLayer history
let _updateHistoryTimer: ReturnType<typeof setTimeout> | null = null;
let _updateHistoryPushed = false;

interface CanvasStore {
    // Layers (rendered on canvas, derived from components for active resize)
    layers: Layer[];
    selectedLayerIds: string[];
    activeTool: ToolType;
    canvasWidth: number;
    canvasHeight: number;
    zoom: number;
    stageX: number;
    stageY: number;

    // Artboard
    artboardProps: ArtboardProps;

    // Snap config
    snapConfig: SnapConfig;

    // Drag-to-frame highlight
    highlightedFrameId: string | null;

    // Component model
    masterComponents: MasterComponent[];
    componentInstances: ComponentInstance[];

    // Resize
    resizes: ResizeFormat[];
    activeResizeId: string;

    // Editor mode
    editorMode: EditorMode;

    // Inline text editing
    isEditingText: boolean;
    editingLayerId: string | null;

    // Undo / Redo
    history: HistorySnapshot[];
    historyIndex: number;
    future: HistorySnapshot[];

    // Layer actions
    addTextLayer: (overrides?: Partial<TextLayer>) => void;
    addRectangleLayer: (overrides?: Partial<RectangleLayer>) => void;
    addImageLayer: (src: string, width: number, height: number) => void;
    addBadgeLayer: (overrides?: Partial<BadgeLayer>) => void;
    addFrameLayer: (overrides?: Partial<FrameLayer>) => void;
    updateLayer: (id: string, updates: Partial<Layer>) => void;
    removeLayer: (id: string) => void;
    selectLayer: (id: string | string[] | null) => void;
    toggleSelection: (id: string) => void;
    addToSelection: (id: string) => void;
    removeFromSelection: (id: string) => void;
    deleteSelectedLayers: () => void;
    batchUpdateLayers: (updates: { id: string; changes: Partial<Layer> }[]) => void;
    alignSelectedLayers: (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
    duplicateSelectedLayers: () => void;
    reorderLayers: (fromIndex: number, toIndex: number) => void;
    reorderLayer: (layerId: string, mode: "up" | "down" | "top" | "bottom") => void;
    toggleLayerVisibility: (id: string) => void;
    toggleLayerLock: (id: string) => void;
    duplicateLayer: (id: string) => void;
    bringToFront: (id: string) => void;
    sendToBack: (id: string) => void;
    moveLayerToFrame: (layerId: string, frameId: string, dropIndex?: number) => void;
    removeLayerFromFrame: (layerId: string) => void;

    // Undo / Redo actions
    undo: () => void;
    redo: () => void;

    // Artboard actions
    updateArtboardProps: (updates: Partial<ArtboardProps>) => void;
    updateSnapConfig: (updates: Partial<SnapConfig>) => void;

    // Drag-to-frame actions
    setHighlightedFrameId: (id: string | null) => void;
    getFrameAtPoint: (x: number, y: number, excludeId?: string) => FrameLayer | null;

    // Component actions
    promoteToMaster: (layerId: string) => void;
    updateMasterComponent: (masterId: string, updates: Partial<ComponentProps>) => void;

    // Resize actions
    addResize: (format: ResizeFormat) => void;
    removeResize: (resizeId: string) => void;
    renameResize: (resizeId: string, name: string) => void;
    setActiveResize: (resizeId: string) => void;
    syncLayersToResize: () => void;
    toggleInstanceMode: (resizeId: string) => void;

    // Mode
    setEditorMode: (mode: EditorMode) => void;

    // Canvas actions
    setActiveTool: (tool: ToolType) => void;
    setZoom: (zoom: number) => void;
    setStagePosition: (x: number, y: number) => void;
    setCanvasSize: (width: number, height: number) => void;
    resetCanvas: () => void;
    loadTemplatePack: (data: { masterComponents: MasterComponent[]; componentInstances: ComponentInstance[]; resizes: ResizeFormat[]; layers?: Layer[]; baseWidth: number; baseHeight: number; }) => void;
    applySmartResize: (templatePack: TemplatePack, mappings: SlotMapping[]) => { unmappedSlotNames: string[] };

    // Inline text editing
    startTextEditing: (layerId: string) => void;
    stopTextEditing: () => void;
}

const DEFAULT_RESIZE: ResizeFormat = {
    id: "master",
    name: "Master",
    width: 1080,
    height: 1080,
    label: "1080 × 1080",
    instancesEnabled: false, // Master itself doesn't receive cascades
};

/**
 * Helper: extract content-source keys from master props for a given component type
 */
function getContentSourceUpdates(master: MasterComponent): Record<string, unknown> {
    const keys = CONTENT_SOURCE_KEYS[master.type] || [];
    const updates: Record<string, unknown> = {};
    const props = master.props as unknown as Record<string, unknown>;
    for (const key of keys) {
        updates[key] = props[key];
    }
    return updates;
}

const DEFAULT_ARTBOARD_PROPS: ArtboardProps = {
    fill: "#FFFFFF",
    cornerRadius: 0,
    clipContent: true,
    stroke: "",
    strokeWidth: 0,
};

/**
 * Sync `childIds` from runtime layers back into masterComponent props.
 * This keeps nesting intact when switching resize formats.
 */
function syncFrameChildIdsToMasters(
    layers: Layer[],
    masters: MasterComponent[],
): MasterComponent[] {
    return masters.map((m) => {
        if (m.type !== "frame") return m;
        const frameLayer = layers.find((l) => l.masterId === m.id && l.type === "frame") as FrameLayer | undefined;
        if (!frameLayer) return m;
        // Convert layer-level childIds to master-level childIds
        // childIds in layers are layer IDs; we need to keep them as-is since
        // syncLayersToResize preserves layer IDs via existingLayer?.id
        const frameProps = m.props as FrameLayer;
        if (JSON.stringify(frameProps.childIds) === JSON.stringify(frameLayer.childIds)) return m;
        return { ...m, props: { ...m.props, childIds: [...frameLayer.childIds] } as ComponentProps };
    });
}

function syncFrameChildIdsToInstances(
    layers: Layer[],
    masters: MasterComponent[],
    instances: ComponentInstance[],
    activeResizeId: string,
): ComponentInstance[] {
    return instances.map((inst) => {
        const master = masters.find((m) => m.id === inst.masterId);
        if (!master || master.type !== "frame") return inst;
        const frameLayer = layers.find((l) => l.masterId === master.id && l.type === "frame") as FrameLayer | undefined;
        if (!frameLayer) return inst;
        // Only update the instance for the currently active resize
        if (inst.resizeId !== activeResizeId) return inst;
        const instProps = inst.localProps as FrameLayer;
        if (JSON.stringify(instProps.childIds) === JSON.stringify(frameLayer.childIds)) return inst;
        return { ...inst, localProps: { ...inst.localProps, childIds: [...frameLayer.childIds] } as ComponentProps };
    });
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
    layers: [],
    selectedLayerIds: [],
    activeTool: "select",
    canvasWidth: DEFAULT_RESIZE.width,
    canvasHeight: DEFAULT_RESIZE.height,
    zoom: 0.5,
    stageX: 0,
    stageY: 0,

    artboardProps: { ...DEFAULT_ARTBOARD_PROPS },
    snapConfig: { ...DEFAULT_SNAP_CONFIG },
    highlightedFrameId: null,

    // Undo / Redo
    history: [],
    historyIndex: -1,
    future: [],

    masterComponents: [],
    componentInstances: [],

    resizes: [DEFAULT_RESIZE],
    activeResizeId: "master",

    editorMode: "studio",

    isEditingText: false,
    editingLayerId: null,

    // ─── Undo / Redo ────────────────────────────────────
    undo: () => {
        const state = get();
        if (state.history.length === 0) return;
        const prev = state.history[state.history.length - 1];
        const currentSnapshot: HistorySnapshot = {
            layers: state.layers,
            masterComponents: state.masterComponents,
            componentInstances: state.componentInstances,
            selectedLayerIds: state.selectedLayerIds,
        };
        set({
            history: state.history.slice(0, -1),
            layers: prev.layers,
            masterComponents: prev.masterComponents,
            componentInstances: prev.componentInstances,
            selectedLayerIds: prev.selectedLayerIds,
            future: [currentSnapshot, ...state.future].slice(0, MAX_HISTORY),
        });
    },

    redo: () => {
        const state = get();
        if (state.future.length === 0) return;
        const next = state.future[0];
        const currentSnapshot: HistorySnapshot = {
            layers: state.layers,
            masterComponents: state.masterComponents,
            componentInstances: state.componentInstances,
            selectedLayerIds: state.selectedLayerIds,
        };
        set({
            future: state.future.slice(1),
            layers: next.layers,
            masterComponents: next.masterComponents,
            componentInstances: next.componentInstances,
            selectedLayerIds: next.selectedLayerIds,
            history: [...state.history, currentSnapshot].slice(-MAX_HISTORY),
        });
    },

    // ─── Layer creation ─────────────────────────────────
    addTextLayer: (overrides = {}) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerIds: _s.selectedLayerIds };
        set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
        const id = uuid();
        const masterId = uuid();
        const layer: TextLayer = {
            id,
            type: "text",
            name: "Text",
            x: 100,
            y: 100,
            width: 300,
            height: 60,
            rotation: 0,
            visible: true,
            locked: false,
            text: "Type something",
            fontSize: 48,
            fontFamily: "Inter",
            fontWeight: "600",
            fill: "#111827",
            align: "left",
            letterSpacing: 0,
            lineHeight: 1.2,
            textAdjust: "auto_width",
            truncateText: false,
            verticalTrim: false,
            masterId,
            ...overrides,
        };
        const master: MasterComponent = {
            id: masterId,
            type: "text",
            name: layer.name,
            slotId: layer.slotId,
            props: {
                type: "text",
                slotId: layer.slotId,
                x: layer.x,
                y: layer.y,
                width: layer.width,
                height: layer.height,
                rotation: layer.rotation,
                visible: layer.visible,
                locked: layer.locked,
                text: layer.text,
                fontSize: layer.fontSize,
                fontFamily: layer.fontFamily,
                fontWeight: layer.fontWeight,
                fill: layer.fill,
                align: layer.align,
                letterSpacing: layer.letterSpacing,
                lineHeight: layer.lineHeight,
                textAdjust: layer.textAdjust,
                truncateText: layer.truncateText,
                verticalTrim: layer.verticalTrim,
            },
        };
        // Auto-create instances for existing non-master resizes
        const state = get();
        const newInstances: ComponentInstance[] = state.resizes
            .filter((r) => r.id !== "master")
            .map((r) => ({
                id: uuid(),
                masterId,
                resizeId: r.id,
                localProps: { ...master.props },
            }));
        set((s) => ({
            layers: [...s.layers, layer],
            masterComponents: [...s.masterComponents, master],
            componentInstances: [...s.componentInstances, ...newInstances],
            selectedLayerIds: [id],
            activeTool: "select",
        }));
    },

    addRectangleLayer: (overrides = {}) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerIds: _s.selectedLayerIds };
        set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
        const id = uuid();
        const masterId = uuid();
        const layer: RectangleLayer = {
            id,
            type: "rectangle",
            name: "Rectangle",
            x: 100,
            y: 100,
            width: 200,
            height: 200,
            rotation: 0,
            visible: true,
            locked: false,
            fill: "#E5E7EB",
            stroke: "",
            strokeWidth: 0,
            cornerRadius: 0,
            masterId,
            ...overrides,
        };
        const master: MasterComponent = {
            id: masterId,
            type: "rectangle",
            name: layer.name,
            slotId: layer.slotId,
            props: {
                type: "rectangle",
                slotId: layer.slotId,
                x: layer.x,
                y: layer.y,
                width: layer.width,
                height: layer.height,
                rotation: layer.rotation,
                visible: layer.visible,
                locked: layer.locked,
                fill: layer.fill,
                stroke: layer.stroke,
                strokeWidth: layer.strokeWidth,
                cornerRadius: layer.cornerRadius,
            },
        };
        const state = get();
        const newInstances: ComponentInstance[] = state.resizes
            .filter((r) => r.id !== "master")
            .map((r) => ({
                id: uuid(),
                masterId,
                resizeId: r.id,
                localProps: { ...master.props },
            }));
        set((s) => ({
            layers: [...s.layers, layer],
            masterComponents: [...s.masterComponents, master],
            componentInstances: [...s.componentInstances, ...newInstances],
            selectedLayerIds: [id],
            activeTool: "select",
        }));
    },

    addImageLayer: (src, width, height) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerIds: _s.selectedLayerIds };
        set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
        const id = uuid();
        const masterId = uuid();
        const layer: ImageLayer = {
            id,
            type: "image",
            name: "Image",
            x: 100,
            y: 100,
            width,
            height,
            rotation: 0,
            visible: true,
            locked: false,
            src,
            masterId,
        };
        const master: MasterComponent = {
            id: masterId,
            type: "image",
            name: layer.name,
            slotId: layer.slotId,
            props: {
                type: "image",
                slotId: layer.slotId,
                x: layer.x,
                y: layer.y,
                width: layer.width,
                height: layer.height,
                rotation: layer.rotation,
                visible: layer.visible,
                locked: layer.locked,
                src: layer.src,
                objectFit: "cover",
            },
        };
        const state = get();
        const newInstances: ComponentInstance[] = state.resizes
            .filter((r) => r.id !== "master")
            .map((r) => ({
                id: uuid(),
                masterId,
                resizeId: r.id,
                localProps: { ...master.props },
            }));
        set((s) => ({
            layers: [...s.layers, layer],
            masterComponents: [...s.masterComponents, master],
            componentInstances: [...s.componentInstances, ...newInstances],
            selectedLayerIds: [id],
            activeTool: "select",
        }));
    },

    addBadgeLayer: (overrides = {}) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerIds: _s.selectedLayerIds };
        set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
        const id = uuid();
        const masterId = uuid();
        const layer: BadgeLayer = {
            id,
            type: "badge",
            name: "Badge",
            x: 100,
            y: 100,
            width: 120,
            height: 36,
            rotation: 0,
            visible: true,
            locked: false,
            label: "NEW",
            shape: "pill",
            fill: "#6366F1",
            textColor: "#FFFFFF",
            fontSize: 14,
            masterId,
            ...overrides,
        };
        const master: MasterComponent = {
            id: masterId,
            type: "badge",
            name: layer.name,
            slotId: layer.slotId,
            props: {
                type: "badge",
                slotId: layer.slotId,
                x: layer.x,
                y: layer.y,
                width: layer.width,
                height: layer.height,
                rotation: layer.rotation,
                visible: layer.visible,
                locked: layer.locked,
                label: layer.label,
                shape: layer.shape,
                fill: layer.fill,
                textColor: layer.textColor,
                fontSize: layer.fontSize,
            },
        };
        const state = get();
        const newInstances: ComponentInstance[] = state.resizes
            .filter((r) => r.id !== "master")
            .map((r) => ({
                id: uuid(),
                masterId,
                resizeId: r.id,
                localProps: { ...master.props },
            }));
        set((s) => ({
            layers: [...s.layers, layer],
            masterComponents: [...s.masterComponents, master],
            componentInstances: [...s.componentInstances, ...newInstances],
            selectedLayerIds: [id],
            activeTool: "select",
        }));
    },

    addFrameLayer: (overrides = {}) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerIds: _s.selectedLayerIds };
        set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
        const id = uuid();
        const masterId = uuid();
        const layer: FrameLayer = {
            id,
            type: "frame",
            name: "Frame",
            x: 100,
            y: 100,
            width: 400,
            height: 300,
            rotation: 0,
            visible: true,
            locked: false,
            fill: "#FFFFFF",
            stroke: "#E5E7EB",
            strokeWidth: 1,
            cornerRadius: 0,
            clipContent: true,
            childIds: [],
            masterId,
            ...overrides,
        };
        const master: MasterComponent = {
            id: masterId,
            type: "frame",
            name: layer.name,
            slotId: layer.slotId,
            props: {
                type: "frame",
                slotId: layer.slotId,
                x: layer.x,
                y: layer.y,
                width: layer.width,
                height: layer.height,
                rotation: layer.rotation,
                visible: layer.visible,
                locked: layer.locked,
                fill: layer.fill,
                stroke: layer.stroke,
                strokeWidth: layer.strokeWidth,
                cornerRadius: layer.cornerRadius,
                clipContent: layer.clipContent,
                childIds: [],
            },
        };
        const state = get();
        const newInstances: ComponentInstance[] = state.resizes
            .filter((r) => r.id !== "master")
            .map((r) => ({
                id: uuid(),
                masterId,
                resizeId: r.id,
                localProps: { ...master.props },
            }));
        set((s) => ({
            layers: [...s.layers, layer],
            masterComponents: [...s.masterComponents, master],
            componentInstances: [...s.componentInstances, ...newInstances],
            selectedLayerIds: [id],
            activeTool: "select",
        }));
    },

    updateLayer: (id, updates) => {
        // Throttled history push: save snapshot on first call, skip during rapid updates (drag/nudge)
        if (!_updateHistoryPushed) {
            const _s = get();
            const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerIds: _s.selectedLayerIds };
            set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
            _updateHistoryPushed = true;
        }
        if (_updateHistoryTimer) clearTimeout(_updateHistoryTimer);
        _updateHistoryTimer = setTimeout(() => { _updateHistoryPushed = false; }, 300);

        set((state) => {
            // Helper to get all layers including updated children
            const computeUpdatedLayers = (currentLayers: Layer[], targetId: string, layerUpdates: Partial<Layer>): Layer[] => {
                const targetLayer = currentLayers.find(l => l.id === targetId);
                if (!targetLayer) return currentLayers;

                // 1. Calculate delta if position changed
                let dx = 0;
                let dy = 0;
                if (targetLayer.type === "frame" && (layerUpdates.x !== undefined || layerUpdates.y !== undefined)) {
                    if (layerUpdates.x !== undefined) dx = (layerUpdates.x as number) - targetLayer.x;
                    if (layerUpdates.y !== undefined) dy = (layerUpdates.y as number) - targetLayer.y;
                }

                // 2. Identify children to move (if any)
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
                    collect(targetId);
                }

                // 3. Map all layers
                return currentLayers.map(l => {
                    // Target layer gets explicit updates
                    if (l.id === targetId) {
                        return { ...l, ...layerUpdates } as Layer;
                    }
                    // Children get delta updates
                    if (childrenIdsToMove.has(l.id)) {
                        return {
                            ...l,
                            x: l.x + dx,
                            y: l.y + dy,
                        } as Layer;
                    }
                    return l;
                });
            };

            const newLayers = applyAllAutoLayouts(computeUpdatedLayers(state.layers, id, updates));
            const layer = newLayers.find((l) => l.id === id);

            if (!layer?.masterId) {
                return { layers: newLayers };
            }

            if (state.activeResizeId === "master") {
                // ─── On master: update master props AND cascade content-source to instances
                const master = state.masterComponents.find((m) => m.id === layer.masterId);
                if (!master) return { layers: newLayers };

                const newMasters = state.masterComponents.map((m) =>
                    m.id === layer.masterId
                        ? { ...m, name: layer.name, props: { ...m.props, ...updates } as ComponentProps }
                        : m
                );

                // Cascade only content-source keys to enabled instances
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
                        // Only cascade if the resize has instances enabled
                        const resize = state.resizes.find((r) => r.id === inst.resizeId);
                        if (!resize?.instancesEnabled) return inst;
                        return {
                            ...inst,
                            localProps: { ...inst.localProps, ...contentUpdates } as ComponentProps,
                        };
                    });
                }

                return {
                    layers: newLayers,
                    masterComponents: newMasters,
                    componentInstances: newInstances,
                };
            } else {
                // ─── On instance resize: save all changes to instance localProps
                const newInstances = state.componentInstances.map((inst) => {
                    if (inst.masterId !== layer.masterId || inst.resizeId !== state.activeResizeId) {
                        return inst;
                    }
                    return {
                        ...inst,
                        localProps: { ...inst.localProps, ...updates } as ComponentProps,
                    };
                });

                return {
                    layers: newLayers,
                    componentInstances: newInstances,
                };
            }
        });
    },

    removeLayer: (id) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerIds: _s.selectedLayerIds };
        set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
        set((state) => {
            const layer = state.layers.find((l) => l.id === id);
            // Collect all IDs to remove (frame + children recursively)
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
            // Also remove this layer from its parent frame's childIds
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
                layers: newLayers,
                selectedLayerIds: state.selectedLayerIds.filter((sid) => !idsToRemove.has(sid)),
                masterComponents: state.masterComponents.filter((m) => !masterIdsToRemove.has(m.id)),
                componentInstances: state.componentInstances.filter((i) => !masterIdsToRemove.has(i.masterId)),
            };
        });
    },

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

    toggleLayerLock: (id) => {
        set((state) => ({
            layers: state.layers.map((l) => (l.id === id ? { ...l, locked: !l.locked } as Layer : l)),
        }));
    },

    duplicateLayer: (id) => {
        const state = get();
        // ... (reuse existing single duplicate logic or delegate? Let's just keep it for now but maybe just call duplicateSelectedLayers if id == selectedLayer)
        // Actually, let's implement duplicateSelectedLayers nicely and duplicateLayer can become legacy or specific.
        // For now, I'll just leave duplicateLayer as is from previous step (it was working for single).
        // Wait, I need to match the previous content to replace it or just add after it?
        // I will REPLACE duplicateLayer and ADD duplicateSelectedLayers and deleteSelectedLayers to keep it clean.

        // Re-implement duplicateLayer as a wrapper or just standalone.
        // Let's implement duplicateSelectedLayers first.

        // ... previous duplicateLayer logic ...
        const layer = state.layers.find((l) => l.id === id);
        if (!layer) return;
        set({ history: [...state.history, { layers: state.layers, masterComponents: state.masterComponents, componentInstances: state.componentInstances, selectedLayerIds: state.selectedLayerIds } as HistorySnapshot].slice(-MAX_HISTORY), future: [] });

        const newLayers: Layer[] = [];
        const newMasters: MasterComponent[] = [];
        const newInstances: ComponentInstance[] = [];

        // Helper: duplicate a single layer and return its new id
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
                    const newChildId = duplicateOne(child, 20, 20); // Keep relative offset 0? Or 20? 
                    // Usually children keep relative position to parent. 
                    // If root moved 20,20, and we set child x,y to child.x+20, child.y+20, that's GLOBAL x,y.
                    // If child x,y is absolute (stage coordinates), then yes +20, +20.
                    // If child x,y is relative... wait, `srcLayer.x` in CanvasStore usually stores ABSOLUTE Stage Position or Relative?
                    // In most canvas apps, x/y are relative to parent if inside frame?
                    // Let's check `moveLayerToFrame`.
                    // It doesn't adjust x/y. This implies x/y are always global stage coordinates?
                    // Or `moveLayerToFrame` is buggy.
                    // `updateLayer` updates x/y.
                    // If x/y are global, then +20/+20 is correct for children too.
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

    duplicateSelectedLayers: () => {
        const state = get();
        const { selectedLayerIds } = state;
        if (selectedLayerIds.length === 0) return;

        set({ history: [...state.history, { layers: state.layers, masterComponents: state.masterComponents, componentInstances: state.componentInstances, selectedLayerIds: state.selectedLayerIds } as HistorySnapshot].slice(-MAX_HISTORY), future: [] });

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

    deleteSelectedLayers: () => {
        const state = get();
        const { selectedLayerIds } = state;
        if (selectedLayerIds.length === 0) return;

        set({ history: [...state.history, { layers: state.layers, masterComponents: state.masterComponents, componentInstances: state.componentInstances, selectedLayerIds: state.selectedLayerIds } as HistorySnapshot].slice(-MAX_HISTORY), future: [] });

        set((state) => {
            // Collect all IDs to remove (selected + children recursively)
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
                    // Cleanup childIds of surviving frames
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
                layers: newLayers,
                selectedLayerIds: [],
                masterComponents: state.masterComponents.filter((m) => !masterIdsToRemove.has(m.id)),
                componentInstances: state.componentInstances.filter((i) => !masterIdsToRemove.has(i.masterId)),
            };
        });
    },

    bringToFront: (id) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerIds: _s.selectedLayerIds };
        set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
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
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerIds: _s.selectedLayerIds };
        set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
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
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerIds: _s.selectedLayerIds };
        set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
        set((state) => {
            const layers = [...state.layers];
            const [moved] = layers.splice(fromIndex, 1);
            layers.splice(toIndex, 0, moved);
            return { layers: applyAllAutoLayouts(layers) };
        });
    },

    reorderLayer: (layerId: string, mode: "up" | "down" | "top" | "bottom") => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerIds: _s.selectedLayerIds };
        set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });

        set((state) => {
            let layers = [...state.layers];

            // Check if nested in a frame
            const parentFrame = layers.find(l => l.type === "frame" && (l as FrameLayer).childIds.includes(layerId)) as FrameLayer | undefined;

            if (parentFrame) {
                // Reorder within frame's childIds
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
                // Reorder globally
                // In our global array, index 0 is bottom, index length-1 is top
                const idx = layers.findIndex(l => l.id === layerId);
                if (idx !== -1) {
                    const [moved] = layers.splice(idx, 1);
                    if (mode === "top") layers.push(moved);
                    else if (mode === "bottom") layers.unshift(moved);
                    else if (mode === "up") layers.splice(Math.min(layers.length, idx + 1), 0, moved);
                    else if (mode === "down") layers.splice(Math.max(0, idx - 1), 0, moved);
                }
            }

            return { layers: applyAllAutoLayouts(layers) };
        });
    },

    moveLayerToFrame: (layerId, frameId, dropIndex) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerIds: _s.selectedLayerIds };
        set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
        set((state) => {
            let newLayers = [...state.layers];

            // Remove from existing parent (if different, or if same but we want to re-insert)
            const currentParent = newLayers.find(l => l.type === "frame" && (l as FrameLayer).childIds.includes(layerId)) as FrameLayer | undefined;
            if (currentParent && currentParent.id !== frameId) {
                newLayers = newLayers.map(l => l.id === currentParent.id ? { ...l, childIds: (l as FrameLayer).childIds.filter((id: string) => id !== layerId) } as FrameLayer : l);
            }

            // Insert into new or same parent
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
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerIds: _s.selectedLayerIds };
        set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
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

    toggleLayerVisibility: (id) => {
        set((state) => ({
            layers: state.layers.map((l) =>
                l.id === id ? ({ ...l, visible: !l.visible } as Layer) : l
            ),
        }));
    },

    // ─── Component actions ──────────────────────────────
    promoteToMaster: (layerId) => {
        const state = get();
        const layer = state.layers.find((l) => l.id === layerId);
        if (!layer || layer.masterId) return; // already has a master

        const masterId = uuid();
        const { id, name, type, masterId: _, ...rest } = layer;
        const master: MasterComponent = {
            id: masterId,
            type,
            name,
            props: rest as ComponentProps,
        };
        // Create instances for existing non-master resizes
        const newInstances: ComponentInstance[] = state.resizes
            .filter((r) => r.id !== "master")
            .map((r) => ({
                id: uuid(),
                masterId,
                resizeId: r.id,
                localProps: { ...rest } as ComponentProps,
            }));
        set((s) => ({
            layers: s.layers.map((l) =>
                l.id === layerId ? { ...l, masterId } as Layer : l
            ),
            masterComponents: [...s.masterComponents, master],
            componentInstances: [...s.componentInstances, ...newInstances],
        }));
    },

    updateMasterComponent: (masterId, updates) => {
        set((state) => {
            const master = state.masterComponents.find((m) => m.id === masterId);
            if (!master) return {};

            const newMasters = state.masterComponents.map((m) =>
                m.id === masterId
                    ? { ...m, props: { ...m.props, ...updates } as ComponentProps }
                    : m
            );

            // Cascade content-source keys to enabled instances
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
                    if (inst.masterId !== masterId) return inst;
                    const resize = state.resizes.find((r) => r.id === inst.resizeId);
                    if (!resize?.instancesEnabled) return inst;
                    return {
                        ...inst,
                        localProps: { ...inst.localProps, ...contentUpdates } as ComponentProps,
                    };
                });
            }

            // Also update on-screen layers if on master resize
            const newLayers = state.activeResizeId === "master"
                ? state.layers.map((l) => {
                    if (l.masterId === masterId) {
                        return { ...l, ...updates } as Layer;
                    }
                    return l;
                })
                : state.layers;

            return {
                masterComponents: newMasters,
                componentInstances: newInstances,
                layers: newLayers,
            };
        });
    },

    // ─── Resize actions ─────────────────────────────────
    addResize: (format) => {
        const state = get();
        const masterFormat = state.resizes.find((r) => r.id === "master");
        const mw = masterFormat?.width || 1080;
        const mh = masterFormat?.height || 1080;

        // Auto-create instances for all existing master components
        const newInstances: ComponentInstance[] = state.masterComponents.map((m) => {
            const initialProps = { ...m.props };
            let finalProps = initialProps;

            // Apply smart layout if slotId is present
            if (m.slotId) {
                // Mock a layer for layout engine
                const mockLayer = {
                    ...initialProps,
                    id: uuid(),
                    name: m.name,
                    type: m.type,
                    masterId: m.id,
                    slotId: m.slotId
                } as Layer;

                import("@/services/layoutEngine").then(({ applyLayout }) => {
                    // This is synchronous in current code but we are inside map which expects sync
                    // Since applyLayout is already imported at top of canvasStore.ts, we can just use it
                });

                const { applyLayout } = require("@/services/layoutEngine");
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
                const { applyConstraints } = require("@/utils/resizeUtil");
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
        if (resizeId === "master") return; // can't remove master
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
        // Sync layers to show correct instance/master for this resize
        get().syncLayersToResize();
    },

    syncLayersToResize: () => {
        const state = get();
        const { masterComponents, componentInstances, activeResizeId, resizes } = state;

        if (activeResizeId === "master") {
            // On master: layers reflect master component props directly
            const newLayers: Layer[] = masterComponents.map((m) => {
                const existingLayer = state.layers.find((l) => l.masterId === m.id);
                return {
                    ...m.props,
                    id: existingLayer?.id || uuid(),
                    name: m.name,
                    masterId: m.id,
                } as Layer;
            });
            set({ layers: newLayers });
        } else {
            // On instance resize: use localProps from instance
            const resize = resizes.find((r) => r.id === activeResizeId);
            const newLayers: Layer[] = masterComponents.map((m) => {
                const instance = componentInstances.find(
                    (i) => i.masterId === m.id && i.resizeId === activeResizeId
                );
                const existingLayer = state.layers.find((l) => l.masterId === m.id);

                if (instance) {
                    // Use local props, but merge content-source from master if instances are enabled
                    let props = { ...instance.localProps };
                    if (resize?.instancesEnabled) {
                        const contentUpdates = getContentSourceUpdates(m);
                        props = { ...props, ...contentUpdates } as ComponentProps;
                    }
                    return {
                        ...props,
                        id: existingLayer?.id || uuid(),
                        name: m.name,
                        masterId: m.id,
                    } as Layer;
                } else {
                    // No instance yet — fall back to master props
                    return {
                        ...m.props,
                        id: existingLayer?.id || uuid(),
                        name: m.name,
                        masterId: m.id,
                    } as Layer;
                }
            });
            set({ layers: newLayers });
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

    // ─── Mode ───────────────────────────────────────────
    setEditorMode: (mode) => {
        set({ editorMode: mode });
    },

    // ─── Canvas actions ─────────────────────────────────
    setActiveTool: (tool) => {
        set({ activeTool: tool, selectedLayerIds: [] });
    },

    setZoom: (zoom) => {
        set({ zoom: Math.min(Math.max(zoom, 0.1), 3) });
    },

    setStagePosition: (x, y) => {
        set({ stageX: x, stageY: y });
    },

    setCanvasSize: (width, height) => {
        const state = get();
        set({
            canvasWidth: width,
            canvasHeight: height,
            // Also update the master resize entry so dimensions persist across format switches
            resizes: state.activeResizeId === "master"
                ? state.resizes.map((r) =>
                    r.id === "master"
                        ? { ...r, width, height, label: `${width} × ${height}` }
                        : r
                )
                : state.resizes,
        });
    },

    resetCanvas: () => {
        set({
            layers: [],
            masterComponents: [],
            componentInstances: [],
            selectedLayerIds: [],
            activeTool: "select",
            zoom: 0.5,
            stageX: 0,
            stageY: 0,
            resizes: [DEFAULT_RESIZE],
            activeResizeId: "master",
            isEditingText: false,
            editingLayerId: null,
            artboardProps: { ...DEFAULT_ARTBOARD_PROPS },
            highlightedFrameId: null,
        });
    },

    loadTemplatePack: (data) => {
        const { masterComponents, componentInstances, resizes, layers: hydratedLayers, baseWidth, baseHeight } = data;

        let finalResizes = [...resizes];
        let masterResize = finalResizes.find(r => r.id === "master");

        // Restore "master" format if it was stripped during serialization
        if (!masterResize) {
            masterResize = {
                id: "master",
                name: "Мастер макет",
                label: `${baseWidth} × ${baseHeight}`,
                width: baseWidth,
                height: baseHeight,
                instancesEnabled: false
            };
            finalResizes.unshift(masterResize);
        }

        const width = masterResize.width;
        const height = masterResize.height;

        let initialLayers: Layer[];

        if (hydratedLayers && hydratedLayers.length > 0) {
            // Use hydrated layers — these already have proper frame→childIds nesting
            initialLayers = hydratedLayers;
        } else {
            // Fallback: create flat layers from master components (no nesting)
            initialLayers = masterComponents.map((m) => {
                return {
                    ...m.props,
                    id: uuid(),
                    name: m.name,
                    masterId: m.id,
                    type: m.type,
                } as Layer;
            });
        }

        set({
            layers: initialLayers,
            masterComponents,
            componentInstances,
            resizes: finalResizes,
            activeResizeId: "master",
            selectedLayerIds: [],
            history: [],
            historyIndex: -1,
            canvasWidth: width,
            canvasHeight: height,
            zoom: 0.5,
            stageX: 0,
            stageY: 0,
        });
    },

    applySmartResize: (templatePack, mappings) => {
        const { generateSmartResizes } = require("@/services/smartResizeService") as typeof import("@/services/smartResizeService");
        const state = get();
        const result = generateSmartResizes(state.masterComponents, templatePack, mappings);

        // Merge new resizes (skip duplicates by id)
        const existingResizeIds = new Set(state.resizes.map(r => r.id));
        const newResizes = result.resizes.filter(r => !existingResizeIds.has(r.id));
        const mergedResizes = [...state.resizes, ...newResizes];

        // Merge new instances
        const mergedInstances = [...state.componentInstances, ...result.instances];

        // Switch to first new resize for preview
        const firstNewResize = newResizes[0];

        set({
            resizes: mergedResizes,
            componentInstances: mergedInstances,
            activeResizeId: firstNewResize?.id || state.activeResizeId,
            canvasWidth: firstNewResize?.width || state.canvasWidth,
            canvasHeight: firstNewResize?.height || state.canvasHeight,
        });

        // Sync layers to the new resize
        if (firstNewResize) {
            get().syncLayersToResize();
        }

        return { unmappedSlotNames: result.unmappedSlotNames };
    },

    // ─── Artboard actions ───────────────────────────────
    updateArtboardProps: (updates) => {
        set((state) => ({
            artboardProps: { ...state.artboardProps, ...updates },
        }));
    },

    updateSnapConfig: (updates) => {
        set((state) => ({
            snapConfig: { ...state.snapConfig, ...updates },
        }));
    },

    // ─── Drag-to-frame actions ──────────────────────────
    setHighlightedFrameId: (id) => {
        set({ highlightedFrameId: id });
    },

    getFrameAtPoint: (x, y, excludeId) => {
        const { layers } = get();
        // Iterate in reverse to find topmost frame
        for (let i = layers.length - 1; i >= 0; i--) {
            const l = layers[i];
            if (l.type !== "frame" || l.id === excludeId) continue;
            const frame = l as FrameLayer;
            if (
                x >= frame.x &&
                x <= frame.x + frame.width &&
                y >= frame.y &&
                y <= frame.y + frame.height
            ) {
                return frame;
            }
        }
        return null;
    },

    // ─── Inline text editing ────────────────────────────
    startTextEditing: (layerId) => {
        set({ isEditingText: true, editingLayerId: layerId });
    },

    stopTextEditing: () => {
        set({ isEditingText: false, editingLayerId: null });
    },

    alignSelectedLayers: (alignment) => {
        set((state) => {
            const { layers, selectedLayerIds, canvasWidth, canvasHeight } = state;
            if (selectedLayerIds.length === 0) return state;

            const selectedLayers = layers.filter(l => selectedLayerIds.includes(l.id));

            // Determine if any selected layer is inside an Auto-Layout frame
            const isInsideAL = selectedLayers.some(layer => {
                const parent = layers.find(l => l.type === "frame" && (l as FrameLayer).childIds.includes(layer.id)) as FrameLayer | undefined;
                return parent?.layoutMode && parent.layoutMode !== "none";
            });

            // If inside AL, we shouldn't align them manually
            if (isInsideAL) return state;

            const snapshot: HistorySnapshot = {
                layers: state.layers,
                masterComponents: state.masterComponents,
                componentInstances: state.componentInstances,
                selectedLayerIds: state.selectedLayerIds,
            };

            const updates: { id: string; changes: Partial<Layer> }[] = [];

            if (selectedLayers.length === 1) {
                // Single object: align relative to parent (Artboard or Frame)
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
                // Multiple objects: align relative to their collective bounding box
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

            const newLayers = currentLayers;

            return {
                history: [...state.history, snapshot].slice(-MAX_HISTORY),
                future: [],
                layers: newLayers,
            };
        });
    },
}));
