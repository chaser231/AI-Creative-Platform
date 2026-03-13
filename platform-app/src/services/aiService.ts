"use client";

/**
 * AI Service — mock providers + pipeline architecture.
 *
 * Uses adapter pattern: swap MockTextProvider / MockImageProvider
 * with real YandexGPT / Kandinsky later without touching UI.
 */


import type { BusinessUnit } from "@/types";

// ─── Types ──────────────────────────────────────────────

export interface AIProvider {
    id: string;
    name: string;
    type: "text" | "image" | "outpainting";
    generate: (prompt: string, params?: Record<string, unknown>) => Promise<AIResult>;
}

export interface AIResult {
    type: "text" | "image" | "outpainting";
    content: string;       // text result or base64 data URL
    prompt: string;        // original prompt
    model: string;         // provider name
    timestamp: Date;
}

export interface AIStep {
    type: "text-gen" | "image-gen";
    prompt: string;
    model?: string;        // optional provider override
    params?: Record<string, unknown>;
}

export interface AIPipeline {
    id: string;
    name: string;
    steps: AIStep[];
}

// ─── Remote Provider ─────────────────────────────────────

async function callAIApi(prompt: string, type: string, model: string, params: any = {}): Promise<AIResult> {
    const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, type, model, params }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "AI Generation Failed");
    }

    const data = await response.json();
    return {
        type: data.type || type, // fallback
        content: data.content,
        prompt: prompt,
        model: data.model,
        timestamp: new Date(),
    };
}

export const RemoteTextProvider: AIProvider = {
    id: "remote-text",
    name: "Remote Text API",
    type: "text",
    generate: async (prompt, params) => {
        // Use params.model if specified, otherwise default
        const model = (params?.model as string) || "openai";
        return callAIApi(prompt, "text", model, params);
    },
};

export const RemoteImageProvider: AIProvider = {
    id: "remote-image",
    name: "Remote Image API",
    type: "image",
    generate: async (prompt, params) => {
        // Use params.model if specified, otherwise default
        const model = (params?.model as string) || "gemini-nano";
        return callAIApi(prompt, "image", model, params);
    },
};

// ─── Business Unit Contexts ─────────────────────────────

export function getSystemPromptForBU(bu: BusinessUnit, type: "text" | "image"): string {
    if (type === "text") {
        switch (bu) {
            case "yandex-market":
                return "Ты профессиональный копирайтер Яндекс Маркета. Пиши кратко, динамично и продающе. Используй призыв к покупке. Тон: дружелюбный и выгодный.";
            case "yandex-food":
            case "yandex-go": // Treating go/food similarly for now or separate
                return "Ты копирайтер Яндекс Еды / Лавки. Твои тексты вызывают аппетит и желание заказать прямо сейчас. Пиши вкусно, с заботой, но очень емко.";
            default:
                return "Ты рекламный копирайтер. Пиши броские и лаконичные рекламные тексты для баннеров.";
        }
    } else {
        // Image generation prompts
        switch (bu) {
            case "yandex-market":
                return "Продуктовая фотография студийного качества, яркий сплошной фон (желтый или контрастный), товар по центру, реалистично, высокое разрешение, 4k, студийный свет.";
            case "yandex-food":
                return "Вкусная еда крупным планом, теплый свет, аппетитно, профессиональная фуд-фотография, боке, глубина резкости, 8k, photorealistic.";
            default:
                return "Высококачественное изображение для рекламы, эстетично, профессионально, студийный свет, 4k.";
        }
    }
}

// ─── Pipeline runner ────────────────────────────────────

const providers: Record<string, AIProvider> = {
    "text": RemoteTextProvider,
    "image": RemoteImageProvider,
};

export async function runPipeline(
    pipeline: AIPipeline,
    context: Record<string, string> = {},
): Promise<AIResult[]> {
    const results: AIResult[] = [];
    const vars: Record<string, string> = { ...context };

    for (let i = 0; i < pipeline.steps.length; i++) {
        const step = pipeline.steps[i];

        // Interpolate variables in prompt: {{tov}}, {{previous_text}}, etc.
        let interpolated = step.prompt;
        for (const [key, val] of Object.entries(vars)) {
            interpolated = interpolated.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val);
        }

        const type = step.type === "text-gen" ? "text" : "image";
        const provider = providers[type];

        if (!provider) throw new Error(`Unknown AI provider type: ${type}`);

        const result = await provider.generate(interpolated, {
            model: step.model,
            ...step.params
        });

        results.push(result);

        // Store result for use in subsequent steps
        vars[`step_${i}_result`] = result.content;
        if (result.type === "text") {
            vars["previous_text"] = result.content;
        }
    }

    return results;
}
