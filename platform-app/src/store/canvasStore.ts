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
    selectedLayerId: string | null;
}

// Throttle timer for updateLayer history
let _updateHistoryTimer: ReturnType<typeof setTimeout> | null = null;
let _updateHistoryPushed = false;

interface CanvasStore {
    // Layers (rendered on canvas, derived from components for active resize)
    layers: Layer[];
    selectedLayerId: string | null;
    activeTool: ToolType;
    canvasWidth: number;
    canvasHeight: number;
    zoom: number;
    stageX: number;
    stageY: number;

    // Artboard
    artboardProps: ArtboardProps;

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
    future: HistorySnapshot[];

    // Layer actions
    addTextLayer: (overrides?: Partial<TextLayer>) => void;
    addRectangleLayer: (overrides?: Partial<RectangleLayer>) => void;
    addImageLayer: (src: string, width: number, height: number) => void;
    addBadgeLayer: (overrides?: Partial<BadgeLayer>) => void;
    addFrameLayer: (overrides?: Partial<FrameLayer>) => void;
    updateLayer: (id: string, updates: Partial<Layer>) => void;
    removeLayer: (id: string) => void;
    selectLayer: (id: string | null) => void;
    reorderLayers: (fromIndex: number, toIndex: number) => void;
    toggleLayerVisibility: (id: string) => void;
    toggleLayerLock: (id: string) => void;
    duplicateLayer: (id: string) => void;
    bringToFront: (id: string) => void;
    sendToBack: (id: string) => void;
    moveLayerToFrame: (layerId: string, frameId: string) => void;
    removeLayerFromFrame: (layerId: string) => void;

    // Undo / Redo actions
    undo: () => void;
    redo: () => void;

    // Artboard actions
    updateArtboardProps: (updates: Partial<ArtboardProps>) => void;

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
    selectedLayerId: null,
    activeTool: "select",
    canvasWidth: DEFAULT_RESIZE.width,
    canvasHeight: DEFAULT_RESIZE.height,
    zoom: 0.5,
    stageX: 0,
    stageY: 0,

    artboardProps: { ...DEFAULT_ARTBOARD_PROPS },
    highlightedFrameId: null,

    masterComponents: [],
    componentInstances: [],

    resizes: [DEFAULT_RESIZE],
    activeResizeId: "master",

    editorMode: "studio",

    isEditingText: false,
    editingLayerId: null,

    history: [],
    future: [],

