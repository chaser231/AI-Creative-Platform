/**
 * Viewport Slice — zoom, stage position, artboard, snap, mode, text editing
 */

import type { StateCreator } from "zustand";
import type { CanvasStore, ArtboardProps, SnapConfig, EditorMode, FrameLayer } from "./types";
import { DEFAULT_SNAP_CONFIG } from "@/services/snapService";

export type ViewportSlice = Pick<CanvasStore,
    | "zoom" | "stageX" | "stageY"
    | "artboardProps" | "snapConfig"
    | "highlightedFrameId" | "hoveredLayerId" | "editorMode"
    | "isEditingText" | "editingLayerId"
    | "setZoom" | "setStagePosition"
    | "updateArtboardProps" | "updateSnapConfig"
    | "setHighlightedFrameId" | "setHoveredLayerId" | "getFrameAtPoint"
    | "setEditorMode" | "setActiveTool"
    | "startTextEditing" | "stopTextEditing"
    | "activeTool"
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
    editorMode: "studio",
    isEditingText: false,
    editingLayerId: null,

    setActiveTool: (tool) => {
        set({ activeTool: tool, selectedLayerIds: [] });
    },

    setZoom: (zoom) => {
        set({ zoom: Math.min(Math.max(zoom, 0.1), 3) });
    },

    setStagePosition: (x, y) => {
        set({ stageX: x, stageY: y });
    },

    updateArtboardProps: (updates: Partial<ArtboardProps>) => {
        set((state) => ({
            artboardProps: { ...state.artboardProps, ...updates },
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
            if (l.type !== "frame" || excludeIds.has(l.id)) continue;
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

    startTextEditing: (layerId) => {
        set({ isEditingText: true, editingLayerId: layerId });
    },

    stopTextEditing: () => {
        set({ isEditingText: false, editingLayerId: null });
    },
});
