"use client";

/**
 * NodeTopbar — editor header: back link, editable workflow name, save
 * status, Save (force) and Run (disabled until Phase 4) buttons.
 */

import Link from "next/link";
import { ArrowLeft, Check, Loader2, Play, Save, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { SaveStatus } from "@/hooks/workflow/useWorkflowAutoSave";

interface NodeTopbarProps {
    name: string;
    onNameChange: (name: string) => void;
    onSave: () => void;
    saveStatus: SaveStatus;
}

function SaveStatusBadge({ status }: { status: SaveStatus }) {
    const base = "flex items-center gap-1 text-xs";
    if (status === "saving") {
        return (
            <span className={`${base} text-neutral-500`}>
                <Loader2 className="h-3 w-3 animate-spin" />
                Сохраняем…
            </span>
        );
    }
    if (status === "saved") {
        return (
            <span className={`${base} text-emerald-600 dark:text-emerald-400`}>
                <Check className="h-3 w-3" />
                Сохранено
            </span>
        );
    }
    if (status === "error") {
        return (
            <span className={`${base} text-red-600 dark:text-red-400`}>
                <XCircle className="h-3 w-3" />
                Ошибка сохранения
            </span>
        );
    }
    return null;
}

export function NodeTopbar({ name, onNameChange, onSave, saveStatus }: NodeTopbarProps) {
    return (
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="flex items-center gap-3">
                <Link
                    href="/workflows"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    aria-label="Назад к списку workflow'ов"
                >
                    <ArrowLeft className="h-4 w-4" />
                </Link>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    className="h-8 w-[320px] rounded-md border border-transparent bg-transparent px-2 text-sm font-medium text-neutral-900 hover:border-neutral-200 focus:border-blue-400 focus:outline-none dark:text-neutral-100 dark:hover:border-neutral-700"
                    aria-label="Название workflow"
                />
                <SaveStatusBadge status={saveStatus} />
            </div>
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onSave}>
                    <Save className="mr-1.5 h-4 w-4" />
                    Сохранить
                </Button>
                <Button
                    size="sm"
                    disabled
                    title="Запуск workflow появится в следующей фазе"
                >
                    <Play className="mr-1.5 h-4 w-4" />
                    Запустить
                </Button>
            </div>
        </header>
    );
}
