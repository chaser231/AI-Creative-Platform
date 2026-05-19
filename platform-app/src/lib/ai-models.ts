/**
 * AI Model Registry (client-safe)
 *
 * This file contains ONLY the model definitions and helpers — no server-side
 * dependencies (OpenAI SDK, Replicate SDK, etc.). Safe to import in browser.
 *
 * ai-providers.ts re-exports from here so existing server imports still work.
 */

// ─── Model Registry ─────────────────────────────────────────────────────────

export type ModelCap = "generate" | "edit" | "remove-bg" | "inpaint" | "outpaint" | "upscale" | "text" | "vision";

export interface ResolutionOption {
    id: string;   // value sent to API (e.g. "1024px", "1", "high")
    label: string; // user-facing label
}

/**
 * LoRA capability descriptor.
 *
 * Attached to LoRA-aware fal.ai endpoints (`fal-ai/flux-lora`,
 * `fal-ai/flux-2/lora`, `fal-ai/qwen-image-2512/lora`,
 * `fal-ai/qwen-image-edit-lora`). Drives:
 *   • UI gating of LoraSelectorPicker / ModelSettingsModal
 *   • allowed `family` filter when picking presets
 *   • per-model defaults the FalProvider falls back to when the user
 *     hasn't overridden anything in advanced settings
 */
export interface LoraSpec {
    /** How many LoRAs may be merged at once. Hardcoded to 2 in V1 UI. */
    maxCount: number;
    /**
     * LoRA "family" — only presets whose family matches can be picked.
     * Cross-family weights are not interchangeable.
     */
    family: "flux-1" | "flux-2" | "qwen";
    /** Default CFG / guidance scale (sent to fal as `guidance_scale`). */
    defaultGuidance: number;
    /** Default sampler steps (sent as `num_inference_steps`). */
    defaultSteps: number;
    /** Inclusive [min, max] range for guidance slider. */
    guidanceRange: [number, number];
    /** Inclusive [min, max] range for steps slider. */
    stepsRange: [number, number];
    /** Whether the endpoint accepts an `acceleration` enum. */
    supportsAcceleration: boolean;
    /** Allowed acceleration values (subset of "none" | "regular" | "high"). */
    accelerationOptions?: ("none" | "regular" | "high")[];
    /** Whether the endpoint accepts a `negative_prompt` (Qwen edit only). */
    supportsNegativePrompt: boolean;
    /** Per-megapixel price in USD — used for cost tracking (more precise than costPerRun). */
    pricePerMP: number;
}

