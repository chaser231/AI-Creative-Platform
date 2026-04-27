"use client";

/**
 * NodeInspector — right-side panel that edits the selected node's params.
 *
 * Reads the node from useWorkflowStore by id, dispatches the param schema
 * through NODE_PARAM_SCHEMAS, renders fields with RenderField, and validates
 * the merged params with safeParse on every change. The store is updated
 * unconditionally so users can leave a field invalid mid-edit; we just
 * surface the validation errors inline.
 *
 * Phase 3, Wave 4 — REQ-12, D-14, D-15, D-20.
 */

import { useMemo, type ReactNode } from "react";
import { z } from "zod";
import { ArrowRight, Database, Loader2, Play, Settings2, Unlink2 } from "lucide-react";
import { useWorkflowStore } from "@/store/workflow/useWorkflowStore";
import { NODE_REGISTRY } from "@/server/workflow/types";
import { NODE_PARAM_SCHEMAS } from "@/lib/workflow/nodeParamSchemas";
import type { ImageInputParams } from "@/lib/workflow/nodeParamSchemas";
import { Button } from "@/components/ui/Button";
import { useWorkflowRunControls } from "./WorkflowRunControlsContext";
import { RenderField } from "./inspector/renderField";
import { ImageSourceInput } from "./inspector/ImageSourceInput";

const PARAM_LABELS: Record<string, string> = {
    source: "Источник",
    assetId: "ID ассета",
    sourceUrl: "URL изображения",
    model: "Модель",
    name: "Название",
    folder: "Папка",
    prompt: "Промпт",
    style: "Стиль",
    aspectRatio: "Формат",
    tone: "Тон",
    // mask + blur — direction + band + endpoint values
    direction: "Направление",
    startPos: "Начало области",
    endPos: "Конец области",
    startAlpha: "Прозрачность в начале",
    endAlpha: "Прозрачность в конце",
    startIntensity: "Блюр в начале (px)",
    endIntensity: "Блюр в конце (px)",
    mode: "Режим",
    intensity: "Интенсивность (px)",
};

/**
 * Per-enum-value display labels. The schema enum strings are stable IDs
 * (`fal-birefnet`, `top-to-bottom`, `nano-banana-2`) — these give users
 * Russian, human-readable choices in the inspector.
 */
const ENUM_OPTION_LABELS: Record<string, Record<string, string>> = {
    model: {
        // removeBackground
        "fal-birefnet": "BiRefNet (сохраняет тени и отражения)",
        "fal-bria": "Bria (fal.ai)",
        "replicate-bria-cutout": "Bria Cutout (Replicate)",
        "replicate-rembg": "RemBG (Replicate)",
        // addReflection
        "nano-banana-2": "Nano Banana 2",
        "bria-product-shot": "Bria Product Shot",
        "flux-kontext-pro": "FLUX Kontext Pro",
        "flux-schnell": "Flux Schnell",
        "flux-dev": "Flux Dev",
        "flux-1.1-pro": "Flux 1.1 Pro",
        "flux-2-pro": "Flux 2 Pro",
        seedream: "Seedream 4.5",
        "qwen-image": "Qwen Image",
        "dall-e-3": "DALL-E 3",
    },
    style: {
        photo: "Фото",
        illustration: "Иллюстрация",
        "3d": "3D",
        flat: "Flat",
        gradient: "Градиент",
    },
    aspectRatio: {
        "1:1": "1:1",
        "2:3": "2:3",
        "3:2": "3:2",
        "3:4": "3:4",
        "4:3": "4:3",
        "4:5": "4:5",
        "5:4": "5:4",
        "9:16": "9:16",
        "16:9": "16:9",
    },
    direction: {
        "top-to-bottom": "Сверху вниз",
        "bottom-to-top": "Снизу вверх",
        "left-to-right": "Слева направо",
        "right-to-left": "Справа налево",
    },
    mode: {
        headline: "Заголовок",
        subtitle: "Подзаголовок",
        freeform: "Свободный текст",
        uniform: "Однородный",
        progressive: "Прогрессивный",
    },
    tone: {
        bold: "Уверенный",
        playful: "Игривый",
        formal: "Деловой",
        urgent: "Срочный",
        neutral: "Нейтральный",
    },
};

