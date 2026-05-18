/**
 * Shared outpaint pipeline used by the studio (AIPromptBar) and the wizard
 * (WizardContentWorkspace). Encapsulates the full outpaint workflow:
 *
 *   1. Load source image, derive natural pixel dimensions
 *   2. Convert canvas-space padding to image-pixel padding
 *   3. Multipass orchestration (Phase 5): if the request would exceed
 *      MAX_FINAL_DIMENSION on either side, OR the per-side image-pixel pad
 *      exceeds FLUX2_PER_SIDE_CAP for flux-2-pro-outpaint, split the
 *      request into two recursive sub-passes that each stay within model
 *      limits. The first pass takes pads up to the cap (or half the
 *      delta for size-driven splits); the second pass adds the remainder
 *      on top of the first pass result. This preserves flux-2-pro-outpaint
 *      quality even for jobs that would otherwise need a heavy downscale
 *      or a fallback to bria-expand.
 *   4. If, after multipass orchestration, final dimensions still exceed
 *      the model's safe ceiling (only possible when the original is
 *      already > MAX_FINAL_DIMENSION), downscale the base image and
 *      (when the downscale is aggressive enough) remember the original
 *      to composite back on top later
 *   5. POST to /api/ai/image-edit with action=outpaint, model defaults to
 *      flux-2-pro-outpaint
 *   6. Optionally upscale the result and composite the original at native
 *      resolution into the center to keep pixel-perfect quality (only the
 *      generated border is AI)
 *
 * Returning a `{ src, model, pixelPadding }` triple lets callers update
 * downstream layer geometry consistently. The function never throws on a
 * recoverable preserve-pipeline failure — it falls back to the raw expand
 * result. The per-side bria-expand fallback (Phase 3) is kept as a deep
 * safety net for the rare case where multipass cannot reduce a pad below
 * FLUX2_PER_SIDE_CAP (e.g. the original image is already huge, forcing a
 * downscale-and-multipass loop that exhausts MAX_OUTPAINT_PASSES).
 */

import { uploadForAI, persistImageToS3 } from "./imageUpload";
import { compositeExpandResult, computeFeatherPx } from "./imageComposite";

/**
 * Upper bound for any side of the final outpaint canvas (image_w + pad_l +
 * pad_r ≤ MAX_FINAL_DIMENSION, same on the height axis). bria-expand
 * officially handles 5000×5000 — we leave 200 px of headroom and pick 4800
 * to drastically cut how often the downscale-and-upscale path runs vs the
 * old 3500 ceiling.
 *
 * flux-2-pro-outpaint has a separate, much stricter ceiling — see
 * FLUX2_FINAL_DIMENSION below. The actual cap used in the pipeline is
 * whichever of these two applies to the chosen model (see `getFinalCap`).
 */
const MAX_FINAL_DIMENSION = 4800;

/**
 * Hard per-axis cap for flux-2-pro-outpaint's final canvas
 * (image_w + pad_l + pad_r ≤ 2560 AND image_h + pad_t + pad_b ≤ 2560).
 * The model rejects anything larger with HTTP 422 and a `value_error`
 * pointing at `expanded canvas dimensions ... exceed the maximum allowed
 * dimension (2560)`. Documented at
 * https://fal.ai/models/fal-ai/flux-2-pro/outpaint and confirmed in
 * production logs.
 *
 * NOTE: this is the *total canvas* cap, not a per-side one. The per-side
 * `expand_top/...` parameters each accept up to 2048, but the final
 * canvas constraint is what fires in practice.
 */
const FLUX2_FINAL_DIMENSION = 2560;

/**
 * Per-side expansion cap for flux-2-pro-outpaint (each `expand_*`
 * parameter is bounded to 0..2048 by the API schema). In practice the
 * total-canvas cap above (FLUX2_FINAL_DIMENSION = 2560) fires before
 * this one for any non-tiny base image, but we keep the constant so
 * the post-downscale defensive guard further down can catch it.
 */
