/**
 * Unified AI Provider Layer
 *
 * SINGLE source of truth for all AI models across the platform:
 * - Studio (AIPromptBar), Wizard (ImageContentBlock, TextContentBlock),
 *   Editor (ImageEditorModal)
 *
 * MODEL_REGISTRY and helpers are in ai-models.ts (client-safe).
 * This file adds provider implementations (server-only).
 */

// Re-export model registry & helpers (client-safe, no server deps)
export {
    MODEL_REGISTRY,
    getModelsForCaps,
    getModelById,
    getMaxOutputs,
    supportsLora,
    getLoraSpec,
    estimateMegapixels,
} from "./ai-models";
export type { ModelCap, ModelEntry, LoraSpec } from "./ai-models";

import { MODEL_REGISTRY, getModelById, getLoraSpec, estimateMegapixels } from "./ai-models";
import type { ModelEntry, LoraSpec } from "./ai-models";

// ─── Interfaces ─────────────────────────────────────────────────────────────

/**
 * A single LoRA weight to merge into a LoRA-aware model run.
 *
 * `path` accepts a public URL pointing at a `.safetensors` file (HuggingFace
 * raw URL, CivitAI download URL, fal.media-hosted asset, or
 * replicate.delivery). The host is validated against an allowlist by the
 * SSRF guard before the request hits fal.ai.
 *
 * `scale` is the LoRA strength multiplier (typically 0..2; default 1.0).
 * Lower values blend the LoRA more subtly; higher values push the style
 * harder at the cost of prompt adherence.
 */
export interface LoraWeight {
    path: string;
    scale?: number;
}

export interface AIRequestParams {
    prompt: string;
    type: "text" | "image" | "inpainting" | "outpainting" | "remove-bg" | "edit" | "upscale";
    model?: string;
    context?: string;
    width?: number;
    height?: number;
    aspectRatio?: string;
    count?: number;
    seed?: number;
    scale?: string;
    referenceImages?: string[];
    imageBase64?: string;
    maskBase64?: string;
    systemPrompt?: string;
    canvasSize?: [number, number];
    originalSize?: [number, number];
    originalLocation?: [number, number];
    /** Per-side pixel offsets for free-form outpainting */
    expandPadding?: { top: number; right: number; bottom: number; left: number };
    /** Scale factor for upscale (e.g. 2.0 = double resolution) */
    upscaleScale?: number;
    // ── LoRA-aware models (fal-ai/flux-lora, fal-ai/flux-2/lora, etc.) ──
    /** LoRA weights to merge into the run (1..loraSpec.maxCount). */
    loras?: LoraWeight[];
    /** CFG scale override; falls back to LoraSpec.defaultGuidance when omitted. */
    guidanceScale?: number;
    /** Sampler steps override; falls back to LoraSpec.defaultSteps when omitted. */
    numInferenceSteps?: number;
    /** Negative prompt — only honored by Qwen Image Edit LoRA. */
    negativePrompt?: string;
    /** Throughput knob; mapped to fal `acceleration` enum. */
    acceleration?: "none" | "regular" | "high";
}

export interface AIResponse {
    content: string;
    /** All image URLs returned by the provider. `content` is always the first item. */
    contents?: string[];
    format: "text" | "url" | "base64";
    model: string;
    provider: string;
    /** Actual pixel width of the generated image (when available) */
    width?: number;
    /** Actual pixel height of the generated image (when available) */
    height?: number;
}

export interface AIProviderImplementation {
    id: string;
    name: string;
    generate(params: AIRequestParams): Promise<AIResponse>;
}

export function normalizeImageOutputs(raw: unknown): string[] {
    const values = Array.isArray(raw) ? raw : [raw];
    return values
        .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object" && "url" in item) {
                const url = (item as { url?: unknown }).url;
                return typeof url === "string" ? url : undefined;
            }
            return undefined;
        })
        .filter((url): url is string => Boolean(url));
}

// ─── OpenAI Direct Provider (DALL-E 3 only) ─────────────────────────────────

import OpenAI from "openai";

class OpenAIDirectProvider implements AIProviderImplementation {
    id = "openai-direct";
    name = "OpenAI Direct";
    private client: OpenAI;

    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY || "dummy",
            dangerouslyAllowBrowser: false,
        });
    }

    async generate(params: AIRequestParams): Promise<AIResponse> {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error("OpenAI API Key is not configured. Set OPENAI_API_KEY in .env.local");
        }
        if (params.type === "text") return this.generateText(params);
        return this.generateImage(params);
    }

    private async generateText(params: AIRequestParams): Promise<AIResponse> {
        const messages: { role: "system" | "user"; content: string }[] = [];
        if (params.systemPrompt) messages.push({ role: "system", content: params.systemPrompt });
        if (params.context) messages.push({ role: "system", content: `Context: ${params.context}` });
        messages.push({ role: "user", content: params.prompt });

        const completion = await this.client.chat.completions.create({
            messages,
            model: "gpt-4o",
        });
        return {
            content: completion.choices[0].message.content || "",
            format: "text",
            model: "gpt-4o",
            provider: "openai",
        };
    }

    private async generateImage(params: AIRequestParams): Promise<AIResponse> {
        let size: "1024x1024" | "1024x1792" | "1792x1024" = "1024x1024";
        const ar = params.aspectRatio;
        if (ar === "9:16" || ar === "3:4") size = "1024x1792";
        else if (ar === "16:9" || ar === "4:3" || ar === "3:2") size = "1792x1024";

        const response = await this.client.images.generate({
            model: "dall-e-3",
            prompt: params.prompt,
            n: 1,
            size,
            response_format: "url",
        });
        const url = response.data?.[0]?.url;
        if (!url) throw new Error("No image URL returned from OpenAI");
        return { content: url, format: "url", model: "dall-e-3", provider: "openai" };
    }
}

// ─── Replicate Provider ──────────────────────────────────────────────────────

class ReplicateProvider implements AIProviderImplementation {
    id = "replicate";
    name = "Replicate";

    async generate(params: AIRequestParams): Promise<AIResponse> {
        const apiToken = process.env.REPLICATE_API_TOKEN;
        if (!apiToken) {
            throw new Error("Replicate API token not configured. Set REPLICATE_API_TOKEN in .env.local");
        }

        const modelId = params.model || "nano-banana-2";
        const entry = getModelById(modelId);
        if (!entry) throw new Error(`Unknown model: ${modelId}`);

        // Text LLMs go through a different path
        if (entry.caps.includes("text")) {
            return this.generateText(params, entry, apiToken);
        }

        // Image generation / editing / tools
        return this.generateImage(params, entry, apiToken);
    }

    // ── Text LLM ────────────────────────────────────────────────────────

    private async generateText(params: AIRequestParams, entry: ModelEntry, token: string): Promise<AIResponse> {
        const input: Record<string, unknown> = {
            prompt: params.prompt,
        };
        if (params.systemPrompt) {
            input.system_prompt = params.systemPrompt;
        }
        // DeepSeek and Gemini expect max_tokens
        input.max_tokens = 2048;

        const result = await this.callReplicate(entry, input, token);
        // LLMs return an array of strings or a single string
        const text = Array.isArray(result) ? result.join("") : String(result);
        return { content: text, format: "text", model: entry.id, provider: "replicate" };
    }

    // ── Image Generation / Editing ──────────────────────────────────────

