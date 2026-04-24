"use client";

import { useState } from "react";
import { AlertCircle, Check, Loader2, Play, Sparkles, Workflow } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { trpc } from "@/lib/trpc";
import {
    useWorkflowScenarioRun,
    type WorkflowScenarioRunResult,
} from "@/hooks/workflow/useWorkflowScenarioRun";
import type {
    WorkflowScenarioInputKind,
    WorkflowScenarioSurface,
} from "@/lib/workflow/scenarioConfig";

export interface AIScenarioInput {
    kind: WorkflowScenarioInputKind;
    imageUrl?: string;
    assetId?: string;
    selectedLayerId?: string;
}

export interface AIScenariosModalProps {
    open: boolean;
    onClose: () => void;
    workspaceId: string | undefined;
    projectId?: string;
    surface: WorkflowScenarioSurface;
    input?: AIScenarioInput;
    onResult?: (result: WorkflowScenarioRunResult) => void | Promise<void>;
}

export function AIScenariosModal({
    open,
    onClose,
    workspaceId,
    projectId,
    surface,
    input,
    onResult,
}: AIScenariosModalProps) {
    const [runningId, setRunningId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const { runScenario } = useWorkflowScenarioRun();

    const scenariosQuery = trpc.workflow.listScenarios.useQuery(
        {
            workspaceId: workspaceId ?? "",
            surface,
            inputKind: input?.kind,
        },
        { enabled: open && !!workspaceId },
    );

    const run = async (workflowId: string) => {
        if (!workspaceId) return;
        setRunningId(workflowId);
        setError(null);
        setSuccess(null);
        try {
            const result = await runScenario({
                workflowId,
                workspaceId,
                projectId,
                inputImageUrl: input?.imageUrl,
                inputAssetId: input?.assetId,
            });
            await onResult?.(result);
            setSuccess(successText(result.scenarioConfig.output.behavior));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Не удалось запустить сценарий");
        } finally {
            setRunningId(null);
        }
    };

    const scenarios = scenariosQuery.data ?? [];

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="AI сценарии"
            maxWidth="max-w-3xl"
        >
            <div className="space-y-4">
                <div className="flex items-center gap-2 rounded-[var(--radius-xl)] border border-border-primary bg-bg-secondary px-4 py-3 text-xs text-text-secondary">
                    <Sparkles size={14} className="text-accent-primary" />
                    {input?.imageUrl || input?.assetId
                        ? "Сценарии будут применены к выбранному изображению."
                        : "Выберите изображение или слой, чтобы применить сценарии с обязательным входом."}
                </div>

                {scenariosQuery.isLoading ? (
                    <div className="flex items-center justify-center py-12 text-text-tertiary">
                        <Loader2 size={18} className="animate-spin" />
                    </div>
                ) : scenarios.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-[var(--radius-xl)] border border-dashed border-border-primary py-12 text-center">
                        <Workflow className="mb-3 h-8 w-8 text-text-tertiary" />
                        <div className="text-sm font-medium text-text-primary">
                            Нет доступных сценариев
                        </div>
                        <p className="mt-1 max-w-sm text-xs text-text-secondary">
                            Включите workflow как AI сценарий в его настройках и выберите эту поверхность.
                        </p>
                    </div>
                ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                        {scenarios.map((scenario) => {
                            const needsInput = scenario.scenarioConfig.input.required;
                            const hasInput = !!input?.imageUrl || !!input?.assetId;
                            const disabled =
                                runningId !== null ||
                                !scenario.runnable ||
                                (needsInput && !hasInput);
                            const disabledReason =
                                scenario.disabledReason ??
                                (needsInput && !hasInput
                                    ? "Выберите изображение для запуска"
                                    : undefined);

                            return (
                                <article
                                    key={scenario.id}
                                    className="rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface p-4 shadow-[var(--shadow-sm)]"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <h3 className="truncate text-sm font-semibold text-text-primary">
                                                {scenario.scenarioConfig.title}
                                            </h3>
                                            <p className="mt-1 line-clamp-2 text-xs text-text-secondary">
                                                {scenario.scenarioConfig.description ||
                                                    scenario.description ||
                                                    scenario.name}
                                            </p>
                                        </div>
                                        {scenario.isTemplate && (
                                            <span className="rounded-full bg-accent-lime/25 px-2 py-0.5 text-[10px] font-medium text-accent-lime-text">
                                                Шаблон
                                            </span>
                                        )}
                                    </div>

                                    {disabledReason && (
                                        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-text-tertiary">
                                            <AlertCircle size={12} />
                                            {disabledReason}
                                        </div>
                                    )}

                                    <div className="mt-4 flex items-center justify-between gap-3">
                                        <span className="text-[11px] text-text-tertiary">
                                            {behaviorLabel(scenario.scenarioConfig.output.behavior)}
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            disabled={disabled}
                                            onClick={() => void run(scenario.id)}
                                        >
                                            {runningId === scenario.id ? (
                                                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                            ) : (
                                                <Play className="mr-1.5 h-4 w-4" />
                                            )}
                                            Применить
                                        </Button>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}

                {error && (
                    <div className="rounded-[var(--radius-lg)] border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
                        {error}
                    </div>
                )}

                {success && (
                    <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
                        <Check size={14} />
                        {success}
                    </div>
                )}
            </div>
        </Modal>
    );
}

function behaviorLabel(behavior: string): string {
    switch (behavior) {
        case "replace-selection":
            return "Заменит выделение";
        case "create-layer":
            return "Создаст новый слой";
        case "save-asset":
            return "Сохранит в библиотеку";
        case "open-banner":
            return "Откроет в баннере";
        default:
            return behavior;
    }
}

function successText(behavior: string): string {
    switch (behavior) {
        case "replace-selection":
            return "Выделение обновлено";
        case "create-layer":
            return "Новый слой добавлен";
        case "save-asset":
            return "Результат сохранен в библиотеку";
        case "open-banner":
            return "Открываем баннер";
        default:
            return "Сценарий выполнен";
    }
}
