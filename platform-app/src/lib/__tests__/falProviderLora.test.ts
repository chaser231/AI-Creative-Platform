import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateWithFallback } from "@/lib/ai-providers";

/**
 * FalProvider.generateLora end-to-end test.
 *
 * Mocks `fetch` so we can inspect exactly what hits fal.ai when the user
 * picks a LoRA-aware model. Verifies endpoint mapping, payload shape
 * (LoRA array, guidance/steps clamping, acceleration & negative prompt
 * gating) and that the parsed response makes it back to callers.
 *
 * We deliberately exercise `generateWithFallback` (the public entry
 * point) instead of stubbing `FalProvider` directly — that's what
 * /api/ai/generate, /api/ai/image-edit and executeAction all call, so
 * the test guards the full pipe.
 */

const originalFetch = globalThis.fetch;
const mockFetch = vi.fn();

beforeEach(() => {
    process.env.FAL_KEY = "test-key";
    mockFetch.mockReset();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function okJson(body: unknown): Response {
    return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as unknown as Response;
}

describe("FalProvider — LoRA-aware generate path", () => {
    it("flux-lora: routes to fal-ai/flux-lora and forwards LoRA + guidance/steps", async () => {
        // Synchronous response (no request_id) so we don't need to poll.
        mockFetch.mockResolvedValueOnce(
            okJson({ images: [{ url: "https://fal.media/out.png", width: 1024, height: 1024 }] }),
        );

        const res = await generateWithFallback({
            prompt: "cinematic portrait",
            type: "image",
            model: "flux-lora",
            aspectRatio: "1:1",
            loras: [
                { path: "https://huggingface.co/foo/bar.safetensors", scale: 0.85 },
            ],
            guidanceScale: 4.0,
            numInferenceSteps: 30,
        });

        expect(res.content).toBe("https://fal.media/out.png");
        expect(res.model).toBe("flux-lora");

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://queue.fal.run/fal-ai/flux-lora");

        const body = JSON.parse(init.body as string);
        expect(body.prompt).toBe("cinematic portrait");
        expect(body.image_size).toBeTruthy();
        expect(body.guidance_scale).toBe(4.0);
        expect(body.num_inference_steps).toBe(30);
        expect(body.loras).toEqual([
            { path: "https://huggingface.co/foo/bar.safetensors", scale: 0.85 },
        ]);
    });

    it("returns all fal image URLs and forwards requested image count", async () => {
        mockFetch.mockResolvedValueOnce(
            okJson({
                images: [
                    { url: "https://fal.media/one.png", width: 1024, height: 1024 },
                    { url: "https://fal.media/two.png", width: 1024, height: 1024 },
                ],
            }),
        );

        const res = await generateWithFallback({
            prompt: "product photo",
            type: "image",
            model: "flux-lora",
            count: 2,
        });

        expect(res.content).toBe("https://fal.media/one.png");
        expect(res.contents).toEqual([
            "https://fal.media/one.png",
            "https://fal.media/two.png",
        ]);

        const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(init.body as string);
        expect(body.num_images).toBe(2);
    });

    it("clamps guidance/steps that exceed the spec range", async () => {
        mockFetch.mockResolvedValueOnce(
            okJson({ images: [{ url: "https://fal.media/x.png" }] }),
        );

        await generateWithFallback({
            prompt: "x",
            type: "image",
            model: "flux-lora",
            // flux-lora spec: guidance 0..35, steps 1..50 (see lib/ai-models)
            guidanceScale: 999,
            numInferenceSteps: 999,
        });

        const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(init.body as string);
        expect(body.guidance_scale).toBeLessThanOrEqual(35);
        expect(body.num_inference_steps).toBeLessThanOrEqual(50);
    });

    it("caps loras to spec.maxCount and defaults missing scale to 1", async () => {
        mockFetch.mockResolvedValueOnce(
            okJson({ images: [{ url: "https://fal.media/x.png" }] }),
        );

        await generateWithFallback({
            prompt: "x",
            type: "image",
            model: "flux-lora", // maxCount: 2
            loras: [
                { path: "https://x/a.safetensors" },
                { path: "https://x/b.safetensors", scale: 0.5 },
                { path: "https://x/c.safetensors" },
                { path: "https://x/d.safetensors" },
            ],
        });

        const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(init.body as string);
        expect(body.loras).toHaveLength(2);
        expect(body.loras[0]).toEqual({ path: "https://x/a.safetensors", scale: 1 });
        expect(body.loras[1]).toEqual({ path: "https://x/b.safetensors", scale: 0.5 });
    });

    it("qwen-image-edit-lora: uses edit endpoint, attaches image_url, accepts negativePrompt", async () => {
        mockFetch.mockResolvedValueOnce(
            okJson({ images: [{ url: "https://fal.media/edited.png" }] }),
        );

        await generateWithFallback({
            prompt: "make the sky purple",
            type: "edit",
            model: "qwen-image-edit-lora",
            imageBase64: "https://cdn.example.com/source.png",
            negativePrompt: "blurry, low quality",
            acceleration: "regular",
            loras: [{ path: "https://huggingface.co/q/edit.safetensors" }],
        });

        const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        // Whatever exact endpoint Qwen Image Edit LoRA maps to, it must
        // contain "qwen-image-edit" — the edit-flavoured endpoint, not the
        // text-to-image one.
        expect(url).toContain("qwen-image-edit");

        const body = JSON.parse(init.body as string);
        expect(body.image_url).toBe("https://cdn.example.com/source.png");
        expect(body.prompt).toBe("make the sky purple");
        expect(body.negative_prompt).toBe("blurry, low quality");
        expect(body.acceleration).toBe("regular");
        expect(body.loras).toHaveLength(1);
    });

    it("respects spec.acceleration whitelist (silently drops unsupported value)", async () => {
        mockFetch.mockResolvedValueOnce(
            okJson({ images: [{ url: "https://fal.media/x.png" }] }),
        );

        // flux-lora has supportsAcceleration: false, so any acceleration
        // value should be dropped before hitting the wire.
        await generateWithFallback({
            prompt: "x",
            type: "image",
            model: "flux-lora",
            acceleration: "high",
        });

        const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(init.body as string);
        expect(body.acceleration).toBeUndefined();
    });
});

describe("FalProvider — native fal multi-output payloads", () => {
    it.each([
        ["nano-banana-2", "fal-ai/nano-banana-2", 3],
        ["gpt-image-2", "openai/gpt-image-2", 4],
        ["seedream-5", "fal-ai/bytedance/seedream/v5/lite/text-to-image", 6],
    ])("sends num_images for %s", async (model, expectedEndpoint, count) => {
        mockFetch.mockResolvedValueOnce(
            okJson({ images: [{ url: `https://fal.media/${model}.png`, width: 1024, height: 1024 }] }),
        );

        await generateWithFallback({
            prompt: "product photo",
            type: "image",
            model,
            count,
        });

        const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toContain(expectedEndpoint);

        const body = JSON.parse(init.body as string);
        expect(body.num_images).toBe(count);
    });
});
