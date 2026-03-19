import OpenAI from "openai";

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface AIRequestParams {
    prompt: string;
    type: "text" | "image" | "inpainting" | "outpainting";
    model?: string;
    // Context for text generation
    context?: string;
    // Image generation params
    width?: number;
    height?: number;
    count?: number;
    seed?: number;
    scale?: string;
    referenceImages?: string[];
    // Inpainting/Outpainting params
    imageBase64?: string;
    maskBase64?: string;
}

export interface AIResponse {
    content: string; // Text response or Image URL/Base64
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
        if (params.type === "inpainting" || params.type === "outpainting") return this.editImage(params);

        throw new Error(`Unsupported generation type: ${params.type}`);
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
        const response = await this.client.images.generate({
            model: "dall-e-3",
            prompt: params.prompt,
            n: 1,
            size: "1024x1024",
            response_format: "url",
        });

        const url = response.data?.[0]?.url;
        if (!url) throw new Error("No image URL returned from OpenAI");

        return { content: url, format: "url", model: "dall-e-3", provider: "openai" };
    }

    private async editImage(_params: AIRequestParams): Promise<AIResponse> {
        throw new Error("OpenAI DALL-E 3 does not support inpainting via API yet.");
    }
}

// ─── Replicate Provider ──────────────────────────────────────────────────────
// Supports: nano-banana family, flux, seadream, qwen

class ReplicateProvider implements AIProviderImplementation {
    id = "replicate";
    name = "Replicate";

    // Model version map — use short IDs mapped to Replicate model slugs
    private readonly MODEL_VERSIONS: Record<string, string> = {
        "nano-banana": "black-forest-labs/flux-schnell",
        "nano-banana-2": "black-forest-labs/flux-dev",
        "nano-banana-pro": "black-forest-labs/flux-1.1-pro",
        "flux": "black-forest-labs/flux-schnell",
        "seadream": "stability-ai/stable-diffusion-3.5-large",
        "qwen-edit": "zsxkib/mflux",
    };

    private getModelSlug(modelId: string): string {
        return this.MODEL_VERSIONS[modelId] || this.MODEL_VERSIONS["nano-banana"];
    }

    async generate(params: AIRequestParams): Promise<AIResponse> {
        const apiToken = process.env.REPLICATE_API_TOKEN;
        if (!apiToken) {
            throw new Error("Replicate API token not configured. Set REPLICATE_API_TOKEN in .env.local");
        }

        const modelSlug = this.getModelSlug(params.model || "nano-banana");
        const input: Record<string, unknown> = { prompt: params.prompt };

        // Set dimensions from aspect ratio if provided
        if (params.width) input.width = params.width;
        if (params.height) input.height = params.height;
        if (params.seed) input.seed = params.seed;

        // Reference images for multi-image generation
        if (params.referenceImages && params.referenceImages.length > 0) {
            input.image = params.referenceImages[0]; // First reference image
        }

        // Run prediction via Replicate REST API
        const createRes = await fetch(`https://api.replicate.com/v1/models/${modelSlug}/predictions`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiToken}`,
                "Content-Type": "application/json",
                "Prefer": "wait", // Wait for result inline (up to 60s)
            },
            body: JSON.stringify({ input }),
        });

        if (!createRes.ok) {
            const err = await createRes.text();
            throw new Error(`Replicate API error: ${err}`);
        }

        const prediction = await createRes.json();

        // If result came back inline (Prefer: wait)
        if (prediction.output) {
            const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
            return { content: output as string, format: "url", model: modelSlug, provider: "replicate" };
        }

        // Poll for result
        const predictionId = prediction.id;
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
                headers: { "Authorization": `Bearer ${apiToken}` },
            });
            const poll = await pollRes.json();
            if (poll.status === "succeeded") {
                const output = Array.isArray(poll.output) ? poll.output[0] : poll.output;
                return { content: output as string, format: "url", model: modelSlug, provider: "replicate" };
            }
            if (poll.status === "failed" || poll.status === "canceled") {
                throw new Error(`Replicate prediction ${poll.status}: ${poll.error || "unknown error"}`);
            }
        }

        throw new Error("Replicate prediction timed out after 60 seconds");
    }
}

// ─── GPT-Image Provider (OpenAI gpt-image-1) ────────────────────────────────

class GPTImageProvider implements AIProviderImplementation {
    id = "gpt-image";
    name = "GPT Image 1.5";
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

        const response = await this.client.images.generate({
            model: "gpt-image-1",
            prompt: params.prompt,
            n: 1,
            size: "1024x1024",
        });

        const b64 = response.data?.[0]?.b64_json;
        if (!b64) throw new Error("No image data returned from GPT Image");

        return { content: `data:image/png;base64,${b64}`, format: "base64", model: "gpt-image-1", provider: "openai" };
    }
}

// ─── Provider Factory ───────────────────────────────────────────────────────

const replicateProvider = new ReplicateProvider();
const gptImageProvider = new GPTImageProvider();

const registry: Record<string, AIProviderImplementation> = {
    "openai": new OpenAIProvider(),
    "dall-e": new OpenAIProvider(),
    "gpt-image": gptImageProvider,
    "gpt-image-15": gptImageProvider,
    "nano-banana": replicateProvider,
    "nano-banana-2": replicateProvider,
    "nano-banana-pro": replicateProvider,
    "flux": replicateProvider,
    "seadream": replicateProvider,
    "qwen-edit": replicateProvider,
};

export function getProvider(modelId: string): AIProviderImplementation {
    if (modelId.startsWith("gpt-4") || modelId === "dall-e-3") {
        return registry["openai"];
    }
    if (modelId.startsWith("nano-banana") || modelId === "flux" || modelId === "seadream" || modelId === "qwen-edit") {
        return replicateProvider;
    }
    return registry[modelId] || registry["openai"];
}
