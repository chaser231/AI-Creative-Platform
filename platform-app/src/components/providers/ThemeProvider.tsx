"use client";

import { useEffect, useMemo } from "react";
import { useThemeStore } from "@/store/themeStore";
import { loadAllCustomFonts, type WorkspaceFontAsset } from "@/lib/customFonts";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const theme = useThemeStore((s) => s.theme);
    const { currentWorkspace } = useWorkspace();
    const { data: workspaceFonts = [] } = trpc.asset.list.useQuery(
        { workspaceId: currentWorkspace?.id ?? "", type: "FONT" },
        { enabled: !!currentWorkspace?.id, refetchOnWindowFocus: false }
    );
    const { data: templateFonts = [] } = trpc.asset.listTemplateFonts.useQuery(
        undefined,
        { refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 }
    );

    const allFontAssets = useMemo(() => {
        const seen = new Set<string>();
        const merged: WorkspaceFontAsset[] = [];
        for (const f of [...(workspaceFonts as WorkspaceFontAsset[]), ...(templateFonts as WorkspaceFontAsset[])]) {
            if (!seen.has(f.url)) {
                seen.add(f.url);
                merged.push(f);
            }
        }
        return merged;
    }, [workspaceFonts, templateFonts]);

    useEffect(() => {
        loadAllCustomFonts(allFontAssets).catch(err => console.error("Failed to inject custom fonts on load", err));

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
    }, [theme, allFontAssets]);

    return <>{children}</>;
}
