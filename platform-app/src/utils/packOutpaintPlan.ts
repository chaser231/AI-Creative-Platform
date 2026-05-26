import {
    migrateLegacyBinding,
    resolveImageSyncMode,
    type ImageSyncMode,
    type LayerBinding,
} from "@/types";

export interface PackOutpaintRect {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    slotId?: string;
    masterId?: string;
    type?: string;
}

export interface PackOutpaintFormat {
    id: string;
    width: number;
    height: number;
    isMaster?: boolean;
    layers?: PackOutpaintRect[];
    layerBindings?: LayerBinding[];
}

export interface PixelSize {
    width: number;
    height: number;
}

export interface PackOutpaintDiagnostic {
    code:
        | "content-sync-skipped"
        | "missing-target-layer"
        | "invalid-target-layer"
        | "aspect-pad-added"
        | "request-scaled-to-caps"
        | "request-upscaled-to-min";
    formatId?: string;
    message: string;
}

export interface PackOutpaintPlan {
    canvasPadding: { top: number; right: number; bottom: number; left: number };
    nextMasterRect: { x: number; y: number; width: number; height: number };
    outputSizePx: PixelSize;
    requestSizePx: PixelSize;
    sourcePlacementPx: { x: number; y: number; width: number; height: number };
    diagnostics: PackOutpaintDiagnostic[];
}

export interface ComputePackOutpaintPlanOptions {
    bleedPx?: number;
    exportScale?: number;
}

export interface ComputePackOutpaintPlanInput {
    masterLayer: PackOutpaintRect;
    masterArtboard: PixelSize;
    formats: PackOutpaintFormat[];
    sourceSizePx: PixelSize;
    options?: ComputePackOutpaintPlanOptions;
}

export interface WizardWorkingAssetSizeOptions {
    exportScale?: number;
    reserveRatio?: number;
}

export const GPT_IMAGE2_MAX_EDGE = 3840;
export const GPT_IMAGE2_MAX_PIXELS = 8_294_400;
export const GPT_IMAGE2_MAX_ASPECT = 3;
export const GPT_IMAGE2_MIN_PIXELS = 655_360;
const GPT_IMAGE2_SIZE_MULTIPLE = 16;
const DEFAULT_BLEED_PX = 32;
const DEFAULT_EXPORT_SCALE = 2;
const DEFAULT_WORKING_RESERVE = 1.15;

function cleanSlot(value: string | undefined): string | undefined {
    return value && value !== "none" ? value : undefined;
}

function validRect(rect: Pick<PackOutpaintRect, "width" | "height">): boolean {
    return rect.width > 0 && rect.height > 0;
}

function findBinding(
    layer: PackOutpaintRect,
    masterLayer: PackOutpaintRect,
    bindings: LayerBinding[] | undefined,
): LayerBinding | undefined {
    if (!bindings || bindings.length === 0) return undefined;
    const masterIds = new Set([masterLayer.id, masterLayer.masterId].filter(Boolean));
    return bindings.find((binding) => (
        binding.targetLayerId === layer.id
        || (masterIds.has(binding.masterLayerId) && binding.targetLayerId === layer.id)
    ));
}

function resolveMode(
    layer: PackOutpaintRect,
    masterLayer: PackOutpaintRect,
    bindings: LayerBinding[] | undefined,
): ImageSyncMode {
    const binding = findBinding(layer, masterLayer, bindings);
    if (!binding) return "relative_size";
    return resolveImageSyncMode(migrateLegacyBinding(binding)) ?? "relative_size";
}

export function findPackOutpaintTargetLayer(
    masterLayer: PackOutpaintRect,
    format: PackOutpaintFormat,
): PackOutpaintRect | undefined {
    const layers = format.layers ?? [];
    if (layers.length === 0) return undefined;

    const masterSlot = cleanSlot(masterLayer.slotId);
    if (masterSlot) {
        const bySlot = layers.find((layer) => cleanSlot(layer.slotId) === masterSlot);
        if (bySlot) return bySlot;
    }

    const masterIds = new Set([masterLayer.id, masterLayer.masterId].filter(Boolean));
    const byMaster = layers.find((layer) => layer.masterId && masterIds.has(layer.masterId));
    if (byMaster) return byMaster;

    return layers.find((layer) => layer.id === masterLayer.id);
}

