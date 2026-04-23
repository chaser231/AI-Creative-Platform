import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invokeFalModel } from "@/lib/ai-providers";

// ─── Global fetch mock ────────────────────────────────────────────────
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

function errJson(status: number, body: string): Response {
    return {
        ok: false,
        status,
        json: async () => ({ error: body }),
        text: async () => body,
    } as unknown as Response;
}

describe("invokeFalModel", () => {
    it("sync-response: returns image URL from { image: { url } } shape (bria rmbg)", async () => {
        // bria/background/remove often returns synchronously with no request_id.
        mockFetch.mockResolvedValueOnce(
            okJson({ image: { url: "https://fal.media/out.png" } }),
        );

        const res = await invokeFalModel("bria-rmbg", {
            image_url: "https://cdn.example.com/in.png",
        });

        expect(res.output).toBe("https://fal.media/out.png");
        expect(res.model).toBe("fal-ai/bria/background/remove");
        expect(res.costUsd).toBeGreaterThanOrEqual(0);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://queue.fal.run/fal-ai/bria/background/remove");
        expect((init.headers as Record<string, string>).Authorization).toBe("Key test-key");
    });

    it("queued-response: submits, polls, fetches result (images[0].url shape)", async () => {
        // 1) submit returns request_id + URLs
        mockFetch.mockResolvedValueOnce(
            okJson({
                request_id: "req_123",
                status_url: "https://queue.fal.run/x/status",
                response_url: "https://queue.fal.run/x/result",
            }),
        );
        // 2) first poll → IN_PROGRESS
        mockFetch.mockResolvedValueOnce(okJson({ status: "IN_PROGRESS" }));
        // 3) second poll → COMPLETED
        mockFetch.mockResolvedValueOnce(okJson({ status: "COMPLETED" }));
        // 4) result fetch
        mockFetch.mockResolvedValueOnce(
            okJson({ images: [{ url: "https://fal.media/img.png", width: 1024, height: 1024 }] }),
        );

        // Fake timers so we don't actually wait 4s.
        vi.useFakeTimers();
        const promise = invokeFalModel("bria-rmbg", { image_url: "https://cdn/x.png" });
        await vi.advanceTimersByTimeAsync(6000);
        const res = await promise;
        vi.useRealTimers();

        expect(res.output).toBe("https://fal.media/img.png");
        expect(res.model).toBe("fal-ai/bria/background/remove");
        expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("throws when FAL_KEY is not set", async () => {
        delete process.env.FAL_KEY;
        await expect(
            invokeFalModel("bria-rmbg", { image_url: "https://cdn/x.png" }),
        ).rejects.toThrow(/fal.ai API key not configured/);
    });

    it("throws on unknown modelId", async () => {
        await expect(
            invokeFalModel("nonexistent-model-xyz", { image_url: "https://cdn/x.png" }),
        ).rejects.toThrow(/Unknown model/);
    });

    it("throws on submit failure with status + body snippet", async () => {
        mockFetch.mockResolvedValueOnce(errJson(401, "Invalid API key"));
        await expect(
            invokeFalModel("bria-rmbg", { image_url: "https://cdn/x.png" }),
        ).rejects.toThrow(/fal.ai submit failed \(401\)/);
    });

    it("throws on FAILED status from poll", async () => {
        mockFetch.mockResolvedValueOnce(okJson({ request_id: "r", status_url: "s", response_url: "r" }));
        mockFetch.mockResolvedValueOnce(okJson({ status: "FAILED", error: "nsfw content" }));

        vi.useFakeTimers();
        const promise = invokeFalModel("bria-rmbg", { image_url: "https://cdn/x.png" });
        promise.catch(() => { /* swallow unhandled */ });
        await vi.advanceTimersByTimeAsync(3000);
        vi.useRealTimers();

        await expect(promise).rejects.toThrow(/fal.ai prediction failed.*nsfw content/);
    });

    it("throws when response has no image URL in any known shape", async () => {
        // Synchronous response but with unrecognised shape
        mockFetch.mockResolvedValueOnce(okJson({ foo: "bar" }));

        await expect(
            invokeFalModel("bria-rmbg", { image_url: "https://cdn/x.png" }),
        ).rejects.toThrow(/no image URL in response/);
    });
});
