import { persistImageToS3, uploadForAI } from "@/utils/imageUpload";
import type { PackOutpaintDiagnostic, PackOutpaintPlan } from "@/utils/packOutpaintPlan";

const SEAM_BAND_PX = 24;

export interface GptImageOutpaintParams {
    imageSrc: string;
    plan: PackOutpaintPlan;
    prompt?: string;
    projectId: string;
    debug?: boolean;
    onProgress?: (stage: string, info?: Record<string, unknown>) => void;
}

export interface GptImageOutpaintResult {
    src: string;
    outputSizePx: { width: number; height: number };
    pixelPadding: { top: number; right: number; bottom: number; left: number };
    diagnostics: PackOutpaintDiagnostic[];
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`gptImageOutpaint: failed to load ${src.slice(0, 80)}`));
        img.src = src;
    });
}

function pixelPaddingFromPlan(plan: PackOutpaintPlan): { top: number; right: number; bottom: number; left: number } {
    const p = plan.sourcePlacementPx;
    return {
        top: p.y,
        left: p.x,
        right: Math.max(0, plan.outputSizePx.width - p.x - p.width),
        bottom: Math.max(0, plan.outputSizePx.height - p.y - p.height),
    };
}

export function computeOutpaintMaskAlphaAt(
    x: number,
    y: number,
    sourceRect: { x: number; y: number; width: number; height: number },
    outputSize: { width: number; height: number },
    seamPx = SEAM_BAND_PX,
): number {
    const inside =
        x >= sourceRect.x
        && y >= sourceRect.y
        && x < sourceRect.x + sourceRect.width
        && y < sourceRect.y + sourceRect.height;
    if (!inside) return 0;

    let alpha = 1;
    if (sourceRect.x > 0) alpha = Math.min(alpha, (x - sourceRect.x) / seamPx);
    if (sourceRect.y > 0) alpha = Math.min(alpha, (y - sourceRect.y) / seamPx);
    if (sourceRect.x + sourceRect.width < outputSize.width) {
        alpha = Math.min(alpha, (sourceRect.x + sourceRect.width - 1 - x) / seamPx);
    }
    if (sourceRect.y + sourceRect.height < outputSize.height) {
        alpha = Math.min(alpha, (sourceRect.y + sourceRect.height - 1 - y) / seamPx);
    }
    return Math.max(0, Math.min(1, alpha));
}

function buildMaskDataUrl(
    size: { width: number; height: number },
    requestSourceRect: { x: number; y: number; width: number; height: number },
): string {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create GPT outpaint mask canvas");

    const imageData = ctx.createImageData(size.width, size.height);
    const data = imageData.data;
    for (let y = 0; y < size.height; y++) {
        for (let x = 0; x < size.width; x++) {
            const i = (y * size.width + x) * 4;
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = Math.round(
                computeOutpaintMaskAlphaAt(x, y, requestSourceRect, size) * 255,
            );
        }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
}

function buildEdgeExtendedContext(
    sourceImg: HTMLImageElement,
    placement: { x: number; y: number; width: number; height: number },
    size: { width: number; height: number },
): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create GPT outpaint context canvas");

    const sourceW = sourceImg.naturalWidth || sourceImg.width;
    const sourceH = sourceImg.naturalHeight || sourceImg.height;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(sourceImg, placement.x, placement.y, placement.width, placement.height);

    const strip = Math.max(1, Math.round(Math.min(sourceW, sourceH) * 0.01));
    if (placement.x > 0) {
        ctx.drawImage(sourceImg, 0, 0, strip, sourceH, 0, placement.y, placement.x, placement.height);
    }
    const rightPad = size.width - placement.x - placement.width;
    if (rightPad > 0) {
        ctx.drawImage(sourceImg, sourceW - strip, 0, strip, sourceH, placement.x + placement.width, placement.y, rightPad, placement.height);
    }
    const sideExtended = document.createElement("canvas");
    sideExtended.width = size.width;
    sideExtended.height = size.height;
    const sideCtx = sideExtended.getContext("2d");
    if (!sideCtx) throw new Error("Failed to create GPT outpaint side context canvas");
    sideCtx.drawImage(canvas, 0, 0);

    if (placement.y > 0) {
        ctx.drawImage(sideExtended, 0, placement.y, size.width, 1, 0, 0, size.width, placement.y);
    }
    const bottomPad = size.height - placement.y - placement.height;
    if (bottomPad > 0) {
        ctx.drawImage(sideExtended, 0, placement.y + placement.height - 1, size.width, 1, 0, placement.y + placement.height, size.width, bottomPad);
    }

    return canvas;
}

