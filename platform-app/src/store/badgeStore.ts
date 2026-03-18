"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface BadgeConfig {
    label: string;
    shape: "pill" | "rectangle" | "circle" | "star" | "arrow";
    fill: string;
    textColor: string;
    fontSize: number;
    fontWeight: string;
    borderWidth: number;
    borderColor: string;
}

export interface BadgeTemplate {
    id: string;
    name: string;
    config: BadgeConfig;
    createdAt: number;
}

export const DEFAULT_BADGE_CONFIG: BadgeConfig = {
    label: "",
    shape: "pill",
    fill: "#7C3AED",
    textColor: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
    borderWidth: 0,
    borderColor: "transparent",
};

interface BadgeStore {
    templates: BadgeTemplate[];
    addTemplate: (name: string, config: BadgeConfig) => void;
    removeTemplate: (id: string) => void;
    getTemplates: () => BadgeTemplate[];
}

export const useBadgeStore = create<BadgeStore>()(
    persist(
        (set, get) => ({
            templates: [],

            addTemplate: (name, config) => {
                const template: BadgeTemplate = {
                    id: `badge_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                    name,
                    config: { ...config },
                    createdAt: Date.now(),
                };
                set(state => ({
                    templates: [...state.templates, template],
                }));
            },

            removeTemplate: (id) => {
                set(state => ({
                    templates: state.templates.filter(t => t.id !== id),
                }));
            },

            getTemplates: () => get().templates,
        }),
        {
            name: "badge-templates",
        }
    )
);