export interface ModelEntry {
    id: string;
    label: string;
    slug: string;             // Replicate slug, fal.ai endpoint, or "openai-direct"
    provider: "replicate" | "openai" | "fal";
    caps: ModelCap[];
    /** Estimated cost per single run in USD (for analytics) */
    costPerRun: number;
    /** Max reference images supported (0 or omit = no ref support) */
    maxRefs?: number;
    /** Maximum images one API request can return (1/omit = single-image only). */
    maxOutputs?: number;
    /** Supported aspect ratios (omit = uses DEFAULT_ASPECT_RATIOS) */
    aspectRatios?: string[];
    /** Available resolution options (omit = no resolution control) */
    resolutions?: ResolutionOption[];
    /** Version hash (only for community models that need it) */
    version?: string;
    /** If true, requires OPENAI_API_KEY for BYOK billing */
    byok?: boolean;
    /**
     * LoRA capability — when present, this model accepts a `loras` array and
     * exposes the advanced-settings modal (guidance / steps / negative prompt /
     * acceleration). Absent on all base models.
     */
    loraSpec?: LoraSpec;
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

/** Seedream 5 size resolution options ("size" param, enum: 2K | 3K) */
const SEEDREAM_RESOLUTIONS: ResolutionOption[] = [
    { id: "2K", label: "2K" },
    { id: "3K", label: "3K" },
];

/**
 * fal.ai LoRA endpoints accept the `image_size` preset enum (square_hd /
 * portrait_* / landscape_*). We surface the same canonical AR strings the rest
 * of the registry uses; FalProvider maps them to fal's image_size internally
 * via falImageSizeFromAspectRatio().
 */
const LORA_ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"];

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
        maxOutputs: 4,
        aspectRatios: WIDE_ASPECT_RATIOS,
        resolutions: GOOGLE_RESOLUTIONS,
    },
    {
        // Nano Banana 2 / Gemini 3.1 Flash Image.
        // Inpaint here is semantic-mask (experimental): we forward the user
        // mask as a second image hint via image_urls/image_input, the model
        // does not strictly respect mask edges. Reflected in the
        // FALLBACK_INPAINT_MODEL chain — flux-fill stays default.
        id: "nano-banana-2",
        label: "Nano Banana 2",
        slug: "google/nano-banana-2",
        provider: "replicate",
        caps: ["generate", "edit", "remove-bg", "inpaint", "vision"],
        costPerRun: 0.067,
        maxRefs: 14,
        maxOutputs: 4,
        aspectRatios: WIDE_ASPECT_RATIOS,
        resolutions: GOOGLE_RESOLUTIONS,
    },
    {
        id: "nano-banana-pro",
        label: "Nano Banana Pro",
        slug: "google/nano-banana-pro",
        provider: "replicate",
        caps: ["generate", "edit", "remove-bg", "inpaint", "vision"],
        costPerRun: 0.15,
        maxRefs: 14,
        maxOutputs: 4,
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
        // GPT Image 2 (released April 2026).
        // Routed primarily through fal.ai (no OpenAI BYOK needed — billed
        // through FAL_KEY); Replicate (openai/gpt-image-2) used as fallback
        // via MODEL_FALLBACK_CHAIN.
        // The fal.ai TTI / edit endpoints accept `image_size` preset enum
        // instead of `aspect_ratio` — see FalProvider for the mapping.
        id: "gpt-image-2",
        label: "GPT Image 2",
        slug: "openai/gpt-image-2",
        provider: "replicate",
        // Native mask support (white = regenerate, black = preserve) via the
        // OpenAI /images/edits mask parameter; both fal and Replicate respect
        // it. Mask must match source size and carry a real alpha channel.
        caps: ["generate", "edit", "inpaint", "vision"],
        costPerRun: 0.15,
        maxRefs: 8,
        maxOutputs: 4,
        aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
        resolutions: GPT_RESOLUTIONS,
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
    {
        // Seedream 5 (Lite) — ByteDance latest, released Feb 2026.
        // Replicate slug: bytedance/seedream-5-lite. Adds reasoning,
        // example-based editing, multi-image blending up to 14 refs.
        // The non-Lite variant has no public Replicate page yet (404).
        id: "seedream-5",
        label: "Seedream 5",
        slug: "bytedance/seedream-5-lite",
        provider: "replicate",
        caps: ["generate", "edit", "vision"],
        costPerRun: 0.035,
        maxRefs: 14,
        maxOutputs: 6,
        aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"],
        resolutions: SEEDREAM_RESOLUTIONS,
    },

    // ── Image Generation Only ───────────────────────────────────────────
    {
        id: "flux-schnell",
        label: "Flux Schnell",
        slug: "black-forest-labs/flux-schnell",
        provider: "replicate",
        caps: ["generate"],
        costPerRun: 0.003,
        maxOutputs: 4,
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
        maxOutputs: 4,
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

    // ── LoRA-aware Image Models (fal.ai) ────────────────────────────────
    // These endpoints accept a `loras` array of { path, scale } pairs. They
    // share schema across families (Flux 1, Flux 2, Qwen 2512) but each has
    // its own guidance/steps/acceleration defaults — see LoraSpec.
    {
        // FLUX.1 [dev] with LoRAs — the canonical Flux LoRA endpoint.
        // Cheapest and most battle-tested LoRA model; the right default for
        // applying community Flux LoRAs (HuggingFace / CivitAI).
        // Endpoint: https://fal.run/fal-ai/flux-lora
        id: "flux-lora",
        label: "FLUX.1 LoRA",
        slug: "fal-ai/flux-lora",
        provider: "fal",
        caps: ["generate", "edit", "vision"],
        costPerRun: 0.025,
        maxRefs: 1, // image-to-image variant accepts a single source image
        maxOutputs: 4,
        aspectRatios: LORA_ASPECT_RATIOS,
        loraSpec: {
            maxCount: 2,
            family: "flux-1",
            defaultGuidance: 3.5,
            defaultSteps: 28,
            guidanceRange: [0, 35],
            stepsRange: [1, 50],
            supportsAcceleration: true,
            accelerationOptions: ["none", "regular"],
            supportsNegativePrompt: false,
            pricePerMP: 0.025,
        },
    },
    {
        // FLUX.2 [dev] with LoRAs — newest Flux generation. Better prompt
        // adherence and acceleration="high" support, slightly pricier.
        // Endpoint: https://fal.run/fal-ai/flux-2/lora
        id: "flux-2-lora",
        label: "FLUX.2 LoRA",
        slug: "fal-ai/flux-2/lora",
        provider: "fal",
        caps: ["generate", "vision"],
        costPerRun: 0.05,
        maxOutputs: 4,
        aspectRatios: LORA_ASPECT_RATIOS,
        loraSpec: {
            maxCount: 2,
            family: "flux-2",
            defaultGuidance: 2.5,
            defaultSteps: 28,
            guidanceRange: [0, 20],
            stepsRange: [1, 50],
            supportsAcceleration: true,
            accelerationOptions: ["none", "regular", "high"],
            supportsNegativePrompt: false,
            pricePerMP: 0.05,
        },
    },
    {
        // Qwen Image 2512 with LoRAs — best-in-class for photorealism and
        // legible in-image text (incl. Cyrillic). Use for product photos and
        // banners with embedded copy.
        // Endpoint: https://fal.run/fal-ai/qwen-image-2512/lora
        id: "qwen-image-lora",
        label: "Qwen Image LoRA",
        slug: "fal-ai/qwen-image-2512/lora",
        provider: "fal",
        caps: ["generate"],
        costPerRun: 0.035,
        maxOutputs: 4,
        aspectRatios: LORA_ASPECT_RATIOS,
        loraSpec: {
            maxCount: 2,
            family: "qwen",
            defaultGuidance: 4,
            defaultSteps: 28,
            guidanceRange: [0, 20],
            stepsRange: [1, 50],
            supportsAcceleration: true,
            accelerationOptions: ["none", "regular", "high"],
            supportsNegativePrompt: false,
            pricePerMP: 0.035,
        },
    },
    {
        // Qwen Image Edit with LoRAs — image-to-image with optional negative
        // prompt and LoRA stack. The only LoRA-aware editing endpoint we
        // currently expose; lives in EDIT_MODELS in the prompt bars.
        // Endpoint: https://fal.run/fal-ai/qwen-image-edit-lora
        id: "qwen-image-edit-lora",
        label: "Qwen Image Edit LoRA",
        slug: "fal-ai/qwen-image-edit-lora",
        provider: "fal",
        caps: ["edit", "vision"],
        costPerRun: 0.035,
        maxRefs: 1,
        aspectRatios: LORA_ASPECT_RATIOS,
        loraSpec: {
            maxCount: 2,
            family: "qwen",
            defaultGuidance: 4,
            defaultSteps: 30,
            guidanceRange: [0, 20],
            stepsRange: [2, 50],
            supportsAcceleration: true,
            accelerationOptions: ["none", "regular", "high"],
            supportsNegativePrompt: true,
            pricePerMP: 0.035,
        },
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
        id: "flux-2-pro-outpaint",
        label: "Flux 2 Pro Outpaint",
        slug: "fal-ai/flux-2-pro/outpaint",
        provider: "replicate",
        caps: ["outpaint"],
        costPerRun: 0.075,
    },
    {
        id: "outpainter",
        label: "Outpainter",
        slug: "zsxkib/outpainter",
        provider: "replicate",
        caps: ["outpaint"],
        costPerRun: 0.05,
    },
    {
        id: "bria-rmbg",
        label: "Bria Remove BG",
        slug: "fal-ai/bria/background/remove",
        provider: "replicate",
        caps: ["remove-bg"],
        costPerRun: 0.002,
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

    // ── Upscale / Super-Resolution ──────────────────────────────────────
    {
        // Topaz Gigapixel "High Fidelity V2" via fal.ai. Structure-preserving
        // (no hallucinated detail) — the right default for the outpaint
        // border-strip pipeline where the original image is composited back
        // over the upscaled result. Fallback chain drops to seedvr/esrgan
        // if Topaz is unavailable.
        // Endpoint: https://fal.run/fal-ai/topaz/upscale/image
        // Pricing: $0.08 (≤24MP), $0.16 (≤48MP), $0.32 (≤96MP), $1.36 (≤512MP)
        // 2026-05 — verified via fal.ai docs. The `model` param toggles
        // between "Standard V2" (default), "High Fidelity V2", "Recovery V2",
        // "Redefine", etc; we pin it to "High Fidelity V2" in FalProvider.
        id: "topaz-hf-v2",
        label: "Topaz High Fidelity v2",
        slug: "fal-ai/topaz/upscale/image",
        provider: "replicate",
        caps: ["upscale"],
        costPerRun: 0.08,
    },
    {
        id: "seedvr",
        label: "SeedVR2 Upscaler",
        slug: "fal-ai/seedvr/upscale/image",
        provider: "replicate",
        caps: ["upscale"],
        costPerRun: 0.001,
    },
    {
        id: "sima-upscaler",
        label: "Sima Upscaler",
        slug: "simalabs/sima-upscaler",
        provider: "replicate",
        caps: ["upscale"],
        costPerRun: 0.0005,
    },
    {
        id: "esrgan",
        label: "Real-ESRGAN",
        slug: "nightmareai/real-esrgan",
        provider: "replicate",
        caps: ["upscale"],
        costPerRun: 0.004,
    },

    // ── Workflow-only Models (Phase 1: node-editor bg-removal + reflection) ─
    {
        id: "bria-product-cutout",
        label: "Bria Product Cutout",
        slug: "bria/product-cutout",
        provider: "replicate",
        caps: ["remove-bg"],
        costPerRun: 0.025,
    },
    {
        id: "rembg-851-labs",
        label: "851 Labs Background Remover",
        slug: "851-labs/background-remover",
        provider: "replicate",
        caps: ["remove-bg"],
        costPerRun: 0.002,
    },
    {
        id: "bria-product-shadow",
        label: "Bria Product Shadow",
        slug: "bria/product-shadow",
        provider: "replicate",
        caps: ["edit"],
        costPerRun: 0.04,
    },
    {
        // fal.ai primary for reflection/shadow generation (Bria Product Shot API)
        id: "bria-product-shot",
        label: "Bria Product Shot (fal.ai)",
        slug: "fal-ai/bria/product-shot",
        provider: "fal",
        caps: ["edit"],
        costPerRun: 0.04,
    },
    {
        // BiRefNet on fal.ai — preserves shadows and reflections during
        // background removal, unlike Bria/rembg which strip everything but
        // the product silhouette. Default for the workflow `removeBackground`
        // node when downstream graph contains a reflection step.
        id: "fal-birefnet",
        label: "BiRefNet (fal.ai)",
        slug: "fal-ai/birefnet/v2",
        provider: "fal",
        caps: ["remove-bg"],
        costPerRun: 0.005,
    },
    {
        id: "flux-kontext-pro",
        label: "FLUX Kontext Pro",
        slug: "black-forest-labs/flux-kontext-pro",
        provider: "replicate",
        caps: ["edit", "inpaint"],
        costPerRun: 0.055,
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

/** Get maximum images one generation request can return (1 = single output). */
export function getMaxOutputs(modelId: string): number {
    return Math.max(1, getModelById(modelId)?.maxOutputs ?? 1);
}

/** Get supported aspect ratios for a model. */
export function getAspectRatios(modelId: string): string[] {
    return getModelById(modelId)?.aspectRatios ?? DEFAULT_ASPECT_RATIOS;
}

/** Get available resolution options for a model (empty = no resolution control). */
export function getResolutions(modelId: string): ResolutionOption[] {
    return getModelById(modelId)?.resolutions ?? [];
}

/** Default resolution pill for a model (2K for Google-style tiers, else first option). */
export function getDefaultResolution(modelId: string): string {
    const resolutions = getResolutions(modelId);
    if (resolutions.length === 0) return "";
    if (resolutions.some((r) => r.id === "2K")) return "2K";
    return resolutions[0]?.id ?? "";
}

/** Returns true if the model accepts a `loras` array (i.e. exposes LoraSpec). */
export function supportsLora(modelId: string): boolean {
    return !!getModelById(modelId)?.loraSpec;
}

/** Get the LoRA capability descriptor for a model, or undefined if non-LoRA. */
export function getLoraSpec(modelId: string): LoraSpec | undefined {
    return getModelById(modelId)?.loraSpec;
}

/**
 * Approximate megapixels generated for a given aspect ratio + resolution
 * preset. Used to project per-MP price (LoRA models bill per megapixel).
 *
 * Heuristic — matches what fal.ai produces in practice for our enums:
 *   • Google "1K" / "2K" / "4K" → 1 / 4 / 16 MP
 *   • Seedream "2K" / "3K"      → 4 / 9 MP
 *   • Flux megapixels enum is the literal MP value
 *   • LoRA models with no resolution selector → 1 MP (square_hd default)
 */
export function estimateMegapixels(
    modelId: string,
    resolution?: string,
): number {
    const entry = getModelById(modelId);
    if (!entry) return 1;

    if (resolution) {
        // Flux megapixels: literal value
        if (entry.slug.startsWith("black-forest-labs/")) {
            const n = parseFloat(resolution);
            if (Number.isFinite(n)) return n;
        }
        // Google nano-banana
        if (entry.slug.startsWith("google/")) {
            if (resolution === "1K") return 1;
            if (resolution === "2K") return 4;
            if (resolution === "4K") return 16;
        }
        // Seedream
        if (entry.slug.startsWith("bytedance/")) {
            if (resolution === "2K") return 4;
            if (resolution === "3K") return 9;
        }
    }

    // LoRA endpoints + everything else — assume ~1 MP (square_hd).
    return 1;
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
