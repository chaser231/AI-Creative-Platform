import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { BrandKit, BrandColor, BrandFont } from "@/types";

interface BrandKitStore {
    brandKit: BrandKit;

    // Color actions
    addColor: (color: Omit<BrandColor, "id">) => void;
    updateColor: (id: string, updates: Partial<BrandColor>) => void;
    removeColor: (id: string) => void;

    // Font actions
    addFont: (font: Omit<BrandFont, "id">) => void;
    updateFont: (id: string, updates: Partial<BrandFont>) => void;
    removeFont: (id: string) => void;

    // TOV
    setToneOfVoice: (tov: string) => void;
    setLogoUrl: (url: string) => void;
}

const DEFAULT_BRAND_KIT: BrandKit = {
    id: "default-kit",
    workspaceName: "Yandex Market",
    colors: [
        { id: "c1", name: "Primary", hex: "#111827", usage: "Headlines, CTAs" },
        { id: "c2", name: "Accent", hex: "#6366F1", usage: "Links, highlights" },
        { id: "c3", name: "Background", hex: "#FFFFFF", usage: "Backgrounds" },
        { id: "c4", name: "Surface", hex: "#F9FAFB", usage: "Cards, panels" },
        { id: "c5", name: "Muted", hex: "#6B7280", usage: "Secondary text" },
        { id: "c6", name: "Success", hex: "#22C55E", usage: "Positive states" },
        { id: "c7", name: "Warning", hex: "#F59E0B", usage: "Alerts" },
        { id: "c8", name: "Error", hex: "#EF4444", usage: "Errors, destructive" },
    ],
    fonts: [
        { id: "f1", name: "Inter", weights: ["400", "500", "600", "700"], usage: "All text" },
    ],
    toneOfVoice:
        "You are a creative copywriter for Yandex Market. " +
        "Write in a professional yet approachable tone. " +
        "Be concise, avoid jargon. " +
        "Use active voice and action verbs. " +
        "Address the audience directly with 'you'. " +
        "Highlight benefits over features.",
};

export const useBrandKitStore = create<BrandKitStore>((set) => ({
    brandKit: DEFAULT_BRAND_KIT,

    addColor: (colorData) => {
        const color: BrandColor = { id: uuid(), ...colorData };
        set((state) => ({
            brandKit: {
                ...state.brandKit,
                colors: [...state.brandKit.colors, color],
            },
        }));
    },

    updateColor: (id, updates) => {
        set((state) => ({
            brandKit: {
                ...state.brandKit,
                colors: state.brandKit.colors.map((c) =>
                    c.id === id ? { ...c, ...updates } : c
                ),
            },
        }));
    },

    removeColor: (id) => {
        set((state) => ({
            brandKit: {
                ...state.brandKit,
                colors: state.brandKit.colors.filter((c) => c.id !== id),
            },
        }));
    },

    addFont: (fontData) => {
        const font: BrandFont = { id: uuid(), ...fontData };
        set((state) => ({
            brandKit: {
                ...state.brandKit,
                fonts: [...state.brandKit.fonts, font],
            },
        }));
    },

    updateFont: (id, updates) => {
        set((state) => ({
            brandKit: {
                ...state.brandKit,
                fonts: state.brandKit.fonts.map((f) =>
                    f.id === id ? { ...f, ...updates } : f
                ),
            },
        }));
    },

    removeFont: (id) => {
        set((state) => ({
            brandKit: {
                ...state.brandKit,
                fonts: state.brandKit.fonts.filter((f) => f.id !== id),
            },
        }));
    },

    setToneOfVoice: (tov) => {
        set((state) => ({
            brandKit: { ...state.brandKit, toneOfVoice: tov },
        }));
    },

    setLogoUrl: (url) => {
        set((state) => ({
            brandKit: { ...state.brandKit, logoUrl: url },
        }));
    },
}));
