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
            apiKey: process.env.OPENAI_API_KEY || "dummy", // Fail gracefully if missing
            dangerouslyAllowBrowser: false,
        });
    }

    async generate(params: AIRequestParams): Promise<AIResponse> {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error("OpenAI API Key is not configured");
        }

        if (params.type === "text") {
            return this.generateText(params);
        } else if (params.type === "image") {
            return this.generateImage(params);
        } else if (params.type === "inpainting" || params.type === "outpainting") {
            return this.editImage(params);
        }

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

        if (!url) {
            throw new Error("No image URL returned from OpenAI");
        }

        return {
            content: url,
            format: "url",
            model: "dall-e-3",
            provider: "openai",
        };
    }
    private async editImage(params: AIRequestParams): Promise<AIResponse> {
        // Note: DALL-E 2 supports edit, but DALL-E 3 does not yet via API.
        // We will simulate or attempt to use DALL-E 2 if selected, but for now we throw
        // or return a mock if specifically requesting outpainting via OpenAI as it's limited.
        throw new Error("OpenAI DALL-E 3 does not support inpainting/outpainting via API yet.");
    }
}

// ─── Mock/Placeholder Providers ─────────────────────────────────────────────
// These will be replaced by real implementations using specific SDKs or REST calls
// (e.g. Yandex Cloud API, Fal.ai client, Replicate, etc.)

class MockProvider implements AIProviderImplementation {
    constructor(public id: string, public name: string) { }

    async generate(params: AIRequestParams): Promise<AIResponse> {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Simulate latency

        if (params.type === "text") {
            return {
                content: `[${this.name}] Generated text for: "${params.prompt}"`,
                format: "text",
                model: this.id,
                provider: this.id,
            };
        } else {
            // Return a placeholder image
            const color = "#" + Math.floor(Math.random() * 16777215).toString(16);
            const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${params.width || 1024}" height="${params.height || 1024}" viewBox="0 0 512 512">
            <rect width="512" height="512" fill="${color}"/>
            <text x="50%" y="50%" font-family="sans-serif" font-size="24" fill="white" text-anchor="middle">
                ${this.name} (${params.type})
            </text>
        </svg>`;
            const base64 = Buffer.from(svg).toString("base64");
            return {
                content: `data:image/svg+xml;base64,${base64}`,
                format: "base64", // Using base64 for consistency in mock
                model: this.id,
                provider: this.id,
            };
        }
    }
}

// ─── Provider Factory ───────────────────────────────────────────────────────

const registry: Record<string, AIProviderImplementation> = {
    openai: new OpenAIProvider(),
    alice: new MockProvider("alice", "Yandex Alice"),
    "gemini-nano": new MockProvider("gemini-nano", "Gemini Nano"),
    flux: new MockProvider("flux", "Flux 2.0"),
    seadream: new MockProvider("seadream", "SeaDream 4.5"),
    "gpt-image": new MockProvider("gpt-image", "GPT Image 1.5"),
    "flux-fill": new MockProvider("flux-fill", "Flux Fill"),
    "bria-expand": new MockProvider("bria-expand", "Bria AI"),
    "fal-outpaint": new MockProvider("fal-outpaint", "Fal.ai Outpaint"),
    "luma-photon-outpaint": new MockProvider("luma-photon-outpaint", "Luma Photon"),
};

export function getProvider(modelId: string): AIProviderImplementation {
    // Simple mapping: if model starts with "gpt" -> openai, etc.
    // For now we use precise IDs from the registry.
    // If modelId is not found, default to OpenAI or throw.

    if (modelId.startsWith("gpt-4") || modelId.startsWith("dall-e")) {
        return registry["openai"];
    }

    return registry[modelId] || registry["openai"];
}