    private async generateImage(params: AIRequestParams, entry: ModelEntry, token: string): Promise<AIResponse> {
        const input: Record<string, unknown> = {};

        // ── Remove BG ───────────────────────────────────────────────
        if (params.type === "remove-bg") {
            if (!params.imageBase64) throw new Error("Image is required for background removal");
            // Always use rembg on Replicate (since bria-rmbg is fal.ai only)
            const rembgEntry = getModelById("rembg")!;
            const result = await this.callReplicate(rembgEntry, { image: params.imageBase64 }, token);
            const output = Array.isArray(result) ? result[0] : result;
            return { content: output as string, format: "url", model: rembgEntry.id, provider: "replicate" };
        }

        // ── Outpaint ────────────────────────────────────────────────
        if (params.type === "outpainting") {
            if (!params.imageBase64) throw new Error("Image is required for outpainting");
            const expandModel = params.model || "bria-expand";
            const expandEntry = getModelById(expandModel);
            if (!expandEntry) throw new Error(`Model ${expandModel} not found`);

            const expandInput: Record<string, unknown> = {
                image: params.imageBase64,
            };
            if (params.prompt) expandInput.prompt = params.prompt;

            // zsxkib/outpainter: direct pixel offsets
            if (expandEntry.slug === "zsxkib/outpainter" && params.expandPadding) {
                expandInput.extend_top = Math.round(params.expandPadding.top || 0);
                expandInput.extend_bottom = Math.round(params.expandPadding.bottom || 0);
                expandInput.extend_left = Math.round(params.expandPadding.left || 0);
                expandInput.extend_right = Math.round(params.expandPadding.right || 0);
                expandInput.preset = "none";
            } else {
                // bria/expand-image and others: canvas_size + position
                if (params.aspectRatio) expandInput.aspect_ratio = params.aspectRatio;
                if (params.canvasSize) expandInput.canvas_size = (params.canvasSize as number[]).map(Math.round);
                if (params.originalSize) expandInput.original_image_size = (params.originalSize as number[]).map(Math.round);
                if (params.originalLocation) expandInput.original_image_location = (params.originalLocation as number[]).map(Math.round);

                // Convert expandPadding to canvas_size + original_image_location for bria
                if (params.expandPadding && params.originalSize) {
                    const [origW, origH] = params.originalSize;
                    const pad = params.expandPadding;
                    expandInput.canvas_size = [Math.round(origW + pad.left + pad.right), Math.round(origH + pad.top + pad.bottom)];
                    expandInput.original_image_location = [Math.round(pad.left), Math.round(pad.top)];
                    expandInput.original_image_size = [Math.round(origW), Math.round(origH)];
                }
            }
            
            const result = await this.callReplicate(expandEntry, expandInput, token);
            const output = Array.isArray(result) ? result[0] : result;
            return { content: output as string, format: "url", model: expandEntry.id, provider: "replicate" };
        }

        // ── Inpaint ─────────────────────────────────────────────────
        if (params.type === "inpainting") {
            if (!params.imageBase64) throw new Error("Image is required for inpainting");

            const slug = entry.slug;
            input.prompt = params.prompt;

            if (slug.startsWith("google/")) {
                // Nano Banana family — heuristic mask via image_input[1].
                input.image_input = params.maskBase64
                    ? [params.imageBase64, params.maskBase64]
                    : [params.imageBase64];
                input.output_format = "png";
            } else if (slug.startsWith("black-forest-labs/")) {
                // FLUX Fill / Kontext — native mask.
                input.image = params.imageBase64;
                if (params.maskBase64) input.mask = params.maskBase64;
                input.output_format = "webp";
            } else if (slug.startsWith("openai/")) {
                // GPT Image 1.5 / 2 on Replicate — native OpenAI mask edit.
                //   - input_images: source image as a single-item array
                //   - input_mask:   alpha-channel PNG, same size as source
                //                   (white = regenerate, black = preserve)
                //   - quality:      we pin to "high" by default for the
                //                   inpaint surface; caller can override
                //                   via `scale` (low | medium | high | auto)
                //   - input_fidelity="high" preserves fine detail / faces
                //                   in the unmasked regions, important for
                //                   product/portrait inpainting.
                input.input_images = [params.imageBase64];
                if (params.maskBase64) input.input_mask = params.maskBase64;
                input.output_format = "png";
                input.quality = params.scale || "high";
                input.input_fidelity = "high";
            } else {
                // Default: pass mask field through and hope the model groks it.
                input.image = params.imageBase64;
                if (params.maskBase64) input.mask = params.maskBase64;
            }

            const result = await this.callReplicate(entry, input, token);
            const output = Array.isArray(result) ? result[0] : result;
            return { content: output as string, format: "url", model: entry.id, provider: "replicate" };
        }

        // ── Edit (image + prompt → edited image) ────────────────────
        // ── Edit (image + prompt → edited image) ────────────────────
        if (params.type === "edit") {
            if (!params.imageBase64) throw new Error("Image is required for editing");
            
            const slug = entry.slug;
            input.prompt = params.prompt;
            if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;

            // Map image to the correct parameter based on model family
            if (slug.startsWith("google/")) {
                input.image_input = [params.imageBase64];
                input.output_format = "png";
            } else if (slug.startsWith("black-forest-labs/")) {
                input.input_images = [params.imageBase64];
                input.output_format = "webp";
            } else if (slug.startsWith("bytedance/")) {
                // Seedream (4.5 / 5-lite) expects image_input
                input.image_input = [params.imageBase64];
                // Seedream 5 supports `size` ("2K" | "3K") in addition to AR
                if (params.scale) input.size = params.scale;
            } else if (slug === "openai/gpt-image-2") {
                // GPT Image 2 expects input_images for editing; quality is the
                // resolution knob (low | medium | high | auto).
                input.input_images = [params.imageBase64];
                input.output_format = "png";
                if (params.scale) input.quality = params.scale;
            } else {
                // Default / Qwen / GPT Image 1.5 expects image
                input.image = params.imageBase64;
            }

            const result = await this.callReplicate(entry, input, token);
            const output = Array.isArray(result) ? result[0] : result;
            return { content: output as string, format: "url", model: entry.id, provider: "replicate" };
        }

        // ── Upscale / Super-Resolution ─────────────────────────────
        if (params.type === "upscale") {
            if (!params.imageBase64) throw new Error("Image is required for upscaling");
            const upscaleEntry = getModelById("esrgan") || entry;
            const upscaleInput: Record<string, unknown> = {
                image: params.imageBase64,
            };
            if (params.upscaleScale) upscaleInput.scale = params.upscaleScale;

            const result = await this.callReplicate(upscaleEntry, upscaleInput, token);
            const output = Array.isArray(result) ? result[0] : result;
            return { content: output as string, format: "url", model: upscaleEntry.id, provider: "replicate" };
        }

        // ── Standard text-to-image generation ───────────────────────
        input.prompt = params.prompt;
        if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;
        if (params.seed) input.seed = params.seed;

        // Model-family-specific params
        const slug = entry.slug;
        const supportsReplicateMultiOutput = entry.id === "flux-dev" || entry.id === "flux-schnell";
        const isFlux = slug.startsWith("black-forest-labs/");
        const isGoogle = slug.startsWith("google/");
        const isQwen = slug.startsWith("qwen/");
        const isSeedream = slug.startsWith("bytedance/");

        if (isFlux) {
            // Flux models support webp, num_outputs, output_quality
            input.output_format = "webp";
            input.output_quality = 90;
            if (supportsReplicateMultiOutput && params.count && params.count > 1) {
                input.num_outputs = Math.min(params.count, 4);
            }
            // Flux resolution: megapixels
            if (params.scale) input.megapixels = params.scale; // "0.25", "1", "4"
        } else if (isGoogle) {
            // Nano Banana models: only jpg or png
            input.output_format = "png";
            // Google resolution: "1K" | "2K" | "4K"
            if (params.scale) input.resolution = params.scale;
        } else if (slug.startsWith("openai/")) {
            // GPT Image (1.5 + 2): quality knob ("low" | "medium" | "high" | "auto")
            if (params.scale) input.quality = params.scale;
        } else if (isSeedream) {
            // Seedream 5 supports `size` ("2K" | "3K"); 4.5 ignores it.
            if (params.scale) input.size = params.scale;
        }
        // Qwen: no resolution control

        // ── Reference images — correct parameter per model family ──────
        if (params.referenceImages && params.referenceImages.length > 0) {
            console.log(`[Pipeline ▶6 Provider] referenceImages: ${params.referenceImages.length} image(s), model: ${slug}`);

            if (isGoogle) {
                // Nano Banana family: image_input accepts array of URLs or base64
                input.image_input = params.referenceImages;
            } else if (isSeedream) {
                // Seedream: image_input (4.5 = up to 4 refs, 5-lite = up to 14)
                input.image_input = params.referenceImages;
            } else if (slug === "black-forest-labs/flux-2-pro") {
                // Flux 2 Pro: reference_images
                input.reference_images = params.referenceImages;
            } else if (slug === "openai/gpt-image-2") {
                // GPT Image 2: input_images (multi-ref edit/compose)
                input.input_images = params.referenceImages;
            } else if (slug.startsWith("openai/")) {
                // GPT Image 1.5: reference_images (legacy param name)
                input.reference_images = params.referenceImages;
            }
            // Flux Dev, Flux 1.1 Pro, DALL-E 3, Qwen: no reference image support
        }

        console.log(`[Pipeline ▶6 Provider] Final Replicate input keys: ${Object.keys(input).join(", ")}`);

        const result = await this.callReplicate(entry, input, token);
        const outputs = normalizeImageOutputs(result);
        const output = outputs[0];
        if (!output) throw new Error(`No image URL returned from ${entry.slug}`);
        return { content: output, contents: outputs, format: "url", model: entry.id, provider: "replicate" };
    }

    // ── Replicate API Call ───────────────────────────────────────────────

    private async callReplicate(entry: ModelEntry, input: Record<string, unknown>, token: string): Promise<unknown> {
        return replicatePredict(entry, input, token);
    }
}

// ─── Shared Replicate polling (module-scope, reused by invokeReplicateModel) ─

