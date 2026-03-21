"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil, Trash2, ChevronRight, FileText, Play, Eye, Globe, Archive } from "lucide-react";

type ProjectStatus = "DRAFT" | "IN_PROGRESS" | "REVIEW" | "PUBLISHED" | "ARCHIVED";

const STATUS_OPTIONS: { value: ProjectStatus; label: string; icon: React.ReactNode }[] = [
    { value: "DRAFT", label: "Черновик", icon: <FileText size={14} /> },
    { value: "IN_PROGRESS", label: "В работе", icon: <Play size={14} /> },
    { value: "REVIEW", label: "На ревью", icon: <Eye size={14} /> },
    { value: "PUBLISHED", label: "Опубликован", icon: <Globe size={14} /> },
    { value: "ARCHIVED", label: "Архив", icon: <Archive size={14} /> },
];

interface ProjectContextMenuProps {
    open: boolean;
    onClose: () => void;
    currentStatus: string;
    onRename: () => void;
    onStatusChange: (status: ProjectStatus) => void;
    onDelete: () => void;
    /** Position anchor: "left" or "right" */
    align?: "left" | "right";
}

export function ProjectContextMenu({
    open,
    onClose,
    currentStatus,
    onRename,
    onStatusChange,
    onDelete,
    align = "right",
}: ProjectContextMenuProps) {
    const [showStatusSub, setShowStatusSub] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open, onClose]);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [open, onClose]);

    if (!open) return null;

    const normalizedStatus = currentStatus.toUpperCase().replace("-", "_");

    return (
        <div
            ref={menuRef}
            className={`absolute z-50 top-full mt-1 ${align === "right" ? "right-0" : "left-0"} w-48 bg-bg-surface border border-border-primary rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] py-1 animate-in fade-in slide-in-from-top-1 duration-150`}
        >
            {/* Rename */}
            <button
                onClick={() => { onRename(); onClose(); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
            >
                <Pencil size={14} />
                Переименовать
            </button>

            {/* Status submenu */}
            <div
                className="relative"
                onMouseEnter={() => setShowStatusSub(true)}
                onMouseLeave={() => setShowStatusSub(false)}
            >
                <button
                    className="flex items-center justify-between w-full px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
                >
                    <span className="flex items-center gap-2.5">
                        <Play size={14} />
                        Статус
                    </span>
                    <ChevronRight size={12} />
                </button>

                {showStatusSub && (
                    <div className={`absolute top-0 ${align === "right" ? "right-full mr-1" : "left-full ml-1"} w-44 bg-bg-surface border border-border-primary rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] py-1`}>
                        {STATUS_OPTIONS.map((opt) => (
                            <button
                                key={opt.value}
                                onClick={() => { onStatusChange(opt.value); onClose(); }}
                                className={`flex items-center gap-2.5 w-full px-3 py-2 text-xs transition-colors cursor-pointer ${
                                    normalizedStatus === opt.value
                                        ? "text-accent-primary bg-bg-tertiary font-medium"
                                        : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
                                }`}
                            >
                                {opt.icon}
                                {opt.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Divider */}
            <div className="my-1 border-t border-border-primary" />

            {/* Delete */}
            <button
                onClick={() => { onDelete(); onClose(); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
                <Trash2 size={14} />
                Удалить
            </button>
        </div>
    );
}

/** Status labels for display */
export const STATUS_LABELS: Record<string, string> = {
    DRAFT: "Черновик",
    IN_PROGRESS: "В работе",
    REVIEW: "На ревью",
    PUBLISHED: "Опубликован",
    ARCHIVED: "Архив",
    draft: "Черновик",
    "in-progress": "В работе",
    review: "На ревью",
    published: "Опубликован",
    archived: "Архив",
};

export { STATUS_OPTIONS };
export type { ProjectStatus };
