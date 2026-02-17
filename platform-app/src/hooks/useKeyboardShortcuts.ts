"use client";

import { useEffect, useCallback } from "react";
import { useCanvasStore } from "@/store/canvasStore";

/**
 * Global keyboard shortcuts for the editor.
 * Skip when user is editing text inline or focused in an input/textarea.
 */
export function useKeyboardShortcuts() {
    const {
        selectedLayerId,
        layers,
        isEditingText,
        removeLayer,
        duplicateLayer,
        updateLayer,
        undo,
        redo,
        selectLayer,
    } = useCanvasStore();

    // clipboard state lives in a ref so it persists across renders
    // but doesn't trigger re-renders
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            // Skip if inside input, textarea, or contentEditable
            const target = e.target as HTMLElement;
            if (
                target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.tagName === "SELECT" ||
                target.isContentEditable
            ) {
                return;
            }

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
                if (selectedLayerId) {
                    duplicateLayer(selectedLayerId);
                }
                return;
            }

            // ─── Delete / Backspace ──────────────────────
            if (e.key === "Delete" || e.key === "Backspace") {
                if (selectedLayerId) {
                    e.preventDefault();
                    removeLayer(selectedLayerId);
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
            if (selectedLayerId) {
                const layer = layers.find((l) => l.id === selectedLayerId);
                if (!layer) return;

                if (e.key === "ArrowUp") {
                    e.preventDefault();
                    updateLayer(selectedLayerId, { y: layer.y - arrowDelta });
                    return;
                }
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    updateLayer(selectedLayerId, { y: layer.y + arrowDelta });
                    return;
                }
                if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    updateLayer(selectedLayerId, { x: layer.x - arrowDelta });
                    return;
                }
                if (e.key === "ArrowRight") {
                    e.preventDefault();
                    updateLayer(selectedLayerId, { x: layer.x + arrowDelta });
                    return;
                }
            }
        },
        [selectedLayerId, layers, isEditingText, removeLayer, duplicateLayer, updateLayer, undo, redo, selectLayer]
    );

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);
}
