"use client";

import { Toolbar } from "@/components/editor/Toolbar";
import { EditorAiPanelHost } from "@/components/editor/EditorAiPanelHost";
import { useCanvasEditMode } from "@/hooks/useCanvasEditMode";
import type { ComponentProps } from "react";

type EditorStudioChromeProps = {
    aiPanelOpen: boolean;
    setAiPanelOpen: (open: boolean) => void;
    aiChatOpen: boolean;
    setAiChatOpen: (open: boolean) => void;
    toolbarProps: Omit<ComponentProps<typeof Toolbar>, "onToggleAI" | "aiActive">;
    promptBarProps: Omit<ComponentProps<typeof EditorAiPanelHost>, "onClosePanel">;
};

export function EditorStudioChrome({
    aiPanelOpen,
    setAiPanelOpen,
    aiChatOpen,
    setAiChatOpen,
    toolbarProps,
    promptBarProps,
}: EditorStudioChromeProps) {
    const { exitCanvasEditMode } = useCanvasEditMode();

    const handleToggleAi = () => {
        if (aiPanelOpen) {
            exitCanvasEditMode();
        }
        setAiPanelOpen(!aiPanelOpen);
    };

    return (
        <>
            <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 transition-all duration-300">
                <Toolbar
                    {...toolbarProps}
                    onToggleAI={handleToggleAi}
                    aiActive={aiPanelOpen}
                />
            </div>

            {aiPanelOpen && (
                <div className="absolute bottom-[68px] left-1/2 z-20 -translate-x-1/2">
                    <EditorAiPanelHost
                        {...promptBarProps}
                        onClosePanel={() => setAiPanelOpen(false)}
                    />
                </div>
            )}
        </>
    );
}
