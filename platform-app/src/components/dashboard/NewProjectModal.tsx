"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useProjectStore } from "@/store/projectStore";
import { useCreateProjectSync } from "@/hooks/useProjectSync";
import { cn } from "@/lib/cn";
import { ImageIcon, Type, PlayCircle, Camera, LayoutTemplate, Palette, Workflow } from "lucide-react";
import type { ProjectGoal } from "@/types";

type GoalChoice = ProjectGoal | "workflows";

interface NewProjectModalProps {
    open: boolean;
    onClose: () => void;
    workspaceId?: string | null;
}

const goals: Array<{
    value: GoalChoice;
    label: string;
    description: string;
    icon: React.ReactNode;
}> = [
        {
            value: "banner",
            label: "Баннеры",
            description: "Создание баннеров для рекламы и соцсетей",
            icon: <ImageIcon size={24} />,
        },
        {
            value: "photo",
            label: "Фото",
            description: "Генерация фотореалистичных изображений",
            icon: <Camera size={24} />,
        },
        {
            value: "video",
            label: "Видео",
            description: "Создание короткого видеоконтента",
            icon: <PlayCircle size={24} />,
        },
        {
            value: "text",
            label: "Тексты",
            description: "Генерация заголовков, подписей и текстов",
            icon: <Type size={24} />,
        },
        {
            value: "workflows",
            label: "Workflow",
            description: "Визуальный сценарий из AI-нод",
            icon: <Workflow size={24} />,
        },
    ];

export function NewProjectModal({ open, onClose, workspaceId }: NewProjectModalProps) {
    const [name, setName] = useState("");
    const [goal, setGoal] = useState<GoalChoice>("banner");
    const [mode, setMode] = useState<"wizard" | "studio">("wizard");
    const [isCreating, setIsCreating] = useState(false);

    const addProject = useProjectStore((s) => s.addProject);
    const createProjectLocal = useProjectStore((s) => s.createProject);
    const { createProject: createOnBackend } = useCreateProjectSync();
    const router = useRouter();

    const handleCreate = async () => {
        // Workflow path: bypasses the project create flow entirely — workflows
        // are workspace-level, have their own list/new pages, and use a
        // separate tRPC router. We just navigate; the /workflows/new page
        // owns the create mutation and the name prompt.
        if (goal === "workflows") {
            onClose();
            setName("");
            router.push("/workflows/new");
            return;
        }

        if (!name.trim() || isCreating) return;
        setIsCreating(true);

        try {
            // Backend-first: create on PostgreSQL and get the canonical ID
            const backendProject = await createOnBackend({
                name: name.trim(),
                goal,
                workspaceId: workspaceId ?? undefined,
            });

            if (backendProject) {
                // Use backend ID as the single source of truth
                addProject({
                    id: backendProject.id,
                    name: backendProject.name,
                    businessUnit: "other", // default value since we removed the field
                    goal,
                    status: "draft",
                    createdAt: new Date(backendProject.createdAt),
                    updatedAt: new Date(backendProject.updatedAt),
                    resizes: [{ id: "master", name: "Master", width: 1080, height: 1080, label: "1080 × 1080", instancesEnabled: false }],
                    activeResizeId: "master",
                });

                onClose();
                setName("");
                setIsCreating(false);
                router.push(
                    goal === "photo"
                        ? `/photo/${backendProject.id}`
                        : `/editor/${backendProject.id}?mode=${mode}`
                );
                return;
            }
        } catch {
            // Backend unavailable — fall through to local creation
        }

        // Fallback: create locally if backend fails
        const localProject = createProjectLocal({ name: name.trim(), businessUnit: "other", goal });
        onClose();
        setName("");
        setIsCreating(false);
        router.push(
            goal === "photo"
                ? `/photo/${localProject.id}`
                : `/editor/${localProject.id}?mode=${mode}`
        );
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Новый проект"
            maxWidth="max-w-md"
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>
                        Отмена
                    </Button>
                    <Button
                        onClick={handleCreate}
                        disabled={(goal !== "workflows" && !name.trim()) || isCreating}
                    >
                        {isCreating ? "Создание..." : goal === "workflows" ? "Перейти" : "Создать"}
                    </Button>
                </>
            }
        >
            <div className="space-y-5">
                {/* Project Name */}
                <Input
                    id="project-name"
                    label="Название проекта"
                    placeholder="Напр. Летняя распродажа 2026"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                />

                {/* Goal Selection */}
                <div className="space-y-1.5">
                    <label className="text-sm font-medium text-text-primary">
                        Тип проекта
                    </label>
                    <div className="grid grid-cols-5 gap-2">
                        {goals.map((g) => (
                            <button
                                key={g.value}
                                onClick={() => setGoal(g.value)}
                                className={cn(
                                    "flex flex-col items-center gap-2 p-2 rounded-[var(--radius-md)] border text-center transition-all cursor-pointer",
                                    goal === g.value
                                        ? "border-accent-primary bg-bg-tertiary"
                                        : "border-border-primary hover:border-border-secondary hover:bg-bg-secondary"
                                )}
                            >
                                <span
                                    className={cn(
                                        "transition-colors",
                                        goal === g.value
                                            ? "text-text-primary"
                                            : "text-text-tertiary"
                                    )}
                                >
                                    {g.icon}
                                </span>
                                <span className="text-[10px] font-medium text-text-primary">
                                    {g.label}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Mode Selection - Only for Banners */}
                {goal === "banner" && (
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-text-primary">
                            Режим работы
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setMode("wizard")}
                                className={cn(
                                    "flex flex-col items-center gap-2 p-3 rounded-[var(--radius-md)] border text-center transition-all cursor-pointer",
                                    mode === "wizard"
                                        ? "border-accent-primary bg-bg-tertiary"
                                        : "border-border-primary hover:border-border-secondary hover:bg-bg-secondary"
                                )}
                            >
                                <span className={cn("transition-colors", mode === "wizard" ? "text-text-primary" : "text-text-tertiary")}>
                                    <LayoutTemplate size={24} />
                                </span>
                                <span className="text-xs font-medium text-text-primary">Пошагово</span>
                            </button>
                            <button
                                onClick={() => setMode("studio")}
                                className={cn(
                                    "flex flex-col items-center gap-2 p-3 rounded-[var(--radius-md)] border text-center transition-all cursor-pointer",
                                    mode === "studio"
                                        ? "border-accent-primary bg-bg-tertiary"
                                        : "border-border-primary hover:border-border-secondary hover:bg-bg-secondary"
                                )}
                            >
                                <span className={cn("transition-colors", mode === "studio" ? "text-text-primary" : "text-text-tertiary")}>
                                    <Palette size={24} />
                                </span>
                                <span className="text-xs font-medium text-text-primary">Студия</span>
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}