const FLUX2_PER_SIDE_CAP = 2048;

/**
 * Total-area cap for flux-2-pro-outpaint's expanded canvas
 * (final_w × final_h ≤ 4,194,304 = 2048²). The model rejects anything
 * larger with HTTP 422 and a `value_error` pointing at
 * `expanded canvas area (WxH) exceeds the maximum allowed area (4194304 pixels)`.
 *
 * This is the *third* and most restrictive flux constraint, separate
 * from the 2048 per-side cap and the 2560 per-axis cap. A 2560×2305
 * canvas passes both per-side AND per-axis but blows past the area
 * cap (5.9 MP > 4 MP), which is exactly the failure mode reported in
 * production logs.
 *
 * Practically: any rectangle inside ~2048×2048 fits, but tall-or-wide
 * canvases (e.g. 2560×1638 or 1638×2560) are the limit.
 */
const FLUX2_MAX_PIXELS = 4_194_304;

/**
 * Safety margin applied to flux-2-pro's caps when computing the
 * downscale ratio. Without it, a request that's mathematically *just*
 * under the cap can still trip a 422: `sentPadding` rounds each side
 * with Math.round, which can drift up to ~0.5 px per side. On a
 * 2048-px axis that compounds to ~1.5 px of unaccounted growth =
 * ~3000 extra pixels of area = enough to push 4,194,304 → 4,194,937
 * (the actual production failure with 2159×1943).
 *
 * 0.97 = 3% slack on both dim and area caps. On a 2048-px axis this
 * is ~62 px of headroom, far above the worst-case rounding drift.
 * Quality cost is negligible (the source downscales by an extra 1.5%
 * which is invisible after Topaz upscale + composite).
 */
const FLUX2_SAFETY_MARGIN = 0.97;

/**
 * Minimum acceptable downscale ratio when routing a too-big request
 * through flux-2-pro's downscale-and-upscale path. Anything below
 * means the source would be shrunk to less than this fraction of
 * native, and the AI border would have to be magnified by
 * `1 / ratio` afterwards — Topaz HF v2 holds structure well up to
 * ~3× magnification but starts blurring beyond that. When the
 * required ratio is below the threshold we fall back to bria-expand
 * at native resolution instead, accepting bria's content artefacts
 * over a soft / smeared upscaled border.
 *
 * 0.30 corresponds to ≤ 3.33× upscale of the border ring, which is
 * still inside Topaz HF v2's sweet spot.
 */
const FLUX2_MIN_DOWNSCALE_RATIO = 0.30;

/** Returns the final-canvas dimension cap for the given model id. */
function getFinalCap(model: string): number {
    if (model === "flux-2-pro-outpaint") return FLUX2_FINAL_DIMENSION;
    return MAX_FINAL_DIMENSION;
}

/**
 * Compute the largest downscale ratio (≤ 1) that lets `finalW`/`finalH`
 * fit ALL of the model's caps with enough headroom that post-rounding
 * `sentPadding` can't trip them. For bria/topaz this is just the
 * per-axis dimension cap (no safety margin — bria is lenient about a
 * few pixels of overshoot). For flux-2-pro it's the min of:
 *   - per-axis dim cap × FLUX2_SAFETY_MARGIN  (≈ 2483)
 *   - total-area cap   × FLUX2_SAFETY_MARGIN  (≈ 4.07 MP)
 *
 * Returns 1 when the request already fits — callers branch on
 * `< 1` to decide whether downscale is needed.
 *
 * Math note: when the area constraint binds, the resulting ratio is
 * `sqrt(safeAreaCap / area)` — that's the linear ratio that scales
 * each axis isotropically so the *area* lands at the cap.
 *
 * Why the safety margin lives here (not in sentPadding rounding):
 * applying `Math.floor` to sentPadding would force EVERY request
 * (including bria) to be 1-2 px short of what the user asked for.
 * The downscale-time margin only kicks in for flux when a cap binds,
 * and even then only takes 1.5% off the linear ratio.
 */
