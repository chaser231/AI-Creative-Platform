import { z } from "zod";

export const workflowScenarioSurfaceSchema = z.enum(["banner", "photo", "asset"]);
export const workflowScenarioInputKindSchema = z.enum(["image", "text", "layer"]);
export const workflowScenarioOutputKindSchema = z.enum([
    "image",
    "text",
    "asset",
    "banner",
]);
export const workflowScenarioBehaviorSchema = z.enum([
    "replace-selection",
    "create-layer",
    "save-asset",
    "open-banner",
]);

export const workflowScenarioConfigSchema = z.object({
    enabled: z.boolean().default(false),
    title: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    surfaces: z.array(workflowScenarioSurfaceSchema).min(1).default(["banner"]),
    input: z.object({
        kind: workflowScenarioInputKindSchema.default("image"),
        required: z.boolean().default(true),
    }),
    output: z.object({
        kind: workflowScenarioOutputKindSchema.default("image"),
        behavior: workflowScenarioBehaviorSchema.default("replace-selection"),
    }),
});

export type WorkflowScenarioSurface = z.infer<typeof workflowScenarioSurfaceSchema>;
export type WorkflowScenarioInputKind = z.infer<typeof workflowScenarioInputKindSchema>;
export type WorkflowScenarioOutputKind = z.infer<typeof workflowScenarioOutputKindSchema>;
export type WorkflowScenarioBehavior = z.infer<typeof workflowScenarioBehaviorSchema>;
export type WorkflowScenarioConfig = z.infer<typeof workflowScenarioConfigSchema>;

export function defaultWorkflowScenarioConfig(
    workflowName = "AI сценарий",
): WorkflowScenarioConfig {
    return {
        enabled: false,
        title: workflowName.trim() || "AI сценарий",
        description: "",
        surfaces: ["banner", "photo", "asset"],
        input: { kind: "image", required: true },
        output: { kind: "image", behavior: "replace-selection" },
    };
}

export function normalizeWorkflowScenarioConfig(
    raw: unknown,
    workflowName = "AI сценарий",
): WorkflowScenarioConfig {
    const fallback = defaultWorkflowScenarioConfig(workflowName);
    const parsed = workflowScenarioConfigSchema.safeParse(raw);
    if (!parsed.success) return fallback;
    return {
        ...fallback,
        ...parsed.data,
        title: parsed.data.title || fallback.title,
        description: parsed.data.description ?? "",
        input: { ...fallback.input, ...parsed.data.input },
        output: { ...fallback.output, ...parsed.data.output },
    };
}
