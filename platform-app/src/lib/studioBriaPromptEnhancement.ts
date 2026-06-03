export type StudioBriaPromptEnhancementProvider = "fal-vision" | "fallback";

export interface StudioBriaPromptEnhancement {
    prompt: string;
    provider: StudioBriaPromptEnhancementProvider;
    model?: string;
}

export const STUDIO_BRIA_PROMPT_ENHANCEMENT_ENDPOINT = "openrouter/router/vision";
export const STUDIO_BRIA_PROMPT_ENHANCEMENT_MODEL = "google/gemini-2.5-flash";
export const STUDIO_BRIA_PROMPT_ENHANCEMENT_FALLBACK = "Fill seamlessly";

const MAX_ENHANCED_PROMPT_WORDS = 60;
const MAX_PROMPT_CHARS = 600;

function toAsciiPromptText(value: string | undefined): string {
    if (!value) return "";
    return value
        .replace(/[^\x20-\x7E]+/g, " ")
        .replace(/[^\w\s.,;:!?'"()/-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function unwrapLikelyJsonPrompt(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{")) return raw;
    try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const value = parsed.prompt ?? parsed.output ?? parsed.caption ?? parsed.text;
        if (typeof value === "string") return value;
    } catch {
        // Not JSON; continue with plain-text cleanup.
    }
    return raw;
}

export function sanitizeStudioBriaPromptText(value: string | undefined): string {
    return toAsciiPromptText(value).slice(0, MAX_PROMPT_CHARS);
}

export function sanitizeStudioBriaEnhancedPrompt(value: string | undefined): string {
    const unwrapped = unwrapLikelyJsonPrompt(value ?? "");
    const cleaned = toAsciiPromptText(unwrapped)
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/^[\s"'`*_>-]*(?:prompt|caption|answer|output)\s*[:=-]\s*/i, "")
        .replace(/^["'`]+|["'`]+$/g, "")
        .replace(/\b(?:change|alter|modify|move|resize|copy)\s+(?:the\s+)?original\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    return words.slice(0, MAX_ENHANCED_PROMPT_WORDS).join(" ").slice(0, MAX_PROMPT_CHARS).trim();
}

export function fallbackStudioBriaPromptEnhancement(): StudioBriaPromptEnhancement {
    return {
        prompt: STUDIO_BRIA_PROMPT_ENHANCEMENT_FALLBACK,
        provider: "fallback",
    };
}

export function buildStudioBriaVisionInstruction(userPrompt?: string): string {
    const context = userPrompt?.trim()
        ? `User context/style hint, translate or interpret into English if needed: ${userPrompt.trim()}`
        : "No user context/style hint was provided.";

    return [
        "Analyze the image for Bria Expand background outpainting.",
        "Return one short English prompt under 60 words, plain text only.",
        "Describe only extendable scene context: subject category, environment, lighting, surface/materials, depth of field, negative space, and commercial photography style.",
        "Mention visible products, logos, text, people, or foreground subjects only as protected existing foreground context.",
        "Do not ask to add new foreground objects, products, people, text, logos, packaging, labels, or brand marks.",
        "Do not instruct the model to change, copy, move, resize, recreate, or continue the original foreground subject.",
        context,
    ].join(" ");
}

export function extractFalVisionOutput(data: unknown): string {
    if (typeof data === "string") return data;
    if (!data || typeof data !== "object") return "";
    const record = data as Record<string, unknown>;

    const direct = record.output ?? record.text ?? record.content;
    if (typeof direct === "string") return direct;
    if (Array.isArray(direct)) return direct.map(String).join("");

    const nestedData = record.data;
    if (nestedData && typeof nestedData === "object") {
        const nested = nestedData as Record<string, unknown>;
        const nestedOutput = nested.output ?? nested.text ?? nested.content;
        if (typeof nestedOutput === "string") return nestedOutput;
        if (Array.isArray(nestedOutput)) return nestedOutput.map(String).join("");
    }

    const choices = record.choices;
    if (Array.isArray(choices)) {
        const first = choices[0] as Record<string, unknown> | undefined;
        const message = first?.message as Record<string, unknown> | undefined;
        const content = message?.content ?? first?.text;
        if (typeof content === "string") return content;
    }

    return "";
}
