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

export interface ModelEntry {
    id: string;
    label: string;
    slug: string;             // Replicate slug or "openai-direct"
    provider: "replicate" | "openai";
    caps: ModelCap[];
    /** Estimated cost per single run in USD (for analytics) */
    costPerRun: number;
    /** Version hash (only for community models that need it) */
    version?: string;
    /** If true, requires OPENAI_API_KEY for BYOK billing */
    byok?: boolean;
}

export const MODEL_REGISTRY: ModelEntry[] = [
    // ── Image Generation + Editing ──────────────────────────────────────
    {
        id: "nano-banana",
        label: "Nano Banana",
        slug: "google/nano-banana",
        provider: "replicate",
        caps: ["generate", "edit", "remove-bg", "vision"],
        costPerRun: 0.045,
    },
    {
        id: "nano-banana-2",
        label: "Nano Banana 2",
        slug: "google/nano-banana-2",
        provider: "replicate",
        caps: ["generate", "edit", "remove-bg", "vision"],
        costPerRun: 0.045,
    },
    {
        id: "nano-banana-pro",
        label: "Nano Banana Pro",
        slug: "google/nano-banana-pro",
        provider: "replicate",
        caps: ["generate", "edit", "remove-bg", "vision"],
        costPerRun: 0.067,
    },
    {
        id: "flux-2-pro",
        label: "Flux 2 Pro",
        slug: "black-forest-labs/flux-2-pro",
        provider: "replicate",
        caps: ["generate", "edit", "vision"],
        costPerRun: 0.05,
    },
    {
        id: "gpt-image",
        label: "GPT Image 1.5",
        slug: "openai/gpt-image-1.5",
        provider: "replicate",
        caps: ["generate", "edit", "vision"],
        costPerRun: 0.04,
        byok: true,
    },
    {
        id: "qwen-image",
        label: "Qwen Image",
        slug: "qwen/qwen-image",
        provider: "replicate",
        caps: ["generate"],
        costPerRun: 0.03,
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
    },

    // ── Image Generation Only ───────────────────────────────────────────
    {
        id: "flux-schnell",
        label: "Flux Schnell",
        slug: "black-forest-labs/flux-schnell",
        provider: "replicate",
        caps: ["generate"],
        costPerRun: 0.003, // $3/1000 images
    },
    {
        id: "flux-dev",
        label: "Flux Dev",
        slug: "black-forest-labs/flux-dev",
        provider: "replicate",
        caps: ["generate"],
        costPerRun: 0.025,
    },
    {
        id: "flux-1.1-pro",
        label: "Flux 1.1 Pro",
        slug: "black-forest-labs/flux-1.1-pro",
        provider: "replicate",
        caps: ["generate"],
        costPerRun: 0.04,
    },
    {
        id: "dall-e-3",
        label: "DALL-E 3",
        slug: "openai-direct",
        provider: "openai",
        caps: ["generate"],
        costPerRun: 0.04,
    },

    // ── Specialized Image Tools ─────────────────────────────────────────
    {
        id: "flux-fill",
        label: "Flux Fill",
        slug: "black-forest-labs/flux-fill-dev",
        provider: "replicate",
        caps: ["inpaint", "outpaint"],
        costPerRun: 0.025,
    },
    {
        id: "bria-expand",
        label: "Bria Expand",
        slug: "bria/expand-image",
        provider: "replicate",
        caps: ["outpaint"],
        costPerRun: 0.025,
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
        costPerRun: 0.005,
    },
    {
        id: "gemini-flash",
        label: "Gemini 2.5 Flash",
        slug: "google/gemini-2.5-flash",
        provider: "replicate",
        caps: ["text"],
        costPerRun: 0.003,
    },
];

// ─── Helpers for UI ─────────────────────────────────────────────────────────

/** Get all models that have ALL specified capabilities. */
export function getModelsForCaps(...caps: ModelCap[]): ModelEntry[] {
    return MODEL_REGISTRY.filter(m => caps.every(c => m.caps.includes(c)));
}

/** Lookup a single model by its ID. */
export function getModelById(id: string): ModelEntry | undefined {
    return MODEL_REGISTRY.find(m => m.id === id);
}
