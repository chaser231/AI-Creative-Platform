"use client";

/**
 * NodeTopbar — editor header: back link, editable workflow name, save
 * status, Save (force) and Run (disabled until Phase 4) buttons.
 */

import Link from "next/link";
import { ArrowLeft, Check, Loader2, Play, Save, Workflow, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { SaveStatus } from "@/hooks/workflow/useWorkflowAutoSave";

interface NodeTopbarProps {
    name: string;
    onNameChange: (name: string) => void;
    onSave: () => void;
    saveStatus: SaveStatus;
    onRun: () => void;
    canRun: boolean;
    isRunning: boolean;
    runError: { nodeId: string; message: string } | null;
    runDisabledReason?: string;
    scenarioEnabled: boolean;
    onOpenScenarioSettings: () => void;
}

function SaveStatusBadge({ status }: { status: SaveStatus }) {
    const base = "flex items-center gap-1 text-xs";
    if (status === "saving") {
        return (
            <span className={`${base} text-text-secondary`}>
                <Loader2 className="h-3 w-3 animate-spin" />
                Сохраняем…
            </span>
        );
    }
    if (status === "saved") {
        return (
            <span className={`${base} text-status-published`}>
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

export function NodeTopbar({
    name,
    onNameChange,
    onSave,
    saveStatus,
    onRun,
    canRun,
    isRunning,
    runError,
    runDisabledReason,
    scenarioEnabled,
    onOpenScenarioSettings,
}: NodeTopbarProps) {
    return (
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border-primary bg-bg-surface px-4">
            <div className="flex items-center gap-3">
                <Link
                    href="/workflows"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary"
                    aria-label="Назад к списку workflow'ов"
                >
                    <ArrowLeft className="h-4 w-4" />
                </Link>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    className="h-8 w-[320px] rounded-md border border-transparent bg-transparent px-2 text-sm font-medium text-text-primary hover:border-border-primary focus:border-border-focus focus:outline-none"
                    aria-label="Название workflow"
                />
                <SaveStatusBadge status={saveStatus} />
            </div>
            <div className="flex items-center gap-2">
                {runError && (
                    <span className="max-w-[280px] truncate text-xs text-red-500" title={runError.message}>
                        {runError.message}
                    </span>
                )}
                <Button variant="ghost" size="sm" onClick={onSave} disabled={isRunning}>
                    <Save className="mr-1.5 h-4 w-4" />
                    Сохранить
                </Button>
                <Button
                    variant={scenarioEnabled ? "secondary" : "ghost"}
                    size="sm"
                    onClick={onOpenScenarioSettings}
                    disabled={isRunning}
                    title="Настроить запуск этого workflow как AI-сценария"
                >
                    <Workflow className="mr-1.5 h-4 w-4" />
                    Сценарий
                </Button>
                <Button
                    size="sm"
                    onClick={onRun}
                    disabled={!canRun}
                    title={!canRun ? runDisabledReason : "Запустить workflow"}
                >
                    {isRunning ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                        <Play className="mr-1.5 h-4 w-4" />
                    )}
                    {isRunning ? "Выполняется…" : "Запустить"}
                </Button>
            </div>
        </header>
    );
}
