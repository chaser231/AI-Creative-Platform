import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TemplatePack, TemplatePackV2 } from "@/services/templateService";

interface TemplateStore {
    savedPacks: TemplatePackV2[];

    // Pack management (V2)
    addPack: (pack: TemplatePack, meta?: Partial<TemplatePackV2>) => void;
    updatePack: (id: string, updates: Partial<TemplatePackV2>) => void;
    deletePack: (id: string) => void;
}

/** Upgrades a v1 TemplatePack to V2 with default metadata */
function toV2(pack: TemplatePack, meta?: Partial<TemplatePackV2>): TemplatePackV2 {
    return {
        ...pack,
        businessUnits: meta?.businessUnits ?? ["other"],
        categories: meta?.categories ?? ["other"],
        contentType: meta?.contentType ?? "visual",
        occasion: meta?.occasion ?? "default",
        tags: meta?.tags ?? [],
        author: meta?.author ?? "system",
        isOfficial: meta?.isOfficial ?? false,
        thumbnailUrl: meta?.thumbnailUrl,
        popularity: meta?.popularity ?? 0,
        createdAt: meta?.createdAt ?? new Date().toISOString(),
        updatedAt: meta?.updatedAt ?? new Date().toISOString(),
    };
}

export const useTemplateStore = create<TemplateStore>()(persist((set) => ({
    savedPacks: [],

    addPack: (pack, meta) => {
        const v2Pack = toV2(pack, meta);
        set((state) => ({
            savedPacks: [...state.savedPacks, v2Pack],
        }));
    },

    updatePack: (id, updates) => {
        set((state) => ({
            savedPacks: state.savedPacks.map((p) =>
                p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
            ),
        }));
    },

    deletePack: (id) => {
        set((state) => ({
            savedPacks: state.savedPacks.filter((p) => p.id !== id),
        }));
    },
}), {
    name: "template-storage",
    partialize: (state) => ({ savedPacks: state.savedPacks }),
}));