function InspectorSection({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) {
    return (
        <section className="border-t border-border-primary px-4 py-4">
            <h4 className="mb-3 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                {title}
            </h4>
            {children}
        </section>
    );
}

function InspectorShell({
    children,
    label,
}: {
    children: ReactNode;
    label: string;
}) {
    return (
        <aside
            className="pointer-events-auto absolute right-4 top-4 z-20 flex max-h-[calc(100%-2rem)] w-[320px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface/90 shadow-[var(--shadow-xl)] backdrop-blur-xl"
            aria-label={label}
        >
            {children}
        </aside>
    );
}

export interface NodeInspectorProps {
    selectedNodeId: string | null;
    selectedEdgeId?: string | null;
    onDetachEdge?: (edgeId: string) => void;
}

export function NodeInspector({
    selectedNodeId,
    selectedEdgeId,
    onDetachEdge,
}: NodeInspectorProps) {
    const node = useWorkflowStore((s) =>
        selectedNodeId ? s.nodes.find((n) => n.id === selectedNodeId) ?? null : null,
    );
    const edge = useWorkflowStore((s) =>
        selectedEdgeId ? s.edges.find((e) => e.id === selectedEdgeId) ?? null : null,
    );
    const nodes = useWorkflowStore((s) => s.nodes);
    const updateNodeParams = useWorkflowStore((s) => s.updateNodeParams);
    const runControls = useWorkflowRunControls();

    const definition = node ? NODE_REGISTRY[node.type] : null;
    const schema = node ? NODE_PARAM_SCHEMAS[node.type] : null;
    const edgeNodes = useMemo(() => {
        if (!edge) return null;
        return {
            source: nodes.find((n) => n.id === edge.source) ?? null,
            target: nodes.find((n) => n.id === edge.target) ?? null,
        };
    }, [edge, nodes]);

    const validation = useMemo(() => {
        if (!node || !schema) return null;
        return schema.safeParse(node.data.params);
    }, [node, schema]);

    if (edge && edgeNodes?.source && edgeNodes.target) {
        const sourceDefinition = NODE_REGISTRY[edgeNodes.source.type];
        const targetDefinition = NODE_REGISTRY[edgeNodes.target.type];
        const sourcePortDefinition = sourceDefinition.outputs.find(
            (port) => port.id === edge.sourceHandle,
        );
        const targetPortDefinition = targetDefinition.inputs.find(
            (port) => port.id === edge.targetHandle,
        );
        const sourcePort = sourcePortDefinition?.label ?? edge.sourceHandle;
        const targetPort = targetPortDefinition?.label ?? edge.targetHandle;
        const flowTitle =
            sourcePortDefinition?.type === "text"
                ? "Поток текста"
                : sourcePortDefinition?.type === "image"
                  ? "Поток изображения"
                  : "Связь";

        return (
            <InspectorShell label="Параметры выбранной связи">
                <header className="shrink-0 border-b border-border-primary px-4 py-4">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                        Связь
                    </span>
                    <h3 className="text-sm font-semibold text-text-primary">
                        {flowTitle}
                    </h3>
                    <p className="text-xs text-text-secondary">
                        Эта связь передаёт результат одного узла во вход «{targetPort}».
                    </p>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    <InspectorSection title="Маршрут">
                        <div className="space-y-3">
                            <div>
                                <div className="text-xs font-medium text-text-primary">
                                    {sourceDefinition.displayName}
                                </div>
                                <div className="mt-1 text-[11px] text-text-tertiary">
                                    {sourcePort}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 text-text-tertiary">
                                <div className="h-px flex-1 bg-border-primary" />
                                <ArrowRight className="h-3.5 w-3.5" />
                                <div className="h-px flex-1 bg-border-primary" />
                            </div>
                            <div>
                                <div className="text-xs font-medium text-text-primary">
                                    {targetDefinition.displayName}
                                </div>
                                <div className="mt-1 text-[11px] text-text-tertiary">
                                    {targetPort}
                                </div>
                            </div>
                        </div>
                    </InspectorSection>

                    <InspectorSection title="Действие">
                        <Button
                            type="button"
                            variant="secondary"
                            size="md"
                            onClick={() => onDetachEdge?.(edge.id)}
                            className="w-full rounded-[var(--radius-md)]"
                        >
                            <Unlink2 className="h-4 w-4" />
                            Отключить связь
                        </Button>
                    </InspectorSection>
                </div>
            </InspectorShell>
        );
    }

    if (!node || !definition || !schema) {
        return null;
    }

    // ZodEffects (the .refine() on imageInput) wraps the inner ZodObject;
    // the inspector form renders fields off the inner shape, while the
    // outer schema is what we actually validate against.
    const innerObject = unwrapToObject(schema);
    const shape = innerObject?.shape ?? {};

    const errorByPath = new Map<string, string>();
    if (validation && !validation.success) {
        for (const issue of validation.error.issues) {
            const key = String(issue.path[0] ?? "");
            if (key && !errorByPath.has(key)) errorByPath.set(key, issue.message);
        }
    }

    const handlePatch = (patch: Record<string, unknown>) => {
        // updateNodeParams is a shallow merge; passing `undefined` clears a key.
        updateNodeParams(node.id, patch);
    };
    const nodeRunDisabledReason = runControls?.getNodeRunDisabledReason(node.id);
    const canRunNode = Boolean(runControls && !nodeRunDisabledReason);
    const nodeCachedRunDisabledReason =
        runControls?.getNodeCachedRunDisabledReason(node.id);
    const canRunNodeWithCachedInputs = Boolean(
        runControls && !nodeCachedRunDisabledReason,
    );

    return (
        <InspectorShell label="Параметры выбранного узла">
            <header className="shrink-0 border-b border-border-primary px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                            Параметры
                        </span>
                        <h3 className="text-sm font-semibold text-text-primary">
                            {definition.displayName}
                        </h3>
                        {definition.description && (
                            <p className="text-xs text-text-secondary">
                                {definition.description}
                            </p>
                        )}
                    </div>
                    {runControls && (
                        <div className="flex shrink-0 items-center gap-1.5">
                            <Button
                                type="button"
                                size="icon"
                                variant="secondary"
                                onClick={() => {
                                    if (canRunNode) void runControls.runNode(node.id);
                                }}
                                disabled={!canRunNode}
                                title={
                                    nodeRunDisabledReason ??
                                    `Запустить «${definition.displayName}» с предками`
                                }
                                aria-label={`Запустить ноду «${definition.displayName}» с предками`}
                                className="rounded-[var(--radius-md)]"
                            >
                                {runControls.isRunning ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Play className="h-4 w-4" />
                                )}
                            </Button>
                            <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => {
                                    if (canRunNodeWithCachedInputs) {
                                        void runControls.runNodeWithCachedInputs(node.id);
                                    }
                                }}
                                disabled={!canRunNodeWithCachedInputs}
                                title={
                                    nodeCachedRunDisabledReason ??
                                    "Запустить только эту ноду с кэшированными входами; если кэша нет, запустятся предки"
                                }
                                aria-label={`Запустить ноду «${definition.displayName}» с кэшированными входами`}
                                className="rounded-[var(--radius-md)]"
                            >
                                {runControls.isRunning ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Database className="h-4 w-4" />
                                )}
                            </Button>
                        </div>
                    )}
                </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
                <InspectorSection
                    title={node.type === "imageInput" ? "Источник" : "Настройки"}
                >
                    {/* Special-case: imageInput renders the composite picker for the whole schema */}
                    {node.type === "imageInput" ? (
                        <ImageSourceInput
                            value={node.data.params as Partial<ImageInputParams>}
                            onChange={(patch) => handlePatch(patch as Record<string, unknown>)}
                            error={errorByPath.get("source") ?? errorByPath.get("")}
                        />
                    ) : (
                        <div className="space-y-5">
                            {Object.entries(shape).map(([key, fieldSchema]) => (
                                <RenderField
                                    key={key}
                                    name={key}
                                    label={PARAM_LABELS[key] ?? key}
                                    schema={fieldSchema as z.ZodTypeAny}
                                    value={(node.data.params as Record<string, unknown>)[key]}
                                    error={errorByPath.get(key)}
                                    optionLabels={ENUM_OPTION_LABELS[key]}
                                    onChange={(next) => handlePatch({ [key]: next })}
                                />
                            ))}
                        </div>
                    )}
                </InspectorSection>

                {validation && !validation.success && (
                    <div className="mx-4 mb-4 rounded-[var(--radius-md)] border border-status-draft/40 bg-status-draft/10 px-2.5 py-2 text-[11px] text-text-secondary">
                        Ноду нельзя выполнить с этими параметрами — исправьте ошибки выше.
                    </div>
                )}

                {node.type !== "imageInput" && (
                    <InspectorSection title="Состояние">
                        <div className="flex items-center gap-2 text-xs text-text-secondary">
                            <Settings2 className="h-3.5 w-3.5 text-text-tertiary" />
                            Параметры сохраняются автоматически.
                        </div>
                    </InspectorSection>
                )}
            </div>
        </InspectorShell>
    );
}

/**
 * Walk past optional/default/effects wrappers until we hit the underlying
 * ZodObject (or null if the schema isn't object-shaped at its core). This
 * is what lets us iterate `.shape` on schemas like
 * `z.object({...}).refine(...)`.
 */
function unwrapToObject(schema: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> | null {
    let current: { def: { type: string; innerType?: unknown }; shape?: z.ZodRawShape } =
        schema as unknown as typeof current;
    while (true) {
        const t = current.def.type;
        if (t === "object") return current as unknown as z.ZodObject<z.ZodRawShape>;
        if (
            (t === "optional" || t === "nullable" || t === "default" || t === "pipe" || t === "transform") &&
            current.def.innerType
        ) {
            current = current.def.innerType as typeof current;
            continue;
        }
        return null;
    }
}
