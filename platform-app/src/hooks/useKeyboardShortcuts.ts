"use client";

import { useEffect, useCallback } from "react";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import { isFocusedOnInput } from "@/utils/keyboard";
import type { FrameLayer } from "@/types";

/**
 * Global keyboard shortcuts for the editor.
 * Skip when user is editing text inline or focused in an input/textarea.
 */
export function useKeyboardShortcuts() {
    const {
        selectedLayerIds,
        layers,
        isEditingText,
        deleteSelectedLayers,
        duplicateSelectedLayers,
        updateLayer,
        undo,
        redo,
        selectLayer,
        reorderLayer,
    } = useCanvasStore(useShallow((s) => ({
        selectedLayerIds: s.selectedLayerIds, layers: s.layers,
        isEditingText: s.isEditingText, deleteSelectedLayers: s.deleteSelectedLayers,
        duplicateSelectedLayers: s.duplicateSelectedLayers, updateLayer: s.updateLayer,
        undo: s.undo, redo: s.redo, selectLayer: s.selectLayer, reorderLayer: s.reorderLayer,
    })));

    // clipboard state lives in a ref so it persists across renders
    // but doesn't trigger re-renders
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            // Skip if inside input, textarea, or contentEditable
            if (isFocusedOnInput(e)) return;

            // Skip if inline text editing is active
            if (isEditingText) return;

            const isMeta = e.metaKey || e.ctrlKey;

            // ─── Undo: Cmd+Z ─────────────────────────────
            if (isMeta && !e.shiftKey && e.key === "z") {
                e.preventDefault();
                undo();
                return;
            }

            // ─── Redo: Cmd+Shift+Z ───────────────────────
            if (isMeta && e.shiftKey && e.key === "z") {
                e.preventDefault();
                redo();
                return;
            }

            // ─── Duplicate: Cmd+D ────────────────────────
            if (isMeta && e.key === "d") {
                e.preventDefault();
                if (selectedLayerIds.length > 0) {
                    duplicateSelectedLayers();
                }
                return;
            }

            // ─── Delete / Backspace ──────────────────────
            if (e.key === "Delete" || e.key === "Backspace") {
                if (selectedLayerIds.length > 0) {
                    e.preventDefault();
                    deleteSelectedLayers();
                }
                return;
            }

            // ─── Escape: deselect ────────────────────────
            if (e.key === "Escape") {
                selectLayer(null);
                return;
            }

            // ─── Arrow nudge ─────────────────────────────
            const arrowDelta = e.shiftKey ? 10 : 1;
            if (selectedLayerIds.length > 0) {
                let didMove = false;
                if (e.key === "ArrowUp") {
                    e.preventDefault();
                    selectedLayerIds.forEach((id) => {
                        const layer = layers.find((l) => l.id === id);
                        if (!layer) return;
                        const parentFrame = layers.find(l => l.type === "frame" && (l as FrameLayer).childIds.includes(id)) as FrameLayer | undefined;
                        if (parentFrame && parentFrame.layoutMode && parentFrame.layoutMode !== "none" && !layer.isAbsolutePositioned) {
                            if (parentFrame.layoutMode === "vertical") reorderLayer(id, "down");
                        } else {
                            updateLayer(id, { y: layer.y - arrowDelta });
                        }
                    });
                    didMove = true;
                }
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    selectedLayerIds.forEach((id) => {
                        const layer = layers.find((l) => l.id === id);
                        if (!layer) return;
                        const parentFrame = layers.find(l => l.type === "frame" && (l as FrameLayer).childIds.includes(id)) as FrameLayer | undefined;
                        if (parentFrame && parentFrame.layoutMode && parentFrame.layoutMode !== "none" && !layer.isAbsolutePositioned) {
                            if (parentFrame.layoutMode === "vertical") reorderLayer(id, "up");
                        } else {
                            updateLayer(id, { y: layer.y + arrowDelta });
                        }
                    });
                    didMove = true;
                }
                if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    selectedLayerIds.forEach((id) => {
                        const layer = layers.find((l) => l.id === id);
                        if (!layer) return;
                        const parentFrame = layers.find(l => l.type === "frame" && (l as FrameLayer).childIds.includes(id)) as FrameLayer | undefined;
                        if (parentFrame && parentFrame.layoutMode && parentFrame.layoutMode !== "none" && !layer.isAbsolutePositioned) {
                            if (parentFrame.layoutMode === "horizontal") reorderLayer(id, "down");
                        } else {
                            updateLayer(id, { x: layer.x - arrowDelta });
                        }
                    });
                    didMove = true;
                }
                if (e.key === "ArrowRight") {
                    e.preventDefault();
                    selectedLayerIds.forEach((id) => {
                        const layer = layers.find((l) => l.id === id);
                        if (!layer) return;
                        const parentFrame = layers.find(l => l.type === "frame" && (l as FrameLayer).childIds.includes(id)) as FrameLayer | undefined;
                        if (parentFrame && parentFrame.layoutMode && parentFrame.layoutMode !== "none" && !layer.isAbsolutePositioned) {
                            if (parentFrame.layoutMode === "horizontal") reorderLayer(id, "up");
                        } else {
                            updateLayer(id, { x: layer.x + arrowDelta });
                        }
                    });
                    didMove = true;
                }
                if (didMove) return;
            }
        },
        [selectedLayerIds, layers, isEditingText, deleteSelectedLayers, duplicateSelectedLayers, updateLayer, undo, redo, selectLayer, reorderLayer]
    );

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);
}
