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
    type: "text" | "image" | "inpainting" | "outpainting" | "remove-bg" | "edit";
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
}

export interface AIResponse {
    content: string;
    format: "text" | "url" | "base64";
    model: string;
    provider: string;
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
        return { content: text, format: "text", model: entry.slug, provider: "replicate" };
    }

    // ── Image Generation / Editing ──────────────────────────────────────

    private async generateImage(params: AIRequestParams, entry: ModelEntry, token: string): Promise<AIResponse> {
        const input: Record<string, unknown> = {};

        // ── Remove BG ───────────────────────────────────────────────
        if (params.type === "remove-bg") {
            if (!params.imageBase64) throw new Error("Image is required for background removal");
            // Use rembg regardless of selected model
            const rembgEntry = getModelById("rembg")!;
            const result = await this.callReplicate(rembgEntry, { image: params.imageBase64 }, token);
            const output = Array.isArray(result) ? result[0] : result;
            return { content: output as string, format: "url", model: rembgEntry.slug, provider: "replicate" };
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
            if (params.aspectRatio) expandInput.aspect_ratio = params.aspectRatio;
            if (params.canvasSize) expandInput.canvas_size = params.canvasSize;
            if (params.originalSize) expandInput.original_image_size = params.originalSize;
            if (params.originalLocation) expandInput.original_image_location = params.originalLocation;
            
            const result = await this.callReplicate(expandEntry, expandInput, token);
            const output = Array.isArray(result) ? result[0] : result;
            return { content: output as string, format: "url", model: expandEntry.slug, provider: "replicate" };
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
            return { content: output as string, format: "url", model: entry.slug, provider: "replicate" };
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
            return { content: output as string, format: "url", model: entry.slug, provider: "replicate" };
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
        } else if (isGoogle) {
            // Nano Banana models: only jpg or png
            input.output_format = "png";
        }
        // Seedream, Qwen, GPT-Image: use model defaults (don't send output_format)

        // Reference images (Flux 2 Pro, Nano Banana)
        if (params.referenceImages && params.referenceImages.length > 0) {
            input.reference_images = params.referenceImages;
        }

        const result = await this.callReplicate(entry, input, token);
        const output = Array.isArray(result) ? result[0] : result;
        return { content: output as string, format: "url", model: entry.slug, provider: "replicate" };
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

        const createRes = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "Prefer": "wait",
            },
            body: JSON.stringify(body),
        });

        if (!createRes.ok) {
            const errBody = await createRes.text();
            console.error(`Replicate API error [${entry.slug}]:`, errBody);
            throw new Error(`Replicate error (${createRes.status}): ${errBody.slice(0, 300)}`);
        }

        let prediction = await createRes.json();

        // If inline result (Prefer: wait succeeded)
        if (prediction.output !== undefined && prediction.output !== null) {
            return prediction.output;
        }

        // Poll for result (up to 120 seconds)
        const predictionId = prediction.id;
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
                headers: { "Authorization": `Bearer ${token}` },
            });
            const poll = await pollRes.json();

            if (poll.status === "succeeded") {
                return poll.output;
            }
            if (poll.status === "failed" || poll.status === "canceled") {
                throw new Error(`Replicate prediction ${poll.status}: ${poll.error || "unknown error"}`);
            }
        }

        throw new Error("Replicate prediction timed out after 120 seconds");
    }
}

// ─── Provider Factory ───────────────────────────────────────────────────────

const openaiDirect = new OpenAIDirectProvider();
const replicate = new ReplicateProvider();

export function getProvider(modelId: string): AIProviderImplementation {
    const entry = getModelById(modelId);
    if (entry?.provider === "openai") return openaiDirect;
    // Everything else goes through Replicate (including BYOK models like gpt-image)
    return replicate;
}