function addRequirement(
    req: { top: number; right: number; bottom: number; left: number },
    side: keyof typeof req,
    value: number,
): void {
    if (Number.isFinite(value) && value > req[side]) req[side] = value;
}

function computeDeficits(
    rect: PackOutpaintRect,
    format: PackOutpaintFormat,
    bleed: number,
): { top: number; right: number; bottom: number; left: number } {
    const safeLeft = -bleed;
    const safeTop = -bleed;
    const safeRight = format.width + bleed;
    const safeBottom = format.height + bleed;

    return {
        left: Math.max(0, rect.x > safeLeft ? rect.x - safeLeft : 0),
        top: Math.max(0, rect.y > safeTop ? rect.y - safeTop : 0),
        right: Math.max(0, rect.x + rect.width < safeRight ? safeRight - (rect.x + rect.width) : 0),
        bottom: Math.max(0, rect.y + rect.height < safeBottom ? safeBottom - (rect.y + rect.height) : 0),
    };
}

function ceilNonNegative(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.ceil(value);
}

function roundMultiple(value: number): number {
    return Math.max(GPT_IMAGE2_SIZE_MULTIPLE, Math.round(value / GPT_IMAGE2_SIZE_MULTIPLE) * GPT_IMAGE2_SIZE_MULTIPLE);
}

function floorMultiple(value: number): number {
    return Math.max(GPT_IMAGE2_SIZE_MULTIPLE, Math.floor(value / GPT_IMAGE2_SIZE_MULTIPLE) * GPT_IMAGE2_SIZE_MULTIPLE);
}

export function computeGptImage2RequestSize(
    outputSize: PixelSize,
): { size: PixelSize; diagnostics: PackOutpaintDiagnostic[] } {
    const diagnostics: PackOutpaintDiagnostic[] = [];
    const outputW = Math.max(1, Math.round(outputSize.width));
    const outputH = Math.max(1, Math.round(outputSize.height));
    let scale = 1;

    scale = Math.min(scale, GPT_IMAGE2_MAX_EDGE / outputW, GPT_IMAGE2_MAX_EDGE / outputH);
    const area = outputW * outputH;
    if (area > GPT_IMAGE2_MAX_PIXELS) {
        scale = Math.min(scale, Math.sqrt(GPT_IMAGE2_MAX_PIXELS / area));
    }
    if (scale < 1) {
        diagnostics.push({
            code: "request-scaled-to-caps",
            message: "GPT request size was downscaled to fit edge or area caps.",
        });
    }

    let reqW = outputW * scale;
    let reqH = outputH * scale;

    const reqArea = reqW * reqH;
    if (reqArea < GPT_IMAGE2_MIN_PIXELS) {
        const up = Math.sqrt(GPT_IMAGE2_MIN_PIXELS / reqArea);
        reqW *= up;
        reqH *= up;
        diagnostics.push({
            code: "request-upscaled-to-min",
            message: "GPT request size was temporarily upscaled to satisfy the minimum pixel budget.",
        });
    }

    let width = roundMultiple(reqW);
    let height = roundMultiple(reqH);

    if (width > GPT_IMAGE2_MAX_EDGE) width = floorMultiple(GPT_IMAGE2_MAX_EDGE);
    if (height > GPT_IMAGE2_MAX_EDGE) height = floorMultiple(GPT_IMAGE2_MAX_EDGE);

    while (width * height > GPT_IMAGE2_MAX_PIXELS && (width > GPT_IMAGE2_SIZE_MULTIPLE || height > GPT_IMAGE2_SIZE_MULTIPLE)) {
        if (width >= height) width -= GPT_IMAGE2_SIZE_MULTIPLE;
        else height -= GPT_IMAGE2_SIZE_MULTIPLE;
    }

    return { size: { width, height }, diagnostics };
}

