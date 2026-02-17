"use client";

import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface EmptyStateProps {
    onCreateProject: () => void;
}

export function EmptyState({ onCreateProject }: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center py-20">
            <div className="flex items-center justify-center w-20 h-20 rounded-[var(--radius-2xl)] bg-bg-tertiary mb-6">
                <Sparkles size={36} className="text-text-tertiary" />
            </div>
            <h2 className="text-xl font-bold text-text-primary mb-2">
                Пока нет проектов
            </h2>
            <p className="text-sm text-text-secondary mb-6 text-center max-w-sm">
                Создайте первый проект, чтобы начать генерировать креативы с помощью ИИ.
            </p>
            <Button
                onClick={onCreateProject}
                icon={<Plus size={16} />}
                size="lg"
            >
                Создать проект
            </Button>
        </div>
    );
}
