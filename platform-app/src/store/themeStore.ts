import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeStore {
    theme: ThemeMode;
    setTheme: (theme: ThemeMode) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
    theme: (typeof window !== "undefined"
        ? (localStorage.getItem("theme") as ThemeMode) || "system"
        : "system"),
    setTheme: (theme) => {
        if (typeof window !== "undefined") {
            localStorage.setItem("theme", theme);
        }
        set({ theme });
    },
}));