function enforceAspectCap(
    padding: { top: number; right: number; bottom: number; left: number },
    masterLayer: PackOutpaintRect,
    sourceSize: PixelSize,
    diagnostics: PackOutpaintDiagnostic[],
): { top: number; right: number; bottom: number; left: number } {
    const scaleX = sourceSize.width / masterLayer.width;
    const scaleY = sourceSize.height / masterLayer.height;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
        return padding;
    }

    let next = { ...padding };
    let outW = sourceSize.width + (next.left + next.right) * scaleX;
    let outH = sourceSize.height + (next.top + next.bottom) * scaleY;
    const aspect = outW / outH;

    if (aspect > GPT_IMAGE2_MAX_ASPECT) {
        const targetH = outW / GPT_IMAGE2_MAX_ASPECT;
        const extraCanvas = Math.ceil((targetH - outH) / scaleY);
        const extraTop = Math.ceil(extraCanvas / 2);
        next = {
            ...next,
            top: next.top + extraTop,
            bottom: next.bottom + (extraCanvas - extraTop),
        };
        diagnostics.push({
            code: "aspect-pad-added",
            message: "Vertical padding was added so the GPT request stays within the 3:1 aspect limit.",
        });
    } else if (aspect < 1 / GPT_IMAGE2_MAX_ASPECT) {
        const targetW = outH / GPT_IMAGE2_MAX_ASPECT;
        const extraCanvas = Math.ceil((targetW - outW) / scaleX);
        const extraLeft = Math.ceil(extraCanvas / 2);
        next = {
            ...next,
            left: next.left + extraLeft,
            right: next.right + (extraCanvas - extraLeft),
        };
        diagnostics.push({
            code: "aspect-pad-added",
            message: "Horizontal padding was added so the GPT request stays within the 3:1 aspect limit.",
        });
    }

    outW = sourceSize.width + (next.left + next.right) * scaleX;
    outH = sourceSize.height + (next.top + next.bottom) * scaleY;
    if (outW / outH > GPT_IMAGE2_MAX_ASPECT || outH / outW > GPT_IMAGE2_MAX_ASPECT) {
        return next;
    }
    return next;
}

