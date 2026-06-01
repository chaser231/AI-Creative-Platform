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

export interface CompositeInpaintParams {
    /** Provider inpaint result (URL or data URI). May be any size/aspect. */
    editedSrc: string;
    /** Original source image to preserve outside the painted mask. */
    originalSrc: string;
    /** User-painted mask. RGB masks use black=preserve/white=edit; alpha masks use opaque=edit. */
    maskSrc: string;
    /** Explicit alpha polarity for providers such as OpenAI where transparent pixels mean edit. */
    maskAlphaMode?: InpaintMaskAlphaMode;
    /**
     * Original image-space rectangle represented by `editedSrc`.
     *
     * When provider requests are cropped for better inpaint quality, providers
     * return only the crop. The composite step still receives the full original
     * and full mask, then scales/pastes the provider crop into this rectangle.
     */
    editedRect?: InpaintRect;
    /** Optional expansion of the edit region to include nearby cleanup, shadows, and context. */
    maskExpandPx?: number;
    /** Max edited-image opacity allowed outside the originally painted mask. */
    contextOpacity?: number;
    /** Optional softening applied to the edit mask edge before compositing. */
    featherPx?: number;
    /** `seamless` allows a narrow outside blend ring; `strict` preserves outside pixels 1:1. */
    blendMode?: InpaintBlendMode;
    /** Width of the outside transition ring in original-image pixels. */
    outsideBlendPx?: number;
    /** Max edited-image opacity allowed in the outside transition ring. */
    outsideBlendOpacity?: number;
    /** Lightly match provider seam colour/luma to the original seam. */
    seamColorMatch?: boolean;
}

export interface InpaintRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export type InpaintMaskAlphaMode = "auto" | "transparent-edit" | "opaque-edit";
export type InpaintBlendMode = "seamless" | "strict";

export interface RgbMean {
    r: number;
    g: number;
    b: number;
}

/**
 * Normalize provider/input mask bytes to an edit-region alpha mask.
 *
 * Supports both mask families we generate client-side:
 * - RGB masks for non-OpenAI providers: black = preserve, white = edit.
 * - Alpha masks: either transparent background + opaque strokes (legacy),
 *   or OpenAI-style opaque preserve + transparent edit region.
 *
 * Pure helper so polarity can be tested without a DOM/canvas implementation.
 */
export function normalizeInpaintMaskAlpha(
    maskData: Uint8ClampedArray,
    alphaMode: InpaintMaskAlphaMode = "auto",
): Uint8ClampedArray {
    const pixels = Math.floor(maskData.length / 4);
    const alpha = new Uint8ClampedArray(pixels);

    let hasTransparent = false;
    let hasVisible = false;
    let transparentCount = 0;
    let visibleCount = 0;
    for (let i = 0; i < maskData.length; i += 4) {
        const a = maskData[i + 3];
        if (a <= 5) {
            hasTransparent = true;
            transparentCount++;
        }
        if (a > 5) {
            hasVisible = true;
            visibleCount++;
        }
    }

    const useSourceAlpha = hasTransparent && hasVisible;
    const transparentMeansEdit = alphaMode === "transparent-edit"
        || (alphaMode === "auto" && useSourceAlpha && transparentCount < visibleCount);
    for (let i = 0, p = 0; i < maskData.length; i += 4, p++) {
        if (useSourceAlpha) {
            alpha[p] = transparentMeansEdit
                ? 255 - maskData[i + 3]
                : maskData[i + 3];
        } else {
            // Rec. 709 luma: white strokes become edit alpha, black stays preserve.
            alpha[p] = Math.round(maskData[i] * 0.2126 + maskData[i + 1] * 0.7152 + maskData[i + 2] * 0.0722);
        }
    }

    return alpha;
}

export interface InpaintMaskBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface InpaintCropPlan {
    rect: InpaintRect;
    outputWidth: number;
    outputHeight: number;
    scale: number;
}

export interface PreparedInpaintProviderCrop {
    /** Cropped source image data URI to upload/pass to the provider. */
    sourceSrc: string;
    /** Cropped mask data URI to upload/pass to the provider. */
    maskSrc: string;
    /** Original image-space rectangle covered by `sourceSrc` and provider output. */
    editedRect: InpaintRect;
    originalWidth: number;
    originalHeight: number;
    cropWidth: number;
    cropHeight: number;
    outputWidth: number;
    outputHeight: number;
    scale: number;
}