function buildSourceOverlay(
    sourceImg: HTMLImageElement,
    placement: { width: number; height: number },
    outputSize: { width: number; height: number },
    sourceOffset: { x: number; y: number },
): HTMLCanvasElement {
    const overlay = document.createElement("canvas");
    overlay.width = placement.width;
    overlay.height = placement.height;
    const octx = overlay.getContext("2d");
    if (!octx) throw new Error("Failed to create GPT outpaint source overlay canvas");

    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(sourceImg, 0, 0, placement.width, placement.height);

    const mask = octx.createImageData(placement.width, placement.height);
    for (let y = 0; y < placement.height; y++) {
        for (let x = 0; x < placement.width; x++) {
            const i = (y * placement.width + x) * 4;
            mask.data[i] = 255;
            mask.data[i + 1] = 255;
            mask.data[i + 2] = 255;
            mask.data[i + 3] = Math.round(
                computeOutpaintMaskAlphaAt(
                    x + sourceOffset.x,
                    y + sourceOffset.y,
                    {
                        x: sourceOffset.x,
                        y: sourceOffset.y,
                        width: placement.width,
                        height: placement.height,
                    },
                    outputSize,
                ) * 255,
            );
        }
    }
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = placement.width;
    maskCanvas.height = placement.height;
    const mctx = maskCanvas.getContext("2d");
    if (!mctx) throw new Error("Failed to create GPT outpaint overlay mask canvas");
    mctx.putImageData(mask, 0, 0);

    octx.globalCompositeOperation = "destination-in";
    octx.drawImage(maskCanvas, 0, 0);
    octx.globalCompositeOperation = "source-over";
    return overlay;
}

export function chooseOutpaintObjectFitForRect(
    imageSize: { width: number; height: number },
    layerRect: { width: number; height: number },
    tolerance = 0.01,
): "fill" | "cover" {
    if (imageSize.width <= 0 || imageSize.height <= 0 || layerRect.width <= 0 || layerRect.height <= 0) {
        return "cover";
    }
    const imageAspect = imageSize.width / imageSize.height;
    const layerAspect = layerRect.width / layerRect.height;
    const mismatch = Math.abs(imageAspect - layerAspect) / Math.max(imageAspect, layerAspect);
    return mismatch <= tolerance ? "fill" : "cover";
}

