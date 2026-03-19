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
        body: JSON.stringify({ prompt, type, model, ...params }),
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
        const model = (params?.model as string) || "flux-schnell";
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

// ─── Text Generation Presets ────────────────────────────

import type { TextGenPreset } from "@/types";

const PRESET_INSTRUCTIONS: Record<TextGenPreset, string> = {
    selling: "Пиши продающе, с призывом к действию и акцентом на выгоду. Текст должен мотивировать на покупку.",
    informational: "Пиши информативно, нейтрально, с фокусом на факты и характеристики.",
    emotional: "Пиши эмоционально, используй яркие образы и метафоры, вызывай эмоции.",
    short: "Пиши максимально кратко — не более 2-3 слов.",
    long: "Пиши развёрнуто — 1-2 предложения с деталями и описанием.",
};

/**
 * Generate multiple text variants for a single field.
 * Returns an array of `count` text variants.
 */
export async function generateTextVariants(
    userPrompt: string,
    fieldName: string,
    count: number = 3,
    bu?: BusinessUnit,
    preset?: TextGenPreset,
): Promise<string[]> {
    const buContext = bu ? getSystemPromptForBU(bu, "text") : "";
    const presetInstr = preset ? PRESET_INSTRUCTIONS[preset] : "";

    const systemPrompt = [
        buContext,
        presetInstr,
        `Сгенерируй ровно ${count} вариант${count > 1 ? "ов" : ""} текста для элемента «${fieldName}».`,
        `Каждый вариант на отдельной строке. Без нумерации, без кавычек, без пояснений.`,
        `Только текст элемента — больше ничего.`,
    ].filter(Boolean).join("\n");

    const result = await RemoteTextProvider.generate(
        `${systemPrompt}\n\nЗапрос пользователя: ${userPrompt}`,
        { model: "openai" },
    );

    const variants = result.content
        .split("\n")
        .map((s: string) => s.replace(/^\d+[\.\)]\s*/, "").replace(/^["«]|["»]$/g, "").trim())
        .filter((s: string) => s.length > 0);

    // Pad or truncate to exactly `count`
    while (variants.length < count) variants.push(variants[0] || fieldName);
    return variants.slice(0, count);
}

/**
 * Coordinated generation for a group of linked text fields.
 *
 * Example: a frame with groupSlotId="hero" containing headline + subheadline.
 * The AI generates all fields in one call so they are thematically consistent.
 *
 * @param fields — array of { id, name, role } for each text slot in the group
 * @param userPrompt — high-level user description
 * @param bu — business unit for TOV
 * @param preset — optional style preset
 * @returns Record<fieldId, string> with generated text for each field
 */
export async function generateTextGroup(
    fields: { id: string; name: string }[],
    userPrompt: string,
    bu?: BusinessUnit,
    preset?: TextGenPreset,
): Promise<Record<string, string>> {
    const buContext = bu ? getSystemPromptForBU(bu, "text") : "";
    const presetInstr = preset ? PRESET_INSTRUCTIONS[preset] : "";

    const fieldList = fields.map((f, i) => `${i + 1}. ${f.name}`).join("\n");

    const systemPrompt = [
        buContext,
        presetInstr,
        `Тебе нужно сгенерировать согласованный набор текстов для рекламного баннера.`,
        `Все тексты должны быть тематически связаны между собой.`,
        `Список полей:\n${fieldList}`,
        `\nОтветь СТРОГО в формате:\nПОЛЕ_1: <текст>\nПОЛЕ_2: <текст>\n...`,
        `Без кавычек, без дополнительных пояснений.`,
    ].filter(Boolean).join("\n");

    const result = await RemoteTextProvider.generate(
        `${systemPrompt}\n\nЗапрос пользователя: ${userPrompt}`,
        { model: "openai" },
    );

    // Parse "ПОЛЕ_N: text" format
    const lines = result.content.split("\n").filter((s: string) => s.trim());
    const output: Record<string, string> = {};

    for (let i = 0; i < fields.length; i++) {
        const line = lines[i];
        if (line) {
            // Remove "ПОЛЕ_N: " or "1. " prefix if present
            const cleaned = line
                .replace(/^ПОЛЕ_\d+:\s*/i, "")
                .replace(/^\d+[\.\)]\s*/, "")
                .replace(/^["«]|["»]$/g, "")
                .trim();
            output[fields[i].id] = cleaned;
        } else {
            output[fields[i].id] = fields[i].name; // fallback
        }
    }

    return output;
}

