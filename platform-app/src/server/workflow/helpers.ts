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
 * Build an SVG with a linear alpha gradient sized to (width, height).
 * `start` is the alpha at the start of `direction`, `end` is the alpha at
 * the end. Used as a `dest-in` composite to multiply the gradient into the
 * destination image's alpha channel.
 */
function buildAlphaGradientSvg(
    width: number,
    height: number,
    direction: LinearDirection,
    start: number,
    end: number,
): Buffer {
    const { x1, y1, x2, y2 } = gradientCoordsFor(direction);
    const startAlpha = Math.max(0, Math.min(1, start)).toFixed(4);
    const endAlpha = Math.max(0, Math.min(1, end)).toFixed(4);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0%" stop-color="#fff" stop-opacity="${startAlpha}"/><stop offset="100%" stop-color="#fff" stop-opacity="${endAlpha}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
    return Buffer.from(svg);
}

/**
 * Apply a linear alpha gradient mask to an image. Result is always RGBA PNG.
 * Multiplies the gradient into the source image's alpha (preserving RGB).
 */
export async function applyMask(
    inputBuffer: Buffer,
    params: {
        direction: LinearDirection;
        start: number;
        end: number;
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
        params.start,
        params.end,
    );

    return sharp(inputBuffer)
        .ensureAlpha()
        .composite([{ input: maskSvg, blend: "dest-in" }])
        .png()
        .toBuffer();
}

/**
 * Apply blur to an image. Two modes:
 * - `uniform`: gaussian blur with sigma=intensity across the whole image.
 * - `progressive`: composite of two blurred copies (start, end) interpolated
 *   linearly along `direction` via an alpha gradient mask.
 *
 * Sharp's `.blur(sigma)` rejects values < 0.3, so we route sigma=0 through
 * a no-op (pass the buffer untouched) instead of clamping silently.
 */
export async function applyBlur(
    inputBuffer: Buffer,
    params:
        | { mode: "uniform"; intensity: number }
        | {
              mode: "progressive";
              direction: LinearDirection;
              start: number;
              end: number;
          },
): Promise<Buffer> {
    if (params.mode === "uniform") {
        return blurOrPass(inputBuffer, params.intensity);
    }

    const { direction, start, end } = params;
    if (end <= start) {
        // Fallback: degenerate progressive collapses to uniform at `start`.
        return blurOrPass(inputBuffer, start);
    }

    const meta = await sharp(inputBuffer).metadata();
    const width = meta.width;
    const height = meta.height;
    if (!width || !height) {
        throw new Error("applyBlur: cannot read input image dimensions");
    }

    const baseBuffer = await blurOrPass(inputBuffer, start);
    const sharpBuffer = await blurOrPass(inputBuffer, end);

    // Mask: alpha=0 at start of direction, alpha=1 at end. So `sharpBuffer`
    // (the more-blurred end) shows through more strongly toward the end of
    // the direction, blending over the lighter `baseBuffer`.
    const maskSvg = buildAlphaGradientSvg(width, height, direction, 0, 1);

    const sharpMasked = await sharp(sharpBuffer)
        .composite([{ input: maskSvg, blend: "dest-in" }])
        .png()
        .toBuffer();

    return sharp(baseBuffer)
        .composite([{ input: sharpMasked, blend: "over" }])
        .png()
        .toBuffer();
}

/**
 * Sharp's `.blur(sigma)` errors on sigma < 0.3 (its supported minimum). We
 * treat anything <= 0.3 as a no-op pass-through to keep "uniform 0" valid.
 * PNG output here normalises encoding so downstream composites never have
 * to re-encode WebP/JPEG inputs.
 */
async function blurOrPass(buf: Buffer, sigma: number): Promise<Buffer> {
    if (sigma <= 0.3) {
        return sharp(buf).ensureAlpha().png().toBuffer();
    }
    return sharp(buf).ensureAlpha().blur(sigma).png().toBuffer();
}