    // ─── Undo / Redo ────────────────────────────────────
    undo: () => {
        const state = get();
        if (state.history.length === 0) return;
        const prev = state.history[state.history.length - 1];
        const currentSnapshot: HistorySnapshot = {
            layers: state.layers,
            masterComponents: state.masterComponents,
            componentInstances: state.componentInstances,
            selectedLayerId: state.selectedLayerId,
        };
        set({
            history: state.history.slice(0, -1),
            layers: prev.layers,
            masterComponents: prev.masterComponents,
            componentInstances: prev.componentInstances,
            selectedLayerId: prev.selectedLayerId,
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
            selectedLayerId: state.selectedLayerId,
        };
        set({
            future: state.future.slice(1),
            layers: next.layers,
            masterComponents: next.masterComponents,
            componentInstances: next.componentInstances,
            selectedLayerId: next.selectedLayerId,
            history: [...state.history, currentSnapshot].slice(-MAX_HISTORY),
        });
    },

    // ─── Layer creation ─────────────────────────────────
    addTextLayer: (overrides = {}) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerId: _s.selectedLayerId };
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
            masterId,
            ...overrides,
        };
        const master: MasterComponent = {
            id: masterId,
            type: "text",
            name: layer.name,
            props: {
                type: "text",
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
            selectedLayerId: id,
            activeTool: "select",
        }));
    },

    addRectangleLayer: (overrides = {}) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerId: _s.selectedLayerId };
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
            props: {
                type: "rectangle",
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
            selectedLayerId: id,
            activeTool: "select",
        }));
    },

    addImageLayer: (src, width, height) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerId: _s.selectedLayerId };
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
            props: {
                type: "image",
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
            selectedLayerId: id,
            activeTool: "select",
        }));
    },

    addBadgeLayer: (overrides = {}) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerId: _s.selectedLayerId };
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
            props: {
                type: "badge",
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
            selectedLayerId: id,
            activeTool: "select",
        }));
    },

    addFrameLayer: (overrides = {}) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerId: _s.selectedLayerId };
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
            props: {
                type: "frame",
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
            selectedLayerId: id,
            activeTool: "select",
        }));
    },

    updateLayer: (id, updates) => {
        // Throttled history push: save snapshot on first call, skip during rapid updates (drag/nudge)
        if (!_updateHistoryPushed) {
            const _s = get();
            const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerId: _s.selectedLayerId };
            set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
            _updateHistoryPushed = true;
        }
        if (_updateHistoryTimer) clearTimeout(_updateHistoryTimer);
        _updateHistoryTimer = setTimeout(() => { _updateHistoryPushed = false; }, 300);

        set((state) => {
            const newLayers = state.layers.map((l) =>
                l.id === id ? ({ ...l, ...updates } as Layer) : l
            );
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
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerId: _s.selectedLayerId };
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
                selectedLayerId: idsToRemove.has(state.selectedLayerId ?? "") ? null : state.selectedLayerId,
                masterComponents: state.masterComponents.filter((m) => !masterIdsToRemove.has(m.id)),
                componentInstances: state.componentInstances.filter((i) => !masterIdsToRemove.has(i.masterId)),
            };
        });
    },

    selectLayer: (id) => {
        set({ selectedLayerId: id });
    },

    toggleLayerLock: (id) => {
        set((state) => ({
            layers: state.layers.map((l) => (l.id === id ? { ...l, locked: !l.locked } as Layer : l)),
        }));
    },

    duplicateLayer: (id) => {
        const state = get();
        const layer = state.layers.find((l) => l.id === id);
        if (!layer) return;
        set({ history: [...state.history, { layers: state.layers, masterComponents: state.masterComponents, componentInstances: state.componentInstances, selectedLayerId: state.selectedLayerId } as HistorySnapshot].slice(-MAX_HISTORY), future: [] });

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

        // Duplicate the root layer
        const newRootId = duplicateOne(layer, 20, 20);

        // If frame, recursively duplicate children
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
            selectedLayerId: newRootId,
        }));
    },

    bringToFront: (id) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerId: _s.selectedLayerId };
        set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
        set((state) => {
            const idx = state.layers.findIndex((l) => l.id === id);
            if (idx === -1 || idx === state.layers.length - 1) return state;
            const layers = [...state.layers];
            const [moved] = layers.splice(idx, 1);
            layers.push(moved);
            return { layers };
        });
    },

    sendToBack: (id) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerId: _s.selectedLayerId };
        set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
        set((state) => {
            const idx = state.layers.findIndex((l) => l.id === id);
            if (idx <= 0) return state;
            const layers = [...state.layers];
            const [moved] = layers.splice(idx, 1);
            layers.unshift(moved);
            return { layers };
        });
    },

    reorderLayers: (fromIndex, toIndex) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerId: _s.selectedLayerId };
        set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
        set((state) => {
            const layers = [...state.layers];
            const [moved] = layers.splice(fromIndex, 1);
            layers.splice(toIndex, 0, moved);
            return { layers };
        });
    },

    moveLayerToFrame: (layerId, frameId) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerId: _s.selectedLayerId };
        set({ history: [..._s.history, _snap].slice(-MAX_HISTORY), future: [] });
        set((state) => {
            const newLayers = state.layers.map((l) => {
                // Remove from any existing parent frame
                if (l.type === "frame" && (l as FrameLayer).childIds.includes(layerId) && l.id !== frameId) {
                    return { ...l, childIds: (l as FrameLayer).childIds.filter((c) => c !== layerId) } as Layer;
                }
                // Add to target frame
                if (l.id === frameId && l.type === "frame" && !(l as FrameLayer).childIds.includes(layerId)) {
                    return { ...l, childIds: [...(l as FrameLayer).childIds, layerId] } as Layer;
                }
                return l;
            });
            const newMasters = syncFrameChildIdsToMasters(newLayers, state.masterComponents);
            const newInstances = syncFrameChildIdsToInstances(newLayers, state.masterComponents, state.componentInstances, state.activeResizeId);
            return { layers: newLayers, masterComponents: newMasters, componentInstances: newInstances };
        });
    },

    removeLayerFromFrame: (layerId) => {
        const _s = get();
        const _snap: HistorySnapshot = { layers: _s.layers, masterComponents: _s.masterComponents, componentInstances: _s.componentInstances, selectedLayerId: _s.selectedLayerId };
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
            return { layers: newLayers, masterComponents: newMasters, componentInstances: newInstances };
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
        // Auto-create instances for all existing master components
        const newInstances: ComponentInstance[] = state.masterComponents.map((m) => ({
            id: uuid(),
            masterId: m.id,
            resizeId: format.id,
            localProps: { ...m.props }, // full copy of master props as starting point
        }));
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
        set({ activeTool: tool, selectedLayerId: null });
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
            selectedLayerId: null,
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

    // ─── Artboard actions ───────────────────────────────
    updateArtboardProps: (updates) => {
        set((state) => ({
            artboardProps: { ...state.artboardProps, ...updates },
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
}));
