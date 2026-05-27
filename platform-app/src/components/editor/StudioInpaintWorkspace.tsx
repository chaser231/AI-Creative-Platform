"use client";

import type { ReactNode } from "react";
import { InpaintProvider } from "@/components/inpaint/InpaintContext";
import { CanvasEditModeEffects } from "@/components/editor/canvas/CanvasEditModeEffects";

interface StudioInpaintWorkspaceProps {
    children: ReactNode;
}

/** Studio canvas shell: shared inpaint mask + edit-mode side effects. */
export function StudioInpaintWorkspace({ children }: StudioInpaintWorkspaceProps) {
    return (
        <InpaintProvider>
            <CanvasEditModeEffects />
            {children}
        </InpaintProvider>
    );
}
