/**
 * AI Model Registry (client-safe)
 *
 * This file contains ONLY the model definitions and helpers — no server-side
 * dependencies (OpenAI SDK, Replicate SDK, etc.). Safe to import in browser.
 *
 * ai-providers.ts re-exports from here so existing server imports still work.
 */

// ─── Model Registry ─────────────────────────────────────────────────────────

export type ModelCap = "generate" | "edit" | "remove-bg" | "inpaint" | "outpaint" | "text" | "vision";

export interface ResolutionOption {
    id: string;   // value sent to API (e.g. "1024px", "1", "high")
    label: string; // user-facing label
}

export interface ModelEntry {
    id: string;
    label: string;
    slug: string;             // Replicate slug or "openai-direct"
    provider: "replicate" | "openai";
    caps: ModelCap[];
    /** Estimated cost per single run in USD (for analytics) */
    costPerRun: number;
    /** Max reference images supported (0 or omit = no ref support) */
    maxRefs?: number;
    /** Supported aspect ratios (omit = uses DEFAULT_ASPECT_RATIOS) */
    aspectRatios?: string[];
    /** Available resolution options (omit = no resolution control) */
    resolutions?: ResolutionOption[];
    /** Version hash (only for community models that need it) */
    version?: string;
    /** If true, requires OPENAI_API_KEY for BYOK billing */
    byok?: boolean;
}

// ─── Shared Constants ───────────────────────────────────────────────────────

/** Aspect ratios shared by Google and Flux models */
const WIDE_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

/** Google Nano Banana resolution options ("resolution" param, enum: 1K | 2K | 4K) */
const GOOGLE_RESOLUTIONS: ResolutionOption[] = [
    { id: "1K", label: "1K" },
    { id: "2K", label: "2K" },
    { id: "4K", label: "4K" },
];

/** Flux megapixel resolution options */
const FLUX_RESOLUTIONS_FULL: ResolutionOption[] = [
    { id: "1",    label: "1 MP" },
    { id: "4",    label: "4 MP" },
    { id: "0.25", label: "0.25 MP" },
];

const FLUX_RESOLUTIONS_BASIC: ResolutionOption[] = [
    { id: "1",    label: "1 MP" },
    { id: "0.25", label: "0.25 MP" },
];

/** GPT Image quality-based resolution */
const GPT_RESOLUTIONS: ResolutionOption[] = [
    { id: "medium", label: "Medium" },
    { id: "high",   label: "High" },
    { id: "low",    label: "Low" },
];

// ─── Registry ───────────────────────────────────────────────────────────────

