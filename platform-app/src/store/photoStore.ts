/**
 * Photo Generation Store
 *
 * Client state for the Krea-like `/photo/[id]` workspace:
 * - which session is active in the sidebar
 * - right-panel library open state
 * - model/aspect ratio selections per mode
 * - edit context: when user clicks "Edit" on a generated result, we keep
 *   a reference to the source image so the next prompt goes through the
 *   image-edit pipeline with that image pre-bound.
 */

import { create } from "zustand";

export interface PhotoEditContext {
    /** Source image URL (S3) of the image being edited */
    url: string;
    /** Asset ID if the source is a saved library asset */
    assetId?: string;
    /** ID of the AIMessage that produced the source (for lineage in chat) */
    sourceMessageId?: string;
}

export interface PhotoStore {
    // Sessions
    activeSessionId: string | null;
    setActiveSession: (id: string | null) => void;

    // UI
    libraryOpen: boolean;
    setLibraryOpen: (open: boolean) => void;
    toggleLibrary: () => void;

    // Generate mode
    selectedModelId: string;
    setSelectedModel: (id: string) => void;
    aspectRatio: string;
    setAspectRatio: (ratio: string) => void;

    /** Style preset id (see lib/stylePresets). "none" means no style applied. */
    imageStyleId: string;
    setImageStyleId: (id: string) => void;

    // Edit mode
    editModelId: string;
    setEditModel: (id: string) => void;
    editContext: PhotoEditContext | null;
    setEditContext: (ctx: PhotoEditContext | null) => void;
    clearEditContext: () => void;

    /**
     * Reference URLs pushed from result cards / library. Consumed by the prompt bar
     * on mount/update and then cleared. Used for the "Use as reference" action so
     * the user can stack several references without entering edit mode.
     */
    pendingReferences: string[];
    pushReference: (url: string) => void;
    clearPendingReferences: () => void;
}

export const usePhotoStore = create<PhotoStore>((set) => ({
    activeSessionId: null,
    setActiveSession: (id) => set({ activeSessionId: id }),

    libraryOpen: false,
    setLibraryOpen: (open) => set({ libraryOpen: open }),
    toggleLibrary: () => set((s) => ({ libraryOpen: !s.libraryOpen })),

    selectedModelId: "nano-banana-2",
    setSelectedModel: (id) => set({ selectedModelId: id }),
    aspectRatio: "1:1",
    setAspectRatio: (ratio) => set({ aspectRatio: ratio }),

    imageStyleId: "none",
    setImageStyleId: (id) => set({ imageStyleId: id }),

    editModelId: "nano-banana-2",
    setEditModel: (id) => set({ editModelId: id }),
    editContext: null,
    setEditContext: (ctx) => set({ editContext: ctx }),
    clearEditContext: () => set({ editContext: null }),

    pendingReferences: [],
    pushReference: (url) =>
        set((s) =>
            s.pendingReferences.includes(url)
                ? s
                : { pendingReferences: [...s.pendingReferences, url] }
        ),
    clearPendingReferences: () => set({ pendingReferences: [] }),
}));
