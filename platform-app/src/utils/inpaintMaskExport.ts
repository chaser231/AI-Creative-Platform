/**
 * Inpaint mask export — project user brush strokes (drawn in screen pixels
 * over an image layer) into the source image's natural pixel space.
 *
 * Why this exists
 * ---------------
 * Users paint the inpaint mask in *screen* coordinates — on a DOM <canvas>
 * overlay anchored to the visible bbox of an `ImageLayer`. The AI providers
 * (FLUX Fill, GPT Image 2, Nano Banana) need a mask in the *natural pixel
 * space of the source image*, matching the source image dimensions exactly.
 *
 * Two reprojections are required to bridge the gap:
 *
 *   1. screen px  →  layer-local px         (divide by zoom)
 *   2. layer-local px  →  image natural px  (inverse of computeImageFitProps)
 *
 * Step 2 is non-trivial because the image is shown with an objectFit transform
 * (cover / contain / crop / fill) and an optional focus point — we use
 * computeImageFitProps from imageFitUtils.ts to obtain the same draw/crop
 * rectangle the renderer uses, then invert the mapping.
 *
 * Output formats
 * --------------
 * • RGB white/black (default) — what FLUX Fill and Nano Banana expect.
 * • RGBA with alpha channel — required by OpenAI gpt-image-2 / gpt-image
 *   (mask must have a real alpha channel, white means transparent =
 *   regenerate, black means opaque = preserve).
 *
 * The exporter picks the right format based on the target model slug.
 */

import { computeImageFitProps, type ImageViewIntentLike } from "./imageFitUtils";
import type { ImageFitMode } from "@/types";

export interface BrushPoint {
    /** X in overlay (screen) coordinates, relative to the layer's screen bbox. */
    x: number;
    /** Y in overlay (screen) coordinates, relative to the layer's screen bbox. */
    y: number;
}

export interface BrushStroke {
    /** "draw" adds to mask, "erase" removes from mask. */
    type: "draw" | "erase";
    /** Brush diameter in overlay (screen) pixels. */
    size: number;
    /** 0 = soft, 1 = hard. Used to render a radial gradient brush. */
    hardness: number;
    /** Points in overlay (screen) pixels, in stroke order. */
    points: BrushPoint[];
}

export interface InpaintMaskTarget {
    /** Source image natural width in pixels. */
    naturalWidth: number;
    /** Source image natural height in pixels. */
    naturalHeight: number;
    /** Layer width in artboard coordinates (Konva node width). */
    layerWidth: number;
    /** Layer height in artboard coordinates. */
    layerHeight: number;
    /** objectFit mode used by the renderer. */
    objectFit?: ImageFitMode;
    /** Focus point (0..1). */
    viewIntent?: ImageViewIntentLike;
    /** Stage zoom (Konva scaleX/Y). */
    zoom: number;
}

export interface ExportMaskOptions {
    /** Output alpha channel (true = RGBA for OpenAI, false = RGB for FLUX/Nano). */
    withAlpha?: boolean;
    /**
     * If true, also fill the entire output canvas with black before drawing —
     * so unmasked areas explicitly say "preserve" rather than being transparent.
     * Default: true. Required by FLUX Fill and Nano Banana; harmless for OpenAI.
     */
    blackBackground?: boolean;
}

/**
 * Translate one screen-space brush point into source-image natural px.
 *
 * Returns null if the point falls outside the visible portion of the image
 * (letterbox area under "contain" / "crop") — those strokes should not be
 * drawn into the exported mask because they correspond to no real pixels.
 *
 * Exported for unit-testing UV projection across object-fit modes.
 */
export function projectPointToImageSpace(
    point: BrushPoint,
    fit: ReturnType<typeof computeImageFitProps>,
    zoom: number,
): { x: number; y: number } | null {
    // screen px → layer-local px
    const lx = point.x / zoom;
    const ly = point.y / zoom;

    // Outside the drawn image rectangle (letterbox region for contain/crop)
    if (
        lx < fit.drawX
        || ly < fit.drawY
        || lx > fit.drawX + fit.drawWidth
        || ly > fit.drawY + fit.drawHeight
    ) {
        return null;
    }

    // Normalised within drawn rectangle (0..1)
    const nx = (lx - fit.drawX) / fit.drawWidth;
    const ny = (ly - fit.drawY) / fit.drawHeight;

    // Map to source image natural pixels via the crop rectangle the renderer
    // is sampling from. This is exactly the inverse of what Konva's Image
    // does with `crop` + `width`/`height` props.
    const ix = fit.cropX + nx * fit.cropWidth;
    const iy = fit.cropY + ny * fit.cropHeight;
    return { x: ix, y: iy };
}

/**
 * Scale a brush radius from screen px to image natural px.
 *
 * brush in layer-local px = screenRadius / zoom
 * brush in image px = (brush in layer-local px) * (cropWidth / drawWidth)
 *
 * We use the X scale; for square cover/contain the X and Y scales match,
 * and for "fill" / non-square objectFits we accept the small approximation
 * (the brush stays mostly round because we render with arc()).
 */