function computeDownscaleRatio(model: string, finalW: number, finalH: number): number {
    const dimCap = getFinalCap(model);
    if (model === "flux-2-pro-outpaint") {
        const safeDim = dimCap * FLUX2_SAFETY_MARGIN;
        const safeArea = FLUX2_MAX_PIXELS * FLUX2_SAFETY_MARGIN;
        const dimRatio = Math.min(safeDim / finalW, safeDim / finalH, 1);
        const area = finalW * finalH;
        const areaRatio = area > safeArea ? Math.sqrt(safeArea / area) : 1;
        return Math.min(dimRatio, areaRatio);
    }
    return Math.min(dimCap / finalW, dimCap / finalH, 1);
}
/**
 * Maximum number of sequential outpaint API calls per top-level
 * `outpaintImage` invocation. The orchestrator (depth 0) splits a too-big
 * request into exactly two sub-passes (depths 1 and 2). Sub-passes never
 * recurse further — if a sub-pass still exceeds limits (rare, only when the
 * original is already > MAX_FINAL_DIMENSION) it falls through to the
 * single-pass body's own downscale + bria fallback path.
 */
const MAX_OUTPAINT_PASSES = 2;
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
    /**
     * Internal: multipass recursion depth. Outer callers leave this
     * undefined (treated as 0). When the orchestrator splits a request, it
     * sets `_passDepth: 1` on the first sub-pass and `_passDepth: 2` on the
     * second. Sub-passes (any `_passDepth >= 1`) skip multipass
     * orchestration even if their own pads still trip the predicate — they
     * fall through to the single-pass body whose existing downscale and
     * bria-expand fallback handle the residual case. This bounds the total
     * number of sequential API calls to MAX_OUTPAINT_PASSES.
     * @internal
     */
    _passDepth?: number;
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

/**
 * Split a single canvas-space outpaint padding into two sub-pass paddings
 * for multipass orchestration (Phase 5).
 *
 * Two split policies:
 *
 *   - **Cap-split** (when `model === "flux-2-pro-outpaint"` and any pad
 *     side exceeds `FLUX2_PER_SIDE_CAP`): clip every side to the per-side
 *     cap for pass 1; pass 2 receives the remainder. Sides under the cap
 *     pass through fully in pass 1 and contribute 0 to pass 2.
 *   - **Half-split** (every other case where the predicate fired — i.e.
 *     `finalW`/`finalH > MAX_FINAL_DIMENSION` but no side exceeds the cap,
 *     or the model isn't subject to the per-side cap at all): each side
 *     gets `floor(pad / 2)` in pass 1, with the remainder (i.e. the odd
 *     pixel for odd pads) going to pass 2. This keeps each pass adding at
 *     most half the size delta so the per-pass final image stays under
 *     `MAX_FINAL_DIMENSION` whenever the original is already within it.
 *
 * `finalW`/`finalH` are accepted for API symmetry with the predicate but
 * are not currently used inside the helper — the model + max-pad check is
 * sufficient to disambiguate the two policies. They're kept so that
 * future tuning (e.g. asymmetric splits when only one dimension exceeds
 * the cap) can land without a signature change.
 *
 * The helper does NOT decide whether multipass should run; the caller
 * checks the predicate first and only invokes this on a positive answer.
 *
 * Edge cases:
 *   - Cap-split with a side already < cap: that side gets passed through
 *     fully in pass 1 (`pass2[side] === 0`), which is correct — the side
 *     doesn't need splitting.
 *   - All sides ≤ cap but final size > max: cap-split is NOT used (the
 *     `isFlux2OverCap` check fails), so half-split fires regardless of
 *     model. Half-splitting still respects the per-side cap because each
 *     half is at most `pad / 2 ≤ pad ≤ cap`.
 *   - Pad of 0 on a side: pass1 = 0, pass2 = 0 (both branches preserve
 *     this).
 *
 * @internal exported only for unit testing.
 */
