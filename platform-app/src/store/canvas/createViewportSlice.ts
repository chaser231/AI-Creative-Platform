/**
 * Viewport Slice — zoom, stage position, artboard, snap, mode, text editing
 */

import type { StateCreator } from "zustand";
import type { CanvasStore, ArtboardProps, SnapConfig, EditorMode, ViewMode, FrameLayer, ExpandPadding } from "./types";
import type Konva from "konva";
import { DEFAULT_EXPAND_PADDING } from "./types";
import { DEFAULT_SNAP_CONFIG } from "@/services/snapService";

export type ViewportSlice = Pick<CanvasStore,
    | "zoom" | "stageX" | "stageY"
    | "artboardProps" | "snapConfig"
    | "highlightedFrameId" | "hoveredLayerId" | "editorMode"
    | "isEditingText" | "editingLayerId"
    | "activeGradientEditorTarget" | "setActiveGradientEditorTarget"
    | "expandMode" | "expandPadding" | "expandTargetLayerId"
    | "drawingBox" | "setDrawingBox"
    | "keepAspectRatio" | "setKeepAspectRatio"
    | "vectorEditLayerId" | "setVectorEditLayerId"
    | "setZoom" | "setStagePosition"
    | "updateArtboardProps" | "updateSnapConfig"
    | "setHighlightedFrameId" | "setHoveredLayerId" | "getFrameAtPoint"
    | "setEditorMode" | "setActiveTool"
    | "viewMode" | "overviewZoom" | "overviewX" | "overviewY"
    | "setViewMode" | "setOverviewZoom" | "setOverviewPosition"
    | "startTextEditing" | "stopTextEditing"
    | "setExpandMode" | "setExpandPadding" | "resetExpandMode"
    | "activeTool"
    | "stageRef" | "setStageRef"
>;

export const createViewportSlice: StateCreator<CanvasStore, [], [], ViewportSlice> = (set, get) => ({
    activeTool: "select",
    zoom: 0.5,
    stageX: 0,
    stageY: 0,

    artboardProps: {
        fill: "#FFFFFF",
        cornerRadius: 0,
        clipContent: true,
        stroke: "",
        strokeWidth: 0,
    },
    snapConfig: { ...DEFAULT_SNAP_CONFIG },

    highlightedFrameId: null,
    hoveredLayerId: null,
    drawingBox: null,
    keepAspectRatio: false,
    vectorEditLayerId: null,
    editorMode: "studio",
    viewMode: "single",
    overviewZoom: 0.2,
    overviewX: 0,
    overviewY: 0,
    isEditingText: false,
    editingLayerId: null,
    activeGradientEditorTarget: null,

    // Generative Expand
    expandMode: false,
    expandPadding: { ...DEFAULT_EXPAND_PADDING },
    expandTargetLayerId: null,

    // Stage ref (for Copy as PNG from keyboard shortcuts)
    stageRef: null,
    setStageRef: (ref: React.RefObject<Konva.Stage | null>) => {
        set({ stageRef: ref });
    },

    setActiveTool: (tool) => {
        set({ activeTool: tool, drawingBox: null });
    },

    setDrawingBox: (box) => {
        set({ drawingBox: box });
    },

    setKeepAspectRatio: (value) => {
        set({ keepAspectRatio: value });
    },

    setVectorEditLayerId: (id) => {
        set({ vectorEditLayerId: id });
    },

    setZoom: (zoom) => {
        set({ zoom: Math.min(Math.max(zoom, 0.1), 3) });
    },

    setStagePosition: (x, y) => {
        set({ stageX: x, stageY: y });
    },

    updateArtboardProps: (updates: Partial<ArtboardProps>) => {
        set((state) => ({
            artboardProps: {
                ...state.artboardProps,
                ...updates,
                fillSwatchRef:
                    Object.prototype.hasOwnProperty.call(updates, "fill")
                    && !Object.prototype.hasOwnProperty.call(updates, "fillSwatchRef")
                        ? undefined
                        : updates.fillSwatchRef ?? state.artboardProps.fillSwatchRef,
            },
        }));
    },

    updateSnapConfig: (updates: Partial<SnapConfig>) => {
        set((state) => ({
            snapConfig: { ...state.snapConfig, ...updates },
        }));
    },

    setHighlightedFrameId: (id) => {
        set({ highlightedFrameId: id });
    },

    setHoveredLayerId: (id) => {
        set({ hoveredLayerId: id });
    },

    getFrameAtPoint: (x, y, excludeId) => {
        const { layers } = get();

        // Collect excludeId + all its descendants to prevent circular nesting
        const excludeIds = new Set<string>();
        if (excludeId) {
            const collectDescendants = (id: string) => {
                excludeIds.add(id);
                const frame = layers.find(l => l.id === id && l.type === "frame") as FrameLayer | undefined;
                if (frame?.childIds) {
                    frame.childIds.forEach(cid => {
                        if (!excludeIds.has(cid)) collectDescendants(cid);
                    });
                }
            };
            collectDescendants(excludeId);
        }

        for (let i = layers.length - 1; i >= 0; i--) {
            const l = layers[i];
            if (l.type !== "frame" || excludeIds.has(l.id) || !l.visible || l.locked) continue;
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

    setEditorMode: (mode: EditorMode) => {
        set({ editorMode: mode });
    },

    setViewMode: (mode: ViewMode) => {
        set({ viewMode: mode });
    },

    // Overview canvas can zoom out much further than the single-artboard view
    // (whole-project fit), so it uses a wider clamp than `setZoom`.
    setOverviewZoom: (zoom: number) => {
        set({ overviewZoom: Math.min(Math.max(zoom, 0.02), 3) });
    },

    setOverviewPosition: (x: number, y: number) => {
        set({ overviewX: x, overviewY: y });
    },

    startTextEditing: (layerId) => {
        set({ isEditingText: true, editingLayerId: layerId });
    },

    stopTextEditing: () => {
        set({ isEditingText: false, editingLayerId: null });
    },

    setActiveGradientEditorTarget: (target) => {
        if (get().activeGradientEditorTarget === target) return;
        set({ activeGradientEditorTarget: target });
    },

    // ── Generative Expand ────────────────────────────────
    setExpandMode: (active) => {
        if (active) {
            const { selectedLayerIds, layers } = get();
            const targetId = selectedLayerIds[0] || null;
            const targetLayer = targetId ? layers.find(l => l.id === targetId) : null;
            // Only allow expand on image layers
            if (!targetLayer || targetLayer.type !== "image") {
                set({ expandMode: false, expandTargetLayerId: null, expandPadding: { ...DEFAULT_EXPAND_PADDING } });
                return;
            }
            set({
                expandMode: true,
                expandTargetLayerId: targetId,
                expandPadding: { ...DEFAULT_EXPAND_PADDING },
                // Mutual exclusion — same as setInpaintMode turning off expand.
                inpaintMode: false,
                inpaintTargetLayerId: null,
                activeGradientEditorTarget: null,
            });
        } else {
            set({ expandMode: false, expandTargetLayerId: null, expandPadding: { ...DEFAULT_EXPAND_PADDING } });
        }
    },

    setExpandPadding: (padding) => {
        set((state) => ({
            expandPadding: { ...state.expandPadding, ...padding },
        }));
    },

    resetExpandMode: () => {
        set({ expandMode: false, expandTargetLayerId: null, expandPadding: { ...DEFAULT_EXPAND_PADDING } });
    },
});
