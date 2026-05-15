/**
 * Image Composite Utility (client-side, Canvas-based)
 *
 * Used by the "Preserve Original" expand pipeline to overlay the
 * original high-res image on top of the upscaled expand result,
 * producing the final output where only the generated border is
 * AI-produced and the center retains pixel-perfect original quality.
 */

// Shortened from 30s in 2026-05: a 30s wait masked real failures (broken CORS,
// expired Replicate URLs, network drops) as "slow loads". With retry x2 below,
// a true 10s+ load now becomes a 22s total wall time (10 + 1 + 10 + 1) before
// surfacing, which is still well under the previous single-attempt timeout
// but with much better differentiation between transient and permanent
// failures.
const IMAGE_LOAD_TIMEOUT_MS = 10_000;
const RETRY_BACKOFF_MS = 1_000;

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";

        const timer = setTimeout(() => {
            // Third-party CDNs sometimes stall the request without firing
            // onload or onerror (e.g. missing CORS headers on cached responses).
            // Without this timeout, the expand pipeline would hang forever.
            reject(new Error(`Image load timed out after ${IMAGE_LOAD_TIMEOUT_MS}ms: ${src.slice(0, 80)}...`));
        }, IMAGE_LOAD_TIMEOUT_MS);

        img.onload = () => {
            clearTimeout(timer);
            resolve(img);
        };
        img.onerror = () => {
            clearTimeout(timer);
            reject(new Error(`Failed to load image: ${src.slice(0, 80)}...`));
        };
        img.src = src;
    });
}

/**
 * Load an image with up to `attempts` retries, each separated by
 * RETRY_BACKOFF_MS. Distinguishes transient network slowdowns (succeed on
 * retry) from real failures (consistently fail) — the previous single-attempt
 * 30s timeout treated both the same way and left us guessing in telemetry.
 */
async function loadImageWithRetry(
    src: string,
    attempts: number = 2,
): Promise<HTMLImageElement> {
    let lastErr: unknown;
    for (let i = 0; i <= attempts; i++) {
        try {
            return await loadImage(src);
        } catch (err) {
            lastErr = err;
            if (i < attempts) {
                await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
            }
        }
    }
    throw lastErr instanceof Error
        ? lastErr
        : new Error(`Failed to load image after ${attempts + 1} attempts: ${src.slice(0, 80)}...`);
}

export interface PadSides {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface CompositeExpandParams {
    /** Upscaled expand result (full-size with generated border) */
    expandedSrc: string;
    /** Original high-res image (before any downscale) */
    originalSrc: string;
    /**
     * Padding in original pixel-space (pre-downscale).
     * These are the pixel offsets that were desired before the image was
     * downscaled to fit within Bria's limits.
     */
    pixelPadding: PadSides;
}

/**
 * Pure function returning the feather-mask alpha (0..255) for a single pixel.
 *
 * Behavior:
 * - Sides with `pad > 0` linearly fade from alpha=0 at the outer edge of the
 *   original to alpha=255 at `featherPx` pixels into the original.
 * - Sides with `pad === 0` stay solid (alpha=255) all the way to that edge —
 *   we must NOT let the bria background bleed through where there is no bria
 *   background to begin with.
 * - When two padded sides meet at a corner, alphas are multiplied (matching
 *   the result of two destination-in gradient passes in sequence), so the
 *   corner fades quadratically. This is correct because we are approaching
 *   the corner from two directions simultaneously.
 *
 * Exported so unit tests can verify the math without needing a real Canvas
 * implementation in the test environment (vitest runs in node by default).
 */
export function featherAlphaAt(
    x: number,
    y: number,
    width: number,
    height: number,
    pad: PadSides,
    featherPx: number,
): number {
    if (featherPx <= 0) return 255;

    let factor = 1;

    if (pad.top > 0 && y < featherPx) {
        factor *= y / featherPx;
    }
    if (pad.bottom > 0) {
        const distFromBottom = height - 1 - y;
        if (distFromBottom < featherPx) {
            factor *= distFromBottom / featherPx;
        }
    }
    if (pad.left > 0 && x < featherPx) {
        factor *= x / featherPx;
    }
    if (pad.right > 0) {
        const distFromRight = width - 1 - x;
        if (distFromRight < featherPx) {
            factor *= distFromRight / featherPx;
        }
    }

    if (factor <= 0) return 0;
    if (factor >= 1) return 255;
    return Math.round(factor * 255);
}

/**
 * Compute the full feather mask as a packed RGBA Uint8ClampedArray,
 * suitable for direct assignment into `ImageData.data` or for unit testing.
 *
 * Output layout matches `ImageData.data`: RGBA, row-major, 4 bytes per pixel.
 * R/G/B are 0 (the mask only carries alpha — the colour channels are unused
 * once the mask is composited into the original via `destination-in`).
 *
 * Pure (no Canvas dependency), so unit tests can introspect alpha values at
 * arbitrary pixel coordinates without a DOM/Canvas polyfill.
 */
export function computeFeatherMaskData(
    width: number,
    height: number,
    pad: PadSides,
    featherPx: number,
): Uint8ClampedArray {
    const clampedFeather = clampFeatherPx(width, height, featherPx);
    const data = new Uint8ClampedArray(width * height * 4);

    if (pad.top === 0 && pad.right === 0 && pad.bottom === 0 && pad.left === 0) {
        // No feathering needed — return fully opaque alpha.
        for (let i = 3; i < data.length; i += 4) data[i] = 255;
        return data;
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            data[i + 3] = featherAlphaAt(x, y, width, height, pad, clampedFeather);
        }
    }
    return data;
}

