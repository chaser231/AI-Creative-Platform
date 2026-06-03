import type { ImageLayer } from "@/types";
import { persistImageToS3 } from "@/utils/imageUpload";
import { computeFeatherMaskData } from "@/utils/imageComposite";
import { computeStudioOutpaintRasterPlan } from "@/utils/studioOutpaintSource";
import {
    fallbackStudioBriaPromptEnhancement,
    sanitizeStudioBriaEnhancedPrompt,
    sanitizeStudioBriaPromptText,
    STUDIO_BRIA_PROMPT_ENHANCEMENT_FALLBACK,
    type StudioBriaPromptEnhancement,
} from "@/lib/studioBriaPromptEnhancement";

export type { StudioBriaPromptEnhancement } from "@/lib/studioBriaPromptEnhancement";

export interface StudioBriaPadding {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface StudioBriaGeometry {
    sourceSize: { width: number; height: number };
    canvasSize: { width: number; height: number };
    originalLocation: { x: number; y: number };
    pixelPadding: StudioBriaPadding;
    sourceAreaRatio: number;
}

export interface StudioBriaPrompts {
    prompt: string;
    negativePrompt: string;
}

export interface StudioBriaPreparedSource {
    src: string;
    width: number;
    height: number;
    changed: boolean;
}

export interface StudioBriaOutpaintResult {
    src: string;
    model: string;
    seed?: number;
    promptEnhancement: StudioBriaPromptEnhancement;
    pixelPadding: StudioBriaPadding;
    sourceSize: { width: number; height: number };
    canvasSize: { width: number; height: number };
}

export type StudioBriaOutpaintStage =
    | "source-persist-start"
    | "source-persist-done"
    | "source-rasterized"
    | "prepared-source-persisted"
    | "prompt-enhance-start"
    | "prompt-enhance-done"
    | "outpaint-api-start"
    | "outpaint-api-done"
    | "composite-start"
    | "composite-done";

export interface RunStudioBriaOutpaintParams {
    imageSrc: string;
    layer: ImageLayer;
    canvasPadding: StudioBriaPadding;
    prompt?: string;
    promptEnhancement?: StudioBriaPromptEnhancement;
    seed?: number;
    projectId: string;
    onProgress?: (stage: StudioBriaOutpaintStage, info?: Record<string, unknown>) => void;
}

export const STUDIO_BRIA_CANVAS_MAX_EDGE = 5000;

export const STUDIO_BRIA_POSITIVE_PROMPT =
    "Extend only the background, lighting, texture, and environment. Do not create, copy, move, resize, or continue products, packaging, logos, text, people, or foreground subjects into the new area. Leave the unmasked original image unchanged and make the new background seamless at the boundary.";

export const STUDIO_BRIA_NEGATIVE_PROMPT = "";

const STUDIO_BRIA_PERSIST_HOST = "storage.yandexcloud.net";

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 80)}...`));
        img.src = src;
    });
}

export function buildStudioBriaPrompts(
    userPrompt?: string,
    enhancement?: StudioBriaPromptEnhancement,
): StudioBriaPrompts {
    const cleaned = sanitizeStudioBriaPromptText(userPrompt);
    const scenePrompt = sanitizeStudioBriaEnhancedPrompt(enhancement?.prompt)
        || STUDIO_BRIA_PROMPT_ENHANCEMENT_FALLBACK;
    return {
        prompt: `${STUDIO_BRIA_POSITIVE_PROMPT} Scene prompt: ${scenePrompt}. User context/style hint: ${cleaned || STUDIO_BRIA_PROMPT_ENHANCEMENT_FALLBACK}`,
        negativePrompt: STUDIO_BRIA_NEGATIVE_PROMPT,
    };
}

export function normalizeStudioBriaPadding(padding: StudioBriaPadding): StudioBriaPadding {
    return {
        top: Math.max(0, Math.round(padding.top || 0)),
        right: Math.max(0, Math.round(padding.right || 0)),
        bottom: Math.max(0, Math.round(padding.bottom || 0)),
        left: Math.max(0, Math.round(padding.left || 0)),
    };
}

export function computeStudioBriaGeometry(
    layerSize: { width: number; height: number },
    canvasPadding: StudioBriaPadding,
): StudioBriaGeometry {
    const sourceW = Math.max(1, Math.round(layerSize.width));
    const sourceH = Math.max(1, Math.round(layerSize.height));
    const pad = normalizeStudioBriaPadding(canvasPadding);
    const canvasW = sourceW + pad.left + pad.right;
    const canvasH = sourceH + pad.top + pad.bottom;
    const sourceArea = sourceW * sourceH;
    const finalArea = canvasW * canvasH;

    return {
        sourceSize: { width: sourceW, height: sourceH },
        canvasSize: { width: canvasW, height: canvasH },
        originalLocation: { x: pad.left, y: pad.top },
        pixelPadding: pad,
        sourceAreaRatio: finalArea > 0 ? sourceArea / finalArea : 0,
    };
}

export function computeStudioBriaGeometryForSource(
    sourceSize: { width: number; height: number },
    layerSize: { width: number; height: number },
    canvasPadding: StudioBriaPadding,
): StudioBriaGeometry {
    const sourceW = Math.max(1, Math.round(sourceSize.width));
    const sourceH = Math.max(1, Math.round(sourceSize.height));
    const layerW = Math.max(1, layerSize.width);
    const layerH = Math.max(1, layerSize.height);
    const scaleX = sourceW / layerW;
    const scaleY = sourceH / layerH;
    return computeStudioBriaGeometry(
        { width: sourceW, height: sourceH },
        {
            top: canvasPadding.top * scaleY,
            right: canvasPadding.right * scaleX,
            bottom: canvasPadding.bottom * scaleY,
            left: canvasPadding.left * scaleX,
        },
    );
}

export function validateStudioBriaGeometry(geometry: StudioBriaGeometry): void {
    if (
        geometry.canvasSize.width > STUDIO_BRIA_CANVAS_MAX_EDGE
        || geometry.canvasSize.height > STUDIO_BRIA_CANVAS_MAX_EDGE
    ) {
        throw new Error(
            `Bria Expand поддерживает canvas до ${STUDIO_BRIA_CANVAS_MAX_EDGE}x${STUDIO_BRIA_CANVAS_MAX_EDGE}px. Уменьшите рамку расширения или дождитесь автоматического downscale.`,
        );
    }
}

export function computeStudioBriaRequestScale(geometry: StudioBriaGeometry): number {
    return Math.min(
        STUDIO_BRIA_CANVAS_MAX_EDGE / geometry.canvasSize.width,
        STUDIO_BRIA_CANVAS_MAX_EDGE / geometry.canvasSize.height,
        1,
    );
}

function scalePaddingSide(value: number, scale: number): number {
    if (value <= 0) return 0;
    return Math.max(1, Math.floor(value * scale));
}

export function scaleStudioBriaGeometry(
    geometry: StudioBriaGeometry,
    scale: number,
): StudioBriaGeometry {
    if (scale >= 1) return geometry;

    const sourceW = Math.max(1, Math.floor(geometry.sourceSize.width * scale));
    const sourceH = Math.max(1, Math.floor(geometry.sourceSize.height * scale));
    const pad = {
        top: scalePaddingSide(geometry.pixelPadding.top, scale),
        right: scalePaddingSide(geometry.pixelPadding.right, scale),
        bottom: scalePaddingSide(geometry.pixelPadding.bottom, scale),
        left: scalePaddingSide(geometry.pixelPadding.left, scale),
    };
    const scaled = computeStudioBriaGeometry(
        { width: sourceW, height: sourceH },
        pad,
    );

    if (
        scaled.canvasSize.width <= STUDIO_BRIA_CANVAS_MAX_EDGE
        && scaled.canvasSize.height <= STUDIO_BRIA_CANVAS_MAX_EDGE
    ) {
        return scaled;
    }

    const refitScale = computeStudioBriaRequestScale(scaled);
    if (refitScale >= 1) return scaled;
    return scaleStudioBriaGeometry(scaled, refitScale);
}

export function buildStudioBriaImageEditBody(params: {
    imageUrl: string;
    projectId: string;
    geometry: StudioBriaGeometry;
    prompts: StudioBriaPrompts;
    seed?: number;
}): Record<string, unknown> {
    const body: Record<string, unknown> = {
        action: "outpaint",
        imageBase64: params.imageUrl,
        model: "bria-expand",
        prompt: params.prompts.prompt,
        negativePrompt: params.prompts.negativePrompt,
        canvasSize: [params.geometry.canvasSize.width, params.geometry.canvasSize.height],
        originalSize: [params.geometry.sourceSize.width, params.geometry.sourceSize.height],
        originalLocation: [params.geometry.originalLocation.x, params.geometry.originalLocation.y],
        expandPadding: params.geometry.pixelPadding,
        projectId: params.projectId,
        disableFallback: true,
    };
    if (typeof params.seed === "number") {
        body.seed = params.seed;
    }
    return body;
}

export function computeStudioBriaFeatherPx(
    sourceSize: { width: number; height: number },
    padding: StudioBriaPadding,
): number {
    const pad = normalizeStudioBriaPadding(padding);
    const nonZeroPads = [pad.top, pad.right, pad.bottom, pad.left].filter((v) => v > 0);
    if (nonZeroPads.length === 0) return 0;

    const minDim = Math.min(sourceSize.width, sourceSize.height);
    if (minDim <= 2) return 0;

    const dynamic = Math.round(minDim * 0.02);
    const moderate = Math.max(12, Math.min(24, dynamic));
    const maxBySource = Math.floor((minDim - 1) / 4);
    const maxByPad = Math.min(...nonZeroPads);
    return Math.max(0, Math.min(moderate, maxBySource, maxByPad));
}

export async function prepareStudioBriaOutpaintSource(
    imageSrc: string,
    layer: ImageLayer,
    targetSize?: { width: number; height: number },
): Promise<StudioBriaPreparedSource> {
    const img = await loadImage(imageSrc);
    const naturalWidth = img.naturalWidth || layer.width;
    const naturalHeight = img.naturalHeight || layer.height;
    const plan = computeStudioOutpaintRasterPlan(
        { width: naturalWidth, height: naturalHeight },
        layer,
    );
    const targetW = Math.max(1, Math.round(targetSize?.width ?? plan.canvasWidth));
    const targetH = Math.max(1, Math.round(targetSize?.height ?? plan.canvasHeight));

    const canReuseSource =
        !plan.changed
        && Math.round(naturalWidth) === targetW
        && Math.round(naturalHeight) === targetH;
    if (canReuseSource) {
        return { src: imageSrc, width: targetW, height: targetH, changed: false };
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Failed to create canvas context for studio Bria outpaint source");
    }

    const scaleX = targetW / Math.max(1, plan.canvasWidth);
    const scaleY = targetH / Math.max(1, plan.canvasHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
        img,
        plan.source.x, plan.source.y, plan.source.width, plan.source.height,
        Math.round(plan.dest.x * scaleX),
        Math.round(plan.dest.y * scaleY),
        Math.round(plan.dest.width * scaleX),
        Math.round(plan.dest.height * scaleY),
    );

    return {
        src: canvas.toDataURL("image/png"),
        width: targetW,
        height: targetH,
        changed: true,
    };
}

export async function compositeStudioBriaOutpaint(params: {
    expandedSrc: string;
    sourceSrc: string;
    outputGeometry: StudioBriaGeometry;
    expandedGeometry: StudioBriaGeometry;
}): Promise<string> {
    const [expandedImg, sourceImg] = await Promise.all([
        loadImage(params.expandedSrc),
        loadImage(params.sourceSrc),
    ]);
    const expectedExpandedW = params.expandedGeometry.canvasSize.width;
    const expectedExpandedH = params.expandedGeometry.canvasSize.height;
    if (expandedImg.naturalWidth !== expectedExpandedW || expandedImg.naturalHeight !== expectedExpandedH) {
        throw new Error(
            `Bria Expand вернула canvas ${expandedImg.naturalWidth}x${expandedImg.naturalHeight}px вместо ожидаемого ${expectedExpandedW}x${expectedExpandedH}px.`,
        );
    }

    const outputW = params.outputGeometry.canvasSize.width;
    const outputH = params.outputGeometry.canvasSize.height;
    const sourceW = params.outputGeometry.sourceSize.width;
    const sourceH = params.outputGeometry.sourceSize.height;
    const canvas = document.createElement("canvas");
    canvas.width = outputW;
    canvas.height = outputH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Failed to create canvas context for studio Bria composite");
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(expandedImg, 0, 0, outputW, outputH);

    const destX = params.outputGeometry.originalLocation.x;
    const destY = params.outputGeometry.originalLocation.y;
    const featherPx = computeStudioBriaFeatherPx(params.outputGeometry.sourceSize, params.outputGeometry.pixelPadding);
    if (featherPx <= 0) {
        ctx.drawImage(sourceImg, destX, destY, sourceW, sourceH);
        return canvas.toDataURL("image/png");
    }

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = sourceW;
    maskCanvas.height = sourceH;
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) {
        throw new Error("Failed to create canvas context for studio Bria feather mask");
    }
    const maskData = maskCtx.createImageData(sourceW, sourceH);
    maskData.data.set(computeFeatherMaskData(sourceW, sourceH, params.outputGeometry.pixelPadding, featherPx));
    maskCtx.putImageData(maskData, 0, 0);

    const overlayCanvas = document.createElement("canvas");
    overlayCanvas.width = sourceW;
    overlayCanvas.height = sourceH;
    const overlayCtx = overlayCanvas.getContext("2d");
    if (!overlayCtx) {
        throw new Error("Failed to create canvas context for studio Bria source overlay");
    }
    overlayCtx.drawImage(sourceImg, 0, 0, sourceW, sourceH);
    overlayCtx.globalCompositeOperation = "destination-in";
    overlayCtx.drawImage(maskCanvas, 0, 0);

    ctx.drawImage(overlayCanvas, destX, destY);
    return canvas.toDataURL("image/png");
}

function isDataImage(src: string): boolean {
    return src.startsWith("data:image/");
}

function isPersistedStudioBriaUrl(src: string): boolean {
    try {
        return new URL(src).host === STUDIO_BRIA_PERSIST_HOST;
    } catch {
        return false;
    }
}

async function persistRequiredStudioBriaImage(
    src: string,
    projectId: string,
    label: string,
): Promise<string> {
    const delaysMs = [0, 500, 1500];
    let lastPersisted = src;
    for (const delayMs of delaysMs) {
        if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        const persisted = await persistImageToS3(src, projectId);
        lastPersisted = persisted;
        if (isPersistedStudioBriaUrl(persisted)) return persisted;
    }

    throw new Error(
        `Studio Bria outpaint: failed to persist ${label} before generation/composite. ` +
        `Last URL host: ${safeHost(lastPersisted)}. ` +
        "Повторите попытку: без постоянного S3 URL браузер не может собрать финальный composite.",
    );
}

async function requestStudioBriaPromptEnhancement(
    imageUrl: string,
    userPrompt?: string,
): Promise<StudioBriaPromptEnhancement> {
    try {
        const response = await fetch("/api/ai/studio-bria-prompt-enhance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                imageUrl,
                prompt: userPrompt,
            }),
        });
        if (!response.ok) {
            throw new Error(`Prompt enhancement failed (${response.status})`);
        }
        const data = await response.json() as {
            enhancement?: Partial<StudioBriaPromptEnhancement>;
            error?: string;
        };
        if (data.error) throw new Error(data.error);
        const raw = data.enhancement;
        const prompt = sanitizeStudioBriaEnhancedPrompt(raw?.prompt);
        if (!prompt) throw new Error("Prompt enhancement returned empty prompt");
        return {
            prompt,
            provider: raw?.provider === "fal-vision" ? "fal-vision" : "fallback",
            model: typeof raw?.model === "string" ? raw.model : undefined,
        };
    } catch (error) {
        console.error("[StudioBriaOutpaint] Prompt enhancement fallback:", error);
        return fallbackStudioBriaPromptEnhancement();
    }
}

export async function runStudioBriaOutpaint(
    params: RunStudioBriaOutpaintParams,
): Promise<StudioBriaOutpaintResult> {
    params.onProgress?.("source-persist-start", {
        sourceHost: safeHost(params.imageSrc),
    });
    const safeSourceSrc = isPersistedStudioBriaUrl(params.imageSrc)
        ? params.imageSrc
        : await persistRequiredStudioBriaImage(params.imageSrc, params.projectId, "source image");
    params.onProgress?.("source-persist-done", {
        sourceHost: safeHost(safeSourceSrc),
    });

    const nativeSource = await prepareStudioBriaOutpaintSource(safeSourceSrc, params.layer);
    const nativeGeometry = computeStudioBriaGeometryForSource(
        { width: nativeSource.width, height: nativeSource.height },
        { width: params.layer.width, height: params.layer.height },
        params.canvasPadding,
    );
    const requestScale = computeStudioBriaRequestScale(nativeGeometry);
    const requestGeometry = scaleStudioBriaGeometry(nativeGeometry, requestScale);
    validateStudioBriaGeometry(requestGeometry);

    const requestSource = requestScale < 1
        ? await prepareStudioBriaOutpaintSource(safeSourceSrc, params.layer, requestGeometry.sourceSize)
        : nativeSource;

    params.onProgress?.("source-rasterized", {
        width: requestSource.width,
        height: requestSource.height,
        changed: requestSource.changed,
        nativeWidth: nativeSource.width,
        nativeHeight: nativeSource.height,
        requestScale,
    });

    const requestSourceUrl = isPersistedStudioBriaUrl(requestSource.src)
        ? requestSource.src
        : await persistRequiredStudioBriaImage(requestSource.src, params.projectId, "request source");
    const nativeSourceUrl = requestSource.src === nativeSource.src
        ? requestSourceUrl
        : isDataImage(nativeSource.src)
            ? nativeSource.src
            : isPersistedStudioBriaUrl(nativeSource.src)
                ? nativeSource.src
                : await persistRequiredStudioBriaImage(nativeSource.src, params.projectId, "native source");
    params.onProgress?.("prepared-source-persisted", {
        sourceHost: safeHost(requestSourceUrl),
    });

    let promptEnhancement = params.promptEnhancement;
    if (promptEnhancement) {
        params.onProgress?.("prompt-enhance-done", {
            provider: promptEnhancement.provider,
            model: promptEnhancement.model,
            reused: true,
        });
    } else {
        params.onProgress?.("prompt-enhance-start", {
            sourceHost: safeHost(requestSourceUrl),
        });
        promptEnhancement = await requestStudioBriaPromptEnhancement(requestSourceUrl, params.prompt);
        params.onProgress?.("prompt-enhance-done", {
            provider: promptEnhancement.provider,
            model: promptEnhancement.model,
        });
    }

    const prompts = buildStudioBriaPrompts(params.prompt, promptEnhancement);
    params.onProgress?.("outpaint-api-start", {
        canvasSize: requestGeometry.canvasSize,
        sourceSize: requestGeometry.sourceSize,
        nativeCanvasSize: nativeGeometry.canvasSize,
    });
    const response = await fetch("/api/ai/image-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
            buildStudioBriaImageEditBody({
                imageUrl: requestSourceUrl,
                projectId: params.projectId,
                geometry: requestGeometry,
                prompts,
                seed: params.seed,
            }),
        ),
    });
    const data = await response.json();
    if (data.error) {
        throw new Error(data.requestId ? `${data.error} [request: ${data.requestId}]` : data.error);
    }
    if (!data.content) {
        throw new Error("Studio Bria outpaint: empty response from /api/ai/image-edit");
    }
    params.onProgress?.("outpaint-api-done", {
        model: data.model ?? "bria-expand",
    });

    const safeExpandedSrc = isPersistedStudioBriaUrl(data.content as string)
        ? data.content as string
        : await persistRequiredStudioBriaImage(data.content as string, params.projectId, "expanded result");
    params.onProgress?.("composite-start");
    const compositedSrc = await compositeStudioBriaOutpaint({
        expandedSrc: safeExpandedSrc,
        sourceSrc: nativeSourceUrl,
        outputGeometry: nativeGeometry,
        expandedGeometry: requestGeometry,
    });
    params.onProgress?.("composite-done");
    const persistedCompositedSrc = await persistRequiredStudioBriaImage(
        compositedSrc,
        params.projectId,
        "composited result",
    );

    return {
        src: persistedCompositedSrc,
        model: typeof data.model === "string" ? data.model : "bria-expand",
        seed: typeof data.seed === "number" ? data.seed : undefined,
        promptEnhancement,
        pixelPadding: nativeGeometry.pixelPadding,
        sourceSize: nativeGeometry.sourceSize,
        canvasSize: nativeGeometry.canvasSize,
    };
}

function safeHost(src: string | null | undefined): string {
    if (!src) return "none";
    if (src.startsWith("data:")) return "data-uri";
    try {
        return new URL(src).host;
    } catch {
        return "invalid-url";
    }
}