export function computePackOutpaintPlan(input: ComputePackOutpaintPlanInput): PackOutpaintPlan {
    const bleed = input.options?.bleedPx ?? DEFAULT_BLEED_PX;
    const masterLayer = input.masterLayer;
    const masterArtboard = input.masterArtboard;
    const diagnostics: PackOutpaintDiagnostic[] = [];
    const required = { top: 0, right: 0, bottom: 0, left: 0 };

    for (const format of input.formats) {
        if (format.width <= 0 || format.height <= 0) continue;

        const targetLayer = format.isMaster
            ? masterLayer
            : findPackOutpaintTargetLayer(masterLayer, format);

        if (!targetLayer) {
            diagnostics.push({
                code: "missing-target-layer",
                formatId: format.id,
                message: "No matching image layer was found for this resize.",
            });
            continue;
        }
        if (!validRect(targetLayer)) {
            diagnostics.push({
                code: "invalid-target-layer",
                formatId: format.id,
                message: "Matching image layer has invalid dimensions.",
            });
            continue;
        }

        const mode = format.isMaster
            ? "relative_size"
            : resolveMode(targetLayer, masterLayer, format.layerBindings);

        if (mode === "content") {
            diagnostics.push({
                code: "content-sync-skipped",
                formatId: format.id,
                message: "Image sync mode is content-only, so geometry is not expanded for this resize.",
            });
            continue;
        }

        const deficits = computeDeficits(targetLayer, format, bleed);

        if (mode === "relative_size") {
            addRequirement(required, "left", deficits.left * masterLayer.width / targetLayer.width);
            addRequirement(required, "right", deficits.right * masterLayer.width / targetLayer.width);
            addRequirement(required, "top", deficits.top * masterLayer.height / targetLayer.height);
            addRequirement(required, "bottom", deficits.bottom * masterLayer.height / targetLayer.height);
        } else {
            const scaleX = masterArtboard.width > 0 ? format.width / masterArtboard.width : 0;
            const scaleY = masterArtboard.height > 0 ? format.height / masterArtboard.height : 0;
            if (scaleX <= 0 || scaleY <= 0) continue;
            addRequirement(required, "left", deficits.left / scaleX);
            addRequirement(required, "right", deficits.right / scaleX);
            addRequirement(required, "top", deficits.top / scaleY);
            addRequirement(required, "bottom", deficits.bottom / scaleY);
        }
    }

    const padded = enforceAspectCap(
        {
            top: ceilNonNegative(required.top),
            right: ceilNonNegative(required.right),
            bottom: ceilNonNegative(required.bottom),
            left: ceilNonNegative(required.left),
        },
        masterLayer,
        input.sourceSizePx,
        diagnostics,
    );

    const scaleX = input.sourceSizePx.width / masterLayer.width;
    const scaleY = input.sourceSizePx.height / masterLayer.height;
    const padPx = {
        left: Math.round(padded.left * scaleX),
        right: Math.round(padded.right * scaleX),
        top: Math.round(padded.top * scaleY),
        bottom: Math.round(padded.bottom * scaleY),
    };
    const outputSizePx = {
        width: Math.max(1, Math.round(input.sourceSizePx.width + padPx.left + padPx.right)),
        height: Math.max(1, Math.round(input.sourceSizePx.height + padPx.top + padPx.bottom)),
    };
    const request = computeGptImage2RequestSize(outputSizePx);
    diagnostics.push(...request.diagnostics);

    return {
        canvasPadding: padded,
        nextMasterRect: {
            x: masterLayer.x - padded.left,
            y: masterLayer.y - padded.top,
            width: masterLayer.width + padded.left + padded.right,
            height: masterLayer.height + padded.top + padded.bottom,
        },
        outputSizePx,
        requestSizePx: request.size,
        sourcePlacementPx: {
            x: padPx.left,
            y: padPx.top,
            width: Math.round(input.sourceSizePx.width),
            height: Math.round(input.sourceSizePx.height),
        },
        diagnostics,
    };
}

export function computeWizardWorkingAssetSize(
    sourceSize: PixelSize,
    layerSize: PixelSize,
    packFormats: PixelSize[],
    opts?: WizardWorkingAssetSizeOptions,
): PixelSize {
    const exportScale = opts?.exportScale ?? DEFAULT_EXPORT_SCALE;
    const reserve = opts?.reserveRatio ?? DEFAULT_WORKING_RESERVE;
    const sourceW = Math.max(1, Math.round(sourceSize.width));
    const sourceH = Math.max(1, Math.round(sourceSize.height));
    const layerW = Math.max(1, layerSize.width);
    const layerH = Math.max(1, layerSize.height);

    let maxScale = 1;
    for (const format of packFormats) {
        if (format.width > 0) maxScale = Math.max(maxScale, format.width / layerW);
        if (format.height > 0) maxScale = Math.max(maxScale, format.height / layerH);
    }

    const targetW = layerW * maxScale * exportScale * reserve;
    const targetH = layerH * maxScale * exportScale * reserve;
    const scale = Math.min(
        1,
        targetW / sourceW,
        targetH / sourceH,
        GPT_IMAGE2_MAX_EDGE / sourceW,
        GPT_IMAGE2_MAX_EDGE / sourceH,
        Math.sqrt(GPT_IMAGE2_MAX_PIXELS / (sourceW * sourceH)),
    );

    return {
        width: Math.max(1, Math.round(sourceW * scale)),
        height: Math.max(1, Math.round(sourceH * scale)),
    };
}
