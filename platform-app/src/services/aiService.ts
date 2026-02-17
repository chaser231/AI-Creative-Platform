"use client";

/**
 * AI Service — mock providers + pipeline architecture.
 *
 * Uses adapter pattern: swap MockTextProvider / MockImageProvider
 * with real YandexGPT / Kandinsky later without touching UI.
 */

// ─── Types ──────────────────────────────────────────────

export interface AIProvider {
    id: string;
    name: string;
    type: "text" | "image";
    generate: (prompt: string, params?: Record<string, unknown>) => Promise<AIResult>;
}

export interface AIResult {
    type: "text" | "image";
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

// ─── Mock providers ─────────────────────────────────────

const MOCK_TEXT_RESPONSES = [
    "Откройте для себя новые возможности! Специальное предложение — только сегодня.",
    "Быстрая доставка за 15 минут. Попробуйте прямо сейчас!",
    "Лучшие товары по выгодным ценам. Скидка до 50% на всё.",
    "Новый сезон — новый стиль. Обновите гардероб с нами.",
    "Качество, которому доверяют. Более 10 000 довольных клиентов.",
    "Удобный выбор, быстрый заказ, надёжная доставка.",
    "Только у нас — эксклюзивные коллекции от ведущих брендов.",
    "Создавайте вкус каждый день. Свежие продукты к вашему столу.",
];

const MOCK_IMAGE_COLORS = [
    "#6366F1", "#EC4899", "#14B8A6", "#F59E0B", "#8B5CF6",
    "#EF4444", "#06B6D4", "#84CC16",
];

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Generates a mock SVG data URL as placeholder image */
function generateMockImage(prompt: string, color: string): string {
    const shortPrompt = prompt.slice(0, 40);
    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
        <defs>
            <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:${color};stop-opacity:0.9"/>
                <stop offset="100%" style="stop-color:${color};stop-opacity:0.5"/>
            </linearGradient>
        </defs>
        <rect width="512" height="512" rx="16" fill="url(#bg)"/>
        <text x="256" y="240" font-family="Inter,sans-serif" font-size="18" fill="white" text-anchor="middle" opacity="0.8">AI Generated</text>
        <text x="256" y="280" font-family="Inter,sans-serif" font-size="14" fill="white" text-anchor="middle" opacity="0.6">${shortPrompt}</text>
    </svg>`.trim();
    return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export const MockTextProvider: AIProvider = {
    id: "mock-text",
    name: "Mock Text (Demo)",
    type: "text",
    generate: async (prompt) => {
        await delay(800 + Math.random() * 1200); // 0.8–2s
        const response = MOCK_TEXT_RESPONSES[Math.floor(Math.random() * MOCK_TEXT_RESPONSES.length)];
        return {
            type: "text",
            content: response,
            prompt,
            model: "Mock Text",
            timestamp: new Date(),
        };
    },
};

export const MockImageProvider: AIProvider = {
    id: "mock-image",
    name: "Mock Image (Demo)",
    type: "image",
    generate: async (prompt) => {
        await delay(1500 + Math.random() * 2000); // 1.5–3.5s
        const color = MOCK_IMAGE_COLORS[Math.floor(Math.random() * MOCK_IMAGE_COLORS.length)];
        return {
            type: "image",
            content: generateMockImage(prompt, color),
            prompt,
            model: "Mock Image",
            timestamp: new Date(),
        };
    },
};

// ─── Pipeline runner ────────────────────────────────────

const providers: Record<string, AIProvider> = {
    "mock-text": MockTextProvider,
    "mock-image": MockImageProvider,
};

export function registerProvider(provider: AIProvider): void {
    providers[provider.id] = provider;
}

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

        const providerId = step.model || (step.type === "text-gen" ? "mock-text" : "mock-image");
        const provider = providers[providerId];
        if (!provider) throw new Error(`Unknown AI provider: ${providerId}`);

        const result = await provider.generate(interpolated, step.params);
        results.push(result);

        // Store result for use in subsequent steps
        vars[`step_${i}_result`] = result.content;
        if (result.type === "text") {
            vars["previous_text"] = result.content;
        }
    }

    return results;
}
