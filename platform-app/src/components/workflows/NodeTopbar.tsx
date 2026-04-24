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

function RunFeedback({
    canRun,
    isRunning,
    runError,
    runDisabledReason,
}: {
    canRun: boolean;
    isRunning: boolean;
    runError: { nodeId: string; message: string } | null;
    runDisabledReason?: string;
}) {
    let message = "";
    let tone = "text-text-tertiary";

    if (runError) {
        message = runError.message;
        tone = "text-red-500";
    } else if (isRunning) {
        message = "Выполняем workflow…";
        tone = "text-text-secondary";
    } else if (!canRun && runDisabledReason) {
        message = runDisabledReason;
        tone = "text-text-tertiary";
    }

    return (
        <span
            className={`hidden min-h-4 w-[260px] max-w-[28vw] truncate text-right text-[11px] leading-4 md:block ${tone}`}
            title={message}
            aria-live="polite"
        >
            {message || "\u00A0"}
        </span>
    );
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
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border-primary bg-bg-surface/95 px-4 backdrop-blur">
            <div className="flex min-w-0 items-center gap-3">
                <Link
                    href="/workflows"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-text-secondary transition hover:bg-bg-tertiary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus/50"
                    aria-label="Назад к списку workflow'ов"
                >
                    <ArrowLeft className="h-4 w-4" />
                </Link>
                <div className="min-w-0">
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => onNameChange(e.target.value)}
                        className="h-8 w-80 max-w-[36vw] rounded-[var(--radius-md)] border border-transparent bg-transparent px-2 text-sm font-medium text-text-primary transition hover:border-border-primary focus:border-border-focus focus:outline-none"
                        aria-label="Название workflow"
                    />
                    <div className="h-4 px-2">
                        <SaveStatusBadge status={saveStatus} />
                    </div>
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <RunFeedback
                    canRun={canRun}
                    isRunning={isRunning}
                    runError={runError}
                    runDisabledReason={runDisabledReason}
                />
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
                    title={
                        isRunning
                            ? "Workflow выполняется"
                            : !canRun
                              ? runDisabledReason
                              : "Запустить workflow"
                    }
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
