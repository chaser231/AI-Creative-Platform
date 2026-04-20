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
export { MODEL_REGISTRY, getModelsForCaps, getModelById } from "./ai-models";
export type { ModelCap, ModelEntry } from "./ai-models";

import { MODEL_REGISTRY, getModelById } from "./ai-models";
import type { ModelEntry } from "./ai-models";

// ─── Interfaces ─────────────────────────────────────────────────────────────

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
}

export interface AIResponse {
    content: string;
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
                input.image_input = params.maskBase64 ? [params.imageBase64, params.maskBase64] : [params.imageBase64];
                input.output_format = "png";
            } else if (slug.startsWith("black-forest-labs/")) {
                input.image = params.imageBase64;
                if (params.maskBase64) input.mask = params.maskBase64;
                input.output_format = "webp";
            } else {
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
                // Seedream expects image_input
                input.image_input = [params.imageBase64];
            } else {
                // Default / Qwen expects image
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
        const isFlux = slug.startsWith("black-forest-labs/");
        const isGoogle = slug.startsWith("google/");
        const isQwen = slug.startsWith("qwen/");
        const isSeedream = slug.startsWith("bytedance/");

        if (isFlux) {
            // Flux models support webp, num_outputs, output_quality
            input.output_format = "webp";
            input.output_quality = 90;
            if (params.count && params.count > 1) input.num_outputs = Math.min(params.count, 4);
            // Flux resolution: megapixels
            if (params.scale) input.megapixels = params.scale; // "0.25", "1", "4"
        } else if (isGoogle) {
            // Nano Banana models: only jpg or png
            input.output_format = "png";
            // Google resolution: "1K" | "2K" | "4K"
            if (params.scale) input.resolution = params.scale;
        } else if (slug.startsWith("openai/")) {
            // GPT Image: quality
            if (params.scale) input.quality = params.scale; // "low", "medium", "high"
        }
        // Seedream, Qwen: no resolution control

        // ── Reference images — correct parameter per model family ──────
        if (params.referenceImages && params.referenceImages.length > 0) {
            console.log(`[Pipeline ▶6 Provider] referenceImages: ${params.referenceImages.length} image(s), model: ${slug}`);

            if (isGoogle) {
                // Nano Banana family: image_input accepts array of URLs or base64
                input.image_input = params.referenceImages;
            } else if (isSeedream) {
                // Seedream: image_input
                input.image_input = params.referenceImages;
            } else if (slug === "black-forest-labs/flux-2-pro") {
                // Flux 2 Pro: reference_images
                input.reference_images = params.referenceImages;
            } else if (slug.startsWith("openai/")) {
                // GPT-Image: reference_images
                input.reference_images = params.referenceImages;
            }
            // Flux Dev, Flux 1.1 Pro, DALL-E 3, Qwen: no reference image support
        }

        console.log(`[Pipeline ▶6 Provider] Final Replicate input keys: ${Object.keys(input).join(", ")}`);

        const result = await this.callReplicate(entry, input, token);
        const output = Array.isArray(result) ? result[0] : result;
        return { content: output as string, format: "url", model: entry.id, provider: "replicate" };
    }

    // ── Replicate API Call ───────────────────────────────────────────────

    private async callReplicate(entry: ModelEntry, input: Record<string, unknown>, token: string): Promise<unknown> {
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
}

// ─── fal.ai Fallback Provider ───────────────────────────────────────────────

/** Model ID → fal.ai text-to-image endpoint mapping */
const FAL_MODEL_MAP: Record<string, string> = {
    "nano-banana":     "fal-ai/nano-banana",
    "nano-banana-2":   "fal-ai/nano-banana-2",
    "nano-banana-pro": "fal-ai/nano-banana-pro",
    "seedream":        "fal-ai/seedream-4.5",
    "bria-expand":     "fal-ai/bria/expand",
    "bria-rmbg":       "fal-ai/bria/background/remove",
    "esrgan":          "fal-ai/esrgan",
    "seedvr":          "fal-ai/seedvr/upscale/image",
    "sima-upscaler":   "simalabs/sima-upscaler",
};

