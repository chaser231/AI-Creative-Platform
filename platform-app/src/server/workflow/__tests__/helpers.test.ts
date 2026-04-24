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
    it("produces a 4-channel PNG and modulates alpha across full-image band", async () => {
        const input = await makeOpaqueRgbBuffer(32, 32);

        const out = await applyMask(input, {
            direction: "top-to-bottom",
            startPos: 0,
            endPos: 1,
            startAlpha: 1,
            endAlpha: 0,
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

    it("supports inverted gradient (startAlpha=0 endAlpha=1)", async () => {
        const input = await makeOpaqueRgbBuffer(32, 32);
        const out = await applyMask(input, {
            direction: "top-to-bottom",
            startPos: 0,
            endPos: 1,
            startAlpha: 0,
            endAlpha: 1,
        });
        const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
        const stride = info.width * info.channels;
        const topAlpha = data[3];
        const bottomAlpha = data[(info.height - 1) * stride + 3];
        expect(topAlpha).toBeLessThan(40);
        expect(bottomAlpha).toBeGreaterThan(220);
    });

    it("clamps alpha outside [startPos, endPos] band (Figma parity)", async () => {
        // Band covers only top 50% of the image (top-to-bottom → startPos=0 at top).
        // Before startPos: clamped to startAlpha=1 (opaque).
        // After endPos: clamped to endAlpha=0 (transparent).
        // So: top pixel is fully opaque, middle is mid-gradient, bottom is
        // fully transparent (because we clamped), *even though the gradient
        // itself only spans the top half*.
        const input = await makeOpaqueRgbBuffer(40, 40);
        const out = await applyMask(input, {
            direction: "top-to-bottom",
            startPos: 0,
            endPos: 0.5,
            startAlpha: 1,
            endAlpha: 0,
        });
        const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
        const stride = info.width * info.channels;
        const topAlpha = data[3];
        // Row at 75% height (well past endPos=0.5): must be clamped to ~0.
        const deepBottomAlpha = data[Math.floor(info.height * 0.75) * stride + 3];
        expect(topAlpha).toBeGreaterThan(220);
        expect(deepBottomAlpha).toBeLessThan(20);
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
            startPos: 0,
            endPos: 0.8,
            startIntensity: 0,
            endIntensity: 8,
        });
        const meta = await sharp(out).metadata();
        expect(meta.format).toBe("png");
        expect(meta.width).toBe(40);
        expect(meta.height).toBe(40);
    });

    it("progressive mode degenerates safely when start === end intensity", async () => {
        const input = await makeOpaqueRgbBuffer(20, 20);
        const out = await applyBlur(input, {
            mode: "progressive",
            direction: "top-to-bottom",
            startPos: 0,
            endPos: 0.5,
            startIntensity: 4,
            endIntensity: 4,
        });
        expect((await sharp(out).metadata()).format).toBe("png");
    });

    /**
     * Regression — dark-halo / premultiplied-alpha fix.
     *
     * Baseline straight-alpha blur darkens RGB at the silhouette edge because
     * the "transparent black" zone (RGB=0, A=0) bleeds into the product's
     * colour. This test makes that bug visible as a numeric check: a bright
     * red square on a transparent background must remain bright red inside
     * the square after blur (premultiplied blur preserves the colour; only
     * the alpha feathers).
     *
     * If we ever regress to naive straight-alpha blur, the centre R drops
     * well below 200 (empirically ~80-130) → assertion fires.
     */
    it("premultiplied blur preserves colour inside the silhouette (no dark halo)", async () => {
        // 40×40 transparent canvas with a centred 20×20 opaque red square.
        const W = 40;
        const H = 40;
        const SQ = 20;
        const ox = (W - SQ) / 2;
        const oy = (H - SQ) / 2;
        const raw = Buffer.alloc(W * H * 4, 0); // RGBA, fully transparent
        for (let y = oy; y < oy + SQ; y++) {
            for (let x = ox; x < ox + SQ; x++) {
                const i = (y * W + x) * 4;
                raw[i] = 255; // R
                raw[i + 1] = 0; // G
                raw[i + 2] = 0; // B
                raw[i + 3] = 255; // A
            }
        }
        const input = await sharp(raw, { raw: { width: W, height: H, channels: 4 } })
            .png()
            .toBuffer();

        const blurred = await applyBlur(input, {
            mode: "uniform",
            intensity: 3,
        });
        const { data, info } = await sharp(blurred)
            .raw()
            .toBuffer({ resolveWithObject: true });
        expect(info.channels).toBe(4);

        // Centre pixel of the red square — after premultiplied blur, RGB
        // stays bright red (R close to 255). Naive straight-alpha blur would
        // drag R down by 50+ at this radius.
        const cx = Math.floor(W / 2);
        const cy = Math.floor(H / 2);
        const centre = (cy * W + cx) * 4;
        expect(data[centre + 3]).toBe(255); // still fully opaque
        expect(data[centre]).toBeGreaterThan(240); // R not darkened
        expect(data[centre + 1]).toBeLessThan(10); // G still ~0
        expect(data[centre + 2]).toBeLessThan(10); // B still ~0
    });

    /**
     * Regression — multi-pass progressive blur (no ghosting).
     *
     * The old 2-pass implementation blended blur@startIntensity with
     * blur@endIntensity linearly across the whole band, so at the band
     * midpoint the result was 0.5·blur@start + 0.5·blur@end — bimodal,
     * with sharp-edge structure from blur@start surviving into the blurry
     * zone. Users read this as "the image is blurred but the original is
     * pasted on top".
     *
     * Multi-pass composites N=5 pre-blurred levels with σ spaced every
     * (σ_end − σ_start)/(N−1). At sub-band boundaries (25%, 50%, 75% of the
     * band) the output equals a single pre-blur level exactly; inside a
     * sub-band it mixes only two ADJACENT σ levels, so the residual ghost
     * magnitude is (σ_end − σ_start)/(N−1), ~4× smaller than 2-pass.
     *
     * Test: on a checkerboard (only pattern that makes σ differences
     * visible in raw pixels — flat regions blur to the same mean at any σ),
     * the middle row of a 0→20 progressive band must be close to a uniform
     * blur@10. A 2-pass regression would produce a bimodal checkerboard
     * here (pixel values ~64/~191) and fail this assertion loudly.
     */
    it("progressive blur at band midpoint matches uniform blur at mid-sigma (multi-pass, no ghost)", async () => {
        const W = 80;
        const H = 80;
        const raw = Buffer.alloc(W * H * 4);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const i = (y * W + x) * 4;
                const v =
                    (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0
                        ? 255
                        : 0;
                raw[i] = v;
                raw[i + 1] = v;
                raw[i + 2] = v;
                raw[i + 3] = 255;
            }
        }
        const input = await sharp(raw, {
            raw: { width: W, height: H, channels: 4 },
        })
            .png()
            .toBuffer();

        const startI = 0;
        const endI = 20;
        const midSigma = (startI + endI) / 2;

        const progressive = await applyBlur(input, {
            mode: "progressive",
            direction: "top-to-bottom",
            startPos: 0,
            endPos: 1,
            startIntensity: startI,
            endIntensity: endI,
        });
        const uniformMid = await applyBlur(input, {
            mode: "uniform",
            intensity: midSigma,
        });

        const { data: progRaw } = await sharp(progressive)
            .raw()
            .toBuffer({ resolveWithObject: true });
        const { data: midRaw } = await sharp(uniformMid)
            .raw()
            .toBuffer({ resolveWithObject: true });

        // y=H/2=40 → pixel-centre pos ≈ 0.506, effectively at the 0.5
        // sub-band boundary; progressive should read pure level 2 (= σ=10).
        const y = Math.floor(H / 2);
        let totalDelta = 0;
        let samples = 0;
        for (let x = 10; x < W - 10; x++) {
            const idx = (y * W + x) * 4;
            for (let c = 0; c < 3; c++) {
                totalDelta += Math.abs(progRaw[idx + c] - midRaw[idx + c]);
                samples++;
            }
        }
        const meanDelta = totalDelta / samples;
        // 2-pass regression would yield a bimodal checkerboard here with
        // mean delta well above 30; multi-pass stays within single-digit
        // territory (dominated by the ~2% sub-band 3 bleed at y=40.5).
        expect(meanDelta).toBeLessThan(12);
    });

    /**
     * Regression — cumulative halo outside the blur band.
     *
     * The first multi-pass attempt used `composite({ blend: "over" })` to
     * layer blurred levels, and at positions past `endPos` (where every
     * sub-band mask clamps to alpha=1) the sharp level was supposed to
     * fully win. It didn't: `over` only writes where the overlay itself is
     * opaque, so in the transparent rim of the sharp silhouette the
     * underlying blurrier levels leaked through — composited through 3
     * iterations their alphas accumulated into a visible halo the user
     * reported as "светящийся ореол".
     *
     * The fix is linear interpolation in premultiplied space (mask=1 fully
     * replaces prior level, regardless of the new level's own alpha). This
     * test asserts the fix: 25px above a σ=30 blur band boundary, with a
     * centred red square on a transparent canvas, the alpha must match a
     * plain uniform σ=0 blur of the same input — i.e. stay zero.
     */
    it("progressive blur has no cumulative halo past endPos (linear lerp, not over-blend)", async () => {
        const W = 120;
        const H = 120;
        const SQ = 40;
        const ox = (W - SQ) / 2;
        const oy = (H - SQ) / 2;
        const raw = Buffer.alloc(W * H * 4, 0); // transparent
        for (let y = oy; y < oy + SQ; y++) {
            for (let x = ox; x < ox + SQ; x++) {
                const i = (y * W + x) * 4;
                raw[i] = 255;
                raw[i + 1] = 0;
                raw[i + 2] = 0;
                raw[i + 3] = 255;
            }
        }
        const input = await sharp(raw, {
            raw: { width: W, height: H, channels: 4 },
        })
            .png()
            .toBuffer();

        // Progressive band occupies only the BOTTOM 20% (direction
        // bottom-to-top → pos=0 at y=H-1). Above y = 0.8·H the mask is
        // clamped to alpha=1, so the output there must be σ_end-blurred
        // (= sharp, since endIntensity=0). The red square sits in the
        // middle (y≈50-60, pos≈0.5), well above the band.
        const out = await applyBlur(input, {
            mode: "progressive",
            direction: "bottom-to-top",
            startPos: 0,
            endPos: 0.2,
            startIntensity: 30,
            endIntensity: 0,
        });
        const { data, info } = await sharp(out)
            .raw()
            .toBuffer({ resolveWithObject: true });
        expect(info.channels).toBe(4);

        // Sample a ring of pixels 8px outside the red square. For a true
        // σ=0 blur these must stay fully transparent. The old over-blend
        // leaked ~σ=30-blurred red here (α > 0 with reddish RGB); the fix
        // keeps α at 0.
        const ringRadius = SQ / 2 + 8; // 28 from the square centre
        const cx = Math.floor(W / 2);
        const cy = Math.floor(H / 2);
        const samples: Array<[number, number]> = [
            [cx, cy - ringRadius],
            [cx, cy + ringRadius],
            [cx - ringRadius, cy],
            [cx + ringRadius, cy],
        ];
        let maxAlpha = 0;
        for (const [x, y] of samples) {
            const idx = (y * W + x) * 4;
            if (data[idx + 3] > maxAlpha) maxAlpha = data[idx + 3];
        }
        // σ=0 blur of a transparent-bg image leaves transparent pixels
        // transparent. Allow 3 units of slop for libvips rounding at the
        // SVG mask rasterisation; the old bug produced α ≳ 40 here.
        expect(maxAlpha).toBeLessThan(4);
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
