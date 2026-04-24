"use client";

import { useMemo } from "react";
import { Image as ImageIcon, Layers, Save, Workflow } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Toggle } from "@/components/ui/Toggle";
import { useWorkflowStore } from "@/store/workflow/useWorkflowStore";
import type {
    WorkflowScenarioBehavior,
    WorkflowScenarioConfig,
    WorkflowScenarioInputKind,
    WorkflowScenarioOutputKind,
    WorkflowScenarioSurface,
} from "@/lib/workflow/scenarioConfig";

const SURFACES: Array<{ value: WorkflowScenarioSurface; label: string }> = [
    { value: "banner", label: "Баннерный канвас" },
    { value: "photo", label: "Фото-проекты" },
    { value: "asset", label: "Библиотека ассетов" },
];

const INPUT_KIND_OPTIONS = [
    { value: "image", label: "Изображение" },
    { value: "layer", label: "Слой" },
    { value: "text", label: "Текст" },
];

const OUTPUT_KIND_OPTIONS = [
    { value: "image", label: "Изображение" },
    { value: "asset", label: "Ассет" },
    { value: "banner", label: "Баннер" },
    { value: "text", label: "Текст" },
];

const BEHAVIOR_OPTIONS = [
    { value: "replace-selection", label: "Заменить выделение" },
    { value: "create-layer", label: "Создать новый слой" },
    { value: "save-asset", label: "Сохранить ассет" },
    { value: "open-banner", label: "Открыть в баннере" },
];

export function WorkflowScenarioSettingsModal({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const name = useWorkflowStore((s) => s.name);
    const scenarioConfig = useWorkflowStore((s) => s.scenarioConfig);
    const setScenarioConfig = useWorkflowStore((s) => s.setScenarioConfig);

    const config = useMemo<WorkflowScenarioConfig>(
        () => ({
            ...scenarioConfig,
            title: scenarioConfig.title || name || "AI сценарий",
        }),
        [name, scenarioConfig],
    );

    const patch = (next: Partial<WorkflowScenarioConfig>) => {
        setScenarioConfig({ ...config, ...next });
    };

    const setSurface = (surface: WorkflowScenarioSurface, enabled: boolean) => {
        const set = new Set(config.surfaces);
        if (enabled) set.add(surface);
        else set.delete(surface);
        const surfaces = Array.from(set);
        patch({ surfaces: surfaces.length > 0 ? surfaces : [surface] });
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="AI сценарий"
            maxWidth="max-w-2xl"
            footer={
                <Button onClick={onClose} icon={<Save size={14} />}>
                    Готово
                </Button>
            }
        >
            <div className="space-y-5">
                <div className="rounded-[var(--radius-xl)] border border-border-primary bg-bg-secondary p-4">
                    <Toggle
                        checked={config.enabled}
                        onChange={(enabled) => patch({ enabled })}
                        label="Показывать этот workflow как AI сценарий"
                    />
                    <p className="mt-2 text-xs text-text-secondary">
                        Включённые сценарии появятся в баннерном канвасе, фото-проектах
                        и библиотеке ассетов согласно настройкам ниже.
                    </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <Input
                        label="Название сценария"
                        value={config.title}
                        onChange={(e) => patch({ title: e.target.value })}
                    />
                    <Select
                        label="Поведение результата"
                        value={config.output.behavior}
                        onChange={(behavior) =>
                            patch({
                                output: {
                                    ...config.output,
                                    behavior: behavior as WorkflowScenarioBehavior,
                                },
                            })
                        }
                        options={BEHAVIOR_OPTIONS}
                    />
                </div>

                <Textarea
                    label="Описание"
                    rows={3}
                    value={config.description ?? ""}
                    onChange={(e) => patch({ description: e.target.value })}
                    placeholder="Коротко: что делает сценарий и когда его применять"
                />

                <div className="grid gap-4 md:grid-cols-2">
                    <Select
                        label="Тип входа"
                        value={config.input.kind}
                        onChange={(kind) =>
                            patch({
                                input: {
                                    ...config.input,
                                    kind: kind as WorkflowScenarioInputKind,
                                },
                            })
                        }
                        options={INPUT_KIND_OPTIONS}
                    />
                    <Select
                        label="Тип результата"
                        value={config.output.kind}
                        onChange={(kind) =>
                            patch({
                                output: {
                                    ...config.output,
                                    kind: kind as WorkflowScenarioOutputKind,
                                },
                            })
                        }
                        options={OUTPUT_KIND_OPTIONS}
                    />
                </div>

                <Toggle
                    checked={config.input.required}
                    onChange={(required) =>
                        patch({ input: { ...config.input, required } })
                    }
                    label="Сценарию нужен выбранный вход"
                />

                <div>
                    <div className="mb-2 text-xs font-medium text-text-primary">
                        Где показывать
                    </div>
                    <div className="grid gap-2 md:grid-cols-3">
                        {SURFACES.map((surface) => {
                            const checked = config.surfaces.includes(surface.value);
                            return (
                                <button
                                    key={surface.value}
                                    type="button"
                                    onClick={() => setSurface(surface.value, !checked)}
                                    className={`flex items-center gap-2 rounded-[var(--radius-lg)] border px-3 py-2 text-left text-xs transition-colors ${
                                        checked
                                            ? "border-accent-lime bg-accent-lime/20 text-text-primary"
                                            : "border-border-primary bg-bg-surface text-text-secondary hover:bg-bg-tertiary"
                                    }`}
                                >
                                    {surface.value === "banner" ? (
                                        <Layers size={14} />
                                    ) : surface.value === "photo" ? (
                                        <ImageIcon size={14} />
                                    ) : (
                                        <Workflow size={14} />
                                    )}
                                    <span>{surface.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