const INPAINT_MASK_BOUNDS_THRESHOLD = 8;
const INPAINT_CROP_SKIP_AREA_RATIO = 0.85;
const INPAINT_CROP_MIN_PADDING_PX = 96;
const INPAINT_CROP_MASK_PADDING_RATIO = 0.35;
const INPAINT_CROP_IMAGE_PADDING_RATIO = 0.08;
const INPAINT_CROP_UPSCALE_LONGEST_SIDE = 1024;
const INPAINT_CROP_MAX_UPSCALE = 2;
const INPAINT_CROP_MAX_SIDE = 2048;
const INPAINT_CROP_MAX_PIXELS = 4_000_000;
const INPAINT_OUTSIDE_BLEND_MIN_PX = 8;
const INPAINT_OUTSIDE_BLEND_MAX_PX = 18;
const INPAINT_OUTSIDE_BLEND_OPACITY = 0.18;
const INPAINT_SEAM_COLOR_MAX_DELTA = 18;

export function getInpaintMaskBounds(
    alpha: Uint8ClampedArray,
    width: number,
    threshold: number = INPAINT_MASK_BOUNDS_THRESHOLD,
): InpaintMaskBounds | null {
    const height = Math.floor(alpha.length / width);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            if (alpha[row + x] <= threshold) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }

    if (maxX < minX || maxY < minY) return null;
    return {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
    };
}

export function computeInpaintCropPlan(
    imageWidth: number,
    imageHeight: number,
    bounds: InpaintMaskBounds | null,
): InpaintCropPlan | null {
    if (!bounds) return null;

    const imageArea = imageWidth * imageHeight;
    if (imageWidth <= 0 || imageHeight <= 0 || imageArea <= 0) return null;

    const padding = Math.ceil(Math.max(
        INPAINT_CROP_MIN_PADDING_PX,
        Math.max(bounds.width, bounds.height) * INPAINT_CROP_MASK_PADDING_RATIO,
        Math.min(imageWidth, imageHeight) * INPAINT_CROP_IMAGE_PADDING_RATIO,
    ));

    const x0 = Math.max(0, Math.floor(bounds.x - padding));
    const y0 = Math.max(0, Math.floor(bounds.y - padding));
    const x1 = Math.min(imageWidth, Math.ceil(bounds.x + bounds.width + padding));
    const y1 = Math.min(imageHeight, Math.ceil(bounds.y + bounds.height + padding));
    const cropWidth = Math.max(1, x1 - x0);
    const cropHeight = Math.max(1, y1 - y0);

    if ((cropWidth * cropHeight) / imageArea > INPAINT_CROP_SKIP_AREA_RATIO) {
        return null;
    }

    const longest = Math.max(cropWidth, cropHeight);
    let scale = longest < INPAINT_CROP_UPSCALE_LONGEST_SIDE
        ? Math.min(INPAINT_CROP_MAX_UPSCALE, INPAINT_CROP_UPSCALE_LONGEST_SIDE / longest)
        : 1;

    scale = Math.min(
        scale,
        INPAINT_CROP_MAX_SIDE / cropWidth,
        INPAINT_CROP_MAX_SIDE / cropHeight,
        Math.sqrt(INPAINT_CROP_MAX_PIXELS / (cropWidth * cropHeight)),
    );
    scale = Math.max(0.01, scale);
    let outputWidth = Math.max(1, Math.round(cropWidth * scale));
    let outputHeight = Math.max(1, Math.round(cropHeight * scale));
    if (
        outputWidth > INPAINT_CROP_MAX_SIDE ||
        outputHeight > INPAINT_CROP_MAX_SIDE ||
        outputWidth * outputHeight > INPAINT_CROP_MAX_PIXELS
    ) {
        const outputCapScale = Math.min(
            INPAINT_CROP_MAX_SIDE / outputWidth,
            INPAINT_CROP_MAX_SIDE / outputHeight,
            Math.sqrt(INPAINT_CROP_MAX_PIXELS / (outputWidth * outputHeight)),
        );
        outputWidth = Math.max(1, Math.floor(outputWidth * outputCapScale));
        outputHeight = Math.max(1, Math.floor(outputHeight * outputCapScale));
        scale = Math.min(outputWidth / cropWidth, outputHeight / cropHeight);
    }

    return {
        rect: { x: x0, y: y0, width: cropWidth, height: cropHeight },
        outputWidth,
        outputHeight,
        scale,
    };
}