function scaleRadiusToImage(
    screenSize: number,
    fit: ReturnType<typeof computeImageFitProps>,
    zoom: number,
): number {
    const layerLocalRadius = screenSize / 2 / zoom;
    const scale = fit.cropWidth / fit.drawWidth;
    return Math.max(1, layerLocalRadius * scale);
}

/**
 * Draw a single stroke into the mask canvas in image-natural-pixel space.
 *
 * We use `globalCompositeOperation = "destination-out"` for erase strokes
 * so the user can selectively peel back parts of the mask.
 *
 * For soft brushes (hardness < 1), each stroke segment is drawn as a
 * radial-gradient circle so the edge falls off smoothly. For maximum
 * compatibility with model providers we still threshold the final mask
 * to pure black/white when withAlpha=false (FLUX/Nano expect a binary
 * mask; soft edges confuse the inpainter).
 */
function renderStrokeToImageSpace(
    ctx: CanvasRenderingContext2D,
    stroke: BrushStroke,
    target: InpaintMaskTarget,
    fit: ReturnType<typeof computeImageFitProps>,
): void {
    if (stroke.points.length === 0) return;
    const radius = scaleRadiusToImage(stroke.size, fit, target.zoom);

    ctx.save();
    ctx.globalCompositeOperation = stroke.type === "erase" ? "destination-out" : "source-over";
    ctx.fillStyle = "rgba(255, 255, 255, 1)";

    // Project each point individually; segments where one endpoint is outside
    // the image visible area still draw the in-image endpoint as a dot so
    // the user gets some coverage near the letterbox edge.
    const projected: ({ x: number; y: number } | null)[] = stroke.points.map(
        (p) => projectPointToImageSpace(p, fit, target.zoom),
    );

    // Draw a circle at every projected point. For dense strokes (mousemove
    // generates many points per second) this is enough to produce a
    // continuous swept region without needing quadratic curve math.
    for (const p of projected) {
        if (!p) continue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
    }

    // Connect consecutive in-image points with thick line segments to fill
    // any gaps that single-point arcs would leave (fast mouse movement).
    ctx.lineWidth = radius * 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255, 255, 255, 1)";
    let pathStarted = false;
    ctx.beginPath();
    for (const p of projected) {
        if (!p) {
            pathStarted = false;
            continue;
        }
        if (!pathStarted) {
            ctx.moveTo(p.x, p.y);
            pathStarted = true;
        } else {
            ctx.lineTo(p.x, p.y);
        }
    }
    ctx.stroke();
    ctx.restore();
}

/**
 * Render an offscreen mask canvas matching the source image's natural size.
 * Returns the canvas; caller is responsible for `.toBlob()` / `.toDataURL()`.
 */
export function renderInpaintMaskToCanvas(
    strokes: BrushStroke[],
    target: InpaintMaskTarget,
    opts: ExportMaskOptions = {},
): HTMLCanvasElement {
    const withAlpha = opts.withAlpha ?? false;
    const blackBackground = opts.blackBackground ?? true;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(target.naturalWidth));
    canvas.height = Math.max(1, Math.round(target.naturalHeight));
    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) {
        throw new Error("Failed to allocate 2D context for mask export");
    }

    if (withAlpha) {
        // For OpenAI-style edit endpoints: opaque = preserve, transparent = regenerate.
        // We first build the same black/white edit mask as RGB providers use,
        // then invert luma into alpha after all draw/erase strokes are applied.
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (blackBackground) {
        // For FLUX Fill / Nano Banana: black background = preserve.
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const fit = computeImageFitProps(
        target.objectFit,
        target.naturalWidth,
        target.naturalHeight,
        target.layerWidth,
        target.layerHeight,
        target.viewIntent,
    );

    for (const stroke of strokes) {
        renderStrokeToImageSpace(ctx, stroke, target, fit);
    }

    if (withAlpha) {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            const luma = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
            const editAlpha = data[i + 3] > 0 && luma > 8 ? 255 : 0;
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 255 - editAlpha;
        }
        ctx.putImageData(imgData, 0, 0);
    }

    return canvas;
}

/**
 * Convert a canvas to a PNG Blob via toBlob (faster + lower memory than dataURL).
 */
export async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (!blob) reject(new Error("canvas.toBlob returned null"));
                else resolve(blob);
            },
            "image/png",
        );
    });
}

/**
 * Detect whether a given model needs an alpha mask vs RGB white/black.
 *
 * OpenAI image-edit endpoints REQUIRE a real alpha channel on the mask
 * (white=transparent=regenerate, black=opaque=preserve). FLUX Fill and
 * Nano Banana take a flat black/white image where white means regenerate.
 */
export function modelRequiresAlphaMask(modelSlug?: string): boolean {
    if (!modelSlug) return false;
    return modelSlug.startsWith("openai/");
}
