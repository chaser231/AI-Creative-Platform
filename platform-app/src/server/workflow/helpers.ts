/**
 * Workflow server-side helpers.
 *
 * All HTTP fetches of external URLs MUST go through safeFetch
 * (see REQ-23 — SSRF guard). Direct `fetch(url)` for user-supplied URLs
 * is a P0 security violation.
 */

import sharp from "sharp";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { safeFetch, uploadImagePolicy } from "@/server/security/ssrfGuard";

// ─── S3 client (lazy construction to survive test mocks) ────────────────────

function getS3Client(): S3Client {
    return new S3Client({
        region: "ru-central1",
        endpoint: process.env.S3_ENDPOINT || "https://storage.yandexcloud.net",
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
        },
    });
}

const DEFAULT_S3_ENDPOINT = "https://storage.yandexcloud.net";

function getBucket(): string {
    return process.env.S3_BUCKET || "acp-assets";
}

function getS3Endpoint(): string {
    return process.env.S3_ENDPOINT || DEFAULT_S3_ENDPOINT;
}

// ─── tryWithFallback ────────────────────────────────────────────────────────

export interface ProviderAttempt<T> {
    name: string;
    run: () => Promise<T>;
}

export interface FallbackResult<T> {
    result: T;
    winner: string;
    /** Names of providers that threw before the winner succeeded. */
    attempted: string[];
}

/**
 * Try providers in order. First successful result wins. All-fail throws
 * an aggregated Error with individual messages so callers can surface the
 * cascade in logs and error responses.
 */
