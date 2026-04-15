/**
 * Image Composite Utility (client-side, Canvas-based)
 *
 * Used by the "Preserve Original" expand pipeline to overlay the
 * original high-res image on top of the upscaled expand result,
 * producing the final output where only the generated border is
 * AI-produced and the center retains pixel-perfect original quality.
 */

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 80)}...`));
        img.src = src;
    });
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
    pixelPadding: { top: number; right: number; bottom: number; left: number };
}

/**
 * Composite the original image over the upscaled expand result.
 *
 * Strategy:
 * 1. Create canvas at the target final size (original + padding in original pixel space)
 * 2. Draw the upscaled expanded image stretched to fill the final canvas
 *    (it has the right proportions, just potentially a slightly different absolute size
 *    due to ESRGAN ceil-rounding)
 * 3. Draw the original image on top at its native resolution, offset by padding
 *
 * This ensures the center preserves 100% original quality while the
 * AI-generated border fills the edges seamlessly.
 *
 * Returns a JPEG data URI (quality 0.92) to reduce memory pressure
 * compared to PNG for large images.
 */
export async function compositeExpandResult(
    params: CompositeExpandParams,
): Promise<string> {
    const [expandedImg, originalImg] = await Promise.all([
        loadImage(params.expandedSrc),
        loadImage(params.originalSrc),
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

    ctx.drawImage(expandedImg, 0, 0, canvasW, canvasH);

    const destX = Math.round(pad.left);
    const destY = Math.round(pad.top);
    ctx.drawImage(originalImg, destX, destY, origW, origH);

    return canvas.toDataURL("image/jpeg", 0.92);
}
