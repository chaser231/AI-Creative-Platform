import { persistImageToS3, uploadForAI } from "@/utils/imageUpload";
import {
    computeGptImage2RequestSize,
    GPT_IMAGE2_MAX_ASPECT,
    type PackOutpaintDiagnostic,
    type PackOutpaintPlan,
} from "@/utils/packOutpaintPlan";

const EDGE_CONTEXT_OPT_OUT_ENV = process.env.NEXT_PUBLIC_WIZARD_OUTPAINT_EDGE_CONTEXT;
const ASPECT_DRIFT_TOLERANCE = 0.01;

export interface GptImageOutpaintParams {
    imageSrc: string;
    plan: PackOutpaintPlan;
    prompt?: string;
    projectId: string;
    debug?: boolean;
    sourcePreservation?: "model" | "hard-composite";
    paddingContext?: "edge-extend" | "transparent";
    maskMode?: "binary" | "alpha";
    cropAlignment?: "legacy" | "source-anchor";
    sourceFeatherPx?: number;
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

interface PixelRect {
    x: number;
    y: number;
    width: number;
    height: number;
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

export interface ManualGptOutpaintPlanInput {
    sourceSizePx: { width: number; height: number };
    layerSize: { width: number; height: number };
    canvasPadding: { top: number; right: number; bottom: number; left: number };
}

export function buildGptImage2ManualOutpaintPlan(input: ManualGptOutpaintPlanInput): PackOutpaintPlan {
    const sourceW = Math.max(1, Math.round(input.sourceSizePx.width));
    const sourceH = Math.max(1, Math.round(input.sourceSizePx.height));
    const layerW = Math.max(1, input.layerSize.width);
    const layerH = Math.max(1, input.layerSize.height);
    const scaleX = sourceW / layerW;
    const scaleY = sourceH / layerH;
    const padPx = {
        left: Math.max(0, Math.round(input.canvasPadding.left * scaleX)),
        right: Math.max(0, Math.round(input.canvasPadding.right * scaleX)),
        top: Math.max(0, Math.round(input.canvasPadding.top * scaleY)),
        bottom: Math.max(0, Math.round(input.canvasPadding.bottom * scaleY)),
    };
    const outputSizePx = {
        width: Math.max(1, sourceW + padPx.left + padPx.right),
        height: Math.max(1, sourceH + padPx.top + padPx.bottom),
    };
    const requestExtraPadPx = { left: 0, right: 0, top: 0, bottom: 0 };
    const diagnostics: PackOutpaintDiagnostic[] = [];
    const outputAspect = outputSizePx.width / outputSizePx.height;
    if (outputAspect > GPT_IMAGE2_MAX_ASPECT) {
        const targetH = Math.ceil(outputSizePx.width / GPT_IMAGE2_MAX_ASPECT);
        const extraH = Math.max(0, targetH - outputSizePx.height);
        requestExtraPadPx.top = Math.ceil(extraH / 2);
        requestExtraPadPx.bottom = extraH - requestExtraPadPx.top;
        diagnostics.push({
            code: "aspect-pad-added",
            message: "Vertical padding was added so the GPT request stays within the 3:1 aspect limit.",
        });
    } else if (outputAspect < 1 / GPT_IMAGE2_MAX_ASPECT) {
        const targetW = Math.ceil(outputSizePx.height / GPT_IMAGE2_MAX_ASPECT);
        const extraW = Math.max(0, targetW - outputSizePx.width);
        requestExtraPadPx.left = Math.ceil(extraW / 2);
        requestExtraPadPx.right = extraW - requestExtraPadPx.left;
        diagnostics.push({
            code: "aspect-pad-added",
            message: "Horizontal padding was added so the GPT request stays within the 3:1 aspect limit.",
        });
    }

    const requestRawSize = {
        width: outputSizePx.width + requestExtraPadPx.left + requestExtraPadPx.right,
        height: outputSizePx.height + requestExtraPadPx.top + requestExtraPadPx.bottom,
    };
    const request = computeGptImage2RequestSize(requestRawSize);
    diagnostics.push(...request.diagnostics);
    const reqScaleX = request.size.width / requestRawSize.width;
    const reqScaleY = request.size.height / requestRawSize.height;
    const cropRawX = Math.round(requestExtraPadPx.left * reqScaleX);
    const cropRawY = Math.round(requestExtraPadPx.top * reqScaleY);
    const cropRawW = Math.max(1, Math.round(outputSizePx.width * reqScaleX));
    const cropRawH = Math.max(1, Math.round(outputSizePx.height * reqScaleY));
    const cropX = Math.max(0, Math.min(cropRawX, request.size.width - 1));
    const cropY = Math.max(0, Math.min(cropRawY, request.size.height - 1));

    return {
        canvasPadding: input.canvasPadding,
        nextMasterRect: {
            x: -input.canvasPadding.left,
            y: -input.canvasPadding.top,
            width: layerW + input.canvasPadding.left + input.canvasPadding.right,
            height: layerH + input.canvasPadding.top + input.canvasPadding.bottom,
        },
        outputSizePx,
        requestSizePx: request.size,
        sourcePlacementPx: {
            x: padPx.left,
            y: padPx.top,
            width: sourceW,
            height: sourceH,
        },
        requestSourcePlacementPx: {
            x: Math.round((requestExtraPadPx.left + padPx.left) * reqScaleX),
            y: Math.round((requestExtraPadPx.top + padPx.top) * reqScaleY),
            width: Math.max(1, Math.round(sourceW * reqScaleX)),
            height: Math.max(1, Math.round(sourceH * reqScaleY)),
        },
        requestOutputCropPx: {
            x: cropX,
            y: cropY,
            width: Math.max(1, Math.min(cropRawW, request.size.width - cropX)),
            height: Math.max(1, Math.min(cropRawH, request.size.height - cropY)),
        },
        diagnostics,
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
 * fal's OpenAI-compatible edit endpoint accepts the same mask geometry as the
 * source image. The default binary variant is kept for the Wizard path:
 * white pixels are editable, black pixels are preserved.
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

/**
 * OpenAI image edits use the mask alpha channel: transparent pixels are
 * regenerated, opaque pixels are preserved. Studio manual outpaint uses this
 * stricter variant so the user-dragged frame is the only editable area.
 */
export function computeOpenAIOutpaintMaskPixelAt(
    x: number,
    y: number,
    sourceRect: { x: number; y: number; width: number; height: number },
): RgbaPixel {
    return isInsideRect(x, y, sourceRect)
        ? { r: 0, g: 0, b: 0, a: 255 }
        : { r: 255, g: 255, b: 255, a: 0 };
}

export function buildFalOutpaintMaskPixels(
    size: { width: number; height: number },
    requestSourceRect: { x: number; y: number; width: number; height: number },
    mode: "binary" | "alpha" = "binary",
): { width: number; height: number; data: Uint8ClampedArray } {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    for (let y = 0; y < size.height; y++) {
        for (let x = 0; x < size.width; x++) {
            const i = (y * size.width + x) * 4;
            const pixel = mode === "alpha"
                ? computeOpenAIOutpaintMaskPixelAt(x, y, requestSourceRect)
                : computeFalOutpaintMaskPixelAt(x, y, requestSourceRect);
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
    mode: "binary" | "alpha" = "binary",
): string {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create GPT outpaint mask canvas");

    const pixels = buildFalOutpaintMaskPixels(size, requestSourceRect, mode);
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

export interface ComputeGptOutputCropInput {
    cropAlignment?: "legacy" | "source-anchor";
    requestSizePx: { width: number; height: number };
    gptSizePx: { width: number; height: number };
    requestOutputCropPx: PixelRect;
    requestSourcePlacementPx: PixelRect;
    outputSizePx: { width: number; height: number };
    sourcePlacementPx: PixelRect;
}

export function computeGptOutputCropPx(input: ComputeGptOutputCropInput): { crop: PixelRect; alignment: "legacy" | "source-anchor" } {
    const cropScaleX = input.gptSizePx.width / input.requestSizePx.width;
    const cropScaleY = input.gptSizePx.height / input.requestSizePx.height;
    const maxCropX = Math.max(0, input.gptSizePx.width - 1);
    const maxCropY = Math.max(0, input.gptSizePx.height - 1);
    const legacy = {
        x: Math.min(maxCropX, Math.max(0, Math.round(input.requestOutputCropPx.x * cropScaleX))),
        y: Math.min(maxCropY, Math.max(0, Math.round(input.requestOutputCropPx.y * cropScaleY))),
        width: Math.max(1, Math.round(input.requestOutputCropPx.width * cropScaleX)),
        height: Math.max(1, Math.round(input.requestOutputCropPx.height * cropScaleY)),
    };
    legacy.width = Math.max(1, Math.min(legacy.width, input.gptSizePx.width - legacy.x));
    legacy.height = Math.max(1, Math.min(legacy.height, input.gptSizePx.height - legacy.y));

    if (input.cropAlignment !== "source-anchor") {
        return { crop: legacy, alignment: "legacy" };
    }

    const src = input.requestSourcePlacementPx;
    const outSrc = input.sourcePlacementPx;
    if (
        input.outputSizePx.width <= 0
        || input.outputSizePx.height <= 0
        || outSrc.width <= 0
        || outSrc.height <= 0
        || src.width <= 0
        || src.height <= 0
    ) {
        return { crop: legacy, alignment: "legacy" };
    }

    const cropReqWidth = src.width * input.outputSizePx.width / outSrc.width;
    const cropReqHeight = src.height * input.outputSizePx.height / outSrc.height;
    const cropReqX = src.x - (outSrc.x * cropReqWidth / input.outputSizePx.width);
    const cropReqY = src.y - (outSrc.y * cropReqHeight / input.outputSizePx.height);
    const anchored = {
        x: Math.round(cropReqX * cropScaleX),
        y: Math.round(cropReqY * cropScaleY),
        width: Math.max(1, Math.round(cropReqWidth * cropScaleX)),
        height: Math.max(1, Math.round(cropReqHeight * cropScaleY)),
    };
    const valid = Number.isFinite(anchored.x)
        && Number.isFinite(anchored.y)
        && Number.isFinite(anchored.width)
        && Number.isFinite(anchored.height)
        && anchored.x >= 0
        && anchored.y >= 0
        && anchored.width > 0
        && anchored.height > 0
        && anchored.x + anchored.width <= input.gptSizePx.width
        && anchored.y + anchored.height <= input.gptSizePx.height;

    return valid
        ? { crop: anchored, alignment: "source-anchor" }
        : { crop: legacy, alignment: "legacy" };
}

export function computeSourceFeatherAlphaAt(
    x: number,
    y: number,
    sourceSize: { width: number; height: number },
    padding: { top: number; right: number; bottom: number; left: number },
    featherPx: number,
): number {
    const width = Math.max(1, Math.round(sourceSize.width));
    const height = Math.max(1, Math.round(sourceSize.height));
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    const rawFeather = Math.max(0, Math.round(featherPx));
    if (rawFeather <= 0) return 255;
    const featherX = Math.min(rawFeather, Math.max(1, Math.floor(width / 4)));
    const featherY = Math.min(rawFeather, Math.max(1, Math.floor(height / 4)));

    let alpha = 1;
    if (padding.left > 0 && featherX > 0) alpha = Math.min(alpha, Math.min(1, x / featherX));
    if (padding.right > 0 && featherX > 0) alpha = Math.min(alpha, Math.min(1, (width - 1 - x) / featherX));
    if (padding.top > 0 && featherY > 0) alpha = Math.min(alpha, Math.min(1, y / featherY));
    if (padding.bottom > 0 && featherY > 0) alpha = Math.min(alpha, Math.min(1, (height - 1 - y) / featherY));
    return Math.max(0, Math.min(255, Math.round(alpha * 255)));
}

function buildSourceFeatherMaskCanvas(
    sourceSize: { width: number; height: number },
    padding: { top: number; right: number; bottom: number; left: number },
    featherPx: number,
): HTMLCanvasElement {
    const width = Math.max(1, Math.round(sourceSize.width));
    const height = Math.max(1, Math.round(sourceSize.height));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create GPT outpaint source feather mask canvas");
    const imageData = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            imageData.data[i] = 255;
            imageData.data[i + 1] = 255;
            imageData.data[i + 2] = 255;
            imageData.data[i + 3] = computeSourceFeatherAlphaAt(x, y, { width, height }, padding, featherPx);
        }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
}

function buildPreservedSourceCanvas(
    sourceImg: HTMLImageElement,
    sourceNaturalW: number,
    sourceNaturalH: number,
    placement: PixelRect,
    padding: { top: number; right: number; bottom: number; left: number },
    featherPx: number,
): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = placement.width;
    canvas.height = placement.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create GPT outpaint preserved source canvas");
    const exactSourceSize = sourceNaturalW === placement.width && sourceNaturalH === placement.height;
    ctx.imageSmoothingEnabled = !exactSourceSize;
    if (!exactSourceSize) ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
        sourceImg,
        0, 0, sourceNaturalW, sourceNaturalH,
        0, 0, placement.width, placement.height,
    );
    if (featherPx > 0) {
        const mask = buildSourceFeatherMaskCanvas(placement, padding, featherPx);
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(mask, 0, 0);
        ctx.globalCompositeOperation = "source-over";
    }
    return canvas;
}

export async function outpaintWithGptImage2PackPlan(
    params: GptImageOutpaintParams,
): Promise<GptImageOutpaintResult> {
    const {
        imageSrc,
        plan,
        prompt,
        projectId,
        debug,
        onProgress,
        sourcePreservation = "model",
        paddingContext = "edge-extend",
        maskMode = "binary",
        cropAlignment = "legacy",
        sourceFeatherPx = 0,
    } = params;
    const sourceImg = await loadImage(imageSrc);
    const sourceNaturalW = sourceImg.naturalWidth || sourceImg.width;
    const sourceNaturalH = sourceImg.naturalHeight || sourceImg.height;
    const outputW = plan.outputSizePx.width;
    const outputH = plan.outputSizePx.height;
    const requestW = plan.requestSizePx.width;
    const requestH = plan.requestSizePx.height;
    const requestSourceRect = {
        x: Math.round(plan.requestSourcePlacementPx.x),
        y: Math.round(plan.requestSourcePlacementPx.y),
        width: Math.max(1, Math.round(plan.requestSourcePlacementPx.width)),
        height: Math.max(1, Math.round(plan.requestSourcePlacementPx.height)),
    };
    const requestOutputCrop = {
        x: Math.round(plan.requestOutputCropPx.x),
        y: Math.round(plan.requestOutputCropPx.y),
        width: Math.max(1, Math.round(plan.requestOutputCropPx.width)),
        height: Math.max(1, Math.round(plan.requestOutputCropPx.height)),
    };

    onProgress?.("outpaint-canvas-start", {
        outputW,
        outputH,
        requestW,
        requestH,
        requestSourceRect,
        requestOutputCrop,
        sourcePreservation,
        paddingContext,
        maskMode,
        cropAlignment,
        sourceFeatherPx,
    });

    const paddedCanvas = document.createElement("canvas");
    paddedCanvas.width = requestW;
    paddedCanvas.height = requestH;
    const paddedCtx = paddedCanvas.getContext("2d");
    if (!paddedCtx) throw new Error("Failed to create GPT outpaint padded canvas");
    paddedCtx.imageSmoothingEnabled = true;
    paddedCtx.imageSmoothingQuality = "high";
    if (paddingContext === "edge-extend" && isEdgeContextEnabled()) {
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
    const maskUrl = await uploadForAI(buildFalMaskDataUrl({ width: requestW, height: requestH }, requestSourceRect, maskMode), projectId);
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
                : undefined,
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
            requestOutputCrop,
            cropAlignment,
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

    const { crop: sourceCrop, alignment: usedCropAlignment } = computeGptOutputCropPx({
        cropAlignment,
        requestSizePx: { width: requestW, height: requestH },
        gptSizePx: { width: gptW, height: gptH },
        requestOutputCropPx: requestOutputCrop,
        requestSourcePlacementPx: requestSourceRect,
        outputSizePx: { width: outputW, height: outputH },
        sourcePlacementPx: plan.sourcePlacementPx,
    });
    if (debug) {
        onProgress?.("debug-output-crop", { sourceCrop, usedCropAlignment });
    }
    finalCtx.drawImage(
        gptImg,
        sourceCrop.x, sourceCrop.y, sourceCrop.width, sourceCrop.height,
        0, 0, outputW, outputH,
    );
    if (sourcePreservation === "hard-composite") {
        const sourcePlacement = {
            x: Math.round(plan.sourcePlacementPx.x),
            y: Math.round(plan.sourcePlacementPx.y),
            width: Math.max(1, Math.round(plan.sourcePlacementPx.width)),
            height: Math.max(1, Math.round(plan.sourcePlacementPx.height)),
        };
        const featherPx = Math.max(0, Math.round(sourceFeatherPx));
        const exactSourceSize = sourceNaturalW === sourcePlacement.width
            && sourceNaturalH === sourcePlacement.height;
        const previousSmoothing = finalCtx.imageSmoothingEnabled;
        const previousSmoothingQuality = finalCtx.imageSmoothingQuality;
        if (exactSourceSize || featherPx > 0) {
            finalCtx.imageSmoothingEnabled = false;
        }
        try {
            if (featherPx > 0) {
                const preservedSource = buildPreservedSourceCanvas(
                    sourceImg,
                    sourceNaturalW,
                    sourceNaturalH,
                    sourcePlacement,
                    pixelPaddingFromPlan(plan),
                    featherPx,
                );
                finalCtx.drawImage(preservedSource, sourcePlacement.x, sourcePlacement.y);
            } else {
                finalCtx.drawImage(
                    sourceImg,
                    0, 0, sourceNaturalW, sourceNaturalH,
                    sourcePlacement.x, sourcePlacement.y, sourcePlacement.width, sourcePlacement.height,
                );
            }
        } finally {
            if (exactSourceSize || featherPx > 0) {
                finalCtx.imageSmoothingEnabled = previousSmoothing;
                finalCtx.imageSmoothingQuality = previousSmoothingQuality;
            }
        }
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
