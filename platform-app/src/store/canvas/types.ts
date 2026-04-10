/**
 * Canvas Store — Shared Types & Interfaces
 *
 * Centralizes all type definitions used across canvas store slices.
 * ArtboardProps is the single source of truth (also used by api-types.ts).
 */

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
    LayerBinding,
    EditorMode,
    LayerConstraints,
} from "@/types";
import type { SnapConfig } from "@/services/snapService";
import type { SlotMapping } from "@/services/slotMappingService";
import type { TemplatePack } from "@/services/templateService";

// ─── Re-export layer types for slice convenience ────────
export type {
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
    LayerBinding,
    EditorMode,
    LayerConstraints,
    SnapConfig,
    SlotMapping,
    TemplatePack,
};

// ─── ArtboardProps (single source of truth) ─────────────

export interface ArtboardProps {
    fill: string;
    cornerRadius: number;
    clipContent: boolean;
    stroke: string;
    strokeWidth: number;
}

export const DEFAULT_ARTBOARD_PROPS: ArtboardProps = {
    fill: "#FFFFFF",
    cornerRadius: 0,
    clipContent: true,
    stroke: "",
    strokeWidth: 0,
};

// ─── Frame Resize Delta ─────────────────────────────────

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

// ─── History ────────────────────────────────────────────

export const MAX_HISTORY = 50;

export interface HistorySnapshot {
    layers: Layer[];
    masterComponents: MasterComponent[];
    componentInstances: ComponentInstance[];
    selectedLayerIds: string[];
}

// ─── Default Resize ─────────────────────────────────────

export const DEFAULT_RESIZE: ResizeFormat = {
    id: "master",
    name: "Master",
    width: 1080,
    height: 1080,
    label: "1080 × 1080",
    instancesEnabled: false,
};

// ─── Canvas Store Interface ─────────────────────────────

export interface CanvasStore {
    // State
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

    // Phase 2: Master binding actions
    promoteFormatToMaster: (formatId: string) => void;
    demoteFormatFromMaster: (formatId: string) => void;
    setFormatBindings: (formatId: string, bindings: LayerBinding[]) => void;
    unbindFormat: (formatId: string) => void;

    // Mode
    setEditorMode: (mode: EditorMode) => void;

    // Canvas actions
    setActiveTool: (tool: ToolType) => void;
    setZoom: (zoom: number) => void;
    setStagePosition: (x: number, y: number) => void;
    setCanvasSize: (width: number, height: number) => void;
    resetCanvas: () => void;
    loadTemplatePack: (data: {
        masterComponents: MasterComponent[];
        componentInstances: ComponentInstance[];
        resizes: ResizeFormat[];
        layers?: Layer[];
        baseWidth: number;
        baseHeight: number;
    }) => void;
    applySmartResize: (templatePack: TemplatePack, mappings: SlotMapping[]) => { unmappedSlotNames: string[] };

    // Inline text editing
    startTextEditing: (layerId: string) => void;
    stopTextEditing: () => void;
}
