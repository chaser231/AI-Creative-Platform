import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateWithFallback } from "@/lib/ai-providers";

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

describe("FalProvider — Bria outpaint", () => {
    it("forwards exact Bria geometry, seed, negative prompt, and no aspect ratio", async () => {
        mockFetch.mockResolvedValueOnce(
            okJson({ image: { url: "https://fal.media/expanded.png" }, seed: 123 }),
        );

        const res = await generateWithFallback({
            prompt: "Naturally extend the studio background",
            type: "outpainting",
            model: "bria-expand",
            imageBase64: "https://storage.yandexcloud.net/acp/source.png",
            originalSize: [320, 180],
            expandPadding: { top: 20, right: 30, bottom: 40, left: 10 },
            negativePrompt: "artifacts, warped subject",
            seed: 42,
            disableFallback: true,
        });

        expect(res.content).toBe("https://fal.media/expanded.png");
        expect(res.model).toBe("bria-expand");
        expect(res.seed).toBe(123);
        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://queue.fal.run/fal-ai/bria/expand");
        const body = JSON.parse(init.body as string);
        expect(body).toMatchObject({
            image_url: "https://storage.yandexcloud.net/acp/source.png",
            prompt: "Naturally extend the studio background",
            negative_prompt: "artifacts, warped subject",
            canvas_size: [360, 240],
            original_image_location: [10, 20],
            original_image_size: [320, 180],
            seed: 42,
        });
        expect(body.aspect_ratio).toBeUndefined();
    });

    it("does not retry provider or sibling models when disableFallback is true", async () => {
        mockFetch.mockResolvedValueOnce(errText(422, "validation failed"));

        await expect(generateWithFallback({
            prompt: "extend",
            type: "outpainting",
            model: "bria-expand",
            imageBase64: "https://storage.yandexcloud.net/acp/source.png",
            originalSize: [320, 180],
            expandPadding: { top: 20, right: 30, bottom: 40, left: 10 },
            disableFallback: true,
        })).rejects.toThrow(/fal.ai outpaint submit failed \(422\)/);

        expect(mockFetch).toHaveBeenCalledTimes(1);
    });
});