export async function prepareInpaintProviderCrop(
    params: { originalSrc: string; maskSrc: string; maskAlphaMode?: InpaintMaskAlphaMode },
): Promise<PreparedInpaintProviderCrop | null> {
    const [originalImg, maskImg] = await Promise.all([
        loadImageWithRetry(params.originalSrc),
        loadImageWithRetry(params.maskSrc),
    ]);

    const origW = originalImg.naturalWidth;
    const origH = originalImg.naturalHeight;

    const fullMaskCanvas = document.createElement("canvas");
    fullMaskCanvas.width = origW;
    fullMaskCanvas.height = origH;
    const fullMaskCtx = fullMaskCanvas.getContext("2d", { willReadFrequently: true });
    if (!fullMaskCtx) throw new Error("Failed to create inpaint crop mask context");
    fullMaskCtx.imageSmoothingEnabled = true;
    fullMaskCtx.imageSmoothingQuality = "high";
    fullMaskCtx.drawImage(maskImg, 0, 0, origW, origH);

    const rawMask = fullMaskCtx.getImageData(0, 0, origW, origH);
    const editAlpha = normalizeInpaintMaskAlpha(rawMask.data, params.maskAlphaMode);
    const bounds = getInpaintMaskBounds(editAlpha, origW, INPAINT_MASK_BOUNDS_THRESHOLD);
    const plan = computeInpaintCropPlan(origW, origH, bounds);
    if (!plan) return null;

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = plan.outputWidth;
    sourceCanvas.height = plan.outputHeight;
    const sourceCtx = sourceCanvas.getContext("2d");
    if (!sourceCtx) throw new Error("Failed to create inpaint crop source context");
    sourceCtx.imageSmoothingEnabled = true;
    sourceCtx.imageSmoothingQuality = "high";
    sourceCtx.drawImage(
        originalImg,
        plan.rect.x,
        plan.rect.y,
        plan.rect.width,
        plan.rect.height,
        0,
        0,
        plan.outputWidth,
        plan.outputHeight,
    );

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = plan.outputWidth;
    maskCanvas.height = plan.outputHeight;
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) throw new Error("Failed to create inpaint crop provider mask context");
    maskCtx.imageSmoothingEnabled = false;
    maskCtx.drawImage(
        fullMaskCanvas,
        plan.rect.x,
        plan.rect.y,
        plan.rect.width,
        plan.rect.height,
        0,
        0,
        plan.outputWidth,
        plan.outputHeight,
    );

    return {
        sourceSrc: sourceCanvas.toDataURL("image/png"),
        maskSrc: maskCanvas.toDataURL("image/png"),
        editedRect: plan.rect,
        originalWidth: origW,
        originalHeight: origH,
        cropWidth: plan.rect.width,
        cropHeight: plan.rect.height,
        outputWidth: plan.outputWidth,
        outputHeight: plan.outputHeight,
        scale: plan.scale,
    };
}

export function computeInpaintOutsideBlendPx(
    imageWidth: number,
    imageHeight: number,
    bounds: InpaintMaskBounds | null,
): number {
    const minDim = Math.max(1, Math.min(imageWidth, imageHeight));
    const maskMax = bounds ? Math.max(bounds.width, bounds.height) : minDim;
    return Math.round(Math.max(
        INPAINT_OUTSIDE_BLEND_MIN_PX,
        Math.min(
            INPAINT_OUTSIDE_BLEND_MAX_PX,
            Math.max(minDim * 0.02, maskMax * 0.02),
        ),
    ));
}

export interface InpaintCompositeMaskAlphaOptions {
    blendMode?: InpaintBlendMode;
    contextOpacity?: number;
    outsideBlendOpacity?: number;
    outerAllowedAlpha?: Uint8ClampedArray;
    coreThreshold?: number;
}

