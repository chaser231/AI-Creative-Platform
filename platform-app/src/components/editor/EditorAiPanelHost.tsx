"use client";

import { useCallback, useEffect, useRef } from "react";
import { AIPromptBar, type AIPromptBarProps } from "@/components/editor/AIPromptBar";
import { useCanvasEditMode } from "@/hooks/useCanvasEditMode";

type EditorAiPanelHostProps = Omit<AIPromptBarProps, "open" | "onClose"> & {
    onClosePanel: () => void;
};

/**
 * AIPromptBar wrapper that exits inpaint/expand modes when the panel closes
 * or unmounts.
 */
export function EditorAiPanelHost({ onClosePanel, ...props }: EditorAiPanelHostProps) {
    const { exitCanvasEditMode } = useCanvasEditMode();
    const exitRef = useRef(exitCanvasEditMode);
    exitRef.current = exitCanvasEditMode;

    const handleClose = useCallback(() => {
        exitCanvasEditMode();
        onClosePanel();
    }, [exitCanvasEditMode, onClosePanel]);

    // Cleanup only on real unmount (panel hidden), not when deps change.
    useEffect(() => {
        return () => {
            exitRef.current();
        };
    }, []);

    return <AIPromptBar open onClose={handleClose} {...props} />;
}