/** Model ID → fal.ai /edit endpoint (required for reference images) */
const FAL_MODEL_MAP_EDIT: Record<string, string> = {
    "nano-banana":     "fal-ai/nano-banana/edit",
    "nano-banana-2":   "fal-ai/nano-banana-2/edit",
    "nano-banana-pro": "fal-ai/nano-banana-pro/edit",
};

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

        // ── Outpainting (bria-expand on fal.ai) ────────────────────
        if (params.type === "outpainting") {
            const falEndpoint = FAL_MODEL_MAP[modelId];
            if (!falEndpoint) throw new Error(`Model ${modelId} is not available on fal.ai for outpainting`);
            
            const outpaintInput: Record<string, unknown> = {
                image_url: params.imageBase64, // fal.ai accepts base64 data URIs
            };
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
                // Synchronous result — no polling needed
                console.log(`[fal.ai] Outpaint returned synchronously`);
                const imageUrl = submitData.image?.url;
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
            if (!resultRes.ok) throw new Error(`fal.ai outpaint result failed (${resultRes.status})`);
            const result = await resultRes.json();
            console.log(`[fal.ai] Outpaint response keys: ${Object.keys(result).join(", ")}`);
            
            const imageUrl = result.image?.url;
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
        if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;

        // Resolution mapping: fal.ai uses same "1K"/"2K"/"4K" enum for Google models
        // fal.ai REQUIRES this field (unlike Replicate which defaults to 1K)
        const isGoogleModel = !!FAL_MODEL_MAP[modelId]?.includes("nano-banana");
        input.resolution = params.scale || (isGoogleModel ? "1K" : undefined);
        if (!input.resolution) delete input.resolution;

        // Output format
        input.output_format = "png";

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

    /** Parse fal.ai response, extracting image URL and dimensions */
    private parseResult(data: Record<string, unknown>, entry: ModelEntry): AIResponse {
        const images = data.images as { url?: string; width?: number; height?: number }[] | undefined;
        const imageObj = images?.[0];
        const imageUrl = imageObj?.url || (data.output as string);
        if (!imageUrl) throw new Error("fal.ai: no image URL in response");

        return {
            content: imageUrl,
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
    return !!FAL_MODEL_MAP[modelId] && !!process.env.FAL_KEY;
}

/**
 * Models where fal.ai should be the PRIMARY provider (Replicate is unstable).
 * When FAL_KEY is set, these models go to fal.ai first, Replicate as fallback.
 */
const FAL_PRIMARY_MODELS = new Set([
    "nano-banana-2",
    "nano-banana",
    "nano-banana-pro",
    "bria-expand",
    "bria-rmbg",
    "esrgan",
    "seedvr",
    "sima-upscaler",
]);



/**
 * Model fallback chains — if original model is unavailable on all providers,
 * try sibling models from the same family.
 */
const MODEL_FALLBACK_CHAIN: Record<string, string[]> = {
    "nano-banana-2":   ["nano-banana", "nano-banana-pro"],
    "nano-banana":     ["nano-banana-2", "nano-banana-pro"],
    "nano-banana-pro": ["nano-banana-2", "nano-banana"],
    "bria-expand":     ["outpainter"],
    "outpainter":      ["bria-expand"],
    "bria-rmbg":       ["rembg"],
    "rembg":           ["bria-rmbg"],
    "seedvr":          ["esrgan", "sima-upscaler"],
    "sima-upscaler":   ["seedvr", "esrgan"],
    "esrgan":          ["seedvr"],
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

    // Determine provider order
    const useFalPrimary = FAL_PRIMARY_MODELS.has(modelId) && hasFalSupport(modelId);
    const providers: { impl: AIProviderImplementation; label: string }[] = useFalPrimary
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
    const siblings = MODEL_FALLBACK_CHAIN[modelId];
    if (siblings && siblings.length > 0) {
        for (const siblingId of siblings) {
            console.log(`[Provider] Trying sibling model ${siblingId} instead of ${modelId}...`);
            const siblingParams = { ...params, model: siblingId };

            // Determine providers for sibling
            const sibFalPrimary = FAL_PRIMARY_MODELS.has(siblingId) && hasFalSupport(siblingId);
            const sibProviders = sibFalPrimary
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