export function computeInpaintCompositeMaskAlpha(
    candidateAlpha: Uint8ClampedArray,
    allowedAlpha: Uint8ClampedArray,
    coreAlpha: Uint8ClampedArray,
    options: InpaintCompositeMaskAlphaOptions = {},
): Uint8ClampedArray {
    const length = Math.min(candidateAlpha.length, allowedAlpha.length, coreAlpha.length);
    const out = new Uint8ClampedArray(length);
    const blendMode = options.blendMode ?? "seamless";
    const coreThreshold = options.coreThreshold ?? INPAINT_MASK_BOUNDS_THRESHOLD;
    const maxContextAlpha = Math.round(255 * Math.max(0, Math.min(1, options.contextOpacity ?? 0)));
    const maxOutsideAlpha = Math.round(255 * Math.max(0, Math.min(1, options.outsideBlendOpacity ?? INPAINT_OUTSIDE_BLEND_OPACITY)));
    const outerAllowedAlpha = options.outerAllowedAlpha ?? allowedAlpha;

    for (let p = 0; p < length; p++) {
        const core = coreAlpha[p] ?? 0;
        const candidate = candidateAlpha[p] ?? 0;

        if (blendMode === "strict") {
            let alpha = Math.min(candidate, allowedAlpha[p] ?? 0);
            if (core <= coreThreshold && alpha > maxContextAlpha) {
                alpha = maxContextAlpha;
            }
            out[p] = alpha;
            continue;
        }

        if (core > coreThreshold) {
            out[p] = Math.min(candidate, allowedAlpha[p] ?? 255);
            continue;
        }

        if ((outerAllowedAlpha[p] ?? 0) <= coreThreshold) {
            out[p] = 0;
            continue;
        }

        out[p] = Math.min(candidate, outerAllowedAlpha[p] ?? 0, maxOutsideAlpha);
    }

    return out;
}

export function clampRgbDelta(delta: RgbMean, maxAbsDelta: number = INPAINT_SEAM_COLOR_MAX_DELTA): RgbMean {
    const clamp = (value: number) => Math.max(-maxAbsDelta, Math.min(maxAbsDelta, value));
    return {
        r: clamp(delta.r),
        g: clamp(delta.g),
        b: clamp(delta.b),
    };
}

function buildDilatedMaskCanvas(
    source: HTMLCanvasElement,
    width: number,
    height: number,
    radiusPx: number,
): HTMLCanvasElement {
    if (radiusPx <= 0) return source;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create inpaint dilation context");

    const radius = Math.max(0, Math.round(radiusPx));
    const step = Math.max(1, Math.floor(radius / 4));
    for (let dy = -radius; dy <= radius; dy += step) {
        for (let dx = -radius; dx <= radius; dx += step) {
            if (dx * dx + dy * dy > radius * radius) continue;
            ctx.drawImage(source, dx, dy);
        }
    }
    return canvas;
}

function extractAlphaPlane(data: Uint8ClampedArray, pixels: number): Uint8ClampedArray {
    const alpha = new Uint8ClampedArray(pixels);
    for (let i = 0, p = 0; p < pixels; i += 4, p++) {
        alpha[p] = data[i + 3];
    }
    return alpha;
}

function computeInpaintSeamColorDelta(
    originalData: Uint8ClampedArray,
    editedData: Uint8ClampedArray,
    resolvedAlpha: Uint8ClampedArray,
    coreAlpha: Uint8ClampedArray,
    coreThreshold: number = INPAINT_MASK_BOUNDS_THRESHOLD,
): RgbMean | null {
    const originalOuter = { r: 0, g: 0, b: 0, count: 0 };
    const editedInner = { r: 0, g: 0, b: 0, count: 0 };

    for (let p = 0, i = 0; p < resolvedAlpha.length; p++, i += 4) {
        const alpha = resolvedAlpha[p];
        if (alpha <= 0) continue;

        if ((coreAlpha[p] ?? 0) <= coreThreshold) {
            originalOuter.r += originalData[i];
            originalOuter.g += originalData[i + 1];
            originalOuter.b += originalData[i + 2];
            originalOuter.count++;
        } else if (alpha < 250) {
            editedInner.r += editedData[i];
            editedInner.g += editedData[i + 1];
            editedInner.b += editedData[i + 2];
            editedInner.count++;
        }
    }

    if (originalOuter.count === 0 || editedInner.count === 0) return null;

    return clampRgbDelta({
        r: (originalOuter.r / originalOuter.count) - (editedInner.r / editedInner.count),
        g: (originalOuter.g / originalOuter.count) - (editedInner.g / editedInner.count),
        b: (originalOuter.b / originalOuter.count) - (editedInner.b / editedInner.count),
    });
}