export async function outpaintWithGptImage2PackPlan(
    params: GptImageOutpaintParams,
): Promise<GptImageOutpaintResult> {
    const { imageSrc, plan, prompt, projectId, debug, onProgress } = params;
    const sourceImg = await loadImage(imageSrc);
    const outputW = plan.outputSizePx.width;
    const outputH = plan.outputSizePx.height;
    const requestW = plan.requestSizePx.width;
    const requestH = plan.requestSizePx.height;
    const scaleX = requestW / outputW;
    const scaleY = requestH / outputH;
    const requestSourceRect = {
        x: Math.round(plan.sourcePlacementPx.x * scaleX),
        y: Math.round(plan.sourcePlacementPx.y * scaleY),
        width: Math.max(1, Math.round(plan.sourcePlacementPx.width * scaleX)),
        height: Math.max(1, Math.round(plan.sourcePlacementPx.height * scaleY)),
    };

    onProgress?.("gpt-outpaint-canvas-start", { outputW, outputH, requestW, requestH });

    const paddedCanvas = document.createElement("canvas");
    paddedCanvas.width = requestW;
    paddedCanvas.height = requestH;
    const paddedCtx = paddedCanvas.getContext("2d");
    if (!paddedCtx) throw new Error("Failed to create GPT outpaint padded canvas");
    paddedCtx.imageSmoothingEnabled = true;
    paddedCtx.imageSmoothingQuality = "high";
    const edgeContext = buildEdgeExtendedContext(
        sourceImg,
        requestSourceRect,
        { width: requestW, height: requestH },
    );
    paddedCtx.drawImage(edgeContext, 0, 0);
    paddedCtx.save();
    paddedCtx.filter = "blur(12px)";
    paddedCtx.globalAlpha = 0.85;
    paddedCtx.drawImage(edgeContext, 0, 0);
    paddedCtx.restore();
    paddedCtx.drawImage(
        sourceImg,
        requestSourceRect.x,
        requestSourceRect.y,
        requestSourceRect.width,
        requestSourceRect.height,
    );

    const paddedUrl = await uploadForAI(paddedCanvas.toDataURL("image/png"), projectId);
    const maskUrl = await uploadForAI(buildMaskDataUrl({ width: requestW, height: requestH }, requestSourceRect), projectId);
    if (debug) {
        onProgress?.("debug-artifacts-prepared", {
            paddedUrl,
            maskUrl,
            requestSourceRect,
            outputSizePx: plan.outputSizePx,
            requestSizePx: plan.requestSizePx,
            diagnostics: plan.diagnostics,
        });
    }

    onProgress?.("outpaint-api-start", { model: "gpt-image-2", requestW, requestH });
    const response = await fetch("/api/ai/image-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            action: "inpaint",
            intent: "edit",
            prompt: prompt && prompt.trim().length > 0
                ? prompt
                : "Extend the image naturally and seamlessly. Preserve the product, text, packaging, and original composition.",
            imageBase64: paddedUrl,
            maskBase64: maskUrl,
            model: "gpt-image-2",
            scale: "high",
            imageSize: { width: requestW, height: requestH },
            projectId,
        }),
    });
    onProgress?.("outpaint-api-done", { model: "gpt-image-2" });

    const data = await response.json();
    if (data.error) {
        throw new Error(data.requestId ? `${data.error} [request: ${data.requestId}]` : data.error);
    }
    if (!data.content) {
        throw new Error("GPT Image 2 returned an empty outpaint result");
    }

    const gptSrc = await persistImageToS3(data.content as string, projectId);
    if (debug) onProgress?.("debug-raw-result", { rawUrl: gptSrc });
    const gptImg = await loadImage(gptSrc);

    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = outputW;
    finalCanvas.height = outputH;
    const finalCtx = finalCanvas.getContext("2d");
    if (!finalCtx) throw new Error("Failed to create GPT outpaint final canvas");
    finalCtx.imageSmoothingEnabled = true;
    finalCtx.imageSmoothingQuality = "high";
    finalCtx.drawImage(gptImg, 0, 0, outputW, outputH);

    const overlay = buildSourceOverlay(
        sourceImg,
        { width: plan.sourcePlacementPx.width, height: plan.sourcePlacementPx.height },
        { width: outputW, height: outputH },
        { x: plan.sourcePlacementPx.x, y: plan.sourcePlacementPx.y },
    );
    finalCtx.drawImage(overlay, plan.sourcePlacementPx.x, plan.sourcePlacementPx.y);
    onProgress?.("preserve-composite-done", { model: "gpt-image-2" });

    const finalUrl = await persistImageToS3(finalCanvas.toDataURL("image/png"), projectId);
    if (debug) onProgress?.("debug-final-result", { finalUrl });
    return {
        src: finalUrl,
        outputSizePx: { width: outputW, height: outputH },
        pixelPadding: pixelPaddingFromPlan(plan),
        diagnostics: plan.diagnostics,
    };
}
