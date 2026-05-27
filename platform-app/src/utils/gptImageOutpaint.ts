import { persistImageToS3, uploadForAI } from "@/utils/imageUpload";
import type { PackOutpaintDiagnostic, PackOutpaintPlan } from "@/utils/packOutpaintPlan";

const EDGE_CONTEXT_OPT_OUT_ENV = process.env.NEXT_PUBLIC_WIZARD_OUTPAINT_EDGE_CONTEXT;
const ASPECT_DRIFT_TOLERANCE = 0.01;

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

export interface RgbaPixel {
    r: number;
    g: number;
    b: number;
    a: number;
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

function isInsideRect(
    x: number,
    y: number,
    rect: { x: number; y: number; width: number; height: number },
): boolean {
    return x >= rect.x
        && y >= rect.y
        && x < rect.x + rect.width
        && y < rect.y + rect.height;
}

/**
 * fal's openai/gpt-image-2/edit endpoint documents mask_url as a black/white
 * PNG: white pixels are editable, black pixels are preserved. The mask is
 * binary on purpose — fal preserves the black region pixel-for-pixel, so we
 * never need to re-paste the source on the client side.
 */
export function computeFalOutpaintMaskPixelAt(
    x: number,
    y: number,
    sourceRect: { x: number; y: number; width: number; height: number },
): RgbaPixel {
    return isInsideRect(x, y, sourceRect)
        ? { r: 0, g: 0, b: 0, a: 255 }
        : { r: 255, g: 255, b: 255, a: 255 };
}

export function buildFalOutpaintMaskPixels(
    size: { width: number; height: number },
    requestSourceRect: { x: number; y: number; width: number; height: number },
): { width: number; height: number; data: Uint8ClampedArray } {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let y = 0; y < size.height; y++) {
        for (let x = 0; x < size.width; x++) {
            const i = (y * size.width + x) * 4;
            const pixel = computeFalOutpaintMaskPixelAt(x, y, requestSourceRect);
            data[i] = pixel.r;
            data[i + 1] = pixel.g;
            data[i + 2] = pixel.b;
            data[i + 3] = pixel.a;
        }
    }
    return { width: size.width, height: size.height, data };
}

export function computeTransparentPaddedInputAlphaAt(
    x: number,
    y: number,
    sourceRect: { x: number; y: number; width: number; height: number },
): number {
    return isInsideRect(x, y, sourceRect) ? 255 : 0;
}

function buildFalMaskDataUrl(
    size: { width: number; height: number },
    requestSourceRect: { x: number; y: number; width: number; height: number },
): string {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create GPT outpaint mask canvas");

    const pixels = buildFalOutpaintMaskPixels(size, requestSourceRect);
    const imageData = ctx.createImageData(size.width, size.height);
    imageData.data.set(pixels.data);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
}

/**
 * Edge-extended background fill is the default for GPT input padding. Without
 * it the editable region is fully transparent and the model often produces
 * symmetric, low-context fills. The opt-out env flag exists only to
 * troubleshoot models that prefer a clean transparent canvas.
 */
