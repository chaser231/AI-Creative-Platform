/**
 * Shared outpaint pipeline used by the studio (AIPromptBar) and the wizard
 * (WizardContentWorkspace). Encapsulates the full Bria-expand workflow:
 *
 *   1. Load source image, derive natural pixel dimensions
 *   2. Convert canvas-space padding to image-pixel padding
 *   3. If final dimensions exceed the model's safe ceiling, downscale base
 *      image and (when the downscale is aggressive enough) remember the
 *      original to composite back on top later
 *   4. POST to /api/ai/image-edit with action=outpaint, model=bria-expand
 *   5. Optionally upscale the result and composite the original at native
 *      resolution into the center to keep pixel-perfect quality (only the
 *      generated border is AI)
 *
 * Returning a `{ src, model, pixelPadding }` triple lets callers update
 * downstream layer geometry consistently. The function never throws on a
 * recoverable preserve-pipeline failure — it falls back to the raw expand
 * result.
 */

import { uploadForAI, persistImageToS3 } from "./imageUpload";
import { compositeExpandResult, computeFeatherPx } from "./imageComposite";

/**
 * Upper bound for any side of the final outpaint canvas before we downscale
 * the base image. flux-2-pro-outpaint has no fixed output ceiling (only the
 * per-side 2048 cap below); bria-expand officially handles 5000×5000. We keep
 * 200 px headroom under bria's limit so a flux→bria fallback still fits, and
 * pick 4800 to drastically cut how often the downscale-and-upscale path runs
 * (vs the old 3500 ceiling which kicked in for almost every banner-sized job).
 */
const MAX_FINAL_DIMENSION = 4800;
/** When downscale ratio drops below this, switch on the preserve-original pipeline. */
const PRESERVE_THRESHOLD = 0.85;
/**
 * Per-side expansion cap for flux-2-pro-outpaint (hard model limit, 2026-05).
 * When any side requests more than this we fall back to bria-expand for the
 * call. Phase 5 will replace this with a proper multipass loop.
 */
const FLUX2_PER_SIDE_CAP = 2048;
/** Default outpaint model used when callers don't override. */
const DEFAULT_OUTPAINT_MODEL = "flux-2-pro-outpaint";

