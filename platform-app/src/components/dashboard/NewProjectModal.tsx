"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useProjectStore } from "@/store/projectStore";
import { useCreateProjectSync } from "@/hooks/useProjectSync";
import { cn } from "@/lib/cn";
import { ImageIcon, Type, PlayCircle, LayoutTemplate, Palette } from "lucide-react";
import type { ProjectGoal, BusinessUnit } from "@/types";

interface NewProjectModalProps {
    open: boolean;
    onClose: () => void;
}

const goals: Array<{
    value: ProjectGoal;
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
            value: "text",
            label: "Копирайтинг",
            description: "Генерация заголовков, подписей и текстов",
            icon: <Type size={24} />,
        },
        {
            value: "video",
            label: "Видеореклама",
            description: "Создание короткого видеоконтента",
            icon: <PlayCircle size={24} />,
        },
    ];

const businessUnits: Array<{ value: BusinessUnit; label: string }> = [
    { value: "yandex-market", label: "Yandex Market" },
    { value: "yandex-go", label: "Yandex Go" },
    { value: "yandex-food", label: "Yandex Food" },
    { value: "other", label: "Other" },
];

export function NewProjectModal({ open, onClose }: NewProjectModalProps) {
    const [name, setName] = useState("");
    const [businessUnit, setBusinessUnit] = useState<BusinessUnit>("yandex-market");
    const [goal, setGoal] = useState<ProjectGoal>("banner");
    const [mode, setMode] = useState<"wizard" | "studio">("wizard");

    const createProject = useProjectStore((s) => s.createProject);
    const { createProject: createOnBackend } = useCreateProjectSync();
    const router = useRouter();

    const handleCreate = async () => {
        if (!name.trim()) return;

        // Create locally for instant UI
        const localProject = createProject({ name: name.trim(), businessUnit, goal });

        // Also create on backend (async, non-blocking)
        createOnBackend({ name: name.trim(), goal }).catch(() => {
            // Silent fallback — project works locally
        });

        onClose();
        setName("");
        router.push(`/editor/${localProject.id}?mode=${mode}`);
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Новая кампания"
            maxWidth="max-w-md"
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>
                        Отмена
                    </Button>
                    <Button onClick={handleCreate} disabled={!name.trim()}>
                        Создать
                    </Button>
                </>
            }
        >
            <div className="space-y-5">
                {/* Campaign Name */}
                <Input
                    id="campaign-name"
                    label="Название кампании"
                    placeholder="Напр. Летняя распродажа 2026"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                />

                {/* Business Unit */}
                <div className="space-y-1.5">
                    <label className="text-sm font-medium text-text-primary">
                        Бизнес-юнит
                    </label>
                    <select
                        value={businessUnit}
                        onChange={(e) => setBusinessUnit(e.target.value as BusinessUnit)}
                        className="w-full h-9 rounded-[var(--radius-md)] border border-border-primary bg-bg-primary px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus cursor-pointer"
                    >
                        {businessUnits.map((u) => (
                            <option key={u.value} value={u.value}>
                                {u.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Goal Selection */}
                <div className="space-y-1.5">
                    <label className="text-sm font-medium text-text-primary">
                        Выберите цель
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                        {goals.map((g) => (
                            <button
                                key={g.value}
                                onClick={() => setGoal(g.value)}
                                className={cn(
                                    "flex flex-col items-center gap-2 p-3 rounded-[var(--radius-md)] border text-center transition-all cursor-pointer",
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
                                <span className="text-xs font-medium text-text-primary">
                                    {g.label}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Mode Selection */}
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
            </div>
        </Modal>
    );
}