function isEdgeContextEnabled(): boolean {
    if (EDGE_CONTEXT_OPT_OUT_ENV === "0") return false;
    try {
        if (typeof window !== "undefined"
            && window.localStorage?.getItem("wizardOutpaintEdgeContext") === "0") {
            return false;
        }
    } catch {
        // Ignore localStorage access errors — feature stays enabled.
    }
    return true;
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
    ctx.drawImage(
        sourceImg,
        0, 0, sourceW, sourceH,
        placement.x, placement.y, placement.width, placement.height,
    );

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

export function chooseOutpaintObjectFitForRect(
    imageSize: { width: number; height: number },
    layerRect: { width: number; height: number },
    tolerance = ASPECT_DRIFT_TOLERANCE,
): "fill" | "cover" {
    if (imageSize.width <= 0 || imageSize.height <= 0 || layerRect.width <= 0 || layerRect.height <= 0) {
        return "cover";
    }
    const imageAspect = imageSize.width / imageSize.height;
    const layerAspect = layerRect.width / layerRect.height;
    const mismatch = Math.abs(imageAspect - layerAspect) / Math.max(imageAspect, layerAspect);
    return mismatch <= tolerance ? "fill" : "cover";
}

/**
 * Compute the fitted rect that draws `source` into `target` using a single
 * uniform scale factor (object-contain). The result is centered inside the
 * target, leaving small letterbox bands on the axis that would otherwise be
 * stretched. This is what we use after GPT returns a result whose aspect
 * deviates from the requested aspect by more than ASPECT_DRIFT_TOLERANCE.
 */
export function computeUniformContainRect(
    source: { width: number; height: number },
    target: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
    const scale = Math.min(target.width / source.width, target.height / source.height);
    const width = Math.round(source.width * scale);
    const height = Math.round(source.height * scale);
    return {
        x: Math.round((target.width - width) / 2),
        y: Math.round((target.height - height) / 2),
        width,
        height,
    };
}

export async function outpaintWithGptImage2PackPlan(
    params: GptImageOutpaintParams,
): Promise<GptImageOutpaintResult> {
    const { imageSrc, plan, prompt, projectId, debug, onProgress } = params;
    const sourceImg = await loadImage(imageSrc);
    const sourceNaturalW = sourceImg.naturalWidth || sourceImg.width;
    const sourceNaturalH = sourceImg.naturalHeight || sourceImg.height;
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

    onProgress?.("outpaint-canvas-start", { outputW, outputH, requestW, requestH });

    const paddedCanvas = document.createElement("canvas");
    paddedCanvas.width = requestW;
    paddedCanvas.height = requestH;
    const paddedCtx = paddedCanvas.getContext("2d");
    if (!paddedCtx) throw new Error("Failed to create GPT outpaint padded canvas");
    paddedCtx.imageSmoothingEnabled = true;
    paddedCtx.imageSmoothingQuality = "high";
    if (isEdgeContextEnabled()) {
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
    }
    paddedCtx.drawImage(
        sourceImg,
        0, 0, sourceNaturalW, sourceNaturalH,
        requestSourceRect.x, requestSourceRect.y, requestSourceRect.width, requestSourceRect.height,
    );

    const paddedUrl = await uploadForAI(paddedCanvas.toDataURL("image/png"), projectId);
    const maskUrl = await uploadForAI(buildFalMaskDataUrl({ width: requestW, height: requestH }, requestSourceRect), projectId);
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
            promptProfile: "outpaint",
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
    const gptW = gptImg.naturalWidth || gptImg.width;
    const gptH = gptImg.naturalHeight || gptImg.height;

    const requestAspect = requestW / requestH;
    const gptAspect = gptW / gptH;
    const aspectDrift = Math.abs(gptAspect - requestAspect) / Math.max(gptAspect, requestAspect);
    if (debug) {
        onProgress?.("debug-gpt-output-size", {
            gptSizePx: { width: gptW, height: gptH },
            requestSizePx: { width: requestW, height: requestH },
            outputSizePx: { width: outputW, height: outputH },
            aspectDrift,
        });
    }
    if (aspectDrift > ASPECT_DRIFT_TOLERANCE) {
        console.warn("[gptImageOutpaint] gpt response aspect drift exceeds tolerance", {
            aspectDrift,
            tolerance: ASPECT_DRIFT_TOLERANCE,
            requestSizePx: { width: requestW, height: requestH },
            gptSizePx: { width: gptW, height: gptH },
        });
    }

    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = outputW;
    finalCanvas.height = outputH;
    const finalCtx = finalCanvas.getContext("2d");
    if (!finalCtx) throw new Error("Failed to create GPT outpaint final canvas");
    finalCtx.imageSmoothingEnabled = true;
    finalCtx.imageSmoothingQuality = "high";

    if (aspectDrift <= ASPECT_DRIFT_TOLERANCE) {
        // Aspects match within tolerance — single uniform rescale of the GPT
        // bitmap into the pack-required output rect. fal mask guarantees the
        // preserved (black) region is unchanged, so no further composite is
        // needed.
        finalCtx.drawImage(gptImg, 0, 0, outputW, outputH);
    } else {
        // Aspect drift breaks the assumption that drawImage(0,0,outW,outH) is
        // a uniform scale. Letterbox the GPT bitmap into outputSizePx using a
        // single scale factor, leaving thin transparent bands on the
        // mismatched axis. Callers are expected to detect this via the
        // `pixelPadding` returned from the plan and the warning above.
        const containRect = computeUniformContainRect(
            { width: gptW, height: gptH },
            { width: outputW, height: outputH },
        );
        finalCtx.drawImage(
            gptImg,
            0, 0, gptW, gptH,
            containRect.x, containRect.y, containRect.width, containRect.height,
        );
    }

    const finalUrl = await persistImageToS3(finalCanvas.toDataURL("image/png"), projectId);
    if (debug) onProgress?.("debug-final-result", { finalUrl });
    return {
        src: finalUrl,
        outputSizePx: { width: outputW, height: outputH },
        pixelPadding: pixelPaddingFromPlan(plan),
        diagnostics: plan.diagnostics,
    };
}
