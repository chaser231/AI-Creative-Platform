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
import { compositeExpandResult } from "./imageComposite";

/** Upper bound for any side of the input we send to bria-expand. */
const MAX_FINAL_DIMENSION = 3500;
/** When downscale ratio drops below this, switch on the preserve-original pipeline. */
const PRESERVE_THRESHOLD = 0.85;

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

export async function outpaintImage(params: OutpaintParams): Promise<OutpaintResult> {
    const {
        imageSrc,
        canvasPadding,
        layerSize,
        prompt,
        projectId,
        onProgress,
    } = params;

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

    const imageUrl = await uploadForAI(baseImageSrc, projectId ?? "ai-tmp");

    const response = await fetch("/api/ai/image-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            action: "outpaint",
            prompt: prompt && prompt.trim().length > 0 ? prompt : "Fill seamlessly",
            imageBase64: imageUrl,
            model: "bria-expand",
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
        try {
            onProgress?.("preserve-upscale-start");
            const upscaleScale = Math.min(Math.ceil(1 / downscaleRatio), 4);
            const upscaleImageUrl = await uploadForAI(data.content as string, projectId);
            const upscaleRes = await fetch("/api/ai/image-edit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "upscale",
                    imageBase64: upscaleImageUrl,
                    model: "seedvr",
                    upscaleScale,
                    projectId,
                }),
            });
            const upscaleData = await upscaleRes.json();

            if (upscaleData.content && !upscaleData.error) {
                let expandedSrcForComposite = upscaleData.content as string;
                try {
                    expandedSrcForComposite = await persistImageToS3(
                        upscaleData.content as string,
                        projectId ?? "ai-tmp",
                    );
                } catch (persistErr) {
                    console.warn(
                        "[outpaintPipeline] Could not rehost upscale result, falling back to source URL:",
                        persistErr,
                    );
                }

                finalContent = await compositeExpandResult({
                    expandedSrc: expandedSrcForComposite,
                    originalSrc: preserveOriginalSrc,
                    pixelPadding: preserveOriginalPixelPadding,
                });
                onProgress?.("preserve-composite-done");
            } else {
                console.warn(
                    "[outpaintPipeline] Upscale failed, using raw expand result:",
                    upscaleData.error,
                );
            }
        } catch (preserveErr) {
            console.warn(
                "[outpaintPipeline] Preserve pipeline failed, falling back to raw expand result:",
                preserveErr,
            );
        }
    }

    return {
        src: finalContent,
        model: (data.model as string) ?? "bria-expand",
        pixelPadding: sentPadding,
        expanded: true,
    };
}
