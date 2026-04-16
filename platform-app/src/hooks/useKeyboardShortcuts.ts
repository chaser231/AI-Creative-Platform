"use client";

import { useEffect, useCallback } from "react";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import { isFocusedOnInput } from "@/utils/keyboard";
import type { FrameLayer } from "@/types";
import {
    copyLayersToClipboard,
    pasteLayersFromClipboard,
    copyLayerAsPng,
} from "@/utils/clipboardUtils";

/**
 * Global keyboard shortcuts for the editor.
 * Skip when user is editing text inline or focused in an input/textarea.
 */
export function useKeyboardShortcuts() {
    const {
        selectedLayerIds,
        layers,
        isEditingText,
        activeTool,
        setActiveTool,
        deleteSelectedLayers,
        duplicateSelectedLayers,
        updateLayer,
        undo,
        redo,
        selectLayer,
        reorderLayer,
        pasteLayers,
        stageRef,
        wrapInAutoLayoutFrame,
        setDrawingBox,
    } = useCanvasStore(useShallow((s) => ({
        selectedLayerIds: s.selectedLayerIds, layers: s.layers,
        isEditingText: s.isEditingText, activeTool: s.activeTool,
        setActiveTool: s.setActiveTool,
        deleteSelectedLayers: s.deleteSelectedLayers,
        duplicateSelectedLayers: s.duplicateSelectedLayers, updateLayer: s.updateLayer,
        undo: s.undo, redo: s.redo, selectLayer: s.selectLayer, reorderLayer: s.reorderLayer,
        pasteLayers: s.pasteLayers, stageRef: s.stageRef,
        wrapInAutoLayoutFrame: s.wrapInAutoLayoutFrame,
        setDrawingBox: s.setDrawingBox,
    })));

    // clipboard state lives in a ref so it persists across renders
    // but doesn't trigger re-renders
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            const isMeta = e.metaKey || e.ctrlKey;

            // ─── Shift+A: Wrap in Auto-Layout (works from canvas, like Figma) ──
            if (e.shiftKey && !isMeta && e.key.toLowerCase() === "a") {
                if (isEditingText) return;
                const active = document.activeElement as HTMLElement | null;
                const isInTextInput = active && (
                    active.tagName === "INPUT" ||
                    active.tagName === "TEXTAREA" ||
                    active.isContentEditable
                );
                if (isInTextInput) return;
                if (selectedLayerIds.length > 0) {
                    e.preventDefault();
                    wrapInAutoLayoutFrame();
                }
                return;
            }

            // Skip if inside input, textarea, or contentEditable
            if (isFocusedOnInput(e)) return;

            // Skip if inline text editing is active
            if (isEditingText) return;

            // ─── Copy: Cmd+C ────────────────────────────
            if (isMeta && !e.shiftKey && e.key === "c") {
                if (selectedLayerIds.length > 0) {
                    e.preventDefault();
                    copyLayersToClipboard(selectedLayerIds, layers);
                }
                return;
            }

            // ─── Copy as PNG: Cmd+Shift+C ────────────────
            if (isMeta && e.shiftKey && e.key === "C") {
                if (selectedLayerIds.length > 0 && stageRef?.current) {
                    e.preventDefault();
                    copyLayerAsPng(stageRef.current, selectedLayerIds, layers);
                }
                return;
            }

            // ─── Paste: Cmd+V ────────────────────────────
            if (isMeta && !e.shiftKey && e.key === "v") {
                e.preventDefault();
                pasteLayersFromClipboard().then((data) => {
                    if (data && data.layers.length > 0) {
                        pasteLayers(data.layers);
                    }
                });
                return;
            }

            // ─── Cut: Cmd+X ─────────────────────────────
            if (isMeta && e.key === "x") {
                if (selectedLayerIds.length > 0) {
                    // Only cut unlocked layers
                    const unlocked = selectedLayerIds.filter((id) => !layers.find((l) => l.id === id)?.locked);
                    if (unlocked.length > 0) {
                        e.preventDefault();
                        copyLayersToClipboard(unlocked, layers).then(() => {
                            deleteSelectedLayers();
                        });
                    }
                }
                return;
            }

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
                // Only delete unlocked layers
                const unlocked = selectedLayerIds.filter((id) => !layers.find((l) => l.id === id)?.locked);
                if (unlocked.length > 0) {
                    e.preventDefault();
                    deleteSelectedLayers();
                }
                return;
            }

            // ─── Escape: cancel drawing mode or deselect ──
            if (e.key === "Escape") {
                if (activeTool !== "select") {
                    setActiveTool("select");
                    setDrawingBox(null);
                    return;
                }
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
                        if (!layer || layer.locked) return;
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
                        if (!layer || layer.locked) return;
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
                        if (!layer || layer.locked) return;
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
                        if (!layer || layer.locked) return;
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
        [selectedLayerIds, layers, isEditingText, deleteSelectedLayers, duplicateSelectedLayers, updateLayer, undo, redo, selectLayer, reorderLayer, pasteLayers, stageRef, activeTool, setActiveTool, wrapInAutoLayoutFrame, setDrawingBox]
    );

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);
}
