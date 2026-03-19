import OpenAI from "openai";

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface AIRequestParams {
    prompt: string;
    type: "text" | "image" | "inpainting" | "outpainting" | "remove-bg";
    model?: string;
    context?: string;
    width?: number;
    height?: number;
    aspectRatio?: string;   // e.g. "1:1", "16:9"
    count?: number;
    seed?: number;
    scale?: string;
    referenceImages?: string[];
    imageBase64?: string;
    maskBase64?: string;
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

// ─── OpenAI Provider ────────────────────────────────────────────────────────

class OpenAIProvider implements AIProviderImplementation {
    id = "openai";
    name = "OpenAI";
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
        if (params.type === "image") return this.generateImage(params);
        throw new Error(`OpenAI: unsupported type ${params.type}`);
    }

    private async generateText(params: AIRequestParams): Promise<AIResponse> {
        const completion = await this.client.chat.completions.create({
            messages: [
                { role: "system", content: "You are a creative copywriter assistant." },
                ...(params.context ? [{ role: "system" as const, content: `Context: ${params.context}` }] : []),
                { role: "user", content: params.prompt },
            ],
            model: params.model || "gpt-4o",
        });
        return {
            content: completion.choices[0].message.content || "",
            format: "text",
            model: completion.model,
            provider: "openai",
        };
    }

    private async generateImage(params: AIRequestParams): Promise<AIResponse> {
        // Map aspect ratio to DALL-E 3 size
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

    // Actual Replicate model slugs
    private readonly MODELS: Record<string, { slug: string; version?: string }> = {
        // --- Generation ---
        "flux-schnell":      { slug: "black-forest-labs/flux-schnell" },
        "flux-dev":          { slug: "black-forest-labs/flux-dev" },
        "flux-1.1-pro":      { slug: "black-forest-labs/flux-1.1-pro" },
        "flux-pro":          { slug: "black-forest-labs/flux-pro" },
        "seedream":          { slug: "stability-ai/stable-diffusion-3.5-large" },
        "nano-banana":       { slug: "black-forest-labs/flux-schnell" },
        "nano-banana-2":     { slug: "black-forest-labs/flux-dev" },
        "nano-banana-pro":   { slug: "black-forest-labs/flux-1.1-pro" },
        // --- Inpainting ---
        "flux-fill":         { slug: "black-forest-labs/flux-fill-dev" },
        // --- Background removal ---
        "rembg":             { slug: "cjwbw/rembg", version: "fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003" },
    };

    private getModel(modelId: string) {
        return this.MODELS[modelId] || this.MODELS["flux-schnell"];
    }

    async generate(params: AIRequestParams): Promise<AIResponse> {
        const apiToken = process.env.REPLICATE_API_TOKEN;
        if (!apiToken) {
            throw new Error("Replicate API token not configured. Set REPLICATE_API_TOKEN in .env.local");
        }

        const modelId = params.model || "flux-schnell";
        const modelInfo = this.getModel(modelId);

        // Build input based on the type of operation
        const input: Record<string, unknown> = {};

        if (params.type === "remove-bg") {
            // Background removal model requires `image` input
            if (!params.imageBase64) throw new Error("Image is required for background removal");
            input.image = params.imageBase64;
        } else if (params.type === "inpainting") {
            // Inpainting model (flux-fill) needs image + mask + prompt
            if (!params.imageBase64) throw new Error("Image is required for inpainting");
            input.image = params.imageBase64;
            input.prompt = params.prompt;
            if (params.maskBase64) input.mask = params.maskBase64;
        } else {
            // Standard text-to-image generation
            input.prompt = params.prompt;

            // Aspect ratio (supported by Flux models)
            if (params.aspectRatio) {
                input.aspect_ratio = params.aspectRatio;
            }

            // Number of outputs
            if (params.count && params.count > 1) {
                input.num_outputs = Math.min(params.count, 4);
            }

            // Seed for reproducibility
            if (params.seed) {
                input.seed = params.seed;
            }

            // Quality/steps for some models
            input.output_format = "webp";
            input.output_quality = 90;
        }

        // Call Replicate API
        let url: string;
        if (modelInfo.version) {
            url = "https://api.replicate.com/v1/predictions";
        } else {
            url = `https://api.replicate.com/v1/models/${modelInfo.slug}/predictions`;
        }

        const body: Record<string, unknown> = { input };
        if (modelInfo.version) {
            body.version = modelInfo.version;
        }

        const createRes = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiToken}`,
                "Content-Type": "application/json",
                "Prefer": "wait",
            },
            body: JSON.stringify(body),
        });

        if (!createRes.ok) {
            const errText = await createRes.text();
            console.error("Replicate API error:", errText);
            throw new Error(`Replicate API error (${createRes.status}): ${errText.slice(0, 200)}`);
        }

        let prediction = await createRes.json();

        // If result came back inline (Prefer: wait)
        if (prediction.output) {
            const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
            return { content: output as string, format: "url", model: modelInfo.slug, provider: "replicate" };
        }

        // Poll for result (up to 120 seconds)
        const predictionId = prediction.id;
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
                headers: { "Authorization": `Bearer ${apiToken}` },
            });
            const poll = await pollRes.json();
            if (poll.status === "succeeded") {
                const output = Array.isArray(poll.output) ? poll.output[0] : poll.output;
                return { content: output as string, format: "url", model: modelInfo.slug, provider: "replicate" };
            }
            if (poll.status === "failed" || poll.status === "canceled") {
                throw new Error(`Replicate prediction ${poll.status}: ${poll.error || "unknown"}`);
            }
        }

        throw new Error("Replicate prediction timed out after 120 seconds");
    }
}

// ─── Provider Factory ───────────────────────────────────────────────────────

const openaiProvider = new OpenAIProvider();
const replicateProvider = new ReplicateProvider();

const registry: Record<string, AIProviderImplementation> = {
    "openai": openaiProvider,
    "dall-e": openaiProvider,
    "dall-e-3": openaiProvider,
};

// All Replicate-backed model IDs
const REPLICATE_MODEL_IDS = [
    "flux-schnell", "flux-dev", "flux-1.1-pro", "flux-pro",
    "seedream", "nano-banana", "nano-banana-2", "nano-banana-pro",
    "flux-fill", "rembg",
    // Aliases from UI
    "flux", "seadream",
];

export function getProvider(modelId: string): AIProviderImplementation {
    if (registry[modelId]) return registry[modelId];
    if (REPLICATE_MODEL_IDS.includes(modelId)) return replicateProvider;
    // Default: if the key mentions "gpt" → OpenAI, otherwise try Replicate
    if (modelId.startsWith("gpt")) return openaiProvider;
    return replicateProvider;
}
