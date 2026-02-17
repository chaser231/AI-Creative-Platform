"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import type { Project } from "@/types";
import { FolderKanban, MoreHorizontal } from "lucide-react";

interface ProjectCardProps {
    project: Project;
}

const goalLabels: Record<string, string> = {
    banner: "Баннеры",
    text: "Копирайтинг",
    video: "Видеореклама",
};

const unitLabels: Record<string, string> = {
    "yandex-market": "Яндекс Маркет",
    "yandex-go": "Яндекс Go",
    "yandex-food": "Яндекс Еда",
    other: "Другой",
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

export function ProjectCard({ project }: ProjectCardProps) {
    const router = useRouter();

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => router.push(`/editor/${project.id}`)}
            onKeyDown={(e) => { if (e.key === "Enter") router.push(`/editor/${project.id}`); }}
            className="group flex flex-col bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] overflow-hidden hover:shadow-[var(--shadow-lg)] hover:border-border-secondary transition-all duration-[var(--transition-base)] cursor-pointer text-left"
        >
            {/* Thumbnail */}
            <div className="relative aspect-[4/3] bg-bg-tertiary flex items-center justify-center overflow-hidden">
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
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">
                        {project.name}
                    </p>
                    <p className="text-xs text-text-tertiary mt-1">
                        обновлён {timeAgo(project.updatedAt)}
                    </p>
                </div>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                    }}
                    className="p-1.5 rounded-[var(--radius-md)] opacity-0 group-hover:opacity-100 hover:bg-bg-tertiary transition-all cursor-pointer"
                >
                    <MoreHorizontal size={14} className="text-text-tertiary" />
                </button>
            </div>
        </div>
    );
}
