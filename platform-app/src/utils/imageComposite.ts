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
 * Sample mean RGB across `ringWidth`-pixel-wide strips along each padded side
 * of `rect`. With `side="outside"` we sample just outside the rect (the bria
 * border side); with `side="inside"` we sample just inside the rect (the
 * original-image side). Used to characterise the colour step at the seam
 * for the colour-match nudge in `compositeExpandResult`.
 *
 * Returns `null` if no padded side yields any sampled pixels.
 */
function sampleEdgeRingMean(
    data: Uint8ClampedArray,
    dataWidth: number,
    dataHeight: number,
    rect: { x: number; y: number; w: number; h: number },
    pad: PadSides,
    ringWidth: number,
    side: "inside" | "outside",
): { r: number; g: number; b: number } | null {
    const strips: { x: number; y: number; w: number; h: number }[] = [];

    if (pad.top > 0) {
        strips.push(side === "outside"
            ? { x: rect.x, y: rect.y - ringWidth, w: rect.w, h: ringWidth }
            : { x: rect.x, y: rect.y, w: rect.w, h: ringWidth });
    }
    if (pad.bottom > 0) {
        strips.push(side === "outside"
            ? { x: rect.x, y: rect.y + rect.h, w: rect.w, h: ringWidth }
            : { x: rect.x, y: rect.y + rect.h - ringWidth, w: rect.w, h: ringWidth });
    }
    if (pad.left > 0) {
        strips.push(side === "outside"
            ? { x: rect.x - ringWidth, y: rect.y, w: ringWidth, h: rect.h }
            : { x: rect.x, y: rect.y, w: ringWidth, h: rect.h });
    }
    if (pad.right > 0) {
        strips.push(side === "outside"
            ? { x: rect.x + rect.w, y: rect.y, w: ringWidth, h: rect.h }
            : { x: rect.x + rect.w - ringWidth, y: rect.y, w: ringWidth, h: rect.h });
    }

    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (const strip of strips) {
        const x0 = Math.max(0, strip.x);
        const y0 = Math.max(0, strip.y);
        const x1 = Math.min(dataWidth, strip.x + strip.w);
        const y1 = Math.min(dataHeight, strip.y + strip.h);
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                const i = (y * dataWidth + x) * 4;
                r += data[i];
                g += data[i + 1];
                b += data[i + 2];
                count++;
            }
        }
    }
    if (count === 0) return null;
    return { r: r / count, g: g / count, b: b / count };
}

/**
 * Shift every pixel of `ctx` by `delta` (clamped to [0, 255]). Used to nudge
 * the bria-generated border toward the original's colour balance at the seam,
 * eliminating the visible colour-temperature step bria sometimes produces
 * (especially on sky / skin / monochrome backgrounds).
 *
 * We shift the full canvas rather than masking around the original rect:
 * pixels inside the rect get overdrawn by the feathered original anyway,
 * and the feather edge (where alpha < 1) needs the shifted bria as the
 * under-pixel so the blend is colour-continuous.
 */
function shiftCanvasRgb(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    delta: { r: number; g: number; b: number },
): void {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const dr = delta.r;
    const dg = delta.g;
    const db = delta.b;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i] + dr;
        const g = data[i + 1] + dg;
        const b = data[i + 2] + db;
        data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
        data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
    ctx.putImageData(imgData, 0, 0);
}

/** Max channel delta (out of 255) below which the colour shift is a no-op. */
const COLOUR_SHIFT_THRESHOLD = 5;
const COLOUR_SHIFT_RING_PX = 2;

/**
 * Composite the original image over the upscaled expand result with a
 * feathered overlay (and a light colour-match step on the bria border).
 *
 * Strategy:
 * 1. Create canvas at the target final size (original + padding in original pixel space)
 * 2. Draw the upscaled expanded image stretched to fill the final canvas
 *    (it has the right proportions, just potentially a slightly different absolute size
 *    due to ESRGAN ceil-rounding)
 * 3. Sample a 2-px ring at the boundary on both bria (outside the original rect)
 *    and the original (inside its native bounds). If the mean RGB delta exceeds
 *    `COLOUR_SHIFT_THRESHOLD` on any channel, apply that shift to the whole canvas
 *    so the bria border colour-matches the original at the seam.
 * 4. Build a feather mask the size of the original, apply it to a copy of the original
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
        // Step 3: colour-shift bria to match the original at the boundary ring.
        // Cheap and only fires when the delta is visible to the eye (>5/255).
        try {
            const briaImageData = ctx.getImageData(0, 0, canvasW, canvasH);
            const briaMean = sampleEdgeRingMean(
                briaImageData.data,
                canvasW,
                canvasH,
                { x: destX, y: destY, w: origW, h: origH },
                pad,
                COLOUR_SHIFT_RING_PX,
                "outside",
            );

            const originalCanvas = document.createElement("canvas");
            originalCanvas.width = origW;
            originalCanvas.height = origH;
            const octx = originalCanvas.getContext("2d");
            if (!octx) throw new Error("Failed to create original sampling context");
            octx.drawImage(originalImg, 0, 0);
            const origImageData = octx.getImageData(0, 0, origW, origH);
            const origMean = sampleEdgeRingMean(
                origImageData.data,
                origW,
                origH,
                { x: 0, y: 0, w: origW, h: origH },
                pad,
                COLOUR_SHIFT_RING_PX,
                "inside",
            );

            if (briaMean && origMean) {
                const delta = {
                    r: origMean.r - briaMean.r,
                    g: origMean.g - briaMean.g,
                    b: origMean.b - briaMean.b,
                };
                const maxDelta = Math.max(Math.abs(delta.r), Math.abs(delta.g), Math.abs(delta.b));
                if (maxDelta > COLOUR_SHIFT_THRESHOLD) {
                    shiftCanvasRgb(ctx, canvasW, canvasH, delta);
                }
            }
        } catch (err) {
            // Colour-match is a polish step. If it fails (e.g. CORS-tainted canvas
            // somehow slipped through, despite loadImageWithRetry setting
            // crossOrigin), fall back to the un-shifted composite — the feather
            // alone covers ~90% of the visual gain anyway.
            console.error("[compositeExpandResult] colour-match step failed:", err);
        }

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
