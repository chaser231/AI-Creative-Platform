/**
 * InpaintContext — single shared `useInpaintMask` instance for the editor
 * surface and any consumers (AIPromptBar, Canvas overlay, PhotoWorkspace).
 *
 * Why a context: brush strokes are owned by a React hook (mutable ref + RAF
 * coalesce) but we need two physically-separated children to share that hook:
 *
 *   1. The Canvas mounts the InpaintMaskOverlay overlay where the user paints.
 *   2. The AIPromptBar reads `hasMask`, renders the InpaintActionBar, and
 *      exports the mask blob when the user submits.
 *
 * Both must reference the same hook instance — they would diverge if each
 * called `useInpaintMask()` independently. Wrapping them in a provider keeps
 * the API simple while preserving the hook's internal performance tricks.
 */

"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useInpaintMask, type UseInpaintMaskApi } from "@/hooks/useInpaintMask";

const InpaintContext = createContext<UseInpaintMaskApi | null>(null);

export interface InpaintProviderProps {
    children: ReactNode;
    /** Override default brush size (screen px). */
    initialBrushSize?: number;
}

export function InpaintProvider({ children, initialBrushSize }: InpaintProviderProps) {
    const mask = useInpaintMask({ initialBrushSize });
    return <InpaintContext.Provider value={mask}>{children}</InpaintContext.Provider>;
}

/**
 * Read the shared mask state. Throws if used outside InpaintProvider — the
 * inpaint feature is only available inside surfaces that explicitly wrap
 * their consumers in the provider (Studio editor, Photo workspace, Wizard).
 */
export function useSharedInpaintMask(): UseInpaintMaskApi {
    const ctx = useContext(InpaintContext);
    if (!ctx) {
        throw new Error("useSharedInpaintMask must be used inside <InpaintProvider>");
    }
    return ctx;
}

/**
 * Soft variant — returns null instead of throwing. Useful for shared
 * components that may render either inside or outside an InpaintProvider.
 */
export function useOptionalSharedInpaintMask(): UseInpaintMaskApi | null {
    return useContext(InpaintContext);
}
