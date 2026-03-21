"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { ProjectContextMenu } from "./ProjectContextMenu";
import type { ProjectStatus } from "./ProjectContextMenu";
import type { Project } from "@/types";
import { FolderKanban, MoreHorizontal, AlertTriangle } from "lucide-react";

interface ProjectCardProps {
    project: Project;
    onUpdate?: (id: string, data: { name?: string; status?: ProjectStatus }) => void;
    onDelete?: (id: string) => void;
}

const goalLabels: Record<string, string> = {
    banner: "Баннеры",
    text: "Копирайтинг",
    video: "Видеореклама",
};

function timeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "только что";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} мин. назад`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ч. назад`;
    const days = Math.floor(hours / 24);
    return `${days} дн. назад`;
}

export function ProjectCard({ project, onUpdate, onDelete }: ProjectCardProps) {
    const router = useRouter();
    const [menuOpen, setMenuOpen] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [newName, setNewName] = useState(project.name);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isRenaming && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isRenaming]);

    const handleRename = () => {
        const trimmed = newName.trim();
        if (trimmed && trimmed !== project.name) {
            onUpdate?.(project.id, { name: trimmed });
        }
        setIsRenaming(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") handleRename();
        if (e.key === "Escape") { setNewName(project.name); setIsRenaming(false); }
    };

    return (
        <>
            <div
                role="button"
                tabIndex={0}
                onClick={() => {
                    if (!isRenaming && !showDeleteConfirm) router.push(`/editor/${project.id}`);
                }}
                onKeyDown={(e) => { if (e.key === "Enter" && !isRenaming) router.push(`/editor/${project.id}`); }}
                className="group relative flex flex-col bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] hover:shadow-[var(--shadow-lg)] hover:border-border-secondary transition-all duration-[var(--transition-base)] cursor-pointer text-left"
            >
                {/* Thumbnail */}
                <div className="relative aspect-[4/3] bg-bg-tertiary flex items-center justify-center overflow-hidden rounded-t-[var(--radius-xl)]">
                    <FolderKanban
                        size={40}
                        className="text-text-tertiary/50 group-hover:scale-110 transition-transform duration-[var(--transition-slow)]"
                    />
                    <div className="absolute top-2.5 right-2.5">
                        <Badge status={project.status} />
                    </div>
                </div>

                {/* Info */}
                <div className="flex items-start justify-between p-3.5 gap-2">
                    <div className="min-w-0 flex-1">
                        {isRenaming ? (
                            <input
                                ref={inputRef}
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                onBlur={handleRename}
                                onKeyDown={handleKeyDown}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full text-sm font-semibold text-text-primary bg-bg-tertiary border border-border-focus rounded-[var(--radius-md)] px-2 py-0.5 outline-none"
                            />
                        ) : (
                            <p className="text-sm font-semibold text-text-primary truncate">
                                {project.name}
                            </p>
                        )}
                        <p className="text-xs text-text-tertiary mt-1">
                            обновлён {timeAgo(project.updatedAt)}
                        </p>
                    </div>
                    <div className="relative">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpen(!menuOpen);
                            }}
                            className="p-1.5 rounded-[var(--radius-md)] opacity-0 group-hover:opacity-100 hover:bg-bg-tertiary transition-all cursor-pointer"
                        >
                            <MoreHorizontal size={14} className="text-text-tertiary" />
                        </button>
                        <ProjectContextMenu
                            open={menuOpen}
                            onClose={() => setMenuOpen(false)}
                            currentStatus={project.status}
                            onRename={() => setIsRenaming(true)}
                            onStatusChange={(status) => onUpdate?.(project.id, { status })}
                            onDelete={() => setShowDeleteConfirm(true)}
                        />
                    </div>
                </div>
            </div>

            {/* Delete confirmation overlay */}
            {showDeleteConfirm && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                    onClick={() => setShowDeleteConfirm(false)}
                >
                    <div
                        className="bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] p-6 max-w-sm w-full mx-4 shadow-[var(--shadow-lg)]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-[var(--radius-lg)] bg-red-500/10">
                                <AlertTriangle size={20} className="text-red-400" />
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-text-primary">Удалить проект?</h3>
                                <p className="text-xs text-text-tertiary mt-0.5">
                                    «{project.name}» будет удалён безвозвратно
                                </p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                className="px-4 py-2 text-xs font-medium text-text-secondary hover:text-text-primary bg-bg-tertiary rounded-[var(--radius-md)] transition-colors cursor-pointer"
                            >
                                Отмена
                            </button>
                            <button
                                onClick={() => {
                                    onDelete?.(project.id);
                                    setShowDeleteConfirm(false);
                                }}
                                className="px-4 py-2 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-[var(--radius-md)] transition-colors cursor-pointer"
                            >
                                Удалить
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
