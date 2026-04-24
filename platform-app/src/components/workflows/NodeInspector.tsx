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

import { useMemo } from "react";
import { z } from "zod";
import { useWorkflowStore } from "@/store/workflow/useWorkflowStore";
import { NODE_REGISTRY } from "@/server/workflow/types";
import { NODE_PARAM_SCHEMAS } from "@/lib/workflow/nodeParamSchemas";
import type { ImageInputParams } from "@/lib/workflow/nodeParamSchemas";
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
    },
    direction: {
        "top-to-bottom": "Сверху вниз",
        "bottom-to-top": "Снизу вверх",
        "left-to-right": "Слева направо",
        "right-to-left": "Справа налево",
    },
    mode: {
        uniform: "Однородный",
        progressive: "Прогрессивный",
    },
};

export interface NodeInspectorProps {
    selectedNodeId: string | null;
}

export function NodeInspector({ selectedNodeId }: NodeInspectorProps) {
    const node = useWorkflowStore((s) =>
        selectedNodeId ? s.nodes.find((n) => n.id === selectedNodeId) ?? null : null,
    );
    const updateNodeParams = useWorkflowStore((s) => s.updateNodeParams);

    const definition = node ? NODE_REGISTRY[node.type] : null;
    const schema = node ? NODE_PARAM_SCHEMAS[node.type] : null;

    const validation = useMemo(() => {
        if (!node || !schema) return null;
        return schema.safeParse(node.data.params);
    }, [node, schema]);

    if (!node || !definition || !schema) {
        return (
            <aside className="flex w-72 flex-col border-l border-border-primary bg-bg-surface px-4 py-6">
                <p className="text-sm text-text-secondary">
                    Выберите ноду на холсте, чтобы редактировать параметры.
                </p>
            </aside>
        );
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

    return (
        <aside className="flex w-72 flex-col gap-4 border-l border-border-primary bg-bg-surface px-4 py-5">
            <header className="flex flex-col gap-1">
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
            </header>

            <div className="flex flex-col gap-4">
                {/* Special-case: imageInput renders the composite picker for the whole schema */}
                {node.type === "imageInput" ? (
                    <ImageSourceInput
                        value={node.data.params as Partial<ImageInputParams>}
                        onChange={(patch) => handlePatch(patch as Record<string, unknown>)}
                        error={errorByPath.get("source") ?? errorByPath.get("")}
                    />
                ) : (
                    Object.entries(shape).map(([key, fieldSchema]) => (
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
                    ))
                )}
            </div>

            {validation && !validation.success && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                    Ноду нельзя выполнить с этими параметрами — исправьте ошибки выше.
                </div>
            )}
        </aside>
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
