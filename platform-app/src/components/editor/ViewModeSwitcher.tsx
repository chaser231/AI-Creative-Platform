"use client";

import { LayoutGrid, Square } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";

/**
 * Segmented toggle between the single-artboard view and the all-formats overview
 * grid (à la Figma Slides grid view). Lives in the editor TopBar and is shared by
 * both studio and wizard — it only flips the orthogonal `viewMode` store flag, so
 * each surface decides what to render for `overview`.
 */
export function ViewModeSwitcher({ className }: { className?: string }) {
    const viewMode = useCanvasStore((s) => s.viewMode);
    const setViewMode = useCanvasStore((s) => s.setViewMode);

    return (
        <div
            className={`flex items-center bg-bg-tertiary rounded-[var(--radius-full)] p-1 ${className ?? ""}`}
            role="group"
            aria-label="Режим отображения"
        >
            <button
                type="button"
                onClick={() => setViewMode("single")}
                title="Один макет"
                aria-pressed={viewMode === "single"}
                className={`flex h-7 w-7 items-center justify-center rounded-[var(--radius-full)] transition-all cursor-pointer ${
                    viewMode === "single"
                        ? "bg-bg-surface text-text-primary shadow-[var(--shadow-sm)]"
                        : "text-text-secondary hover:text-text-primary"
                }`}
            >
                <Square size={14} />
            </button>
            <button
                type="button"
                onClick={() => setViewMode("overview")}
                title="Обзор всех макетов (Shift + G)"
                aria-pressed={viewMode === "overview"}
                className={`flex h-7 w-7 items-center justify-center rounded-[var(--radius-full)] transition-all cursor-pointer ${
                    viewMode === "overview"
                        ? "bg-bg-surface text-text-primary shadow-[var(--shadow-sm)]"
                        : "text-text-secondary hover:text-text-primary"
                }`}
            >
                <LayoutGrid size={14} />
            </button>
        </div>
    );
}