/**
 * Build a Canvas containing the feather mask used to overlay the original
 * image onto the expanded bria result with a soft edge.
 *
 * The mask is fully opaque in the centre and fades to transparent along
 * padded sides over `featherPx` pixels. Use `destination-in` to apply the
 * mask to a copy of the original image — that produces a feathered overlay
 * which blends seamlessly with the bria-generated border.
 *
 * Note on `featherPx` clamping: if the requested feather is larger than half
 * of the smaller dimension, the gradients would overlap in the centre and
 * leave it semi-transparent. We clamp to `min(width, height) / 2` to keep
 * the centre fully opaque.
 */
export function buildFeatherMask(
    width: number,
    height: number,
    pad: PadSides,
    featherPx: number,
): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create feather mask context");

    const imgData = ctx.createImageData(width, height);
    imgData.data.set(computeFeatherMaskData(width, height, pad, featherPx));
    ctx.putImageData(imgData, 0, 0);

    return canvas;
}

function clampFeatherPx(width: number, height: number, featherPx: number): number {
    const maxFeather = Math.floor(Math.min(width, height) / 2);
    return Math.max(0, Math.min(featherPx, maxFeather));
}

function computeFeatherPx(origW: number, origH: number): number {
    return Math.round(Math.max(24, Math.min(64, Math.min(origW, origH) * 0.04)));
}

/**
 * Composite the original image over the upscaled expand result with a
 * feathered overlay.
 *
 * Strategy:
 * 1. Create canvas at the target final size (original + padding in original pixel space)
 * 2. Draw the upscaled expanded image stretched to fill the final canvas
 *    (it has the right proportions, just potentially a slightly different absolute size
 *    due to ESRGAN ceil-rounding)
 * 3. Build a feather mask the size of the original, apply it to a copy of the original
 *    via `destination-in`, and draw the resulting feathered overlay at (destX, destY).
 *    The feather lives on the INSIDE of the original — its outer edge fades to fully
 *    transparent so bria shows through, while the centre stays pixel-perfect.
 *
 * This eliminates the hard rectangular seam that the previous hard `drawImage` paste
 * produced where original meets bria. Sides without padding receive no feather (we
 * must not let bria bleed through where bria has nothing to contribute).
 *
 * Returns a PNG data URI by default — PNG is lossless, which matters for the
 * seam between the original (untouched) center and the AI-generated border:
 * JPEG/WebP introduce blocking artifacts right at that boundary because the
 * 8x8 DCT block straddles a region with very different statistics on either
 * side. For very large canvases (>15 MB PNG payload) we fall back to WebP at
 * 0.95 quality to avoid blowing up downstream memory budgets.
 */
export async function compositeExpandResult(
    params: CompositeExpandParams,
): Promise<string> {
    const [expandedImg, originalImg] = await Promise.all([
        loadImageWithRetry(params.expandedSrc),
        loadImageWithRetry(params.originalSrc),
    ]);

    const origW = originalImg.naturalWidth;
    const origH = originalImg.naturalHeight;
    const pad = params.pixelPadding;

    const canvasW = Math.round(origW + pad.left + pad.right);
    const canvasH = Math.round(origH + pad.top + pad.bottom);

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create 2d context for compositing");

    // The expanded result frequently arrives at a slightly different
    // resolution than the final canvas (ESRGAN ceil-rounding etc.), so the
    // first drawImage scales it. Default smoothing produces noticeable
    // bilinear softness — high-quality smoothing keeps edges crisp.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(expandedImg, 0, 0, canvasW, canvasH);

    const destX = Math.round(pad.left);
    const destY = Math.round(pad.top);

    const hasAnyPadding = pad.top > 0 || pad.right > 0 || pad.bottom > 0 || pad.left > 0;

    if (!hasAnyPadding) {
        // Defensive guard — outpaintPipeline returns early at zero padding, but
        // if it ever doesn't, we still want a correct result. With no padding
        // there is no bria border, so a hard paste is exactly right.
        ctx.drawImage(originalImg, destX, destY, origW, origH);
    } else {
        const featherPx = computeFeatherPx(origW, origH);
        const mask = buildFeatherMask(origW, origH, pad, featherPx);

        const overlayCanvas = document.createElement("canvas");
        overlayCanvas.width = origW;
        overlayCanvas.height = origH;
        const overlayCtx = overlayCanvas.getContext("2d");
        if (!overlayCtx) throw new Error("Failed to create overlay context");
        overlayCtx.drawImage(originalImg, 0, 0);
        overlayCtx.globalCompositeOperation = "destination-in";
        overlayCtx.drawImage(mask, 0, 0);

        ctx.drawImage(overlayCanvas, destX, destY);
    }

    // Rough byte estimate: base64 data URI length × 0.75 ≈ decoded bytes.
    // 15 MB is the safety cap above which we accept lossy WebP to keep memory
    // pressure manageable on lower-end devices.
    const png = canvas.toDataURL("image/png");
    if (png.length * 0.75 > 15 * 1024 * 1024) {
        return canvas.toDataURL("image/webp", 0.95);
    }
    return png;
}
