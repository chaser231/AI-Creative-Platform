import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks — MUST be declared before module import ──────────────────────────

vi.mock("@/server/security/ssrfGuard", () => ({
    safeFetch: vi.fn(),
    uploadImagePolicy: vi.fn(() => ({ kind: "upload-image" })),
    SsrfBlockedError: class SsrfBlockedError extends Error {
        code: string;
        reason: string;
        url: string;
        constructor(code: string, reason: string, url = "") {
            super(`[SSRF:${code}] ${reason} (url=${url})`);
            this.name = "SsrfBlockedError";
            this.code = code;
            this.reason = reason;
            this.url = url;
        }
    },
}));

const s3SendMock = vi.fn();
vi.mock("@aws-sdk/client-s3", () => {
    function S3Client() {
        return { send: s3SendMock };
    }
    function PutObjectCommand(args: unknown) {
        return { __kind: "PutObject", args };
    }
    return { S3Client, PutObjectCommand };
});

// Imports resolved AFTER mocks above take effect.
import {
    buildReflectionPrompt,
    tryWithFallback,
    uploadFromExternalUrl,
} from "../helpers";
import { safeFetch, SsrfBlockedError } from "@/server/security/ssrfGuard";

const safeFetchMock = safeFetch as unknown as ReturnType<typeof vi.fn>;

function mockSafeFetchImage(options: {
    status?: number;
    contentType?: string;
    bodyBytes?: Buffer;
} = {}) {
    const status = options.status ?? 200;
    const contentType = options.contentType ?? "image/png";
    const body = options.bodyBytes ?? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xde, 0xad, 0xbe, 0xef]);
    safeFetchMock.mockResolvedValueOnce({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    });
}

// ─── tryWithFallback ────────────────────────────────────────────────────────

describe("tryWithFallback", () => {
    it("returns the first provider's result when it succeeds", async () => {
        const r = await tryWithFallback([
            { name: "a", run: async () => "A" },
            { name: "b", run: async () => "B" },
        ]);
        expect(r.result).toBe("A");
        expect(r.winner).toBe("a");
        expect(r.attempted).toEqual([]);
    });

    it("falls back to the next provider when the primary throws", async () => {
        const r = await tryWithFallback([
            { name: "primary", run: async () => { throw new Error("timeout"); } },
            { name: "secondary", run: async () => "OK" },
        ]);
        expect(r.result).toBe("OK");
        expect(r.winner).toBe("secondary");
        expect(r.attempted).toEqual(["primary"]);
    });

    it("throws aggregated error with provider names when all fail", async () => {
        await expect(
            tryWithFallback([
                { name: "alpha", run: async () => { throw new Error("E1"); } },
                { name: "beta", run: async () => { throw new Error("E2"); } },
            ]),
        ).rejects.toThrow(/All providers failed.*alpha\(E1\).*beta\(E2\)/);
    });

    it("throws when no providers are supplied", async () => {
        await expect(tryWithFallback([])).rejects.toThrow(/no providers/);
    });
});

// ─── buildReflectionPrompt ──────────────────────────────────────────────────

describe("buildReflectionPrompt", () => {
    it("includes style and intensity in the prompt", () => {
        const p = buildReflectionPrompt("subtle", 0.3);
        expect(p).toMatch(/Style: subtle/);
        expect(p).toMatch(/Opacity: 0\.30/);
        expect(p).toMatch(/transparent background/i);
    });

    it("clamps intensity below 0.1 up to 0.1", () => {
        const p = buildReflectionPrompt("subtle", 0.05);
        expect(p).toMatch(/Opacity: 0\.10/);
    });

    it("clamps intensity above 1 down to 1", () => {
        const p = buildReflectionPrompt("hard", 2);
        expect(p).toMatch(/Opacity: 1\.00/);
        expect(p).toMatch(/Style: hard/);
    });
});

// ─── uploadFromExternalUrl ──────────────────────────────────────────────────

describe("uploadFromExternalUrl", () => {
    beforeEach(() => {
        safeFetchMock.mockReset();
        s3SendMock.mockReset();
        s3SendMock.mockResolvedValue({});
        process.env.S3_ENDPOINT = "https://storage.yandexcloud.net";
        process.env.S3_BUCKET = "acp-assets";
    });

    afterEach(() => {
        delete process.env.S3_ENDPOINT;
        delete process.env.S3_BUCKET;
    });

    it("uploads an image fetched via safeFetch and returns S3 URL", async () => {
        mockSafeFetchImage({ contentType: "image/png" });
        const out = await uploadFromExternalUrl(
            "https://replicate.delivery/pbxt/abc.png",
            { workspaceId: "ws-test" },
        );
        expect(out.s3Url.startsWith("https://storage.yandexcloud.net/acp-assets/workflow-runs/ws-test/")).toBe(true);
        expect(out.s3Key.startsWith("workflow-runs/ws-test/")).toBe(true);
        expect(out.contentType).toBe("image/png");
        expect(out.sizeBytes).toBeGreaterThan(0);
        expect(s3SendMock).toHaveBeenCalledTimes(1);
    });

    it("re-throws SsrfBlockedError from safeFetch without catching", async () => {
        safeFetchMock.mockRejectedValueOnce(
            new SsrfBlockedError("IP_BLOCKED", "rfc1918", "http://10.0.0.1/x.png"),
        );
        await expect(
            uploadFromExternalUrl("http://10.0.0.1/x.png", { workspaceId: "ws-test" }),
        ).rejects.toMatchObject({ code: "IP_BLOCKED" });
        expect(s3SendMock).not.toHaveBeenCalled();
    });

    it("rejects non-image content-type from the provider", async () => {
        mockSafeFetchImage({ contentType: "text/html" });
        await expect(
            uploadFromExternalUrl("https://example.com/index.html", { workspaceId: "ws-test" }),
        ).rejects.toThrow(/Non-image content-type/);
        expect(s3SendMock).not.toHaveBeenCalled();
    });
});
