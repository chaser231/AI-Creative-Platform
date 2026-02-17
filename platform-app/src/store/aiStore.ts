import { create } from "zustand";
import type { AIResult } from "@/services/aiService";
import { MockTextProvider, MockImageProvider } from "@/services/aiService";
import { useBrandKitStore } from "./brandKitStore";

interface AIStore {
    // State
    isGenerating: boolean;
    generationHistory: AIResult[];
    error: string | null;
    activeTab: "text" | "image";

    // Actions
    setActiveTab: (tab: "text" | "image") => void;
    generateText: (prompt: string) => Promise<AIResult | null>;
    generateImage: (prompt: string) => Promise<AIResult | null>;
    clearHistory: () => void;
    clearError: () => void;
}

export const useAIStore = create<AIStore>((set, get) => ({
    isGenerating: false,
    generationHistory: [],
    error: null,
    activeTab: "text",

    setActiveTab: (tab) => {
        set({ activeTab: tab });
    },

    generateText: async (prompt: string) => {
        set({ isGenerating: true, error: null });
        try {
            // Inject brand kit TOV into prompt context
            const tov = useBrandKitStore.getState().brandKit.toneOfVoice;
            const fullPrompt = tov
                ? `[TOV: ${tov}]\n\nЗадача: ${prompt}`
                : prompt;

            const result = await MockTextProvider.generate(fullPrompt);
            set((s) => ({
                isGenerating: false,
                generationHistory: [result, ...s.generationHistory],
            }));
            return result;
        } catch (e) {
            set({
                isGenerating: false,
                error: e instanceof Error ? e.message : "Ошибка генерации текста",
            });
            return null;
        }
    },

    generateImage: async (prompt: string) => {
        set({ isGenerating: true, error: null });
        try {
            const result = await MockImageProvider.generate(prompt);
            set((s) => ({
                isGenerating: false,
                generationHistory: [result, ...s.generationHistory],
            }));
            return result;
        } catch (e) {
            set({
                isGenerating: false,
                error: e instanceof Error ? e.message : "Ошибка генерации изображения",
            });
            return null;
        }
    },

    clearHistory: () => {
        set({ generationHistory: [] });
    },

    clearError: () => {
        set({ error: null });
    },
}));
