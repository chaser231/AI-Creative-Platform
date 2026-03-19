"use client";

import { useEffect } from "react";
import { useThemeStore } from "@/store/themeStore";
import { loadAllCustomFonts } from "@/lib/customFonts";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const theme = useThemeStore((s) => s.theme);

    useEffect(() => {
        // Load custom fonts entirely on the client side once on mount
        loadAllCustomFonts().catch(err => console.error("Failed to inject custom fonts on load", err));

        const root = document.documentElement;

        const applyTheme = (dark: boolean) => {
            if (dark) {
                root.classList.add("dark");
            } else {
                root.classList.remove("dark");
            }
        };

        if (theme === "dark") {
            applyTheme(true);
        } else if (theme === "light") {
            applyTheme(false);
        } else {
            // System preference
            const mq = window.matchMedia("(prefers-color-scheme: dark)");
            applyTheme(mq.matches);

            const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
            mq.addEventListener("change", handler);
            return () => mq.removeEventListener("change", handler);
        }
    }, [theme]);

    return <>{children}</>;
}
