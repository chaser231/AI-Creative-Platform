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
    applyBlur,
    applyMask,
    tryWithFallback,
    uploadFromExternalUrl,
} from "../helpers";
import sharp from "sharp";
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

// ─── applyMask / applyBlur (sharp-based) ───────────────────────────────────

async function makeOpaqueRgbBuffer(w = 32, h = 32): Promise<Buffer> {
    return sharp({
        create: {
            width: w,
            height: h,
            channels: 3,
            background: { r: 200, g: 100, b: 50 },
        },
    })
        .png()
        .toBuffer();
}

describe("applyMask", () => {
    it("produces a 4-channel PNG and modulates alpha along the gradient", async () => {
        const input = await makeOpaqueRgbBuffer(32, 32);

        const out = await applyMask(input, {
            direction: "top-to-bottom",
            start: 1,
            end: 0,
        });
        const meta = await sharp(out).metadata();
        expect(meta.channels).toBe(4);
        expect(meta.format).toBe("png");

        // Sample the raw RGBA buffer: top row should be opaque, bottom row
        // transparent (within tolerance — the SVG renderer interpolates at
        // the pixel center, not the edge).
        const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
        const stride = info.width * info.channels;
        const topAlpha = data[3]; // first pixel, alpha channel
        const bottomAlpha = data[(info.height - 1) * stride + 3];
        expect(topAlpha).toBeGreaterThan(220);
        expect(bottomAlpha).toBeLessThan(40);
    });

    it("supports inverted gradient (start=0 end=1)", async () => {
        const input = await makeOpaqueRgbBuffer(32, 32);
        const out = await applyMask(input, {
            direction: "top-to-bottom",
            start: 0,
            end: 1,
        });
        const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
        const stride = info.width * info.channels;
        const topAlpha = data[3];
        const bottomAlpha = data[(info.height - 1) * stride + 3];
        expect(topAlpha).toBeLessThan(40);
        expect(bottomAlpha).toBeGreaterThan(220);
    });
});

describe("applyBlur", () => {
    it("uniform mode: returns a PNG with same dimensions", async () => {
        const input = await makeOpaqueRgbBuffer(40, 40);
        const out = await applyBlur(input, { mode: "uniform", intensity: 5 });
        const meta = await sharp(out).metadata();
        expect(meta.format).toBe("png");
        expect(meta.width).toBe(40);
        expect(meta.height).toBe(40);
    });

    it("uniform mode with intensity 0 is a no-op pass-through", async () => {
        const input = await makeOpaqueRgbBuffer(20, 20);
        const out = await applyBlur(input, { mode: "uniform", intensity: 0 });
        expect((await sharp(out).metadata()).format).toBe("png");
    });

    it("progressive mode: returns same-dimension PNG", async () => {
        const input = await makeOpaqueRgbBuffer(40, 40);
        const out = await applyBlur(input, {
            mode: "progressive",
            direction: "top-to-bottom",
            start: 0,
            end: 8,
        });
        const meta = await sharp(out).metadata();
        expect(meta.format).toBe("png");
        expect(meta.width).toBe(40);
        expect(meta.height).toBe(40);
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