export const MODEL_REGISTRY: ModelEntry[] = [
    // ── Image Generation + Editing ──────────────────────────────────────
    {
        id: "nano-banana",
        label: "Nano Banana",
        slug: "google/nano-banana",
        provider: "replicate",
        caps: ["generate", "edit", "remove-bg", "vision"],
        costPerRun: 0.039,
        maxRefs: 14,
        aspectRatios: WIDE_ASPECT_RATIOS,
        resolutions: GOOGLE_RESOLUTIONS,
    },
    {
        id: "nano-banana-2",
        label: "Nano Banana 2",
        slug: "google/nano-banana-2",
        provider: "replicate",
        caps: ["generate", "edit", "remove-bg", "vision"],
        costPerRun: 0.067,
        maxRefs: 14,
        aspectRatios: WIDE_ASPECT_RATIOS,
        resolutions: GOOGLE_RESOLUTIONS,
    },
    {
        id: "nano-banana-pro",
        label: "Nano Banana Pro",
        slug: "google/nano-banana-pro",
        provider: "replicate",
        caps: ["generate", "edit", "remove-bg", "vision"],
        costPerRun: 0.15,
        maxRefs: 14,
        aspectRatios: WIDE_ASPECT_RATIOS,
        resolutions: GOOGLE_RESOLUTIONS,
    },
    {
        id: "flux-2-pro",
        label: "Flux 2 Pro",
        slug: "black-forest-labs/flux-2-pro",
        provider: "replicate",
        caps: ["generate", "edit", "vision"],
        costPerRun: 0.045,
        maxRefs: 4,
        aspectRatios: WIDE_ASPECT_RATIOS,
        resolutions: FLUX_RESOLUTIONS_FULL,
    },
    {
        id: "gpt-image",
        label: "GPT Image 1.5",
        slug: "openai/gpt-image-1.5",
        provider: "replicate",
        caps: ["generate", "edit", "vision"],
        costPerRun: 0.136,
        maxRefs: 4,
        aspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"],
        resolutions: GPT_RESOLUTIONS,
        byok: true,
    },
    {
        id: "qwen-image",
        label: "Qwen Image",
        slug: "qwen/qwen-image",
        provider: "replicate",
        caps: ["generate"],
        costPerRun: 0.025,
        aspectRatios: ["1:1", "3:2", "2:3", "16:9", "9:16"],
    },
    {
        id: "qwen-image-edit",
        label: "Qwen Image Edit",
        slug: "qwen/qwen-image-edit",
        provider: "replicate",
        caps: ["edit"],
        costPerRun: 0.03,
    },
    {
        id: "seedream",
        label: "Seedream 4.5",
        slug: "bytedance/seedream-4.5",
        provider: "replicate",
        caps: ["generate", "edit", "vision"],
        costPerRun: 0.04,
        maxRefs: 4,
        aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"],
    },

    // ── Image Generation Only ───────────────────────────────────────────
    {
        id: "flux-schnell",
        label: "Flux Schnell",
        slug: "black-forest-labs/flux-schnell",
        provider: "replicate",
        caps: ["generate"],
        costPerRun: 0.003,
        aspectRatios: WIDE_ASPECT_RATIOS,
        resolutions: FLUX_RESOLUTIONS_BASIC,
    },
    {
        id: "flux-dev",
        label: "Flux Dev",
        slug: "black-forest-labs/flux-dev",
        provider: "replicate",
        caps: ["generate"],
        costPerRun: 0.025,
        aspectRatios: WIDE_ASPECT_RATIOS,
        resolutions: FLUX_RESOLUTIONS_BASIC,
    },
    {
        id: "flux-1.1-pro",
        label: "Flux 1.1 Pro",
        slug: "black-forest-labs/flux-1.1-pro",
        provider: "replicate",
        caps: ["generate"],
        costPerRun: 0.04,
        aspectRatios: WIDE_ASPECT_RATIOS,
        resolutions: FLUX_RESOLUTIONS_BASIC,
    },
    {
        id: "dall-e-3",
        label: "DALL-E 3",
        slug: "openai-direct",
        provider: "openai",
        caps: ["generate"],
        costPerRun: 0.04,
        aspectRatios: ["1:1", "16:9", "9:16"],
    },

    // ── Specialized Image Tools ─────────────────────────────────────────
    {
        id: "flux-fill",
        label: "Flux Fill",
        slug: "black-forest-labs/flux-fill-dev",
        provider: "replicate",
        caps: ["inpaint", "outpaint"],
        costPerRun: 0.04,
    },
    {
        id: "bria-expand",
        label: "Bria Expand",
        slug: "bria/expand-image",
        provider: "replicate",
        caps: ["outpaint"],
        costPerRun: 0.04,
    },
    {
        id: "rembg",
        label: "RemBG",
        slug: "cjwbw/rembg",
        provider: "replicate",
        caps: ["remove-bg"],
        costPerRun: 0.002,
        version: "fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003",
    },

    // ── Text LLMs ───────────────────────────────────────────────────────
    {
        id: "deepseek",
        label: "DeepSeek V3",
        slug: "deepseek-ai/deepseek-v3",
        provider: "replicate",
        caps: ["text"],
        costPerRun: 0.001,
    },
    {
        id: "gemini-flash",
        label: "Gemini 2.5 Flash",
        slug: "google/gemini-2.5-flash",
        provider: "replicate",
        caps: ["text"],
        costPerRun: 0.001,
    },
];

// ─── Default fallback ───────────────────────────────────────────────────────

const DEFAULT_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2"];

// ─── Helpers for UI ─────────────────────────────────────────────────────────

/** Get all models that have ALL specified capabilities. */
export function getModelsForCaps(...caps: ModelCap[]): ModelEntry[] {
    return MODEL_REGISTRY.filter(m => caps.every(c => m.caps.includes(c)));
}

/** Lookup a single model by its ID or slug. */
export function getModelById(id: string): ModelEntry | undefined {
    return MODEL_REGISTRY.find(m => m.id === id || m.slug === id);
}

/** Get maximum reference images allowed for a model (0 = no refs). */
export function getMaxRefs(modelId: string): number {
    return getModelById(modelId)?.maxRefs ?? 0;
}

/** Get supported aspect ratios for a model. */
export function getAspectRatios(modelId: string): string[] {
    return getModelById(modelId)?.aspectRatios ?? DEFAULT_ASPECT_RATIOS;
}

/** Get available resolution options for a model (empty = no resolution control). */
export function getResolutions(modelId: string): ResolutionOption[] {
    return getModelById(modelId)?.resolutions ?? [];
}

// ─── Reference tag resolution ───────────────────────────────────────────────

/** Ordinal words for Google/Seedream models (1-based) */
const ORDINALS = [
    "first", "second", "third", "fourth", "fifth",
    "sixth", "seventh", "eighth", "ninth", "tenth",
    "eleventh", "twelfth", "thirteenth", "fourteenth",
];

/**
 * Replace @refN tags in the prompt with model-native image references.
 *
 * - Google/Seedream: @ref1 → "the first image", @ref2 → "the second image"
 * - Flux/GPT/others: @ref1 → "image 1", @ref2 → "image 2"
 *
 * If no @ref tags are found, returns the prompt unchanged.
 */
export function resolveRefTags(prompt: string, modelId: string): string {
    const entry = getModelById(modelId);
    const isGoogle = entry?.slug.startsWith("google/");
    const isSeedream = entry?.slug.startsWith("bytedance/");

    // Replace @ref1 through @ref14
    return prompt.replace(/@ref(\d+)/gi, (_match, numStr: string) => {
        const num = parseInt(numStr, 10);
        if (num < 1 || num > 14) return _match; // leave unknown refs untouched

        if (isGoogle || isSeedream) {
            const word = ORDINALS[num - 1] || `${num}th`;
            return `the ${word} image`;
        }
        return `image ${num}`;
    });
}