export interface OutpaintCanvasPadding {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface OutpaintParams {
    /** Image source to expand (S3 URL, https URL, or data URI). */
    imageSrc: string;
    /** Padding to add per side, expressed in canvas (layer) pixels. */
    canvasPadding: OutpaintCanvasPadding;
    /**
     * Layer width/height in canvas pixels. Used to derive the
     * canvas→image pixel scale, so the padding lands at the right
     * absolute resolution regardless of how big the source file is.
     */
    layerSize: { width: number; height: number };
    /** Optional natural language hint forwarded to bria-expand. */
    prompt?: string;
    /** Project id for S3 namespacing (defaults to a temp namespace). */
    projectId?: string;
    /** Optional callback for progress logging. */
    onProgress?: (stage: string, info?: Record<string, unknown>) => void;
    /**
     * Outpaint model id. Defaults to "flux-2-pro-outpaint" — overrides are
     * primarily a kill-switch (e.g. NEXT_PUBLIC_OUTPAINT_MODEL=bria-expand).
     * If the chosen model has a per-side cap the pipeline may fall back to
     * bria-expand transparently for individual calls.
     */
    model?: string;
}

export interface OutpaintResult {
    /** Final image src — may be a data URI (composite) or a remote URL. */
    src: string;
    /** Model id reported by the server (or fallback "bria-expand"). */
    model: string;
    /**
     * The padding actually applied in image-pixel space (post any downscale
     * conversion + rounding). Useful for callers that need to update layer
     * geometry to match the new image bounds in canvas space.
     */
    pixelPadding: OutpaintCanvasPadding;
    /** True if any padding side was non-zero (i.e. an outpaint actually ran). */
    expanded: boolean;
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 80)}...`));
        img.src = src;
    });
}

/**
 * Classify a preserve-pipeline failure for structured telemetry. Distinguishes
 * the failure modes we have actually seen in production so deploys with new
 * symptoms surface a recognisable `reason` tag immediately.
 */
function classifyPreserveErr(e: unknown): string {
    if (e instanceof DOMException && e.name === "SecurityError") return "tainted-canvas";
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("timed out")) return "image-load-timeout";
    if (msg.includes("Failed to load image")) return "image-load-error";
    if (msg.includes("2d context")) return "context-null";
    if (msg.includes("toDataURL")) return "todataurl-memory";
    return "unknown";
}

/**
 * Extract the host of a src for telemetry without ever throwing.
 * Data URIs are bucketed under "data-uri" since they have no host.
 */
function safeHost(src: string | null | undefined): string {
    if (!src) return "none";
    if (src.startsWith("data:")) return "data-uri";
    try {
        return new URL(src).host;
    } catch {
        return "invalid-url";
    }
}

const S3_HOST = "storage.yandexcloud.net";

/**
 * Guarantee a canvas-safe src before we draw it. Tainted-canvas SecurityErrors
 * during compositeExpandResult were a major source of preserve-pipeline
 * fallbacks — they happen whenever we draw a cross-origin image whose response
 * is missing the right CORS headers.
 *
 * Rules:
 *   - Data URIs and S3-hosted URLs are already canvas-safe → return as-is.
 *   - Anything else must be rehosted onto our S3 (via persistImageToS3, which
 *     internally uses presigned PUT or the /api/upload proxy). We retry once
 *     for transient network errors.
 *   - If rehosting can't produce an S3 URL but the source was a data URI we
 *     already handled above; for cross-origin URLs we throw so the outer
 *     catch logs structured telemetry instead of silently tainting the canvas.
 */
async function persistOrThrow(
    src: string,
    projectId: string,
    label: string,
): Promise<string> {
    if (src.startsWith("data:")) return src;
    if (src.includes(S3_HOST)) return src;

    let result = await persistImageToS3(src, projectId);
    if (result.includes(S3_HOST)) return result;

    // Transient failure — retry once.
    result = await persistImageToS3(src, projectId);
    if (result.includes(S3_HOST)) return result;

    // The /api/upload proxy with {url} body (used by uploadExternalUrlToS3
    // inside persistImageToS3) is our last line of defence. If we got here,
    // both attempts returned the input unchanged. Surface this so the outer
    // catch in outpaintImage records structured telemetry.
    throw new Error(
        `persist-failed: ${label} (could not rehost cross-origin source onto S3)`,
    );
}

/**
 * Border-only upscale optimisation.
 *
 * After the feathered composite (compositeExpandResult) the centre of the
 * bria/flux output is OVERWRITTEN by the truly-original pixels (modulo a
 * `featherPx` ring). Upscaling the centre is wasted compute. This helper
 * crops the four border strips out of the bria result, upscales each one
 * in parallel, and stitches them back at the full final resolution. The
 * centre of the stitched canvas is left transparent — the composite step
 * draws the fully-opaque original on top of it anyway.
 *
 * Layout (no overlap — corners belong to top/bottom):
 *   +-----------------------+
 *   |          top          |
 *   +------+--------+-------+
 *   | left | centre | right |
 *   +------+--------+-------+
 *   |        bottom         |
 *   +-----------------------+
 *
 * On any failure (single strip, network, codec) the helper throws and the
 * caller falls back to upscaling the whole expanded result. A throw here is
 * NEVER fatal to the outpaint job — it just means we paid for a bigger
 * upscale than strictly necessary.
 */
async function upscaleBordersOnly(opts: {
    /** Bria/flux outpaint result image src (URL or data URI). */
    briaSrc: string;
    /** Final stitched canvas size (post-upscale, full resolution). */
    finalSize: { w: number; h: number };
    /**
     * "Definitely-overwritten" centre rectangle in final-canvas coordinates.
     * Pixels inside this rect get fully-opaque original drawn on top by the
     * composite step, so we can leave the bria pixels there transparent.
     */
    centreRect: { x: number; y: number; w: number; h: number };
    /** Upscale factor passed to the upscale endpoint (1..4). */
    upscaleScale: number;
    /** S3 namespace for any temporary strip uploads. */
    projectId: string;
    onProgress?: (stage: string, info?: Record<string, unknown>) => void;
}): Promise<string> {
    const { briaSrc, finalSize, centreRect, upscaleScale, projectId, onProgress } = opts;

    // Persist bria result to S3 first to guarantee a CORS-safe load.
    // Strip cropping needs getImageData on the loaded image; a tainted canvas
    // would throw SecurityError. fal.media URLs are CORS-friendly in practice
    // but persistOrThrow gives us a uniform guarantee.
    const briaSafeSrc = await persistOrThrow(briaSrc, projectId, "bria-result-for-strips");
    const briaImg = await loadImage(briaSafeSrc);
    const briaW = briaImg.naturalWidth;
    const briaH = briaImg.naturalHeight;

    const finalW = finalSize.w;
    const finalH = finalSize.h;
    const finalCentreXEnd = centreRect.x + centreRect.w;
    const finalCentreYEnd = centreRect.y + centreRect.h;

    // Map centre-rect endpoints from final-space to bria-space. Endpoints
    // (not widths) are rounded to avoid sub-pixel gaps between strips and
    // keep the centre-cutout pixel-aligned.
    const briaCentreX = Math.round((centreRect.x * briaW) / finalW);
    const briaCentreY = Math.round((centreRect.y * briaH) / finalH);
    const briaCentreXEnd = Math.round((finalCentreXEnd * briaW) / finalW);
    const briaCentreYEnd = Math.round((finalCentreYEnd * briaH) / finalH);

    type Strip = {
        name: "top" | "bottom" | "left" | "right";
        // Source crop rectangle inside the bria result.
        src: { x: number; y: number; w: number; h: number };
        // Destination rectangle inside the final stitched canvas.
        dst: { x: number; y: number; w: number; h: number };
    };

    const strips: Strip[] = [
        {
            name: "top",
            src: { x: 0, y: 0, w: briaW, h: briaCentreY },
            dst: { x: 0, y: 0, w: finalW, h: centreRect.y },
        },
        {
            name: "bottom",
            src: { x: 0, y: briaCentreYEnd, w: briaW, h: briaH - briaCentreYEnd },
            dst: { x: 0, y: finalCentreYEnd, w: finalW, h: finalH - finalCentreYEnd },
        },
        {
            name: "left",
            src: { x: 0, y: briaCentreY, w: briaCentreX, h: briaCentreYEnd - briaCentreY },
            dst: { x: 0, y: centreRect.y, w: centreRect.x, h: centreRect.h },
        },
        {
            name: "right",
            src: {
                x: briaCentreXEnd,
                y: briaCentreY,
                w: briaW - briaCentreXEnd,
                h: briaCentreYEnd - briaCentreY,
            },
            dst: {
                x: finalCentreXEnd,
                y: centreRect.y,
                w: finalW - finalCentreXEnd,
                h: centreRect.h,
            },
        },
    ];

    // A side with pad=0 still has a featherPx-wide strip on that side
    // (the feather ring on the original). A truly-empty strip (zero in
    // either dimension) only appears at degenerate canvas sizes — skip it.
    const validStrips = strips.filter(
        (s) => s.src.w > 0 && s.src.h > 0 && s.dst.w > 0 && s.dst.h > 0,
    );

    if (validStrips.length === 0) {
        throw new Error("upscaleBordersOnly: no non-empty strips (degenerate centre)");
    }

    // Cost-savings telemetry: centreFraction is the fraction of pixel area
    // we no longer pay an upscale call on (because the original overwrites
    // it). For a 1192×300 image with 200px pad on each side and featherPx=24,
    // centreFraction ≈ 0.26 → we save ~26% of the upscale work.
    const totalArea = finalW * finalH;
    const centreArea = centreRect.w * centreRect.h;
    const centreFraction = totalArea > 0 ? centreArea / totalArea : 0;
    const stripsTelemetry = validStrips.map((s) => ({
        name: s.name,
        srcW: s.src.w,
        srcH: s.src.h,
        dstW: s.dst.w,
        dstH: s.dst.h,
    }));
    console.log("[outpaintPipeline] border-only-upscale", {
        briaW,
        briaH,
        finalW,
        finalH,
        centreFraction: Math.round(centreFraction * 1000) / 1000,
        borderFraction: Math.round((1 - centreFraction) * 1000) / 1000,
        upscaleScale,
        strips: stripsTelemetry,
    });
    onProgress?.("border-strips-prepared", {
        strips: validStrips.length,
        centreFraction,
    });

    // Crop, upload, and upscale every strip in parallel. Promise.all rejects
    // on the first failure → caller falls back to whole-image upscale. This
    // is intentional: a partial border-strip upscale would leave a visible
    // seam, so all-or-nothing is safer than mix-and-match.
    const upscaledStrips = await Promise.all(
        validStrips.map(async (strip) => {
            const cropCanvas = document.createElement("canvas");
            cropCanvas.width = strip.src.w;
            cropCanvas.height = strip.src.h;
            const cctx = cropCanvas.getContext("2d");
            if (!cctx) {
                throw new Error(`upscaleBordersOnly: 2d context unavailable for strip ${strip.name}`);
            }
            // Pixel-exact crop — no resampling at this stage.
            cctx.imageSmoothingEnabled = false;
            cctx.drawImage(
                briaImg,
                strip.src.x, strip.src.y, strip.src.w, strip.src.h,
                0, 0, strip.src.w, strip.src.h,
            );
            const cropDataUri = cropCanvas.toDataURL("image/png");

            const cropUrl = await uploadForAI(cropDataUri, projectId);
            const upscaleRes = await fetch("/api/ai/image-edit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "upscale",
                    imageBase64: cropUrl,
                    model: "topaz-hf-v2",
                    upscaleScale,
                    projectId,
                }),
            });
            const upscaleData = await upscaleRes.json();
            if (upscaleData.error || !upscaleData.content) {
                throw new Error(
                    `upscaleBordersOnly: strip ${strip.name} failed (${upscaleData.error ?? "empty response"})`,
                );
            }
            const safeStripSrc = await persistOrThrow(
                upscaleData.content as string,
                projectId,
                `strip-${strip.name}-upscaled`,
            );
            const stripImg = await loadImage(safeStripSrc);
            return { strip, img: stripImg };
        }),
    );

    // Stitch onto a finalSize-sized canvas. Centre stays transparent — the
    // composite step draws fully-opaque original pixels on top of it; the
    // featherPx ring around the centre IS covered by border strips.
    const stitchCanvas = document.createElement("canvas");
    stitchCanvas.width = finalW;
    stitchCanvas.height = finalH;
    const sctx = stitchCanvas.getContext("2d");
    if (!sctx) throw new Error("upscaleBordersOnly: 2d context unavailable for stitch canvas");
    // The upscaled strip dimensions don't exactly match dst.w/dst.h (Topaz
    // upscale_factor is rounded up), so drawImage downsamples slightly to
    // fit. High-quality smoothing keeps the seam between adjacent strips
    // (which all overlap by 0 px in dst-space) visually clean.
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";

    for (const { strip, img } of upscaledStrips) {
        sctx.drawImage(img, strip.dst.x, strip.dst.y, strip.dst.w, strip.dst.h);
    }

    onProgress?.("border-strips-stitched", { finalW, finalH });
    return stitchCanvas.toDataURL("image/png");
}

export async function outpaintImage(params: OutpaintParams): Promise<OutpaintResult> {
    const {
        imageSrc,
        canvasPadding,
        layerSize,
        prompt,
        projectId,
        onProgress,
        model,
    } = params;
    let chosenModel = model ?? DEFAULT_OUTPAINT_MODEL;

    const totalCanvasPad =
        canvasPadding.top + canvasPadding.right + canvasPadding.bottom + canvasPadding.left;
    if (totalCanvasPad <= 0) {
        return {
            src: imageSrc,
            model: "bria-expand",
            pixelPadding: { top: 0, right: 0, bottom: 0, left: 0 },
            expanded: false,
        };
    }

    let img: HTMLImageElement;
    try {
        img = await loadImage(imageSrc);
    } catch (e) {
        throw new Error(
            `outpaintImage: source image failed to load (${(e as Error).message})`,
        );
    }

    let realW = img.naturalWidth;
    let realH = img.naturalHeight;

    const layerW = Math.max(1, layerSize.width);
    const layerH = Math.max(1, layerSize.height);
    const pixelScaleX = realW / layerW;
    const pixelScaleY = realH / layerH;

    let targetPadTop = canvasPadding.top * pixelScaleY;
    let targetPadRight = canvasPadding.right * pixelScaleX;
    let targetPadBottom = canvasPadding.bottom * pixelScaleY;
    let targetPadLeft = canvasPadding.left * pixelScaleX;

    const finalW = realW + targetPadLeft + targetPadRight;
    const finalH = realH + targetPadTop + targetPadBottom;

    let baseImageSrc = imageSrc;
    let preserveOriginalSrc: string | null = null;
    let preserveOriginalPixelPadding: OutpaintCanvasPadding | null = null;
    let downscaleRatio = 1;

    if (finalW > MAX_FINAL_DIMENSION || finalH > MAX_FINAL_DIMENSION) {
        downscaleRatio = Math.min(MAX_FINAL_DIMENSION / finalW, MAX_FINAL_DIMENSION / finalH);

        if (downscaleRatio < PRESERVE_THRESHOLD) {
            preserveOriginalSrc = imageSrc;
            preserveOriginalPixelPadding = {
                top: targetPadTop,
                right: targetPadRight,
                bottom: targetPadBottom,
                left: targetPadLeft,
            };
            onProgress?.("preserve-pipeline-armed", { ratio: downscaleRatio });
        }

        realW = Math.round(realW * downscaleRatio);
        realH = Math.round(realH * downscaleRatio);
        targetPadTop *= downscaleRatio;
        targetPadRight *= downscaleRatio;
        targetPadBottom *= downscaleRatio;
        targetPadLeft *= downscaleRatio;

        const canvas = document.createElement("canvas");
        canvas.width = realW;
        canvas.height = realH;
        const ctx = canvas.getContext("2d");
        if (ctx) {
            ctx.drawImage(img, 0, 0, realW, realH);
            baseImageSrc = canvas.toDataURL("image/png");
            onProgress?.("downscaled", { width: realW, height: realH, ratio: downscaleRatio });
        }
    }

    const sentPadding: OutpaintCanvasPadding = {
        top: Math.round(targetPadTop),
        right: Math.round(targetPadRight),
        bottom: Math.round(targetPadBottom),
        left: Math.round(targetPadLeft),
    };
    const originalSize: [number, number] = [realW, realH];

    // Per-side cap check for flux-2-pro-outpaint (2048 px hard model limit).
    // Phase 5 will replace this simple fallback with a proper multipass loop;
    // for now, drop to bria-expand for the offending call so we don't lose
    // the image entirely.
    if (chosenModel === "flux-2-pro-outpaint") {
        const maxSide = Math.max(
            sentPadding.top,
            sentPadding.right,
            sentPadding.bottom,
            sentPadding.left,
        );
        if (maxSide > FLUX2_PER_SIDE_CAP) {
            console.warn("[outpaintPipeline] flux-2-over-cap-fallback", {
                maxSide,
                cap: FLUX2_PER_SIDE_CAP,
            });
            chosenModel = "bria-expand";
        }
    }

    const imageUrl = await uploadForAI(baseImageSrc, projectId ?? "ai-tmp");

    const response = await fetch("/api/ai/image-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            action: "outpaint",
            prompt: prompt && prompt.trim().length > 0 ? prompt : "Fill seamlessly",
            imageBase64: imageUrl,
            model: chosenModel,
            expandPadding: sentPadding,
            originalSize,
            projectId,
        }),
    });
    const data = await response.json();
    if (data.error) {
        throw new Error(data.requestId ? `${data.error} [request: ${data.requestId}]` : data.error);
    }
    if (!data.content) {
        throw new Error("outpaintImage: empty response from /api/ai/image-edit");
    }

    let finalContent: string = data.content;

    if (preserveOriginalSrc && preserveOriginalPixelPadding) {
        // Hoisted so the outer catch can include it in structured telemetry.
        let expandedSrcForComposite: string | null = null;
        try {
            onProgress?.("preserve-upscale-start");
            const upscaleScale = Math.min(Math.ceil(1 / downscaleRatio), 4);

            // Reconstruct the full (pre-downscale) original dimensions and
            // the final canvas size that compositeExpandResult will produce.
            // realW/H here are post-downscale, so divide by downscaleRatio
            // to recover the original-resolution figures.
            const origW = downscaleRatio > 0 ? realW / downscaleRatio : realW;
            const origH = downscaleRatio > 0 ? realH / downscaleRatio : realH;
            const pad = preserveOriginalPixelPadding;
            const finalW = Math.round(origW + pad.left + pad.right);
            const finalH = Math.round(origH + pad.top + pad.bottom);
            const featherPx = computeFeatherPx(origW, origH);

            // Border-only upscale path: skip compute on the centre that the
            // composite step will overwrite anyway. Falls through to the
            // whole-image path on any failure (or if the feather radius is
            // larger than half the original — then every centre pixel might
            // be feathered and we need bria coverage everywhere).
            let upscaledContent: string | null = null;
            const canBorderOnly =
                featherPx * 2 < origW &&
                featherPx * 2 < origH &&
                origW > 2 * featherPx &&
                origH > 2 * featherPx;

            if (canBorderOnly) {
                const centreRect = {
                    x: Math.round(pad.left + featherPx),
                    y: Math.round(pad.top + featherPx),
                    w: Math.round(origW - 2 * featherPx),
                    h: Math.round(origH - 2 * featherPx),
                };
                try {
                    upscaledContent = await upscaleBordersOnly({
                        briaSrc: data.content as string,
                        finalSize: { w: finalW, h: finalH },
                        centreRect,
                        upscaleScale,
                        projectId: projectId ?? "ai-tmp",
                        onProgress,
                    });
                } catch (borderErr) {
                    // Border-only is a best-effort optimisation; on failure
                    // we just pay for the whole-image upscale instead. Log
                    // via the same structured telemetry as preserve-fallback
                    // so production monitoring can spot recurring causes.
                    console.warn("[outpaintPipeline] border-only-upscale-fallback", {
                        reason: classifyPreserveErr(borderErr),
                        message: borderErr instanceof Error ? borderErr.message : String(borderErr),
                        downscaleRatio,
                        finalW,
                        finalH,
                    });
                    upscaledContent = null;
                }
            } else {
                onProgress?.("border-only-skipped-feather-too-large", {
                    featherPx,
                    origW,
                    origH,
                });
            }

            if (!upscaledContent) {
                // Whole-image upscale fallback — the legacy path. Topaz HF
                // v2 stays the model (still structure-preserving); we just
                // pay for upscaling pixels that will get overwritten.
                const upscaleImageUrl = await uploadForAI(data.content as string, projectId);
                const upscaleRes = await fetch("/api/ai/image-edit", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "upscale",
                        imageBase64: upscaleImageUrl,
                        model: "topaz-hf-v2",
                        upscaleScale,
                        projectId,
                    }),
                });
                const upscaleData = await upscaleRes.json();
                if (upscaleData.content && !upscaleData.error) {
                    upscaledContent = upscaleData.content as string;
                } else {
                    console.error("[outpaintPipeline] upscale-failed", {
                        error: upscaleData.error,
                        requestId: upscaleData.requestId,
                        originalHost: safeHost(preserveOriginalSrc),
                        downscaleRatio,
                    });
                }
            }

            if (upscaledContent) {
                // Hard requirement: both srcs must be canvas-safe before we
                // compose. Throwing here is intentional — it routes to the
                // outer catch which emits structured telemetry instead of
                // silently producing a tainted canvas.
                expandedSrcForComposite = await persistOrThrow(
                    upscaledContent,
                    projectId ?? "ai-tmp",
                    "expanded-upscale",
                );

                const originalSrcForComposite = await persistOrThrow(
                    preserveOriginalSrc,
                    projectId ?? "ai-tmp",
                    "preserve-original",
                );

                finalContent = await compositeExpandResult({
                    expandedSrc: expandedSrcForComposite,
                    originalSrc: originalSrcForComposite,
                    pixelPadding: preserveOriginalPixelPadding,
                });
                onProgress?.("preserve-composite-done");
            }
        } catch (preserveErr) {
            const reason = classifyPreserveErr(preserveErr);
            const message = preserveErr instanceof Error ? preserveErr.message : String(preserveErr);
            // Estimate canvas dims: realW/H here are post-downscale, so divide
            // by downscaleRatio to recover the original-resolution canvas size
            // that compositeExpandResult would have used.
            const origEstW = downscaleRatio > 0 ? realW / downscaleRatio : realW;
            const origEstH = downscaleRatio > 0 ? realH / downscaleRatio : realH;
            const canvasW = preserveOriginalPixelPadding
                ? Math.round(origEstW + preserveOriginalPixelPadding.left + preserveOriginalPixelPadding.right)
                : 0;
            const canvasH = preserveOriginalPixelPadding
                ? Math.round(origEstH + preserveOriginalPixelPadding.top + preserveOriginalPixelPadding.bottom)
                : 0;
            console.error("[outpaintPipeline] preserve-fallback", {
                reason,
                message,
                expandedHost: safeHost(expandedSrcForComposite),
                originalHost: safeHost(preserveOriginalSrc),
                canvasW,
                canvasH,
                downscaleRatio,
            });
        }
    }

    return {
        src: finalContent,
        model: (data.model as string) ?? chosenModel,
        pixelPadding: sentPadding,
        expanded: true,
    };
}
