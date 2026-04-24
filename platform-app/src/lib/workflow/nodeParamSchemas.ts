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

/**
 * Background-removal models. Birefnet (fal) is default — it preserves shadows
 * and reflections better than Bria, which strips everything but the product
 * silhouette. Older Bria/rembg models stay in the enum so existing graphs
 * still validate after the default flip.
 */
export const removeBackgroundParamsSchema = z.object({
    model: z
        .enum([
            "fal-birefnet",
            "fal-bria",
            "replicate-bria-cutout",
            "replicate-rembg",
        ])
        .default("fal-birefnet"),
});

/**
 * Reflection generation. We add a `prompt` field so the user can control
 * the exact request sent to the model. The default prompt is optimized for
 * creating a sharp mirror reflection that downstream `removeBackground` nodes
 * can easily preserve.
 *
 * `model` lets the user pick which provider runs first; the cascade falls back
 * to the others on failure regardless of choice.
 */
export const addReflectionParamsSchema = z.object({
    model: z
        .enum(["nano-banana-2", "bria-product-shot", "flux-kontext-pro"])
        .default("nano-banana-2"),
    prompt: z
        .string()
        .default(
            "Выдели продукт из фото, размести его на изолированном однотонном фоне, создай от него идеально ровно неискаженное физически корректное отражение, как будто он стоит на зеркале.",
        ),
});

/**
 * Mask — linear alpha gradient with two control points (Figma-style).
 * `start` is the alpha at the start of `direction`, `end` is the alpha at
 * the end. Linear interpolation between them. Multiplies into the source
 * RGBA's alpha channel; opaque RGB inputs get an alpha channel added.
 */
export const maskParamsSchema = z.object({
    direction: z
        .enum([
            "top-to-bottom",
            "bottom-to-top",
            "left-to-right",
            "right-to-left",
        ])
        .default("top-to-bottom"),
    start: z.number().min(0).max(1).default(1),
    end: z.number().min(0).max(1).default(0),
});

/**
 * Blur — Figma-style Layer Blur with two modes.
 * - `uniform`: constant `intensity` (px) across the whole image.
 * - `progressive`: blur radius interpolates linearly from `start` (px) at the
 *   start of `direction` to `end` (px) at the end, implemented as a 2-layer
 *   composite (blurred-end masked over blurred-start).
 */
export const blurParamsSchema = z
    .object({
        mode: z.enum(["uniform", "progressive"]).default("uniform"),
        intensity: z.number().min(0).max(50).default(4),
        direction: z
            .enum([
                "top-to-bottom",
                "bottom-to-top",
                "left-to-right",
                "right-to-left",
            ])
            .default("top-to-bottom"),
        start: z.number().min(0).max(50).default(0),
        end: z.number().min(0).max(50).default(8),
    })
    .refine(
        (d) =>
            d.mode === "uniform" ? d.intensity > 0 : d.start >= 0 && d.end > d.start,
        {
            message:
                "Progressive: end должен быть больше start. Uniform: intensity должен быть > 0.",
            path: ["mode"],
        },
    );

export const assetOutputParamsSchema = z.object({
    name: z.string().min(1).max(120).default("Workflow output"),
    folder: z.string().optional(),
});

/**
 * Dispatch table — Inspector resolves the schema by node type.
 * `z.ZodTypeAny` (not a parameterised mapped type) keeps the table flat;
 * each schema is statically typed at its declaration site above.
 */
export const previewParamsSchema = z.object({});

export const NODE_PARAM_SCHEMAS: Record<WorkflowNodeType, z.ZodTypeAny> = {
    imageInput: imageInputParamsSchema,
    removeBackground: removeBackgroundParamsSchema,
    addReflection: addReflectionParamsSchema,
    mask: maskParamsSchema,
    blur: blurParamsSchema,
    preview: previewParamsSchema,
    assetOutput: assetOutputParamsSchema,
};

export type ImageInputParams = z.infer<typeof imageInputParamsSchema>;
export type RemoveBackgroundParams = z.infer<typeof removeBackgroundParamsSchema>;
export type AddReflectionParams = z.infer<typeof addReflectionParamsSchema>;
export type MaskParams = z.infer<typeof maskParamsSchema>;
export type BlurParams = z.infer<typeof blurParamsSchema>;
export type PreviewParams = z.infer<typeof previewParamsSchema>;
export type AssetOutputParams = z.infer<typeof assetOutputParamsSchema>;
