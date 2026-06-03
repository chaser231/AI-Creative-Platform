import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeStudioBriaEnhancedPrompt } from "@/lib/studioBriaPromptEnhancement";
import { enhanceStudioBriaPrompt } from "./studioBriaPromptEnhancer";

const originalFetch = globalThis.fetch;
const mockFetch = vi.fn();

beforeEach(() => {
    process.env.FAL_KEY = "test-key";
    mockFetch.mockReset();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.FAL_KEY;
});

function okJson(body: unknown): Response {
    return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as unknown as Response;
}

function errText(status: number, body: string): Response {
    return {
        ok: false,
        status,
        json: async () => ({ error: body }),
        text: async () => body,
    } as unknown as Response;
}

describe("studio Bria prompt enhancer", () => {
    it("calls fal Vision and returns sanitized English output", async () => {
        mockFetch.mockResolvedValueOnce(
            okJson({ output: "**Prompt:** \"Clean commercial studio background, soft diffused light, matte surface, shallow depth of field, generous negative space.\" " }),
        );

        const enhancement = await enhanceStudioBriaPrompt({
            imageUrl: "https://storage.yandexcloud.net/acp/source.png",
            userPrompt: "расширь в стиле дорогой предметной съемки",
        });

        expect(enhancement).toEqual({
            prompt: "Clean commercial studio background, soft diffused light, matte surface, shallow depth of field, generous negative space.",
            provider: "fal-vision",
            model: "google/gemini-2.5-flash",
        });
        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://queue.fal.run/openrouter/router/vision");
        expect((init.headers as Record<string, string>).Authorization).toBe("Key test-key");
        const body = JSON.parse(init.body as string);
        expect(body).toMatchObject({
            image_urls: ["https://storage.yandexcloud.net/acp/source.png"],
            model: "google/gemini-2.5-flash",
        });
        expect(body.prompt).toContain("Do not ask to add new foreground objects");
        expect(body.prompt).toContain("User context/style hint");
        expect(body.prompt).toContain("расширь");
    });

    it("strips JSON, quotes, markdown, non-ASCII text, and truncates long output", () => {
        const long = Array.from({ length: 80 }, (_, i) => `word${i + 1}`).join(" ");
        const prompt = sanitizeStudioBriaEnhancedPrompt(`{"prompt":"**Prompt:** '${long} русский текст ✨'"}`);

        expect(prompt.split(/\s+/)).toHaveLength(60);
        expect(prompt).not.toContain("**");
        expect(prompt).not.toContain("'");
        expect(prompt).not.toMatch(/[а-яА-ЯёЁ]/);
    });

    it("normalizes alternate fal response fields", async () => {
        mockFetch.mockResolvedValueOnce(
            okJson({ data: { output: "Minimal lifestyle background, window light, warm neutral wall, smooth stone surface, soft focus edges." } }),
        );

        const enhancement = await enhanceStudioBriaPrompt({
            imageUrl: "https://storage.yandexcloud.net/acp/source.png",
        });

        expect(enhancement.prompt).toBe("Minimal lifestyle background, window light, warm neutral wall, smooth stone surface, soft focus edges.");
        expect(enhancement.provider).toBe("fal-vision");
    });

    it("falls back without throwing when fal Vision fails", async () => {
        mockFetch.mockResolvedValueOnce(errText(500, "provider unavailable"));

        const enhancement = await enhanceStudioBriaPrompt({
            imageUrl: "https://storage.yandexcloud.net/acp/source.png",
            userPrompt: "soft background",
        });

        expect(enhancement).toEqual({
            prompt: "Fill seamlessly",
            provider: "fallback",
        });
    });
});