export async function tryWithFallback<T>(
    providers: Array<ProviderAttempt<T>>,
): Promise<FallbackResult<T>> {
    if (providers.length === 0) {
        throw new Error("tryWithFallback: no providers supplied");
    }
    const errors: Array<{ name: string; message: string }> = [];
    for (const p of providers) {
        try {
            const result = await p.run();
            return { result, winner: p.name, attempted: errors.map(e => e.name) };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[workflow] provider ${p.name} failed: ${msg}`);
            errors.push({ name: p.name, message: msg });
        }
    }
    throw new Error(
        `All providers failed: ${errors.map(e => `${e.name}(${e.message})`).join(" → ")}`,
    );
}

// ─── uploadFromExternalUrl ──────────────────────────────────────────────────

export interface UploadResult {
    s3Url: string;
    s3Key: string;
    contentType: string;
    sizeBytes: number;
}

/**
 * Re-upload an external URL (e.g. Replicate temporary link) to our S3 bucket.
 * SSRF-guarded via safeFetch + uploadImagePolicy (pinned DNS, MIME + size caps).
 *
 * Key prefix: workflow-runs/{workspaceId}/{uuid}.{ext}
 */
export async function uploadFromExternalUrl(
    url: string,
    opts: { workspaceId: string },
): Promise<UploadResult> {
    const response = await safeFetch(
        url,
        { signal: AbortSignal.timeout(30_000) },
        uploadImagePolicy(),
    );
    if (!response.ok) {
        throw new Error(`External URL fetch failed: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/png";
    if (!contentType.startsWith("image/")) {
        throw new Error(`Non-image content-type from provider: ${contentType}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
        throw new Error("Provider returned empty body");
    }

    return uploadBufferToS3(buffer, contentType, opts);
}

/**
 * Upload a raw image buffer (from sharp pipelines etc.) to S3 under the
 * same `workflow-runs/{workspaceId}/{uuid}.{ext}` prefix used for AI outputs.
 */
export async function uploadBufferToS3(
    buffer: Buffer,
    contentType: string,
    opts: { workspaceId: string },
): Promise<UploadResult> {
    if (buffer.length === 0) {
        throw new Error("uploadBufferToS3: empty buffer");
    }
    if (!contentType.startsWith("image/")) {
        throw new Error(`uploadBufferToS3: non-image content-type: ${contentType}`);
    }

    const ext = (contentType.split("/")[1] || "png").split(";")[0].trim();
    const key = `workflow-runs/${opts.workspaceId}/${randomUUID()}.${ext}`;

    await getS3Client().send(
        new PutObjectCommand({
            Bucket: getBucket(),
            Key: key,
            Body: buffer,
            ContentType: contentType,
        }),
    );

    return {
        s3Url: `${getS3Endpoint()}/${getBucket()}/${key}`,
        s3Key: key,
        contentType,
        sizeBytes: buffer.length,
    };
}

/** Fetch an external image URL into a Buffer through the SSRF guard. */
export async function fetchImageBuffer(url: string): Promise<{ buffer: Buffer; contentType: string }> {
    const response = await safeFetch(
        url,
        { signal: AbortSignal.timeout(30_000) },
        uploadImagePolicy(),
    );
    if (!response.ok) {
        throw new Error(`Image fetch failed: ${response.status}`);
    }
    const contentType = response.headers.get("content-type") || "image/png";
    if (!contentType.startsWith("image/")) {
        throw new Error(`Non-image content-type: ${contentType}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) throw new Error("Empty image body");
    return { buffer, contentType };
}

// ─── Mask & Blur (sharp-based image transforms) ─────────────────────────────

export type LinearDirection =
    | "top-to-bottom"
    | "bottom-to-top"
    | "left-to-right"
    | "right-to-left";

interface GradientCoords {
    x1: string;
    y1: string;
    x2: string;
    y2: string;
}

function gradientCoordsFor(direction: LinearDirection): GradientCoords {
    switch (direction) {
        case "top-to-bottom":
            return { x1: "0%", y1: "0%", x2: "0%", y2: "100%" };
        case "bottom-to-top":
            return { x1: "0%", y1: "100%", x2: "0%", y2: "0%" };
        case "left-to-right":
            return { x1: "0%", y1: "0%", x2: "100%", y2: "0%" };
        case "right-to-left":
            return { x1: "100%", y1: "0%", x2: "0%", y2: "0%" };
    }
}

/**
 * Build a Figma-style 4-stop linear alpha gradient sized to (width, height).
 *
 * Stops:
 *   0%         → startAlpha   (clamp, solid before startPos)
 *   startPos%  → startAlpha
 *   endPos%    → endAlpha
 *   100%       → endAlpha     (clamp, solid after endPos)
 *
 * So only the [startPos, endPos] band actually interpolates; the rest stays
 * constant at the nearest endpoint — this is what lets callers restrict the
 * mask/blur to a region of the image (e.g. the reflection band) instead of
 * bleeding across the whole canvas.
 */
function buildAlphaGradientSvg(
    width: number,
    height: number,
    direction: LinearDirection,
    startPos: number,
    endPos: number,
    startAlpha: number,
    endAlpha: number,
): Buffer {
    const { x1, y1, x2, y2 } = gradientCoordsFor(direction);
    const sp = Math.max(0, Math.min(1, startPos));
    const ep = Math.max(sp, Math.min(1, endPos));
    const sa = Math.max(0, Math.min(1, startAlpha)).toFixed(4);
    const ea = Math.max(0, Math.min(1, endAlpha)).toFixed(4);
    const spPct = (sp * 100).toFixed(2);
    const epPct = (ep * 100).toFixed(2);
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<defs><linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
        `<stop offset="0%" stop-color="#fff" stop-opacity="${sa}"/>` +
        `<stop offset="${spPct}%" stop-color="#fff" stop-opacity="${sa}"/>` +
        `<stop offset="${epPct}%" stop-color="#fff" stop-opacity="${ea}"/>` +
        `<stop offset="100%" stop-color="#fff" stop-opacity="${ea}"/>` +
        `</linearGradient></defs>` +
        `<rect width="100%" height="100%" fill="url(#g)"/></svg>`;
    return Buffer.from(svg);
}

/**
 * Apply a linear alpha gradient mask to an image. Result is always RGBA PNG.
 *
 * Gradient interpolates only inside [startPos, endPos] along `direction`:
 * before startPos → alpha clamped to `startAlpha`, after endPos → clamped
 * to `endAlpha`. This way the mask affects a *band* of the image instead
 * of stretching across the whole canvas (Figma Layer Mask parity).
 */
export async function applyMask(
    inputBuffer: Buffer,
    params: {
        direction: LinearDirection;
        startPos: number;
        endPos: number;
        startAlpha: number;
        endAlpha: number;
    },
): Promise<Buffer> {
    const meta = await sharp(inputBuffer).metadata();
    const width = meta.width;
    const height = meta.height;
    if (!width || !height) {
        throw new Error("applyMask: cannot read input image dimensions");
    }

    const maskSvg = buildAlphaGradientSvg(
        width,
        height,
        params.direction,
        params.startPos,
        params.endPos,
        params.startAlpha,
        params.endAlpha,
    );

    return sharp(inputBuffer)
        .ensureAlpha()
        .composite([{ input: maskSvg, blend: "dest-in" }])
        .png()
        .toBuffer();
}

/**
 * Number of pre-blurred pyramid levels for progressive blur. We generate
 * `PROGRESSIVE_BLUR_LEVELS` copies of the input at evenly-spaced sigmas
 * between startIntensity and endIntensity, then composite them through
 * `PROGRESSIVE_BLUR_LEVELS - 1` sub-band masks.
 *
 * Why not just 2 copies (startIntensity + endIntensity)? A 2-pass composite
 * blends "very sharp" with "very blurry" in the middle of the band — the
 * eye reads this as ghosting (sharp edges from the startIntensity copy
 * staying visible through the blur). With N levels, each sub-band's ghost
 * magnitude is (σ_max − σ_min) / (N − 1); at N=5 we're blending only
 * ~25%-apart sigma pairs, which visually reads as a smooth gradient blur.
 *
 * N=5 was picked empirically: below 4 the ghost is still visible on
 * thin/high-contrast edges (reflections of chrome products), 6+ doesn't
 * noticeably improve quality and costs an extra full-image blur pass.
 */
const PROGRESSIVE_BLUR_LEVELS = 5;

/**
 * Apply blur to an image. Two modes:
 * - `uniform`: gaussian blur with sigma=intensity across the whole image.
 * - `progressive`: N-level pyramid composite. We pre-blur the input at
 *   `PROGRESSIVE_BLUR_LEVELS` evenly-spaced sigmas between startIntensity
 *   and endIntensity, then layer them from startIntensity→endIntensity
 *   through `N-1` sub-band masks (each covering 1/(N-1) of [startPos,
 *   endPos]). Outside the band the image is blurred at the nearest
 *   endpoint (Figma Layer Blur parity — transition is clamped).
 *
 * Both modes route through `gaussianBlurPremultiplied` so transparent
 * RGBA inputs don't get dark halos on their silhouette.
 */
export async function applyBlur(
    inputBuffer: Buffer,
    params:
        | { mode: "uniform"; intensity: number }
        | {
              mode: "progressive";
              direction: LinearDirection;
              startPos: number;
              endPos: number;
              startIntensity: number;
              endIntensity: number;
          },
): Promise<Buffer> {
    if (params.mode === "uniform") {
        return gaussianBlurPremultiplied(inputBuffer, params.intensity);
    }

    const { direction, startPos, endPos, startIntensity, endIntensity } = params;
    if (endPos <= startPos || startIntensity === endIntensity) {
        // Degenerate progressive collapses to uniform (use whichever intensity
        // is non-zero; both equal → uniform at that value).
        return gaussianBlurPremultiplied(
            inputBuffer,
            Math.max(startIntensity, endIntensity),
        );
    }

    const meta = await sharp(inputBuffer).metadata();
    const width = meta.width;
    const height = meta.height;
    if (!width || !height) {
        throw new Error("applyBlur: cannot read input image dimensions");
    }

    const levels = PROGRESSIVE_BLUR_LEVELS;
    const subBands = levels - 1;

    // Pre-blur at N evenly-spaced sigmas [σ0 … σ_{N-1}] where σ0=startIntensity
    // and σ_{N-1}=endIntensity. All N blurs are independent, so fire them in
    // parallel (libvips releases its lock per-op and actually parallelises).
    //
    // We keep each level as PREMULTIPLIED RAW RGBA (not straight-alpha PNG).
    // Reason: the cross-level blend below is a per-pixel linear interpolation
    // between adjacent σ levels, and in premultiplied space that's just
    // channel-wise `lerp(a, b, t)` — correct even when A varies. Doing it in
    // straight alpha requires dividing by the blended A, which is brittle
    // near the silhouette edge.
    const sigmas = Array.from({ length: levels }, (_, i) => {
        const t = i / subBands;
        return startIntensity + t * (endIntensity - startIntensity);
    });
    const levelBuffers = await Promise.all(
        sigmas.map((s) => gaussianBlurPremultipliedRaw(inputBuffer, s)),
    );

    // Rasterise all N-1 sub-band masks to raw 8-bit alpha planes. Each mask
    // covers exactly one 1/N slice of [startPos, endPos] and clamps to 0
    // before its slice, 1 after — so the cascading lerp below naturally
    // produces σ0-blur before startPos and σ_{N-1}-blur after endPos.
    const maskPlanes = await Promise.all(
        Array.from({ length: subBands }, (_, j) => {
            const i = j + 1; // iteration i=1..N-1
            const subStart =
                startPos + ((i - 1) / subBands) * (endPos - startPos);
            const subEnd =
                startPos + (i / subBands) * (endPos - startPos);
            return renderMaskAlphaPlane(
                width,
                height,
                direction,
                subStart,
                subEnd,
            );
        }),
    );

    // Per-pixel cascaded lerp in premultiplied RGBA. For each sub-band s,
    // result ← lerp(result, level[s+1], maskPlane[s]). A mask value of 0
    // keeps `result` (so positions before the sub-band retain the current
    // blend state), a value of 255 fully replaces it with the next-sharper
    // level (so positions after the sub-band carry forward that level into
    // subsequent iterations and, past endPos, into the final output).
    //
    // IMPORTANT: `over`-blending (the previous attempt) is wrong here —
    // in sub-band transitions the prior level's RGB bleed ("halo" from a
    // high-σ blur) would show through wherever the sharper level has
    // alpha=0, even when the mask is 1. Linear mix in premul space replaces
    // colour cleanly: mask=1 → 100% next level, regardless of silhouette.
    const pixelCount = width * height;
    const result = Buffer.from(levelBuffers[0].data);
    for (let s = 0; s < subBands; s++) {
        const target = levelBuffers[s + 1].data;
        const mask = maskPlanes[s];
        for (let p = 0; p < pixelCount; p++) {
            const m = mask[p];
            if (m === 0) continue;
            if (m === 255) {
                const pi = p * 4;
                result[pi] = target[pi];
                result[pi + 1] = target[pi + 1];
                result[pi + 2] = target[pi + 2];
                result[pi + 3] = target[pi + 3];
                continue;
            }
            const inv = 255 - m;
            const pi = p * 4;
            result[pi] = ((result[pi] * inv + target[pi] * m + 127) / 255) | 0;
            result[pi + 1] =
                ((result[pi + 1] * inv + target[pi + 1] * m + 127) / 255) | 0;
            result[pi + 2] =
                ((result[pi + 2] * inv + target[pi + 2] * m + 127) / 255) | 0;
            result[pi + 3] =
                ((result[pi + 3] * inv + target[pi + 3] * m + 127) / 255) | 0;
        }
    }

    return unpremultipliedRawToPng(result, width, height);
}

/**
 * Render a 4-stop linear alpha gradient as a raw 8-bit grayscale plane of
 * size (width*height). The plane is the *alpha channel* of the rendered SVG
 * — we fill with `#fff` and vary `stop-opacity`, so the raster's alpha is
 * exactly our gradient.
 */
async function renderMaskAlphaPlane(
    width: number,
    height: number,
    direction: LinearDirection,
    startPos: number,
    endPos: number,
): Promise<Buffer> {
    const svg = buildAlphaGradientSvg(
        width,
        height,
        direction,
        startPos,
        endPos,
        0,
        1,
    );
    const { data, info } = await sharp(svg)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    // sharp rasterises <svg width="W" height="H"> at exactly W×H, but assert
    // defensively — if librsvg ever changes its DPI defaults we want a loud
    // error, not silently-broken masks.
    if (info.width !== width || info.height !== height) {
        throw new Error(
            `renderMaskAlphaPlane: SVG rasterised to ${info.width}×${info.height}, expected ${width}×${height}`,
        );
    }
    const out = Buffer.alloc(width * height);
    for (let p = 0; p < out.length; p++) {
        out[p] = data[p * 4 + 3];
    }
    return out;
}

/**
 * Premultiplied-alpha Gaussian blur for RGBA images — parity with Figma /
 * Photoshop "Layer Blur" on layers with transparency.
 *
 * Why not just `sharp(buf).blur(sigma)`? Sharp's/libvips' `.blur()` operates
 * on straight-alpha RGBA and blurs R, G, B, A channels independently. Near
 * the silhouette of a rembg'd product, the RGB channels get averaged with
 * the "transparent zone" (which is RGB=0 after rembg) → dark fringe/halo.
 * Alpha blurs separately and stays relatively sharp, so the halo survives
 * into the output.
 *
 * Fix (the canonical one, used by Figma, PS, AE):
 *   1. Premultiply RGB by A/255 so transparent pixels contribute nothing.
 *   2. Blur the premultiplied image (libvips doesn't know or care — it just
 *      runs Gaussian on whatever numbers we give it).
 *   3. Unpremultiply: RGB ← RGB·255/A (guarding against A=0).
 *
 * Sharp has no public `.premultiply()` op, so we roundtrip through `.raw()`
 * and do the (de)multiplication ourselves — O(n) in pixels, negligible for
 * typical workflow assets (~few ms on 2K images).
 *
 * Sharp's `.blur(sigma)` rejects sigma < 0.3, so we treat anything ≤ 0.3 as
 * a no-op pass-through (encoding normalisation only) to keep "intensity 0"
 * valid.
 */
async function gaussianBlurPremultiplied(
    buf: Buffer,
    sigma: number,
): Promise<Buffer> {
    if (sigma <= 0.3) {
        return sharp(buf).ensureAlpha().png().toBuffer();
    }
    const { data, width, height } = await gaussianBlurPremultipliedRaw(
        buf,
        sigma,
    );
    return unpremultipliedRawToPng(data, width, height);
}

/**
 * Same pipeline as `gaussianBlurPremultiplied` but stops one step earlier —
 * returns the PREMULTIPLIED blurred RAW RGBA, skipping the unpremultiply
 * and PNG encode.
 *
 * Used by the multi-level progressive blur composite, which mixes adjacent
 * σ levels per-pixel in premultiplied space (linear interpolation in premul
 * is correct and trivial; the same interpolation in straight alpha needs a
 * per-pixel divide by the blended alpha and is fragile at silhouette edges).
 *
 * σ ≤ 0.3 still returns a valid premultiplied raw buffer (just the input,
 * premultiplied once) — libvips rejects `blur()` below that threshold, so
 * we skip the blur op but keep the premul so callers get a consistent
 * buffer shape.
 */
async function gaussianBlurPremultipliedRaw(
    buf: Buffer,
    sigma: number,
): Promise<{ data: Buffer; width: number; height: number }> {
    const raw = await sharp(buf)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = raw.info;
    if (channels !== 4) {
        throw new Error(
            `gaussianBlurPremultipliedRaw: expected 4 channels after ensureAlpha, got ${channels}`,
        );
    }

    // Premultiply RGB by A/255. Integer math with /255 rather than /256 so a
    // fully-opaque pixel (A=255) stays bit-exact.
    const src = raw.data;
    const premul = Buffer.alloc(src.length);
    for (let i = 0; i < src.length; i += 4) {
        const a = src[i + 3];
        premul[i] = ((src[i] * a + 127) / 255) | 0;
        premul[i + 1] = ((src[i + 1] * a + 127) / 255) | 0;
        premul[i + 2] = ((src[i + 2] * a + 127) / 255) | 0;
        premul[i + 3] = a;
    }

    if (sigma <= 0.3) {
        return { data: premul, width, height };
    }

    // Blur the premultiplied image. Libvips applies Gaussian per channel —
    // correct here because each channel is already alpha-weighted, so
    // transparent zones contribute zero to their opaque neighbours.
    const blurredRaw = await sharp(premul, {
        raw: { width, height, channels: 4 },
    })
        .blur(sigma)
        .raw()
        .toBuffer();

    return { data: blurredRaw, width, height };
}

/**
 * Unpremultiply a premultiplied raw RGBA buffer and encode as PNG. Guards
 * A=0 (RGB has no meaning at full transparency — zero it out so downstream
 * composites don't see ghost colour) and clamps (integer rounding can push
 * values slightly past 255 at the edges of opaque caps).
 */
async function unpremultipliedRawToPng(
    premul: Buffer,
    width: number,
    height: number,
): Promise<Buffer> {
    const out = Buffer.alloc(premul.length);
    for (let i = 0; i < premul.length; i += 4) {
        const a = premul[i + 3];
        if (a === 0) {
            out[i] = 0;
            out[i + 1] = 0;
            out[i + 2] = 0;
            out[i + 3] = 0;
            continue;
        }
        const r = ((premul[i] * 255 + (a >> 1)) / a) | 0;
        const g = ((premul[i + 1] * 255 + (a >> 1)) / a) | 0;
        const b = ((premul[i + 2] * 255 + (a >> 1)) / a) | 0;
        out[i] = r > 255 ? 255 : r;
        out[i + 1] = g > 255 ? 255 : g;
        out[i + 2] = b > 255 ? 255 : b;
        out[i + 3] = a;
    }
    return sharp(out, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer();
}