async function replicatePredict(entry: ModelEntry, input: Record<string, unknown>, token: string): Promise<unknown> {
        let url: string;
        const body: Record<string, unknown> = { input };

        if (entry.version) {
            // Community model with explicit version
            url = "https://api.replicate.com/v1/predictions";
            body.version = entry.version;
        } else {
            // Official model
            url = `https://api.replicate.com/v1/models/${entry.slug}/predictions`;
        }

        console.log(`[Replicate] Creating prediction for ${entry.slug}...`);

        // Create prediction WITHOUT Prefer:wait — just fire and poll
        // Prefer:wait caused TCP timeouts on slow models (nano-banana-pro ~60s)
        const abortCtl = new AbortController();
        const createTimeout = setTimeout(() => abortCtl.abort(), 30_000);

        let prediction: any;
        try {
            const createRes = await fetch(url, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
                signal: abortCtl.signal,
            });
            clearTimeout(createTimeout);

            if (!createRes.ok) {
                const errBody = await createRes.text();
                console.error(`Replicate API error [${entry.slug}]:`, errBody);
                throw new Error(`Replicate error (${createRes.status}): ${errBody.slice(0, 300)}`);
            }

            prediction = await createRes.json();
        } catch (err: unknown) {
            clearTimeout(createTimeout);
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("abort")) {
                throw new Error(`Replicate: Не удалось создать запрос для ${entry.slug} (таймаут 30s)`);
            }
            throw err;
        }

        // If prediction already completed (fast models)
        if (prediction.output !== undefined && prediction.output !== null) {
            console.log(`[Replicate] Instant result for ${entry.slug}, status: ${prediction.status}`);
            return prediction.output;
        }

        // Poll for result (up to 300 seconds with retry on network errors)
        const predictionId = prediction.id;
        console.log(`[Replicate] Polling prediction ${predictionId} for ${entry.slug}...`);
        const maxPolls = 150; // 150 * 2s = 300s
        let consecutiveNetworkErrors = 0;

        for (let i = 0; i < maxPolls; i++) {
            await new Promise(r => setTimeout(r, 2000));
            
            try {
                const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
                    headers: { "Authorization": `Bearer ${token}` },
                });

                if (!pollRes.ok) {
                    console.warn(`[Replicate] Poll ${i + 1} HTTP error: ${pollRes.status}`);
                    consecutiveNetworkErrors++;
                    if (consecutiveNetworkErrors >= 5) {
                        throw new Error(`Replicate polling failed after ${consecutiveNetworkErrors} consecutive HTTP errors`);
                    }
                    continue;
                }

                consecutiveNetworkErrors = 0; // Reset on success
                const poll = await pollRes.json();

                if (poll.status === "succeeded") {
                    console.log(`[Replicate] Prediction ${predictionId} succeeded after ${(i + 1) * 2}s`);
                    return poll.output;
                }
                if (poll.status === "failed" || poll.status === "canceled") {
                    throw new Error(`Replicate prediction ${poll.status}: ${poll.error || "unknown error"}`);
                }
                // Still processing — continue polling
            } catch (fetchErr: unknown) {
                const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
                // If it's our own thrown error, rethrow
                if (errMsg.includes("Replicate prediction") || errMsg.includes("polling failed")) {
                    throw fetchErr;
                }
                // Network error during fetch — retry up to 5 times
                consecutiveNetworkErrors++;
                console.warn(`[Replicate] Poll ${i + 1} network error (${consecutiveNetworkErrors}/5): ${errMsg}`);
                if (consecutiveNetworkErrors >= 5) {
                    throw new Error(`Replicate polling failed: ${errMsg}`);
                }
            }
        }

        throw new Error("Replicate prediction timed out after 300 seconds");
    }

/**
 * Top-level Replicate invoker for workflow nodes.
 *
 * Phase 1 extraction: reuses replicatePredict (same polling loop as
 * ReplicateProvider.callReplicate) so the workflow runtime can fire Replicate
 * models without instantiating AIProvider / AIRequestParams.
 *
 * @param modelId id from MODEL_REGISTRY (e.g. "bria-product-cutout")
 * @param input raw Replicate `input` payload for the model
 * @returns { output: first URL, model: slug, costUsd: per-run estimate }
 *
 * Throws if:
 * - modelId unknown or not a Replicate entry
 * - REPLICATE_API_TOKEN missing
 * - prediction fails / times out
 * - output shape is unexpected (not a URL or list of URLs)
 */
export async function invokeReplicateModel(
    modelId: string,
    input: Record<string, unknown>,
): Promise<{ output: string; model: string; costUsd: number }> {
    const entry = getModelById(modelId);
    if (!entry || entry.provider !== "replicate") {
        throw new Error(`Unknown or non-Replicate model: ${modelId}`);
    }
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) throw new Error("REPLICATE_API_TOKEN not configured");

    const raw = await replicatePredict(entry, input, token);
    // Most Replicate models return a single URL string or an array of URLs.
    // Some (e.g. flux-kontext) return an object with .image — try that too.
    let firstOutput: unknown = raw;
    if (Array.isArray(raw)) {
        firstOutput = raw[0];
    } else if (raw && typeof raw === "object" && "image" in (raw as Record<string, unknown>)) {
        firstOutput = (raw as Record<string, unknown>).image;
    }

    if (typeof firstOutput !== "string" || firstOutput.length === 0) {
        throw new Error(
            `Unexpected Replicate output shape for ${entry.slug}: ${JSON.stringify(raw).slice(0, 200)}`,
        );
    }

    return { output: firstOutput, model: entry.slug, costUsd: entry.costPerRun };
}

// ─── fal.ai Queue Submit + Poll (shared helper) ─────────────────────────────

/**
 * Submit a request to the fal.ai queue and poll until it completes.
 * Used both by the FalProvider class and by invokeFalModel() for the
 * workflow-node executor.
 */
