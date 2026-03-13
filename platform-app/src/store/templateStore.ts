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

/** Helper to strip large base64 images from packs to prevent localStorage QuotaExceededError */
function scrubBase64FromPack(pack: TemplatePackV2): TemplatePackV2 {
    const scrubbedPack = JSON.parse(JSON.stringify(pack)) as TemplatePackV2;

    scrubbedPack.masterComponents = scrubbedPack.masterComponents.map(mc => {
        if (mc.type === "image" && (mc.props as any).src?.startsWith("data:image")) {
            return { ...mc, props: { ...mc.props, src: "" } };
        }
        return mc;
    });

    if (scrubbedPack.componentInstances) {
        scrubbedPack.componentInstances = scrubbedPack.componentInstances.map(ci => {
            if (ci.localProps.type === "image" && (ci.localProps as any).src?.startsWith("data:image")) {
                return { ...ci, localProps: { ...ci.localProps, src: "" } };
            }
            return ci;
        });
    }

    return scrubbedPack;
}

export const useTemplateStore = create<TemplateStore>()(persist((set) => ({
    savedPacks: [],

    addPack: (pack, meta) => {
        const v2Pack = toV2(pack, meta);
        const scrubbedPack = scrubBase64FromPack(v2Pack);
        set((state) => ({
            savedPacks: [...state.savedPacks, scrubbedPack],
        }));
    },

    updatePack: (id, updates) => {
        set((state) => ({
            savedPacks: state.savedPacks.map((p) => {
                if (p.id === id) {
                    const updatedPack = { ...p, ...updates, updatedAt: new Date().toISOString() };
                    return scrubBase64FromPack(updatedPack);
                }
                return p;
            }),
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
