/**
 * Per-node Zod schemas for workflow node `data.params`.
 *
 * Consumers:
 * - NodeInspector — drives the auto-form via `_def`-based introspection.
 * - Phase 4 executor — validates params before passing to client/server handlers.
 *
 * Kept separate from `workflowGraphSchema` so graph save stays permissive
 * (the store may hold mid-edit invalid params; only Inspector enforces per-node
 * validity at write time, per D-14 in 03-CONTEXT.md).
 */

import { z } from "zod";
import type { WorkflowNodeType } from "@/server/workflow/types";

export const imageInputParamsSchema = z
    .object({
        source: z.enum(["asset", "url", "upload"]).default("asset"),
        assetId: z.string().optional(),
        sourceUrl: z.string().url().optional(),
    })
    .refine(
        (d) => {
            // "asset" requires a library pick; "url" and "upload" both store
            // the resolved location in sourceUrl (uploads run through
            // uploadForAI which returns a public S3 URL — no Asset row is
            // created until the workflow executor runs assetOutput).
            if (d.source === "asset") return !!d.assetId;
            return !!d.sourceUrl;
        },
        {
            message: "Выберите изображение",
            path: ["source"],
        },
    );

export const removeBackgroundParamsSchema = z.object({
    model: z
        .enum(["fal-bria", "replicate-bria-cutout", "replicate-rembg"])
        .default("fal-bria"),
});

export const addReflectionParamsSchema = z.object({
    style: z.enum(["subtle", "strong", "mirror"]).default("subtle"),
    intensity: z.number().min(0).max(1).default(0.3),
    prompt: z.string().max(500).optional(),
});

export const assetOutputParamsSchema = z.object({
    name: z.string().min(1).max(120).default("Workflow output"),
    folder: z.string().optional(),
});

/**
 * Dispatch table — Inspector resolves the schema by node type.
 * `z.ZodTypeAny` (not a parameterised mapped type) keeps the table flat;
 * each schema is statically typed at its declaration site above.
 */
export const NODE_PARAM_SCHEMAS: Record<WorkflowNodeType, z.ZodTypeAny> = {
    imageInput: imageInputParamsSchema,
    removeBackground: removeBackgroundParamsSchema,
    addReflection: addReflectionParamsSchema,
    assetOutput: assetOutputParamsSchema,
};

export type ImageInputParams = z.infer<typeof imageInputParamsSchema>;
export type RemoveBackgroundParams = z.infer<typeof removeBackgroundParamsSchema>;
export type AddReflectionParams = z.infer<typeof addReflectionParamsSchema>;
export type AssetOutputParams = z.infer<typeof assetOutputParamsSchema>;