export function splitPadForPass1(
    pad: OutpaintCanvasPadding,
    model: string,
    finalW: number,
    finalH: number,
): { pass1: OutpaintCanvasPadding; pass2: OutpaintCanvasPadding } {
    void finalW;
    void finalH;

    const maxPad = Math.max(pad.top, pad.right, pad.bottom, pad.left);
    const isFlux2OverCap =
        model === "flux-2-pro-outpaint" && maxPad > FLUX2_PER_SIDE_CAP;

    let pass1: OutpaintCanvasPadding;
    if (isFlux2OverCap) {
        pass1 = {
            top: Math.min(pad.top, FLUX2_PER_SIDE_CAP),
            right: Math.min(pad.right, FLUX2_PER_SIDE_CAP),
            bottom: Math.min(pad.bottom, FLUX2_PER_SIDE_CAP),
            left: Math.min(pad.left, FLUX2_PER_SIDE_CAP),
        };
    } else {
        pass1 = {
            top: Math.floor(pad.top / 2),
            right: Math.floor(pad.right / 2),
            bottom: Math.floor(pad.bottom / 2),
            left: Math.floor(pad.left / 2),
        };
    }

    const pass2: OutpaintCanvasPadding = {
        top: pad.top - pass1.top,
        right: pad.right - pass1.right,
        bottom: pad.bottom - pass1.bottom,
        left: pad.left - pass1.left,
    };

    return { pass1, pass2 };
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
    const passDepth = params._passDepth ?? 0;
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

    // Persist the input src onto our S3 BEFORE anything touches it. Two
    // bugs converge here, both reproducible by triggering outpaint twice
    // in a row in Studio:
    //
    //   1. Browser-side: when layer.src is a fal.media temp URL (e.g.
    //      from a previous fallback that bypassed the composite), the
    //      `loadImage(imageSrc)` call below fails with "Failed to load
    //      image" because we set crossOrigin="anonymous" and fal.media
    //      doesn't return CORS headers — Chrome aborts the load.
    //   2. Server-side: when we forward that same URL to fal.ai's
    //      flux-2-pro-outpaint, the model server can't fetch its own
    //      expired temp URL (or the URL has aged past whatever cache
    //      TTL fal.media uses) and returns HTTP 422 with a validation
    //      error — see the matching error-body capture in ai-providers.ts.
    //
    // We run this for every pass (including sub-passes) — persistOrThrow
    // is a noop for already-S3 / data: srcs, and the recursive
    // multipass call may itself receive a non-S3 src on a fallback path
    // where pass 1's composite was skipped.
    let safeImageSrc = imageSrc;
    try {
        safeImageSrc = await persistOrThrow(
            imageSrc,
            projectId ?? "ai-tmp",
            "outpaint-input",
        );
        if (safeImageSrc !== imageSrc) {
            onProgress?.("input-persisted", {
                fromHost: safeHost(imageSrc),
                toHost: safeHost(safeImageSrc),
                passDepth,
            });
        }
    } catch (e) {
        // Don't fail loud — fall back to the raw src and let loadImage
        // decide. If loadImage *does* succeed we can still continue
        // (e.g. data URIs, same-origin URLs). The structured log makes
        // it obvious when persist itself is the regression.
        const reason = e instanceof Error ? e.message : String(e);
        console.warn(
            `[outpaintPipeline] input-persist-failed reason=${reason} host=${safeHost(imageSrc)} passDepth=${passDepth} — falling back to raw src`,
        );
    }

    let img: HTMLImageElement;
    try {
        img = await loadImage(safeImageSrc);
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

    // ============== PRE-FLIGHT MODEL SELECTION ==============
    // flux-2-pro-outpaint hard-rejects any final canvas > 2560 px with
    // HTTP 422. We have two options:
    //
    //   (A) Swap to bria-expand at native resolution.
    //   (B) Keep flux: downscale source → flux at ≤2560 → upscale back
    //       to native → composite original on top.
    //
    // We pick (B) for quality. Bria's borders frequently hallucinate
    // weird objects ("странные искажённые объекты"); flux extends
    // backgrounds far more coherently. The composite step covers the
    // entire centre with original pixels at native resolution, so the
    // upscale-loss only affects the AI-generated border ring — exactly
    // the area where flux's coherence beats bria's artefacts.
    //
    // Rules for path (B):
    //   - The downscale block further down already supports flux via
    //     `getFinalCap("flux-2-pro-outpaint") === 2560`, so we don't
    //     need to do the downscale here. We just need to make sure
    //     multipass DOESN'T fire for flux (it can't escape 2560 either,
    //     since pass 2 = pass 1 output + extra > 2560).
    //   - If the required downscale is so aggressive that the source
    //     becomes too small for flux to see structure at all
    //     (downscaleRatio < FLUX2_MIN_DOWNSCALE_RATIO), we DO fall
    //     back to bria-expand. At that point the source is < 30% of
    //     native and the upscale would have to magnify the border by
    //     >3.3× — Topaz HF v2 starts losing structure beyond that.
    //
    // The downscale block respects `getFinalCap(chosenModel)`, so it
    // automatically downscales to 2560 for flux and 4800 for bria.
    //
    // Pre-flight is ONLY evaluated at the top level (`passDepth === 0`).
    // For sub-passes the orchestrator above already decided which
    // model to use across the whole multipass run and propagated it
    // explicitly via `params.model` — re-running the switch inside a
    // sub-pass would let pass-2 silently fall back to bria-expand on
    // top of a successful flux pass-1, which is exactly the
    // "пайплайн начался заново через bria и получился размытый"
    // regression we are fixing. Sub-passes that genuinely can't fit
    // their own caps still hit the downscale + per-side fallback
    // logic further down, which is safe model-wise.
    if (chosenModel === "flux-2-pro-outpaint" && passDepth === 0) {
        const projectedRatio = computeDownscaleRatio("flux-2-pro-outpaint", finalW, finalH);
        if (projectedRatio < 1) {
            // Identify which cap binds first so the log is actionable.
            // Both ratios use the same SAFETY_MARGIN as the helper so
            // the binding-cap label matches the helper's actual choice.
            const safeDim = FLUX2_FINAL_DIMENSION * FLUX2_SAFETY_MARGIN;
            const safeArea = FLUX2_MAX_PIXELS * FLUX2_SAFETY_MARGIN;
            const rawDimRatio = Math.min(safeDim / finalW, safeDim / finalH);
            const rawAreaRatio = Math.sqrt(safeArea / (finalW * finalH));
            const bindingCap = rawAreaRatio < rawDimRatio ? "area-4MP" : "per-axis-2560";

            if (projectedRatio < FLUX2_MIN_DOWNSCALE_RATIO) {
                console.warn("[outpaintPipeline] flux2-downscale-too-aggressive-fallback", {
                    finalW: Math.round(finalW),
                    finalH: Math.round(finalH),
                    projectedRatio: projectedRatio.toFixed(3),
                    threshold: FLUX2_MIN_DOWNSCALE_RATIO,
                    bindingCap,
                });
                chosenModel = "bria-expand";
            } else {
                console.log("[outpaintPipeline] flux2-downscale-path", {
                    finalW: Math.round(finalW),
                    finalH: Math.round(finalH),
                    projectedRatio: projectedRatio.toFixed(3),
                    bindingCap,
                    note: "source will be downscaled to satisfy flux caps, then result upscaled back",
                });
            }
        }
    }
    // ============== END PRE-FLIGHT ==============

    // ============== MULTIPASS ORCHESTRATION (Phase 5) ==============
    // Multipass is ONLY useful for bria — splitting a >4800 final size
    // into two smaller passes lets each pass stay under the cap. For
    // flux it can't escape the 2560 ceiling (pass 2 = pass 1 output +
    // extra > 2560), so we route flux through the downscale-and-upscale
    // path instead (handled below by the existing downscale block,
    // since `getFinalCap("flux-2-pro-outpaint") === 2560`).
    const maxImagePixelPad = Math.max(
        targetPadTop,
        targetPadRight,
        targetPadBottom,
        targetPadLeft,
    );
    const finalCap = getFinalCap(chosenModel);
    const needsMultipass =
        chosenModel !== "flux-2-pro-outpaint" &&
        (finalW > finalCap || finalH > finalCap);

    if (needsMultipass && passDepth === 0) {
        const { pass1: pass1Pad, pass2: pass2Pad } = splitPadForPass1(
            canvasPadding,
            chosenModel,
            finalW,
            finalH,
        );
        const pass2Total =
            pass2Pad.top + pass2Pad.right + pass2Pad.bottom + pass2Pad.left;

        if (pass2Total > 0) {
            // Defensive: if pass2Total === 0 the predicate fired but the
            // split is degenerate (e.g. all pads happen to be exactly zero
            // after split). Fall through to single-pass body in that case.
            // eslint-disable-next-line no-console
            console.log("[outpaintPipeline] multipass-orchestrate", {
                reason:
                    chosenModel === "flux-2-pro-outpaint" &&
                    maxImagePixelPad > FLUX2_PER_SIDE_CAP
                        ? "flux2-per-side-cap"
                        : "max-final-dimension",
                chosenModel,
                // `requestedModel` lets us see at a glance whether
                // pre-flight swapped flux→bria for the whole run.
                // After fix-F1 both sub-passes will run on `chosenModel`.
                requestedModel: model ?? DEFAULT_OUTPAINT_MODEL,
                finalW: Math.round(finalW),
                finalH: Math.round(finalH),
                maxImagePixelPad: Math.round(maxImagePixelPad),
                canvasPadding,
                pass1Pad,
                pass2Pad,
            });

            onProgress?.("pass-1-start", { pad: pass1Pad });
            const pass1Result = await outpaintImage({
                ...params,
                canvasPadding: pass1Pad,
                _passDepth: 1,
                // Propagate the top-level model decision (incl. any flux→bria
                // pre-flight swap) so sub-passes don't make their own,
                // potentially conflicting, model choice. See the
                // pre-flight comment above for the regression this prevents.
                model: chosenModel,
            });
            onProgress?.("pass-1-done", {
                model: pass1Result.model,
                pixelPadding: pass1Result.pixelPadding,
            });

            const intermediateLayerSize = {
                width: layerSize.width + pass1Pad.left + pass1Pad.right,
                height: layerSize.height + pass1Pad.top + pass1Pad.bottom,
            };

            onProgress?.("pass-2-start", { pad: pass2Pad });
            const pass2Result = await outpaintImage({
                ...params,
                imageSrc: pass1Result.src,
                canvasPadding: pass2Pad,
                layerSize: intermediateLayerSize,
                _passDepth: 2,
                // See pass 1 above — keep the model decision consistent
                // across the whole multipass run, not just within a single
                // sub-pass.
                model: chosenModel,
            });
            onProgress?.("pass-2-done", {
                model: pass2Result.model,
                pixelPadding: pass2Result.pixelPadding,
            });

            // Combined geometry reflects the FULL applied padding so callers
            // can update layer bounds in canvas space correctly. Each
            // sub-pass already returned its image-pixel pad post-rounding
            // and post any internal downscale; the sum lands in the
            // pass-2-final coordinate system (which is what `pass2Result.src`
            // is rendered in).
            const combinedPixelPadding: OutpaintCanvasPadding = {
                top: pass1Result.pixelPadding.top + pass2Result.pixelPadding.top,
                right: pass1Result.pixelPadding.right + pass2Result.pixelPadding.right,
                bottom: pass1Result.pixelPadding.bottom + pass2Result.pixelPadding.bottom,
                left: pass1Result.pixelPadding.left + pass2Result.pixelPadding.left,
            };

            return {
                src: pass2Result.src,
                model: pass2Result.model,
                pixelPadding: combinedPixelPadding,
                expanded: true,
            };
        }

        // eslint-disable-next-line no-console
        console.warn("[outpaintPipeline] multipass-degenerate-skip", {
            canvasPadding,
            pass1Pad,
            pass2Pad,
        });
        // fall through to single-pass body
    }

    if (needsMultipass && passDepth >= MAX_OUTPAINT_PASSES) {
        // Reached only when the orchestrator's pass 2 itself still trips the
        // predicate — exclusively a downscale-driven scenario (e.g. original
        // is already > MAX_FINAL_DIMENSION so pass 1's downscale forces pad
        // rescaling above the per-side cap on pass 2's input). The
        // single-pass body's downscale + bria-expand fallback below absorbs
        // this gracefully; the warning makes the situation observable.
        // eslint-disable-next-line no-console
        console.warn("[outpaintPipeline] multipass-exhausted", {
            passDepth,
            chosenModel,
            finalW: Math.round(finalW),
            finalH: Math.round(finalH),
            maxImagePixelPad: Math.round(maxImagePixelPad),
        });
    }
    // ============== END MULTIPASS ==============

    let baseImageSrc = safeImageSrc;
    let downscaleRatio = 1;

    // Always arm the preserve-original composite. The preserve step
    // (drop the source image at native resolution onto the AI border)
    // used to fire only when we had to downscale to fit Bria's
    // ceiling — small expands skipped it entirely and shipped a soft
    // AI result. That regression is exactly the "композ игнорируется"
    // symptom in the studio. We capture the padding here in
    // pre-downscale image-pixel space, which is what
    // compositeExpandResult expects (it sizes the canvas to
    // originalImg.naturalWidth + pad.left + pad.right).
    //
    // The downstream upscale call is the one that's conditional on
    // downscaleRatio < 1 — see the `if (downscaleRatio < 1)` branch
    // below. Native-resolution requests stay fast because we skip
    // the upscale and feed the raw bria/flux output straight into
    // the composite.
    const preserveOriginalSrc: string = safeImageSrc;
    const preserveOriginalPixelPadding: OutpaintCanvasPadding = {
        top: targetPadTop,
        right: targetPadRight,
        bottom: targetPadBottom,
        left: targetPadLeft,
    };
    onProgress?.("preserve-pipeline-armed", { ratio: 1 });

    // Downscale to fit ALL the chosen model's caps. For bria/topaz
    // that's just the per-axis 4800 cap. For flux-2-pro it's the min
    // of per-axis 2560, total-area 4 MP, and per-side 2048 (defensive).
    // computeDownscaleRatio bakes all of these into a single ratio.
    const projectedRatio = computeDownscaleRatio(chosenModel, finalW, finalH);
    if (projectedRatio < 1) {
        downscaleRatio = projectedRatio;

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
            onProgress?.("downscaled", {
                width: realW,
                height: realH,
                ratio: downscaleRatio,
                model: chosenModel,
                postArea: realW * realH,
            });
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
    // Phase 5 multipass orchestration above normally splits any too-big
    // request into two sub-passes that each stay under the cap, so this
    // branch is only reachable as a deep safety net when:
    //   1. We're already inside a sub-pass (passDepth >= 1) and that
    //      sub-pass's own predicate fired but couldn't recurse further; OR
    //   2. The orchestrator's downscale step (above) rescaled the per-side
    //      pads above the cap during a multipass-exhausted scenario.
    // Falling back to bria-expand for the offending call keeps the image
    // recoverable instead of letting the API reject the request outright.
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
                passDepth,
            });
            chosenModel = "bria-expand";
        }
    }

    const imageUrl = await uploadForAI(baseImageSrc, projectId ?? "ai-tmp");

    // outpaint-api-start: emitted just before the actual model call so
    // UI consumers can swap to the "AI is generating" message — this is
    // the longest stage in the pipeline (~25-40s on flux-2-pro), so the
    // sooner we surface it the less the user perceives the dead time.
    onProgress?.("outpaint-api-start", { model: chosenModel, finalW: originalSize[0], finalH: originalSize[1] });

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
    onProgress?.("outpaint-api-done", { model: chosenModel });
    const data = await response.json();
    if (data.error) {
        throw new Error(data.requestId ? `${data.error} [request: ${data.requestId}]` : data.error);
    }
    if (!data.content) {
        throw new Error("outpaintImage: empty response from /api/ai/image-edit");
    }

    let finalContent: string = data.content;

    {
        // Hoisted so the outer catch can include it in structured telemetry.
        let expandedSrcForComposite: string | null = null;
        try {
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

            let upscaledContent: string | null = null;

            if (downscaleRatio < 1) {
                onProgress?.("preserve-upscale-start");
                const upscaleScale = Math.min(Math.ceil(1 / downscaleRatio), 4);

                // Border-only upscale path: skip compute on the centre that the
                // composite step will overwrite anyway. Falls through to the
                // whole-image path on any failure (or if the feather radius is
                // larger than half the original — then every centre pixel might
                // be feathered and we need bria coverage everywhere).
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
            } else {
                // No downscale happened → bria/flux already produced the
                // result at native resolution. Skip the upscale call
                // entirely and feed the raw model output straight into
                // the composite. This is what makes small wizard expands
                // (the most common case) fast and lossless.
                onProgress?.("preserve-no-upscale-needed");
                upscaledContent = data.content as string;
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
            const canvasW = Math.round(origEstW + preserveOriginalPixelPadding.left + preserveOriginalPixelPadding.right);
            const canvasH = Math.round(origEstH + preserveOriginalPixelPadding.top + preserveOriginalPixelPadding.bottom);
            // Inline the structured fields into the message string so
            // the Next.js dev-overlay (which sometimes drops the second
            // console arg) doesn't render this as `preserve-fallback {}`.
            // Demoted from console.error → console.warn because a failed
            // composite is a degraded state, not a blocking error — we
            // still return the raw bria/flux result on `finalContent`,
            // and the user-visible image is still functional.
            console.warn(
                `[outpaintPipeline] preserve-fallback reason=${reason} ` +
                `expandedHost=${safeHost(expandedSrcForComposite)} ` +
                `originalHost=${safeHost(preserveOriginalSrc)} ` +
                `canvas=${canvasW}x${canvasH} downscaleRatio=${downscaleRatio.toFixed(3)} ` +
                `message=${message.slice(0, 200)}`,
            );
        }
    }

    // ============== ALWAYS-RETURN-A-URL ==============
    // Composite returns a 10MB+ PNG data URI; downstream callers (wizard
    // /studio) used to wrap us in their own persistImageToS3 with a
    // permissive fallback to the data URI. That fallback fed straight
    // into ai.addMessage tRPC payloads, which choke at ~10MB JSON with
    // `Unterminated string at position 10452920`. We persist here so
    // the return contract is "always a URL" — callers can store the
    // src directly, no extra persist call, no risk of leaking a data
    // URI into JSON-bound state.
    //
    // Persist failure is non-fatal: we fall back to the raw content
    // (URL or data URI) and log a structured warning. This keeps the
    // image visible to the user even when S3 / proxy is degraded.
    let returnSrc = finalContent;
    if (finalContent.startsWith("data:")) {
        try {
            returnSrc = await persistOrThrow(
                finalContent,
                projectId ?? "ai-tmp",
                "outpaint-output",
            );
            onProgress?.("output-persisted", { toHost: safeHost(returnSrc) });
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            console.warn(
                `[outpaintPipeline] output-persist-failed reason=${reason} ` +
                `falling back to data URI (caller may hit 10MB tRPC limits)`,
            );
        }
    }

    return {
        src: returnSrc,
        model: (data.model as string) ?? chosenModel,
        pixelPadding: sentPadding,
        expanded: true,
    };
}
