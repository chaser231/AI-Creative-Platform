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

export const imageGenerationParamsSchema = z.object({
    prompt: z.string().trim().min(3, "Опишите, что нужно сгенерировать").max(1200),
    style: z
        .enum(["photo", "illustration", "3d", "flat", "gradient"])
        .default("photo"),
    model: z
        .enum([
            "flux-schnell",
            "flux-dev",
            "flux-1.1-pro",
            "flux-2-pro",
            "nano-banana-2",
            "seedream",
            "qwen-image",
            "dall-e-3",
        ])
        .default("flux-schnell"),
    aspectRatio: z
        .enum(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9"])
        .default("1:1"),
});

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
 * Mask — Figma-style linear alpha gradient with explicit start/end *positions*
 * along `direction` (0..1). Outside the [startPos, endPos] range the alpha is
 * clamped to `startAlpha` / `endAlpha` (so only the delimited band actually
 * participates in the gradient, the rest stays constant).
 *
 * Example (bottom-to-top, startPos=0, endPos=0.5, startAlpha=0, endAlpha=1):
 *   - Bottom 0..50% of image: alpha fades 0 → 1 (reflection fade-out zone)
 *   - Top 50..100%: alpha = 1 (product stays fully visible)
 */
export const maskParamsSchema = z
    .object({
        direction: z
            .enum([
                "top-to-bottom",
                "bottom-to-top",
                "left-to-right",
                "right-to-left",
            ])
            .default("bottom-to-top"),
        startPos: z.number().min(0).max(1).default(0),
        endPos: z.number().min(0).max(1).default(0.5),
        startAlpha: z.number().min(0).max(1).default(0),
        endAlpha: z.number().min(0).max(1).default(1),
    })
    .refine((d) => d.endPos > d.startPos, {
        message: "Конец области должен быть больше начала",
        path: ["endPos"],
    });

/**
 * Blur — Figma-style Layer Blur with two modes.
 * - `uniform`: constant `intensity` (px) Gaussian blur over the whole image.
 * - `progressive`: blur radius interpolates from `startIntensity` (px) at
 *   `startPos` to `endIntensity` (px) at `endPos` along `direction`. Outside
 *   that band the blur is clamped to the nearest endpoint (Figma parity).
 *   Implementation: two blurred copies of the source are composited through
 *   an alpha-gradient mask matching the same start/end positions.
 */
export const blurParamsSchema = z
    .object({
        mode: z.enum(["uniform", "progressive"]).default("progressive"),
        intensity: z.number().min(0).max(50).default(4),
        direction: z
            .enum([
                "top-to-bottom",
                "bottom-to-top",
                "left-to-right",
                "right-to-left",
            ])
            .default("bottom-to-top"),
        startPos: z.number().min(0).max(1).default(0),
        endPos: z.number().min(0).max(1).default(0.5),
        startIntensity: z.number().min(0).max(50).default(16),
        endIntensity: z.number().min(0).max(50).default(0),
    })
    .refine(
        (d) =>
            d.mode === "uniform"
                ? d.intensity > 0
                : d.endPos > d.startPos &&
                  Math.max(d.startIntensity, d.endIntensity) > 0,
        {
            message:
                "Progressive: endPos > startPos и хотя бы одна интенсивность > 0. Uniform: intensity > 0.",
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
    imageGeneration: imageGenerationParamsSchema,
    removeBackground: removeBackgroundParamsSchema,
    addReflection: addReflectionParamsSchema,
    mask: maskParamsSchema,
    blur: blurParamsSchema,
    preview: previewParamsSchema,
    assetOutput: assetOutputParamsSchema,
};

export type ImageInputParams = z.infer<typeof imageInputParamsSchema>;
export type ImageGenerationParams = z.infer<typeof imageGenerationParamsSchema>;
export type RemoveBackgroundParams = z.infer<typeof removeBackgroundParamsSchema>;
export type AddReflectionParams = z.infer<typeof addReflectionParamsSchema>;
export type MaskParams = z.infer<typeof maskParamsSchema>;
export type BlurParams = z.infer<typeof blurParamsSchema>;
export type PreviewParams = z.infer<typeof previewParamsSchema>;
export type AssetOutputParams = z.infer<typeof assetOutputParamsSchema>;