function applyInpaintSeamColorDelta(
    editedData: Uint8ClampedArray,
    resolvedAlpha: Uint8ClampedArray,
    delta: RgbMean,
): void {
    for (let p = 0, i = 0; p < resolvedAlpha.length; p++, i += 4) {
        const alpha = resolvedAlpha[p];
        if (alpha <= 0 || alpha >= 250) continue;
        editedData[i] = Math.max(0, Math.min(255, editedData[i] + delta.r));
        editedData[i + 1] = Math.max(0, Math.min(255, editedData[i + 1] + delta.g));
        editedData[i + 2] = Math.max(0, Math.min(255, editedData[i + 2] + delta.b));
    }
}

export function resolveInpaintEditedRect(
    editedRect: InpaintRect | undefined,
    imageWidth: number,
    imageHeight: number,
): InpaintRect {
    if (!editedRect) return { x: 0, y: 0, width: imageWidth, height: imageHeight };

    const x = Math.min(Math.max(0, imageWidth - 1), Math.max(0, Math.round(editedRect.x)));
    const y = Math.min(Math.max(0, imageHeight - 1), Math.max(0, Math.round(editedRect.y)));
    const right = Math.min(imageWidth, x + Math.max(1, Math.round(editedRect.width)));
    const bottom = Math.min(imageHeight, y + Math.max(1, Math.round(editedRect.height)));

    return {
        x,
        y,
        width: Math.max(1, right - x),
        height: Math.max(1, bottom - y),
    };
}

export function computeInpaintBlendRadii(
    imageWidth: number,
    imageHeight: number,
    bounds: InpaintMaskBounds | null,
): { expandPx: number; featherPx: number } {
    const minDim = Math.max(1, Math.min(imageWidth, imageHeight));
    const maskMax = bounds ? Math.max(bounds.width, bounds.height) : minDim;
    const expandPx = Math.round(Math.max(4, Math.min(32, Math.max(minDim * 0.008, maskMax * 0.08))));
    const featherPx = Math.round(Math.max(6, Math.min(32, expandPx * 1.15)));
    return { expandPx, featherPx };
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
 * of the smaller dimension, the gradients from opposite sides would overlap
 * in the centre and leave it semi-transparent. We clamp to
 * `floor((min(width, height) - 1) / 2)` — the `-1` accounts for the bottom/
 * right edges being indexed at H-1/W-1 rather than H/W, which would otherwise
 * leave the centre row 1px under-opaque even at the natural-looking limit.
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
    // `-1` because the bottom/right edges are indexed at H-1/W-1: with the
    // un-tightened bound the gradients from opposite sides meet at the centre
    // row with factor < 1 (e.g. for H=20 and featherPx=10 the centre pixel has
    // bottom factor 9/10 = 0.9). Floor((min-1)/2) guarantees an unfeathered
    // interior at least one pixel wide.
    const maxFeather = Math.floor((Math.min(width, height) - 1) / 2);
    return Math.max(0, Math.min(featherPx, maxFeather));
}

/**
 * Pixel radius of the feather fade applied around the original when the
 * composite step blends original-on-top-of-bria. Exported so the outpaint
 * pipeline can compute the same "definitely-overwritten" centre rectangle
 * for the border-only upscale optimisation — the centre minus this feather
 * ring is the region where the original is fully opaque, hence the bria
 * pixels underneath are wasted compute and don't need to be upscaled.
 *
 * Formula: clamped to [24, 64] px, sized to ~4% of the smaller dimension.
 * If both callers ever drift, the seam will gain a visible step.
 */
