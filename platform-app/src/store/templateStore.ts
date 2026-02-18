import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import type { Template, TemplateSlot, ComponentType } from "@/types";
import type { TemplatePack } from "@/services/templateService";

interface TemplateStore {
    templates: Template[];
    savedPacks: TemplatePack[]; // User-saved packs
    activeTemplateId: string | null;

    addTemplate: (template: Omit<Template, "id" | "createdAt" | "updatedAt">) => string;
    updateTemplate: (id: string, updates: Partial<Template>) => void;
    deleteTemplate: (id: string) => void;
    setActiveTemplate: (id: string | null) => void;

    // Pack management
    addPack: (pack: TemplatePack) => void;
    deletePack: (id: string) => void;

    // Slot management
    addSlot: (templateId: string, slot: Omit<TemplateSlot, "id">) => void;
    updateSlot: (templateId: string, slotId: string, updates: Partial<TemplateSlot>) => void;
    removeSlot: (templateId: string, slotId: string) => void;
}

// Sample starter templates
const STARTER_TEMPLATES: Template[] = [
    {
        id: "tpl-promo-banner",
        name: "Promo Banner",
        description: "Standard promotional banner with headline, product image, and CTA",
        baseWidth: 1080,
        baseHeight: 1080,
        slots: [
            {
                id: "slot-bg",
                name: "Background",
                acceptTypes: ["rectangle", "image"],
                defaultProps: { x: 0, y: 0, width: 1080, height: 1080, rotation: 0, visible: true, locked: false },
            },
            {
                id: "slot-headline",
                name: "Headline",
                acceptTypes: ["text"],
                defaultProps: { x: 80, y: 120, width: 920, height: 120, rotation: 0, visible: true, locked: false },
            },
            {
                id: "slot-hero",
                name: "Hero Image",
                acceptTypes: ["image"],
                defaultProps: { x: 140, y: 280, width: 800, height: 480, rotation: 0, visible: true, locked: false },
            },
            {
                id: "slot-cta",
                name: "CTA Button",
                acceptTypes: ["rectangle", "text"],
                defaultProps: { x: 340, y: 820, width: 400, height: 64, rotation: 0, visible: true, locked: false },
            },
            {
                id: "slot-badge",
                name: "Badge",
                acceptTypes: ["badge"],
                defaultProps: { x: 800, y: 80, width: 120, height: 36, rotation: 0, visible: true, locked: false },
            },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        id: "tpl-minimal-card",
        name: "Minimal Card",
        description: "Clean card layout with text and image",
        baseWidth: 1200,
        baseHeight: 628,
        slots: [
            {
                id: "slot-bg",
                name: "Background",
                acceptTypes: ["rectangle"],
                defaultProps: { x: 0, y: 0, width: 1200, height: 628, rotation: 0, visible: true, locked: false },
            },
            {
                id: "slot-image",
                name: "Image",
                acceptTypes: ["image"],
                defaultProps: { x: 600, y: 0, width: 600, height: 628, rotation: 0, visible: true, locked: false },
            },
            {
                id: "slot-title",
                name: "Title",
                acceptTypes: ["text"],
                defaultProps: { x: 60, y: 180, width: 480, height: 80, rotation: 0, visible: true, locked: false },
            },
            {
                id: "slot-subtitle",
                name: "Subtitle",
                acceptTypes: ["text"],
                defaultProps: { x: 60, y: 280, width: 480, height: 60, rotation: 0, visible: true, locked: false },
            },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
    },
];

export const useTemplateStore = create<TemplateStore>()(persist((set) => ({
    templates: STARTER_TEMPLATES,
    savedPacks: [],
    activeTemplateId: null,

    addTemplate: (templateData) => {
        const id = uuid();
        const template: Template = {
            id,
            ...templateData,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        set((state) => ({
            templates: [...state.templates, template],
        }));
        return id;
    },

    updateTemplate: (id, updates) => {
        set((state) => ({
            templates: state.templates.map((t) =>
                t.id === id ? { ...t, ...updates, updatedAt: new Date() } : t
            ),
        }));
    },

    deleteTemplate: (id) => {
        set((state) => ({
            templates: state.templates.filter((t) => t.id !== id),
            activeTemplateId: state.activeTemplateId === id ? null : state.activeTemplateId,
        }));
    },

    setActiveTemplate: (id) => {
        set({ activeTemplateId: id });
    },

    addPack: (pack) => {
        set((state) => ({
            savedPacks: [...state.savedPacks, pack],
        }));
    },

    deletePack: (id) => {
        set((state) => ({
            savedPacks: state.savedPacks.filter((p) => p.id !== id),
        }));
    },

    addSlot: (templateId, slotData) => {
        const slot: TemplateSlot = { id: uuid(), ...slotData };
        set((state) => ({
            templates: state.templates.map((t) =>
                t.id === templateId
                    ? { ...t, slots: [...t.slots, slot], updatedAt: new Date() }
                    : t
            ),
        }));
    },

    updateSlot: (templateId, slotId, updates) => {
        set((state) => ({
            templates: state.templates.map((t) =>
                t.id === templateId
                    ? {
                        ...t,
                        slots: t.slots.map((s) => (s.id === slotId ? { ...s, ...updates } : s)),
                        updatedAt: new Date(),
                    }
                    : t
            ),
        }));
    },

    removeSlot: (templateId, slotId) => {
        set((state) => ({
            templates: state.templates.map((t) =>
                t.id === templateId
                    ? { ...t, slots: t.slots.filter((s) => s.id !== slotId), updatedAt: new Date() }
                    : t
            ),
        }));
    },
}), {
    name: "template-storage",
    partialize: (state) => ({ savedPacks: state.savedPacks }), // Only persist saved packs
}));