async function falSubmitAndPoll(
    endpoint: string,
    input: Record<string, unknown>,
    apiKey: string,
    maxPollSeconds = 300,
): Promise<Record<string, unknown>> {
    const submitRes = await fetch(`https://queue.fal.run/${endpoint}`, {
        method: "POST",
        headers: {
            "Authorization": `Key ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
    });
    if (!submitRes.ok) {
        const errBody = await submitRes.text();
        throw new Error(`fal.ai submit failed (${submitRes.status}): ${errBody.slice(0, 300)}`);
    }
    const submitData = await submitRes.json() as Record<string, unknown>;
    const requestId = submitData.request_id as string | undefined;

    // Synchronous response (some endpoints bypass the queue)
    if (!requestId) {
        return submitData;
    }

    const statusUrl = (submitData.status_url as string | undefined)
        || `https://queue.fal.run/${endpoint}/requests/${requestId}/status`;
    const responseUrl = (submitData.response_url as string | undefined)
        || `https://queue.fal.run/${endpoint}/requests/${requestId}`;

    const iterations = Math.ceil(maxPollSeconds / 2);
    for (let i = 0; i < iterations; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
            const statusRes = await fetch(statusUrl, {
                headers: { "Authorization": `Key ${apiKey}` },
            });
            if (!statusRes.ok) continue;
            const status = await statusRes.json() as { status?: string; error?: unknown };
            if (status.status === "COMPLETED") {
                const resultRes = await fetch(responseUrl, {
                    headers: { "Authorization": `Key ${apiKey}` },
                });
                if (!resultRes.ok) {
                    const errText = await resultRes.text();
                    throw new Error(`fal.ai result fetch failed (${resultRes.status}): ${errText.slice(0, 300)}`);
                }
                return await resultRes.json() as Record<string, unknown>;
            }
            if (status.status === "FAILED") {
                throw new Error(`fal.ai prediction failed: ${String(status.error ?? "unknown")}`);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (err instanceof TypeError && msg.includes("fetch")) continue;
            throw err;
        }
    }
    throw new Error(`fal.ai prediction timed out after ${maxPollSeconds} seconds`);
}

/**
 * Module-scope invoker for workflow node executors.
 *
 * Handles the full fal.ai lifecycle (auth → queue submit → poll → result parse)
 * and normalises output shape to the same contract as invokeReplicateModel:
 * `{ output: string (URL), model: string, costUsd: number }`.
 */
export async function invokeFalModel(
    modelId: string,
    input: Record<string, unknown>,
    opts: { maxPollSeconds?: number; endpoint?: string } = {},
): Promise<{ output: string; model: string; costUsd: number }> {
    const entry = getModelById(modelId);
    if (!entry) throw new Error(`Unknown model: ${modelId}`);

    // `opts.endpoint` overrides the registry/FAL_MODEL_MAP mapping. Used when
    // the same model has multiple fal endpoints (e.g. nano-banana base vs
    // /edit vs /pro) and the caller knows exactly which one is needed.
    const endpoint = opts.endpoint ?? FAL_MODEL_MAP[modelId] ?? entry.slug;
    if (!endpoint) {
        throw new Error(`Model ${modelId} has no fal.ai endpoint mapping`);
    }

    const apiKey = process.env.FAL_KEY;
    if (!apiKey) {
        throw new Error("fal.ai API key not configured. Set FAL_KEY in .env.local");
    }

    const result = await falSubmitAndPoll(endpoint, input, apiKey, opts.maxPollSeconds);

    // fal.ai response shapes we support:
    //   { image: { url } }                  → bria/background/remove, bria/product-shot
    //   { images: [{ url, width, height }]} → nano-banana, flux, seedream
    //   { output: "https://..." }           → some community endpoints
    const image = (result.image as { url?: string } | undefined);
    const images = (result.images as { url?: string }[] | undefined);
    const output = image?.url
        ?? images?.[0]?.url
        ?? (typeof result.output === "string" ? result.output : undefined);

    if (!output) {
        throw new Error(
            `fal.ai ${endpoint}: no image URL in response. Keys: ${Object.keys(result).join(", ")}`,
        );
    }

    return { output, model: entry.slug, costUsd: entry.costPerRun };
}

// ─── fal.ai Fallback Provider ───────────────────────────────────────────────

/** Model ID → fal.ai text-to-image endpoint mapping */
const FAL_MODEL_MAP: Record<string, string> = {
    "nano-banana":     "fal-ai/nano-banana",
    "nano-banana-2":   "fal-ai/nano-banana-2",
    "nano-banana-pro": "fal-ai/nano-banana-pro",
    "seedream":        "fal-ai/seedream-4.5",
    "seedream-5":      "fal-ai/bytedance/seedream/v5/lite/text-to-image",
    "gpt-image-2":     "openai/gpt-image-2",
    "bria-expand":     "fal-ai/bria/expand",
    "flux-2-pro-outpaint": "fal-ai/flux-2-pro/outpaint",
    "bria-rmbg":       "fal-ai/bria/background/remove",
    "bria-product-shot": "fal-ai/bria/product-shot",
    "fal-birefnet":    "fal-ai/birefnet/v2",
    "flux-kontext-pro": "fal-ai/flux-pro/kontext",
    "esrgan":          "fal-ai/esrgan",
    "seedvr":          "fal-ai/seedvr/upscale/image",
    "topaz-hf-v2":     "fal-ai/topaz/upscale/image",
    "sima-upscaler":   "simalabs/sima-upscaler",
    // ── LoRA endpoints ──
    "flux-lora":              "fal-ai/flux-lora",
    "flux-2-lora":            "fal-ai/flux-2/lora",
    "qwen-image-lora":        "fal-ai/qwen-image-2512/lora",
    "qwen-image-edit-lora":   "fal-ai/qwen-image-edit-lora",
};

/** Model ID → fal.ai /edit endpoint (required for reference images) */
const FAL_MODEL_MAP_EDIT: Record<string, string> = {
    "nano-banana":     "fal-ai/nano-banana/edit",
    "nano-banana-2":   "fal-ai/nano-banana-2/edit",
    "nano-banana-pro": "fal-ai/nano-banana-pro/edit",
    "seedream-5":      "fal-ai/bytedance/seedream/v5/lite/edit",
    "gpt-image-2":     "openai/gpt-image-2/edit",
    // FLUX.1 LoRA has a dedicated img2img endpoint that keeps loras + scale.
    "flux-lora":       "fal-ai/flux-lora/image-to-image",
    // Qwen Image Edit LoRA is already an image-to-image endpoint, so its
    // /edit and base mappings collapse to the same URL.
    "qwen-image-edit-lora": "fal-ai/qwen-image-edit-lora",
};

/**
 * Model ID → fal.ai inpaint endpoint mapping.
 *
 * Native mask-aware inpaint:
 *   • flux-fill → fal-ai/flux-pro/v1/fill — accepts `image_url` + `mask_url`,
 *     black=preserve / white=regenerate, requires REAL URLs (not base64 inline).
 *   • gpt-image-2 → openai/gpt-image-2/edit — `mask` field on the OpenAI edits
 *     endpoint; mask must match source and carry an alpha channel.
 *
 * Heuristic mask (model treats mask as a strong reference, not a hard region):
 *   • nano-banana-* → fal-ai/nano-banana(-2/-pro)/edit — we forward
 *     [image, mask] via image_urls. Quality is best-effort; flux-fill stays
 *     the recommended default for predictable inpainting.
 */
const FAL_MODEL_MAP_INPAINT: Record<string, string> = {
    "flux-fill":       "fal-ai/flux-pro/v1/fill",
    "gpt-image-2":     "openai/gpt-image-2/edit",
    "nano-banana":     "fal-ai/nano-banana/edit",
    "nano-banana-2":   "fal-ai/nano-banana-2/edit",
    "nano-banana-pro": "fal-ai/nano-banana-pro/edit",
};

// Models whose fal.ai endpoints don't accept `aspect_ratio` and instead use
// the `image_size` preset enum (square_hd / square / portrait_* / landscape_*).
// Seedream 5 Lite additionally exposes `auto_2K` / `auto_3K` / `auto_4K`.
//
// Kept as an explicit set so the FalProvider build-input branch stays narrow
// and the rest of the pipeline keeps using a unified `aspectRatio` field.
const FAL_IMAGE_SIZE_MODELS = new Set(["gpt-image-2", "seedream-5"]);
const FAL_NUM_IMAGES_MODELS = new Set([
    "nano-banana",
    "nano-banana-2",
    "nano-banana-pro",
    "gpt-image-2",
    "seedream-5",
]);

/** Map our canonical AR string → fal.ai `image_size` preset enum value. */
function falImageSizeFromAspectRatio(aspectRatio?: string): string {
    switch (aspectRatio) {
        case "1:1":  return "square_hd";
        case "4:3":  return "landscape_4_3";
        case "3:4":  return "portrait_4_3";
        case "16:9": return "landscape_16_9";
        case "9:16": return "portrait_16_9";
        // 3:2 / 2:3 / 21:9 / 4:5 / 5:4 don't have a direct preset; let the
        // model auto-select the closest valid size from the prompt.
        default: return "auto";
    }
}

class FalProvider implements AIProviderImplementation {
    id = "fal";
    name = "fal.ai";

    async generate(params: AIRequestParams): Promise<AIResponse> {
        const apiKey = process.env.FAL_KEY;
        if (!apiKey) {
            throw new Error("fal.ai API key not configured. Set FAL_KEY in .env.local");
        }

        const modelId = params.model || "nano-banana-2";
        const entry = getModelById(modelId);
        if (!entry) throw new Error(`Unknown model: ${modelId}`);

        // Text models not supported on fal.ai in this implementation
        if (entry.caps.includes("text")) {
            throw new Error(`Text models not supported on fal.ai fallback`);
        }

        // ── Remove BG (Bria on fal.ai) ────────────────────
        if (params.type === "remove-bg") {
            const falEndpoint = FAL_MODEL_MAP[modelId];
            if (!falEndpoint) throw new Error(`Model ${modelId} is not available on fal.ai for remove-bg`);

            const rmbgInput: Record<string, unknown> = {
                image_url: params.imageBase64,
            };

            console.log(`[fal.ai] Remove BG via ${falEndpoint}`);

            const submitRes = await fetch(`https://queue.fal.run/${falEndpoint}`, {
                method: "POST",
                headers: {
                    "Authorization": `Key ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(rmbgInput),
            });
            if (!submitRes.ok) {
                const errBody = await submitRes.text();
                throw new Error(`fal.ai remove-bg submit failed (${submitRes.status}): ${errBody}`);
            }
            const submitData = await submitRes.json();
            const requestId = submitData.request_id;

            if (!requestId) {
                const imageUrl = submitData.image?.url;
                if (!imageUrl) throw new Error("fal.ai remove-bg returned no image (sync)");
                return { content: imageUrl, format: "url" as const, model: modelId, provider: "fal.ai" };
            }

            const statusUrl = submitData.status_url
                || `https://queue.fal.run/${falEndpoint}/requests/${requestId}/status`;
            const responseUrl = submitData.response_url
                || `https://queue.fal.run/${falEndpoint}/requests/${requestId}`;

            console.log(`[fal.ai] Remove BG queued: ${requestId}`);

            for (let i = 0; i < 60; i++) {
                await new Promise(r => setTimeout(r, 2000));
                try {
                    const statusRes = await fetch(statusUrl, {
                        headers: { "Authorization": `Key ${apiKey}` },
                    });
                    if (!statusRes.ok) continue;
                    const status = await statusRes.json() as { status: string };
                    if (status.status === "COMPLETED") {
                        console.log(`[fal.ai] Remove BG completed after ${(i + 1) * 2}s`);
                        break;
                    }
                    if (status.status === "FAILED") throw new Error("fal.ai remove-bg generation failed");
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (err instanceof TypeError && msg.includes("fetch")) continue;
                    throw err;
                }
            }

            const resultRes = await fetch(responseUrl, {
                headers: { "Authorization": `Key ${apiKey}` },
            });
            if (!resultRes.ok) throw new Error(`fal.ai remove-bg result failed (${resultRes.status})`);
            const result = await resultRes.json();

            const imageUrl = result.image?.url;
            if (!imageUrl) throw new Error(`fal.ai remove-bg returned no image. Response: ${JSON.stringify(result).slice(0, 300)}`);

            return { content: imageUrl, format: "url", model: modelId, provider: "fal.ai" };
        }

        // ── Inpaint (flux-pro/v1/fill native; nano-banana/gpt-image edits) ─
        if (params.type === "inpainting") {
            return await this.generateInpaint(params, entry, apiKey);
        }

        // ── Outpainting (bria-expand / flux-2-pro-outpaint on fal.ai) ───
        if (params.type === "outpainting") {
            const falEndpoint = FAL_MODEL_MAP[modelId];
            if (!falEndpoint) throw new Error(`Model ${modelId} is not available on fal.ai for outpainting`);

            const outpaintInput: Record<string, unknown> = {
                image_url: params.imageBase64, // fal.ai accepts base64 data URIs
            };

            if (modelId === "flux-2-pro-outpaint") {
                // Flux 2 Pro Outpaint takes per-side expansion in pixels directly
                // and produces a coherent extension without prompt or canvas_size.
                // Per-side cap is 2048; callers (outpaintPipeline) are expected
                // to enforce that before reaching this branch.
                const pad = params.expandPadding ?? { top: 0, right: 0, bottom: 0, left: 0 };
                outpaintInput.expand_top = Math.round(pad.top);
                outpaintInput.expand_bottom = Math.round(pad.bottom);
                outpaintInput.expand_left = Math.round(pad.left);
                outpaintInput.expand_right = Math.round(pad.right);
                outpaintInput.output_format = "png";
                outpaintInput.auto_crop = false;
            } else {
                if (params.prompt) outpaintInput.prompt = params.prompt;

                // Convert expandPadding to canvas_size + original_image_location
                // NOTE: fal.ai bria/expand requires all pixel values to be integers
                if (params.expandPadding && params.originalSize) {
                    const [origW, origH] = params.originalSize;
                    const pad = params.expandPadding;
                    outpaintInput.canvas_size = [Math.round(origW + pad.left + pad.right), Math.round(origH + pad.top + pad.bottom)];
                    outpaintInput.original_image_location = [Math.round(pad.left), Math.round(pad.top)];
                    outpaintInput.original_image_size = [Math.round(origW), Math.round(origH)];
                } else if (params.canvasSize) {
                    outpaintInput.canvas_size = (params.canvasSize as number[]).map(Math.round);
                    if (params.originalSize) outpaintInput.original_image_size = (params.originalSize as number[]).map(Math.round);
                    if (params.originalLocation) outpaintInput.original_image_location = (params.originalLocation as number[]).map(Math.round);
                } else if (params.aspectRatio) {
                    outpaintInput.aspect_ratio = params.aspectRatio;
                }
            }

            console.log(`[fal.ai] Outpainting via ${falEndpoint}, padding=${JSON.stringify(params.expandPadding)}`);
            console.log(`[fal.ai] Outpaint input keys: ${Object.keys(outpaintInput).join(", ")}`);

            // Submit to fal.ai queue
            const submitRes = await fetch(`https://queue.fal.run/${falEndpoint}`, {
                method: "POST",
                headers: {
                    "Authorization": `Key ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(outpaintInput),
            });
            if (!submitRes.ok) {
                const errBody = await submitRes.text();
                throw new Error(`fal.ai outpaint submit failed (${submitRes.status}): ${errBody}`);
            }
            const submitData = await submitRes.json();
            const requestId = submitData.request_id;

            if (!requestId) {
                // Synchronous result — no polling needed.
                // Response shape varies by model: bria-expand → { image: { url } },
                // flux-2-pro-outpaint → { images: [{ url }] }.
                console.log(`[fal.ai] Outpaint returned synchronously`);
                const imageUrl = submitData.images?.[0]?.url ?? submitData.image?.url;
                if (!imageUrl) throw new Error("fal.ai outpaint returned no image (sync)");
                return { content: imageUrl, format: "url" as const, model: modelId, provider: "fal.ai" };
            }

            // Use URLs from fal.ai response (may route to different hosts)
            const statusUrl = submitData.status_url
                || `https://queue.fal.run/${falEndpoint}/requests/${requestId}/status`;
            const responseUrl = submitData.response_url
                || `https://queue.fal.run/${falEndpoint}/requests/${requestId}`;

            console.log(`[fal.ai] Outpaint queued: ${requestId}`);
            console.log(`[fal.ai] Status URL: ${statusUrl}`);
            console.log(`[fal.ai] Response URL: ${responseUrl}`);

            // Poll for result (up to 300s)
            for (let i = 0; i < 150; i++) {
                await new Promise(r => setTimeout(r, 2000));
                try {
                    const statusRes = await fetch(statusUrl, {
                        headers: { "Authorization": `Key ${apiKey}` },
                    });
                    if (!statusRes.ok) {
                        console.warn(`[fal.ai] Outpaint poll ${i + 1} HTTP ${statusRes.status}`);
                        continue;
                    }
                    const status = await statusRes.json() as { status: string };
                    if (status.status === "COMPLETED") {
                        console.log(`[fal.ai] Outpaint completed after ${(i + 1) * 2}s`);
                        break;
                    }
                    if (status.status === "FAILED") throw new Error("fal.ai outpaint generation failed");
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (err instanceof TypeError && msg.includes("fetch")) {
                        console.warn(`[fal.ai] Outpaint poll network error: ${msg}`);
                        continue;
                    }
                    throw err;
                }
            }
            
            const resultRes = await fetch(responseUrl, {
                headers: { "Authorization": `Key ${apiKey}` },
            });
            if (!resultRes.ok) {
                // Capture the body so 422/400/etc. surface the actual fal.ai
                // validation message instead of a bare status code. fal.ai
                // returns JSON with `detail` (often an array of validation
                // errors) for 422; we truncate to keep logs readable.
                let errBody = "";
                try {
                    errBody = (await resultRes.text()).slice(0, 600);
                } catch {
                    // ignore body-read errors
                }
                console.error(
                    `[fal.ai] Outpaint result HTTP ${resultRes.status} from ${responseUrl}: ${errBody}`,
                );
                throw new Error(
                    `fal.ai outpaint result failed (${resultRes.status})${errBody ? `: ${errBody}` : ""}`,
                );
            }
            const result = await resultRes.json();
            console.log(`[fal.ai] Outpaint response keys: ${Object.keys(result).join(", ")}`);

            // Response shape varies by model: bria-expand → { image: { url } },
            // flux-2-pro-outpaint → { images: [{ url }] }.
            const imageUrl = result.images?.[0]?.url ?? result.image?.url;
            if (!imageUrl) throw new Error(`fal.ai outpaint returned no image. Response: ${JSON.stringify(result).slice(0, 300)}`);
            
            return {
                content: imageUrl,
                format: "url",
                model: modelId,
                provider: "fal.ai",
            };
        }

        // ── Upscale (ESRGAN / SeedVR2 / Sima on fal.ai) ─────────────
        if (params.type === "upscale") {
            const falEndpoint = FAL_MODEL_MAP[modelId];
            if (!falEndpoint) throw new Error(`Model ${modelId} is not available on fal.ai for upscale`);

            const upscaleInput: Record<string, unknown> = {
                image_url: params.imageBase64,
            };

            // Model-specific parameter shapes
            if (modelId === "seedvr") {
                // SeedVR2: upscale_factor (float, 1..10), noise_scale (0..1), output_format
                // Clamp to SeedVR's supported range (1..10); keep conservative ceiling of 4×
                // to match our downscale-restore use case.
                if (params.upscaleScale) {
                    upscaleInput.upscale_factor = Math.min(Math.max(params.upscaleScale, 1), 10);
                    upscaleInput.upscale_mode = "factor";
                }
                // Lossless output: we composite the original over this result, so we
                // avoid JPEG re-encoding that would soften the seam.
                upscaleInput.output_format = "png";
                // Default noise_scale (0.1) is generally good, leave at provider default.
            } else if (modelId === "topaz-hf-v2") {
                // Topaz HF v2 on fal.ai (`fal-ai/topaz/upscale/image`).
                //   - `model` selects the upscaler variant; we always pin to
                //     "High Fidelity V2" because that's the structure-preserving
                //     option and the whole point of routing through Topaz.
                //   - `upscale_factor` is a float in [1..4]. fal.ai default is 2.
                //   - `face_enhancement` defaults to TRUE — we force it OFF
                //     because we're upscaling outpaint border strips (mostly
                //     sky/grass/background); enabling face touch-up could
                //     hallucinate artifacts in the seam region. The original
                //     image (with any actual faces) is composited back on top.
                //   - `output_format=png` for a lossless seam (same reason as
                //     seedvr above).
                upscaleInput.model = "High Fidelity V2";
                if (params.upscaleScale) {
                    upscaleInput.upscale_factor = Math.min(Math.max(params.upscaleScale, 1), 4);
                }
                upscaleInput.face_enhancement = false;
                upscaleInput.output_format = "png";
            } else if (modelId === "sima-upscaler") {
                // Sima: scale is integer, supports only 2 or 4
                const raw = params.upscaleScale ?? 2;
                const scale = raw <= 2 ? 2 : 4;
                upscaleInput.scale = scale;
            } else {
                // ESRGAN (and any other) — legacy `scale` param
                if (params.upscaleScale) upscaleInput.scale = params.upscaleScale;
            }

            console.log(`[fal.ai] Upscale via ${falEndpoint}, scale=${params.upscaleScale ?? "default"}`);

            const submitRes = await fetch(`https://queue.fal.run/${falEndpoint}`, {
                method: "POST",
                headers: {
                    "Authorization": `Key ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(upscaleInput),
            });
            if (!submitRes.ok) {
                const errBody = await submitRes.text();
                throw new Error(`fal.ai upscale submit failed (${submitRes.status}): ${errBody}`);
            }
            const submitData = await submitRes.json();
            const requestId = submitData.request_id;

            if (!requestId) {
                const imageUrl = submitData.image?.url;
                if (!imageUrl) throw new Error("fal.ai upscale returned no image (sync)");
                return { content: imageUrl, format: "url" as const, model: modelId, provider: "fal.ai" };
            }

            const statusUrl = submitData.status_url
                || `https://queue.fal.run/${falEndpoint}/requests/${requestId}/status`;
            const responseUrl = submitData.response_url
                || `https://queue.fal.run/${falEndpoint}/requests/${requestId}`;

            console.log(`[fal.ai] Upscale queued: ${requestId}`);

            for (let i = 0; i < 60; i++) {
                await new Promise(r => setTimeout(r, 2000));
                try {
                    const statusRes = await fetch(statusUrl, {
                        headers: { "Authorization": `Key ${apiKey}` },
                    });
                    if (!statusRes.ok) continue;
                    const status = await statusRes.json() as { status: string };
                    if (status.status === "COMPLETED") {
                        console.log(`[fal.ai] Upscale completed after ${(i + 1) * 2}s`);
                        break;
                    }
                    if (status.status === "FAILED") throw new Error("fal.ai upscale generation failed");
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (err instanceof TypeError && msg.includes("fetch")) continue;
                    throw err;
                }
            }

            const resultRes = await fetch(responseUrl, {
                headers: { "Authorization": `Key ${apiKey}` },
            });
            if (!resultRes.ok) throw new Error(`fal.ai upscale result failed (${resultRes.status})`);
            const result = await resultRes.json();

            const imageUrl = result.image?.url;
            if (!imageUrl) throw new Error(`fal.ai upscale returned no image. Response: ${JSON.stringify(result).slice(0, 300)}`);

            return { content: imageUrl, format: "url", model: modelId, provider: "fal.ai" };
        }

        // ── LoRA-aware endpoints ───────────────────────────────────
        // Centralised branch for fal-ai/flux-lora, fal-ai/flux-2/lora,
        // fal-ai/qwen-image-2512/lora and fal-ai/qwen-image-edit-lora.
        // These all share a similar input shape (loras[], guidance_scale,
        // num_inference_steps, image_size enum, acceleration, optional
        // negative_prompt) so we route them through one builder rather than
        // duplicating per-model code paths.
        const loraSpec = getLoraSpec(modelId);
        if (loraSpec) {
            return await this.generateLora(params, entry, loraSpec, apiKey);
        }

        // ── Determine endpoint ─────────────────────────────────────
        // Use /edit endpoint when: reference images present, or explicit edit type
        const needsEditEndpoint =
            (params.referenceImages && params.referenceImages.length > 0) ||
            params.type === "edit";

        let falEndpoint: string | undefined;
        if (needsEditEndpoint) {
            falEndpoint = FAL_MODEL_MAP_EDIT[modelId];
            // Fall back to base endpoint if no /edit variant exists
            if (!falEndpoint) falEndpoint = FAL_MODEL_MAP[modelId];
        } else {
            falEndpoint = FAL_MODEL_MAP[modelId];
        }
        if (!falEndpoint) throw new Error(`Model ${modelId} is not available on fal.ai`);

        // ── Build input ────────────────────────────────────────────
        const input: Record<string, unknown> = {};
        input.prompt = params.prompt;

        if (FAL_IMAGE_SIZE_MODELS.has(modelId)) {
            // GPT Image 2 / Seedream 5 Lite use `image_size` enum (not aspect_ratio).
            // For Seedream 5 we honour the explicit "2K" / "3K" choice via
            // `auto_NK`; otherwise we fall back to the AR preset. For GPT Image 2
            // the resolution knob is `quality` (low | medium | high | auto).
            if (modelId === "seedream-5" && params.scale) {
                input.image_size = `auto_${params.scale}`; // "auto_2K" | "auto_3K"
            } else {
                input.image_size = falImageSizeFromAspectRatio(params.aspectRatio);
            }
            if (modelId === "gpt-image-2") {
                if (params.scale) input.quality = params.scale; // low | medium | high
                input.output_format = "png";
            }
            // Seedream 5 Lite ignores output_format — leave it out.
        } else {
            // Existing nano-banana / Bria flow.
            if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;
            // Resolution mapping: fal.ai uses same "1K"/"2K"/"4K" enum for Google models
            // fal.ai REQUIRES this field (unlike Replicate which defaults to 1K)
            const isGoogleModel = !!FAL_MODEL_MAP[modelId]?.includes("nano-banana");
            input.resolution = params.scale || (isGoogleModel ? "2K" : undefined);
            if (!input.resolution) delete input.resolution;
            input.output_format = "png";
        }

        if (params.count && params.count > 1 && FAL_NUM_IMAGES_MODELS.has(modelId)) {
            input.num_images = Math.min(params.count, modelId === "seedream-5" ? 6 : 4);
        }

        // Reference images — /edit endpoint uses `image_urls` (NOT `image_input`)
        // Accepts both public URLs and base64 data URIs
        if (params.referenceImages && params.referenceImages.length > 0) {
            input.image_urls = params.referenceImages;
        }

        // Image edit — prepend the source image to image_urls
        if (params.type === "edit" && params.imageBase64) {
            const existingRefs = (input.image_urls as string[] | undefined) || [];
            input.image_urls = [params.imageBase64, ...existingRefs];
        }

        console.log(`[fal.ai] Submitting to ${falEndpoint} (edit=${!!needsEditEndpoint}, refs=${(input.image_urls as string[] | undefined)?.length || 0}, prompt="${String(params.prompt).slice(0, 60)}")...`);

        // ── Submit to queue ─────────────────────────────────────────
        const submitRes = await fetch(`https://queue.fal.run/${falEndpoint}`, {
            method: "POST",
            headers: {
                "Authorization": `Key ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(input),
        });

        if (!submitRes.ok) {
            const errBody = await submitRes.text();
            console.error(`[fal.ai] Submit error:`, errBody);
            throw new Error(`fal.ai error (${submitRes.status}): ${errBody.slice(0, 300)}`);
        }

        const submitData = await submitRes.json();
        const requestId = submitData.request_id;

        if (!requestId) {
            // Synchronous result — no polling needed
            return this.parseResult(submitData, entry);
        }

        // Use URLs from fal.ai response (handles /edit sub-endpoints correctly)
        const statusUrl = submitData.status_url
            || `https://queue.fal.run/${falEndpoint}/requests/${requestId}/status`;
        const responseUrl = submitData.response_url
            || `https://queue.fal.run/${falEndpoint}/requests/${requestId}`;

        console.log(`[fal.ai] Queued request ${requestId}`);
        console.log(`[fal.ai] Status URL: ${statusUrl}`);
        console.log(`[fal.ai] Response URL: ${responseUrl}`);

        // ── Poll for result (up to 300s) ───────────────────────────
        for (let i = 0; i < 150; i++) {
            await new Promise(r => setTimeout(r, 2000));

            try {
                const statusRes = await fetch(statusUrl, {
                    headers: { "Authorization": `Key ${apiKey}` },
                });

                if (!statusRes.ok) {
                    console.warn(`[fal.ai] Status poll HTTP ${statusRes.status}`);
                    continue;
                }
                const status = await statusRes.json();

                if (status.status === "COMPLETED") {
                    // Fetch the actual result
                    const resultRes = await fetch(responseUrl, {
                        headers: { "Authorization": `Key ${apiKey}` },
                    });

                    if (!resultRes.ok) {
                        const errText = await resultRes.text();
                        throw new Error(`fal.ai result fetch failed (${resultRes.status}): ${errText.slice(0, 300)}`);
                    }

                    const result = await resultRes.json();
                    console.log(`[fal.ai] Request ${requestId} completed after ${(i + 1) * 2}s`);
                    console.log(`[fal.ai] Response keys: ${Object.keys(result).join(", ")}`);
                    if (result.images) {
                        console.log(`[fal.ai] images[0]: url=${!!result.images[0]?.url}, w=${result.images[0]?.width}, h=${result.images[0]?.height}`);
                    } else {
                        console.log(`[fal.ai] No 'images' field. Full response: ${JSON.stringify(result).slice(0, 500)}`);
                    }
                    return this.parseResult(result, entry);
                }
                if (status.status === "FAILED") {
                    throw new Error(`fal.ai prediction failed: ${status.error || "unknown"}`);
                }
                // IN_QUEUE or IN_PROGRESS — keep polling
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                if (err instanceof TypeError && msg.includes("fetch")) {
                    console.warn(`[fal.ai] Poll network error: ${msg}`);
                    continue;
                }
                throw err;
            }
        }

        throw new Error("fal.ai prediction timed out after 300 seconds");
    }

    /**
     * LoRA endpoint pipeline.
     *
     * Routes through `fal-ai/flux-lora`, `fal-ai/flux-2/lora`,
     * `fal-ai/qwen-image-2512/lora` or `fal-ai/qwen-image-edit-lora` depending
     * on the modelId. Builds a normalised input payload that respects the
     * spec's defaults and clamps user overrides to the supported ranges.
     *
     * Endpoint selection rules:
     *   • qwen-image-edit-lora — always image-to-image (FAL_MODEL_MAP[id])
     *   • flux-lora            — img2img variant when source image is supplied
     *   • flux-2-lora /        — text-to-image only (no img2img endpoint yet)
     *     qwen-image-lora
     */
    private async generateLora(
        params: AIRequestParams,
        entry: ModelEntry,
        spec: LoraSpec,
        apiKey: string,
    ): Promise<AIResponse> {
        const modelId = entry.id;
        const sourceImage = params.imageBase64
            ?? (params.referenceImages && params.referenceImages[0]);
        const wantsEdit = params.type === "edit" || !!sourceImage;

        // ── Auto-inject Trigger Words & Translate Prompt ──
        let finalPrompt = params.prompt || "";
        
        try {
            if (params.loras && params.loras.length > 0) {
                const paths = params.loras.map(l => l.path);
                const { SYSTEM_LORA_CATALOG } = await import("@/lib/lora-catalog");
                const { prisma } = await import("@/server/db");
                
                const systemMatches = SYSTEM_LORA_CATALOG.filter(p => paths.includes(p.path));
                const systemWords = systemMatches.flatMap(p => p.triggerWords || []);
                
                const dbMatches = await prisma.loraPreset.findMany({
                    where: { path: { in: paths } },
                    select: { triggerWords: true }
                });
                const dbWords = dbMatches.flatMap(p => p.triggerWords || []);
                
                const allWords = [...new Set([...systemWords, ...dbWords])];
                if (allWords.length > 0) {
                    finalPrompt = `${allWords.join(", ")}, ${finalPrompt}`;
                    console.log(`[fal.ai LoRA] Injected trigger words: ${allWords.join(", ")}`);
                }
            }

            // FLUX models on fal.ai (flux-lora, flux-2-lora) heavily degrade with Cyrillic text
            // because community LoRAs strictly expect English captions.
            if ((modelId === "flux-lora" || modelId === "flux-2-lora") && /[а-яА-ЯёЁ]/.test(finalPrompt)) {
                console.log(`[fal.ai LoRA] Russian prompt detected, translating: "${finalPrompt}"`);
                const textProvider = getProvider("gemini-flash");
                const res = await textProvider.generate({
                    prompt: `Translate this image generation prompt to English. Reply ONLY with the English translation, no quotes, no explanations. Preserve any special tags or trigger words as they are:\n\n${finalPrompt}`,
                    type: "text"
                });
                if (res.content) {
                    finalPrompt = res.content.trim();
                    console.log(`[fal.ai LoRA] Translation result: "${finalPrompt}"`);
                }
            }
        } catch (e) {
            console.warn(`[fal.ai LoRA] Failed to process prompt enhancements:`, e);
            // Non-fatal, continue with original prompt if translation/db-lookup fails
        }

        // Pick endpoint
        let falEndpoint: string;
        if (modelId === "qwen-image-edit-lora") {
            // Edit-only model — uses base mapping which already points at the
            // edit endpoint.
            falEndpoint = FAL_MODEL_MAP[modelId];
            if (!sourceImage) {
                throw new Error("Qwen Image Edit LoRA requires an input image");
            }
        } else if (wantsEdit && FAL_MODEL_MAP_EDIT[modelId]) {
            falEndpoint = FAL_MODEL_MAP_EDIT[modelId];
        } else {
            falEndpoint = FAL_MODEL_MAP[modelId];
        }
        if (!falEndpoint) {
            throw new Error(`No fal.ai endpoint mapped for ${modelId}`);
        }

        // Build input
        const input: Record<string, unknown> = {
            prompt: finalPrompt,
            // All four LoRA endpoints accept the image_size enum (square_hd /
            // portrait_* / landscape_*) — use the existing AR mapper.
            image_size: falImageSizeFromAspectRatio(params.aspectRatio),
            output_format: "png",
            num_images: Math.max(1, Math.min(params.count ?? 1, 4)),
        };

        // Guidance + steps — clamp to the spec's range so an invalid override
        // can't reach fal.ai (which would reject the whole request).
        const [gMin, gMax] = spec.guidanceRange;
        const guidance = Math.min(
            Math.max(params.guidanceScale ?? spec.defaultGuidance, gMin),
            gMax,
        );
        input.guidance_scale = guidance;

        const [sMin, sMax] = spec.stepsRange;
        const steps = Math.min(
            Math.max(params.numInferenceSteps ?? spec.defaultSteps, sMin),
            sMax,
        );
        input.num_inference_steps = steps;

        if (typeof params.seed === "number") {
            input.seed = params.seed;
        }

        // Acceleration — only set when the spec allows it (and the user picked
        // a value the endpoint supports).
        if (spec.supportsAcceleration && params.acceleration) {
            const allowed = spec.accelerationOptions ?? ["none", "regular"];
            if (allowed.includes(params.acceleration)) {
                input.acceleration = params.acceleration;
            }
        }

        // Negative prompt — Qwen Image Edit LoRA only.
        if (spec.supportsNegativePrompt && params.negativePrompt) {
            input.negative_prompt = params.negativePrompt;
        }

        // LoRA weights — normalise, clamp count, default scale to 1.
        if (params.loras && params.loras.length > 0) {
            const normalised = params.loras
                .filter((l) => typeof l?.path === "string" && l.path.length > 0)
                .slice(0, spec.maxCount)
                .map((l) => ({
                    path: l.path,
                    scale: typeof l.scale === "number"
                        ? Math.max(0, Math.min(l.scale, 2))
                        : 1,
                }));
            if (normalised.length > 0) {
                input.loras = normalised;
            }
        }

        // Source image for img2img / edit endpoints.
        if (sourceImage && falEndpoint.includes("image-to-image")) {
            // FLUX.1 LoRA i2i takes `image_url` + optional `strength` (0..1).
            input.image_url = sourceImage;
            // Use a fairly strong strength by default so the LoRA style
            // visibly applies; fal default is 0.85.
        } else if (sourceImage && modelId === "qwen-image-edit-lora") {
            input.image_url = sourceImage;
        }

        console.log(
            `[fal.ai LoRA] ${falEndpoint} guidance=${guidance} steps=${steps}`
            + ` loras=${(input.loras as unknown[] | undefined)?.length ?? 0}`
            + ` accel=${input.acceleration ?? "default"}`
            + ` source=${sourceImage ? "yes" : "no"}`,
        );

        const result = await falSubmitAndPoll(falEndpoint, input, apiKey);
        return this.parseResult(result, entry);
    }

    /**
     * Inpaint pipeline on fal.ai.
     *
     * Endpoint selection (FAL_MODEL_MAP_INPAINT):
     *   • flux-fill            → fal-ai/flux-pro/v1/fill (native mask)
     *   • gpt-image-2          → openai/gpt-image-2/edit (native mask)
     *   • nano-banana / -2 / -pro → fal-ai/nano-banana(-2/-pro)/edit
     *                          (heuristic mask — model treats it as a hint)
     *
     * IMPORTANT — fal.ai /fill requires PUBLIC URLs for `image_url` and
     * `mask_url` (data: URIs are rejected). Callers are expected to push
     * the mask to S3 first via `uploadForAI()` and pass the resulting URL
     * in `maskBase64`. We keep the field name `maskBase64` for backwards
     * compatibility, but the value should already be a URL by the time it
     * lands here.
     */
    private async generateInpaint(
        params: AIRequestParams,
        entry: ModelEntry,
        apiKey: string,
    ): Promise<AIResponse> {
        if (!params.imageBase64) {
            throw new Error("Image is required for inpainting");
        }
        if (!params.maskBase64) {
            throw new Error("Mask is required for inpainting");
        }

        const modelId = entry.id;
        const falEndpoint = FAL_MODEL_MAP_INPAINT[modelId];
        if (!falEndpoint) {
            throw new Error(`Model ${modelId} has no fal.ai inpaint endpoint`);
        }

        const input: Record<string, unknown> = {};
        const prompt = params.prompt || "";

        if (falEndpoint === "fal-ai/flux-pro/v1/fill") {
            // FLUX.1 [pro] Fill — native mask inpaint.
            // Defaults tuned for high-quality, photorealistic fills:
            //   - safety_tolerance=6 to avoid spurious blocks on benign edits
            //   - num_inference_steps left to provider default (28)
            //   - output_format png to preserve sharpness without re-encoding
            input.prompt = prompt || "seamless natural fill";
            input.image_url = params.imageBase64;
            input.mask_url = params.maskBase64;
            input.output_format = "png";
            input.safety_tolerance = 6;
            if (typeof params.seed === "number") input.seed = params.seed;
            if (params.count && params.count > 1) {
                input.num_images = Math.min(params.count, 4);
            }
        } else if (modelId === "gpt-image-2") {
            // OpenAI gpt-image-2 edit with mask — mask in `mask_url`,
            // image in `image_urls[0]`. quality knob = scale (low|medium|high).
            input.prompt = prompt;
            input.image_urls = [params.imageBase64];
            input.mask_url = params.maskBase64;
            input.output_format = "png";
            // High quality by default; caller can override via scale.
            input.quality = params.scale || "high";
            if (params.count && params.count > 1) {
                input.num_images = Math.min(params.count, 4);
            }
        } else {
            // Nano Banana family — heuristic mask via image_urls[].
            // Model treats the mask as a strong visual hint, not as a hard
            // region constraint. UI surfaces this as "experimental"; for
            // predictable inpainting we recommend flux-fill.
            input.prompt = prompt;
            input.image_urls = [params.imageBase64, params.maskBase64];
            input.output_format = "png";
            if (params.scale) input.resolution = params.scale;
            if (params.count && params.count > 1) {
                input.num_images = Math.min(params.count, 4);
            }
        }

        console.log(
            `[fal.ai inpaint] ${falEndpoint} model=${modelId}`
            + ` prompt="${prompt.slice(0, 60)}" image=${params.imageBase64.slice(0, 50)}...`,
        );

        const result = await falSubmitAndPoll(falEndpoint, input, apiKey);
        return this.parseResult(result, entry);
    }

    /** Parse fal.ai response, extracting image URL and dimensions */
    private parseResult(data: Record<string, unknown>, entry: ModelEntry): AIResponse {
        const images = data.images as { url?: string; width?: number; height?: number }[] | undefined;
        const imageObj = images?.[0];
        const imageUrls = Array.from(new Set([
            ...(images?.map((image) => image.url).filter((url): url is string => Boolean(url)) ?? []),
            ...normalizeImageOutputs(data.output),
        ]));
        const imageUrl = imageObj?.url || imageUrls[0];
        if (!imageUrl) throw new Error("fal.ai: no image URL in response");

        return {
            content: imageUrl,
            contents: imageUrls.length > 0 ? imageUrls : [imageUrl],
            format: "url",
            model: entry.id,
            provider: "fal",
            width: imageObj?.width,
            height: imageObj?.height,
        };
    }
}

// ─── Provider Factory ───────────────────────────────────────────────────────

const openaiDirect = new OpenAIDirectProvider();
const replicate = new ReplicateProvider();
const falProvider = new FalProvider();

/** Check if a model has fal.ai support available */
function hasFalSupport(modelId: string): boolean {
    return !!process.env.FAL_KEY
        && (!!FAL_MODEL_MAP[modelId] || !!FAL_MODEL_MAP_INPAINT[modelId]);
}

/**
 * Models where fal.ai should be the PRIMARY provider (Replicate is unstable).
 * When FAL_KEY is set, these models go to fal.ai first, Replicate as fallback.
 */
const FAL_PRIMARY_MODELS = new Set([
    "nano-banana-2",
    "nano-banana",
    "nano-banana-pro",
    "seedream-5",
    "gpt-image-2",
    "bria-expand",
    "flux-2-pro-outpaint",
    "bria-rmbg",
    "esrgan",
    "seedvr",
    "topaz-hf-v2",
    "sima-upscaler",
    // flux-fill exists on fal as fal-ai/flux-pro/v1/fill (native inpaint).
    // Replicate (black-forest-labs/flux-fill-dev) stays as the auto-fallback.
    "flux-fill",
]);

/**
 * Models that exist ONLY on fal.ai — they have no Replicate equivalent.
 * generateWithFallback uses this to skip the Replicate hop entirely so we
 * don't waste 5–10s and a couple of failed retries on a guaranteed 404
 * before falling through to a sibling model.
 *
 * The slug we register in `ai-models.ts` for these models is the fal.ai
 * endpoint (e.g. `fal-ai/flux-2-pro/outpaint`), so naively passing them
 * through Replicate's prediction API returns 404 with that slug.
 *
 * Note: bria-expand / seedvr / topaz-hf-v2 are *also* fal-only by API
 * surface, but their slugs happen to overlap with valid Replicate
 * models (e.g. `bria/expand-image`), so we leave them out of this set
 * and let Replicate try as a real fallback.
 */
const FAL_ONLY_MODELS = new Set([
    "flux-2-pro-outpaint",
    // LoRA endpoints — fal-only, no Replicate equivalent.
    "flux-lora",
    "flux-2-lora",
    "qwen-image-lora",
    "qwen-image-edit-lora",
]);



/**
 * Model fallback chains — if original model is unavailable on all providers,
 * try sibling models from the same family.
 */
const MODEL_FALLBACK_CHAIN: Record<string, string[]> = {
    "nano-banana-2":   ["nano-banana", "nano-banana-pro"],
    "nano-banana":     ["nano-banana-2", "nano-banana-pro"],
    "nano-banana-pro": ["nano-banana-2", "nano-banana"],
    "seedream-5":      ["seedream"],
    "seedream":        ["seedream-5"],
    "gpt-image-2":     ["gpt-image"],
    "gpt-image":       ["gpt-image-2"],
    "flux-2-pro-outpaint": ["bria-expand", "outpainter"],
    "bria-expand":     ["flux-2-pro-outpaint", "outpainter"],
    "outpainter":      ["bria-expand"],
    "bria-rmbg":       ["rembg"],
    "rembg":           ["bria-rmbg"],
    // Topaz HF v2 is the primary outpaint upscaler (structure-preserving).
    // SeedVR is the closest sibling on the upscale fan; esrgan is a hard
    // fallback. We deliberately put topaz at the top of seedvr's chain so
    // an outpaint job that explicitly requests seedvr (legacy callers) still
    // benefits from the structure-preserving option when seedvr is down.
    "topaz-hf-v2":     ["seedvr", "esrgan"],
    "seedvr":          ["topaz-hf-v2", "esrgan", "sima-upscaler"],
    "sima-upscaler":   ["seedvr", "esrgan"],
    "esrgan":          ["seedvr"],
    // LoRA fallback — when the LoRA endpoint goes down or the supplied LoRA
    // path is invalid, fall back to the same base model without LoRAs. Style
    // won't be applied, but the user still gets a usable image.
    "flux-lora":              ["flux-dev", "flux-schnell"],
    "flux-2-lora":            ["flux-2-pro", "flux-1.1-pro"],
    "qwen-image-lora":        ["qwen-image"],
    "qwen-image-edit-lora":   ["qwen-image-edit"],
};

/**
 * Try a single generation attempt on a specific provider.
 * Returns result or throws.
 */
async function tryProvider(
    provider: AIProviderImplementation,
    params: AIRequestParams,
    label: string,
): Promise<AIResponse> {
    console.log(`[Provider] Trying ${label} for ${params.model}...`);
    return await provider.generate(params);
}

/**
 * Try generation with retry (up to `maxAttempts`) on a single provider.
 * Adds a short delay between retries.
 */
async function tryWithRetry(
    provider: AIProviderImplementation,
    params: AIRequestParams,
    label: string,
    maxAttempts = 2,
): Promise<AIResponse> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await tryProvider(provider, params, `${label} (attempt ${attempt}/${maxAttempts})`);
        } catch (err: unknown) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Provider] ${label} attempt ${attempt} failed: ${msg}`);
            // Don't retry on "Service unavailable" — it won't help
            if (msg.includes("Service is currently unavailable") || msg.includes("high demand")) {
                break;
            }
            // Wait before retry (5s)
            if (attempt < maxAttempts) {
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
    throw lastErr;
}

export function getProvider(modelId: string): AIProviderImplementation {
    const entry = getModelById(modelId);
    if (entry?.provider === "openai") return openaiDirect;
    return replicate;
}

/**
 * Generate with maximum resilience:
 *
 * 1. Try primary provider (fal.ai for nano-banana, Replicate for others)
 *    with up to 2 retries
 * 2. Try secondary provider with up to 2 retries
 * 3. If both fail, try sibling models from same family
 *    (e.g. nano-banana-2 → nano-banana → nano-banana-pro)
 */
export async function generateWithFallback(params: AIRequestParams): Promise<AIResponse> {
    const modelId = params.model || "nano-banana-2";
    const errors: string[] = [];

    // Determine provider order. Fal-only models (those with no Replicate
    // slug equivalent) skip the Replicate hop entirely — running them
    // through Replicate just burns ~10s on guaranteed 404 retries before
    // we get to the real sibling fallback (e.g. bria-expand for
    // flux-2-pro-outpaint).
    const useFalPrimary = FAL_PRIMARY_MODELS.has(modelId) && hasFalSupport(modelId);
    const isFalOnly = FAL_ONLY_MODELS.has(modelId);
    const providers: { impl: AIProviderImplementation; label: string }[] = isFalOnly
        ? [{ impl: falProvider, label: "fal.ai" }]
        : useFalPrimary
            ? [
                { impl: falProvider, label: "fal.ai" },
                { impl: replicate, label: "Replicate" },
              ]
            : hasFalSupport(modelId)
                ? [
                    { impl: replicate, label: "Replicate" },
                    { impl: falProvider, label: "fal.ai" },
                  ]
                : [
                    { impl: getProvider(modelId), label: "Replicate" },
                  ];

    // ── Step 1: Try each provider with retries for the original model ──
    for (const { impl, label } of providers) {
        try {
            return await tryWithRetry(impl, params, `${label}/${modelId}`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${label}: ${msg}`);
        }
    }

    // ── Step 2: Try sibling models from the same family ──
    // Inpaint is latency-sensitive: falling through gpt-image-2 → gpt-image
    // (or nano variants) can add several minutes on top of an already-slow
    // queue job. Prefer surfacing the primary model error to the user.
    const siblings =
        params.type === "inpainting" ? undefined : MODEL_FALLBACK_CHAIN[modelId];
    if (siblings && siblings.length > 0) {
        for (const siblingId of siblings) {
            console.log(`[Provider] Trying sibling model ${siblingId} instead of ${modelId}...`);
            const siblingParams = { ...params, model: siblingId };

            // Determine providers for sibling — apply the same fal-only
            // shortcut so a fal-only sibling doesn't drag us through a 404 detour.
            const sibFalPrimary = FAL_PRIMARY_MODELS.has(siblingId) && hasFalSupport(siblingId);
            const sibFalOnly = FAL_ONLY_MODELS.has(siblingId);
            const sibProviders = sibFalOnly
                ? [{ impl: falProvider, label: "fal.ai" }]
                : sibFalPrimary
                    ? [{ impl: falProvider, label: "fal.ai" }, { impl: replicate, label: "Replicate" }]
                    : [{ impl: replicate, label: "Replicate" }, ...(hasFalSupport(siblingId) ? [{ impl: falProvider, label: "fal.ai" }] : [])];

            for (const { impl, label } of sibProviders) {
                try {
                    const result = await tryWithRetry(impl, siblingParams, `${label}/${siblingId}`, 1);
                    console.log(`[Provider] ✓ Sibling model ${siblingId} succeeded on ${label}`);
                    return result;
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    errors.push(`${label}/${siblingId}: ${msg}`);
                }
            }
        }
    }

    // All providers and models exhausted
    throw new Error(`Генерация не удалась. Все провайдеры и модели недоступны:\n${errors.join("\n")}`);
}