export function computeFeatherPx(origW: number, origH: number): number {
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

/**
 * Post-compose an inpaint result over the original image so untouched regions
 * stay pixel-identical to the source. Some providers return a full image with
 * subtle changes outside the requested mask, or return a different resolution;
 * this keeps the output at the original natural size and accepts provider
 * pixels only through the painted edit mask.
 */
export async function compositeInpaintResult(
    params: CompositeInpaintParams,
): Promise<string> {
    const [editedImg, originalImg, maskImg] = await Promise.all([
        loadImageWithRetry(params.editedSrc),
        loadImageWithRetry(params.originalSrc),
        loadImageWithRetry(params.maskSrc),
    ]);

    const origW = originalImg.naturalWidth;
    const origH = originalImg.naturalHeight;

    const canvas = document.createElement("canvas");
    canvas.width = origW;
    canvas.height = origH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create 2d context for inpaint compositing");

    ctx.drawImage(originalImg, 0, 0, origW, origH);

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = origW;
    maskCanvas.height = origH;
    const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
    if (!maskCtx) throw new Error("Failed to create inpaint mask context");
    maskCtx.imageSmoothingEnabled = true;
    maskCtx.imageSmoothingQuality = "high";
    maskCtx.drawImage(maskImg, 0, 0, origW, origH);

    const rawMask = maskCtx.getImageData(0, 0, origW, origH);
    const editAlpha = normalizeInpaintMaskAlpha(rawMask.data, params.maskAlphaMode);
    const maskBounds = getInpaintMaskBounds(editAlpha, origW);
    const defaultRadii = computeInpaintBlendRadii(origW, origH, maskBounds);
    const blendMode = params.blendMode ?? "seamless";
    const expandPx = Math.max(0, Math.round(params.maskExpandPx ?? 0));
    const featherPx = Math.max(0, Math.round(params.featherPx ?? defaultRadii.featherPx));
    const outsideBlendPx = blendMode === "seamless"
        ? Math.max(0, Math.round(params.outsideBlendPx ?? computeInpaintOutsideBlendPx(origW, origH, maskBounds)))
        : 0;
    const outsideBlendOpacity = Math.max(0, Math.min(1, params.outsideBlendOpacity ?? INPAINT_OUTSIDE_BLEND_OPACITY));
    const seamColorMatch = params.seamColorMatch ?? true;
    const normalizedMask = maskCtx.createImageData(origW, origH);
    for (let i = 0, p = 0; p < editAlpha.length; i += 4, p++) {
        normalizedMask.data[i] = 255;
        normalizedMask.data[i + 1] = 255;
        normalizedMask.data[i + 2] = 255;
        normalizedMask.data[i + 3] = editAlpha[p];
    }
    maskCtx.clearRect(0, 0, origW, origH);
    maskCtx.putImageData(normalizedMask, 0, 0);

    let allowedMaskCanvas: HTMLCanvasElement = maskCanvas;
    if (expandPx > 0) {
        allowedMaskCanvas = buildDilatedMaskCanvas(maskCanvas, origW, origH, expandPx);
    }
    const outerAllowedMaskCanvas = outsideBlendPx > 0
        ? buildDilatedMaskCanvas(allowedMaskCanvas, origW, origH, outsideBlendPx)
        : allowedMaskCanvas;

    let maskForComposite: HTMLCanvasElement = allowedMaskCanvas;
    if (featherPx > 0) {
        const featherCanvas = document.createElement("canvas");
        featherCanvas.width = origW;
        featherCanvas.height = origH;
        const featherCtx = featherCanvas.getContext("2d");
        if (!featherCtx) throw new Error("Failed to create inpaint feather context");
        featherCtx.filter = `blur(${featherPx}px)`;
        featherCtx.drawImage(allowedMaskCanvas, 0, 0);
        featherCtx.filter = "none";
        maskForComposite = featherCanvas;
    }

    const finalMaskCanvas = document.createElement("canvas");
    finalMaskCanvas.width = origW;
    finalMaskCanvas.height = origH;
    const finalMaskCtx = finalMaskCanvas.getContext("2d", { willReadFrequently: true });
    if (!finalMaskCtx) throw new Error("Failed to create inpaint final mask context");
    finalMaskCtx.drawImage(maskForComposite, 0, 0);
    const finalMaskData = finalMaskCtx.getImageData(0, 0, origW, origH);

    const allowedMaskReadCanvas = document.createElement("canvas");
    allowedMaskReadCanvas.width = origW;
    allowedMaskReadCanvas.height = origH;
    const allowedMaskReadCtx = allowedMaskReadCanvas.getContext("2d", { willReadFrequently: true });
    if (!allowedMaskReadCtx) throw new Error("Failed to create inpaint allowed mask context");
    allowedMaskReadCtx.drawImage(allowedMaskCanvas, 0, 0);
    const allowedMaskData = allowedMaskReadCtx.getImageData(0, 0, origW, origH);

    const outerAllowedMaskReadCanvas = document.createElement("canvas");
    outerAllowedMaskReadCanvas.width = origW;
    outerAllowedMaskReadCanvas.height = origH;
    const outerAllowedMaskReadCtx = outerAllowedMaskReadCanvas.getContext("2d", { willReadFrequently: true });
    if (!outerAllowedMaskReadCtx) throw new Error("Failed to create inpaint outer mask context");
    outerAllowedMaskReadCtx.drawImage(outerAllowedMaskCanvas, 0, 0);
    const outerAllowedMaskData = outerAllowedMaskReadCtx.getImageData(0, 0, origW, origH);

    const candidateAlpha = extractAlphaPlane(finalMaskData.data, editAlpha.length);
    const allowedAlpha = extractAlphaPlane(allowedMaskData.data, editAlpha.length);
    const outerAllowedAlpha = extractAlphaPlane(outerAllowedMaskData.data, editAlpha.length);
    const resolvedAlpha = computeInpaintCompositeMaskAlpha(
        candidateAlpha,
        allowedAlpha,
        editAlpha,
        {
            blendMode,
            contextOpacity: params.contextOpacity ?? 0,
            outsideBlendOpacity,
            outerAllowedAlpha,
        },
    );
    for (let i = 0, p = 0; p < resolvedAlpha.length; i += 4, p++) {
        finalMaskData.data[i] = 255;
        finalMaskData.data[i + 1] = 255;
        finalMaskData.data[i + 2] = 255;
        finalMaskData.data[i + 3] = resolvedAlpha[p];
    }
    finalMaskCtx.putImageData(finalMaskData, 0, 0);

    const editedCanvas = document.createElement("canvas");
    editedCanvas.width = origW;
    editedCanvas.height = origH;
    const editedCtx = editedCanvas.getContext("2d");
    if (!editedCtx) throw new Error("Failed to create edited inpaint context");
    editedCtx.imageSmoothingEnabled = true;
    editedCtx.imageSmoothingQuality = "high";
    const editedRect = resolveInpaintEditedRect(params.editedRect, origW, origH);
    editedCtx.drawImage(
        editedImg,
        0,
        0,
        editedImg.naturalWidth,
        editedImg.naturalHeight,
        editedRect.x,
        editedRect.y,
        editedRect.width,
        editedRect.height,
    );
    if (blendMode === "seamless" && seamColorMatch) {
        try {
            const originalData = ctx.getImageData(0, 0, origW, origH);
            const editedData = editedCtx.getImageData(0, 0, origW, origH);
            const delta = computeInpaintSeamColorDelta(
                originalData.data,
                editedData.data,
                resolvedAlpha,
                editAlpha,
            );
            if (delta) {
                applyInpaintSeamColorDelta(editedData.data, resolvedAlpha, delta);
                editedCtx.putImageData(editedData, 0, 0);
            }
        } catch (err) {
            console.error("[compositeInpaintResult] seam colour-match step failed:", err);
        }
    }
    editedCtx.globalCompositeOperation = "destination-in";
    editedCtx.drawImage(finalMaskCanvas, 0, 0);

    ctx.drawImage(editedCanvas, 0, 0);

    const png = canvas.toDataURL("image/png");
    if (png.length * 0.75 > 15 * 1024 * 1024) {
        return canvas.toDataURL("image/webp", 0.95);
    }
    return png;
}
