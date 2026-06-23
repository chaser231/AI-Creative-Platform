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

export interface PendingPhotoGeneration {
    id: string;
    sessionId: string;
    count: number;
    aspectRatio?: string;
    prompt: string;
}

/** Top-level mode of the photo workspace. */
export type PhotoGenerationMode = "single" | "multi";

export interface PhotoStore {
    // Sessions
    activeSessionId: string | null;
    setActiveSession: (id: string | null) => void;

    // UI
    libraryOpen: boolean;
    setLibraryOpen: (open: boolean) => void;
    toggleLibrary: () => void;

    /**
     * Single chat-style generation vs "Мульти-генерация" batch mode. Lives in
     * the store so the sidebar toggle and the workspace center stay in sync.
     */
    generationMode: PhotoGenerationMode;
    setGenerationMode: (mode: PhotoGenerationMode) => void;

    /** Batch currently open in the multi-generation view (DB id). */
    activeBatchId: string | null;
    setActiveBatchId: (id: string | null) => void;

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

    // Inpaint sub-mode of edit: when true, the workspace renders the
    // PhotoInpaintModal which mounts the shared mask overlay over the
    // edit-context source image. Toggled from the prompt bar's Inpaint button.
    // The actual brush strokes live in the InpaintProvider hook; this flag
    // only controls modal visibility.
    inpaintMode: boolean;
    setInpaintMode: (active: boolean) => void;

    /**
     * Reference URLs pushed from result cards / library. Consumed by the prompt bar
     * on mount/update and then cleared. Used for the "Use as reference" action so
     * the user can stack several references without entering edit mode.
     */
    pendingReferences: string[];
    pushReference: (url: string) => void;
    clearPendingReferences: () => void;

    pendingGenerations: PendingPhotoGeneration[];
    addPendingGeneration: (generation: PendingPhotoGeneration) => void;
    clearPendingGeneration: (id: string) => void;
}

export const usePhotoStore = create<PhotoStore>((set) => ({
    activeSessionId: null,
    setActiveSession: (id) => set({ activeSessionId: id }),

    libraryOpen: false,
    setLibraryOpen: (open) => set({ libraryOpen: open }),
    toggleLibrary: () => set((s) => ({ libraryOpen: !s.libraryOpen })),

    generationMode: "single",
    setGenerationMode: (mode) => set({ generationMode: mode }),

    activeBatchId: null,
    setActiveBatchId: (id) => set({ activeBatchId: id }),

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
    // Clearing the edit context also drops inpaint mode — the modal has
    // nothing to anchor to without a source image.
    clearEditContext: () => set({ editContext: null, inpaintMode: false }),

    inpaintMode: false,
    setInpaintMode: (active) => set({ inpaintMode: active }),

    pendingReferences: [],
    pushReference: (url) =>
        set((s) =>
            s.pendingReferences.includes(url)
                ? s
                : { pendingReferences: [...s.pendingReferences, url] }
        ),
    clearPendingReferences: () => set({ pendingReferences: [] }),

    pendingGenerations: [],
    addPendingGeneration: (generation) =>
        set((s) => ({ pendingGenerations: [...s.pendingGenerations, generation] })),
    clearPendingGeneration: (id) =>
        set((s) => ({ pendingGenerations: s.pendingGenerations.filter((generation) => generation.id !== id) })),
}));
