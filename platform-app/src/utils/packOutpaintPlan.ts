import {
    migrateLegacyBinding,
    resolveImageSyncMode,
    type ImageFitMode,
    type ImageSyncMode,
    type LayerBinding,
} from "@/types";
import { computeImageFitProps } from "@/utils/imageFitUtils";

export interface PackOutpaintRect {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    slotId?: string;
    masterId?: string;
    type?: string;
    objectFit?: ImageFitMode;
    focusX?: number;
    focusY?: number;
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

export interface PackOutpaintLayerRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PackOutpaintDiagnostic {
    code:
        | "content-sync-skipped"
        | "missing-target-layer"
        | "invalid-target-layer"
        | "aspect-pad-added"
        | "grid-union-fallback"
        | "request-aspect-out-of-range"
        | "request-scaled-to-caps"
        | "request-upscaled-to-min";
    formatId?: string;
    message: string;
}

export interface PackOutpaintPlan {
    canvasPadding: { top: number; right: number; bottom: number; left: number };
    nextMasterRect: { x: number; y: number; width: number; height: number };
    /** Final delivery size (pack-required). Equals nextMasterRect aspect. */
    outputSizePx: PixelSize;
    /** Size sent to fal/GPT (may be larger than outputSizePx for aspect-cap padding). */
    requestSizePx: PixelSize;
    /** Source placement inside the OUTPUT canvas (used for client-side mask). */
    sourcePlacementPx: { x: number; y: number; width: number; height: number };
    /** Source placement inside the REQUEST canvas (used to build the fal payload). */
    requestSourcePlacementPx: { x: number; y: number; width: number; height: number };
    /**
     * Crop rect inside the REQUEST canvas that yields the OUTPUT delivery.
     * For pack-required aspects within the GPT envelope this is the whole
     * request canvas; for ultra-wide / ultra-tall packs it strips the
     * symmetric cap padding that was added only for the GPT request.
     */
    requestOutputCropPx: { x: number; y: number; width: number; height: number };
    /**
     * Experimental grid-union mode only. Exact per-format layer rects for
     * rendering the generated bitmap with objectFit: "fill" while preserving
     * each format's pre-outpaint source placement.
     */
    formatLayerRects?: Record<string, PackOutpaintLayerRect>;
    diagnostics: PackOutpaintDiagnostic[];
}

/**
 * Controls what happens when the union of pack-required paddings produces an
 * aspect outside the GPT Image 2 3:1 / 1:3 envelope.
 *
 * - "delivery-crop" (default): keep `outputSizePx` and `nextMasterRect`
 *   exactly equal to what the pack needs (asymmetric padding only). When
 *   the pack rect breaches the 3:1 envelope, add symmetric cap padding to
 *   the *request canvas only* and crop the GPT bitmap back to the pack
 *   rect after the call. The product never moves and the layer rect never
 *   inflates from the cap.
 * - "pad" (legacy): grow the output canvas with extra symmetric padding on
 *   the short axis to bring the aspect inside the cap. The product on the
 *   master moves toward the geometric center, which is undesirable for
 *   asymmetric banner packs but matches the original behaviour. Kept for
 *   backwards compatibility with existing callers and tests.
 * - "downscale-request": keep `outputSizePx` exactly equal to what the pack
 *   needs and let `computeGptImage2RequestSize` shrink the request canvas
 *   to fit the edge/area caps without padding it for aspect. The resulting
 *   `requestSizePx` may breach the 3:1 aspect — callers can detect this
 *   from `request-aspect-out-of-range` and route to a different engine.
 * - "off": skip the cap entirely. Used when the engine has no aspect limit.
 */
export type PackAspectCapStrategy = "delivery-crop" | "pad" | "downscale-request" | "off";

export interface ComputePackOutpaintPlanOptions {
    bleedPx?: number;
    exportScale?: number;
    aspectCapStrategy?: PackAspectCapStrategy;
    /**
     * Optional composition reserve for tall pack formats. When enabled and a
     * tall format uses a shallow hero image layer, ensure the source image
     * starts at least this fraction down inside the expanded bitmap. This gives
     * vertical banners enough generated background above the product.
     */
    tallFormatTopReserveRatio?: number;
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
const TALL_FORMAT_MIN_ASPECT = 1.25;
const TALL_FORMAT_MAX_LAYER_COVERAGE_Y = 0.72;
const GRID_UNION_MAX_SOURCE_SCALE = 6;

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

    const masterIds = new Set([masterLayer.id, masterLayer.masterId].filter(Boolean));
    const byExactId = layers.find((layer) => layer.id === masterLayer.id);
    if (byExactId) return byExactId;

    const byMaster = layers.find((layer) => layer.masterId && masterIds.has(layer.masterId));
    if (byMaster) return byMaster;

    const masterSlot = cleanSlot(masterLayer.slotId);
    if (masterSlot) {
        const bySlot = layers.find((layer) => cleanSlot(layer.slotId) === masterSlot);
        if (bySlot) return bySlot;
    }

    return undefined;
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

function roundGeometry(value: number): number {
    return Math.round(value * 100) / 100;
}

function clampTopReserveRatio(value: number | undefined): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
    return Math.min(0.45, value);
}

function shouldApplyTallTopReserve(
    format: PackOutpaintFormat,
    targetLayer: PackOutpaintRect,
): boolean {
    if (format.width <= 0 || format.height <= 0 || targetLayer.height <= 0) return false;
    if (format.height / format.width < TALL_FORMAT_MIN_ASPECT) return false;
    return targetLayer.height / format.height <= TALL_FORMAT_MAX_LAYER_COVERAGE_Y;
}

function applyTallFormatTopReserve(
    padding: { top: number; right: number; bottom: number; left: number },
    masterLayer: PackOutpaintRect,
    reserveRatio: number,
): { top: number; right: number; bottom: number; left: number } {
    const ratio = clampTopReserveRatio(reserveRatio);
    if (ratio <= 0 || masterLayer.height <= 0) return padding;

    const minTop = Math.ceil((ratio * (masterLayer.height + padding.bottom)) / (1 - ratio));
    if (minTop <= padding.top) return padding;
    return { ...padding, top: minTop };
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

interface AspectCapExtra {
    extra: { top: number; right: number; bottom: number; left: number };
    diagnostic?: PackOutpaintDiagnostic;
}

function computeAspectCapExtra(
    padding: { top: number; right: number; bottom: number; left: number },
    masterLayer: PackOutpaintRect,
    sourceSize: PixelSize,
): AspectCapExtra {
    const zero = { extra: { top: 0, right: 0, bottom: 0, left: 0 } } as AspectCapExtra;
    const scaleX = sourceSize.width / masterLayer.width;
    const scaleY = sourceSize.height / masterLayer.height;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
        return zero;
    }

    const outW = sourceSize.width + (padding.left + padding.right) * scaleX;
    const outH = sourceSize.height + (padding.top + padding.bottom) * scaleY;
    if (!Number.isFinite(outW) || !Number.isFinite(outH) || outW <= 0 || outH <= 0) {
        return zero;
    }
    const aspect = outW / outH;

    if (aspect > GPT_IMAGE2_MAX_ASPECT) {
        const targetH = outW / GPT_IMAGE2_MAX_ASPECT;
        const extraCanvas = Math.ceil((targetH - outH) / scaleY);
        const extraTop = Math.ceil(extraCanvas / 2);
        return {
            extra: {
                top: extraTop,
                bottom: extraCanvas - extraTop,
                left: 0,
                right: 0,
            },
            diagnostic: {
                code: "aspect-pad-added",
                message: "Vertical padding was added so the GPT request stays within the 3:1 aspect limit.",
            },
        };
    }
    if (aspect < 1 / GPT_IMAGE2_MAX_ASPECT) {
        const targetW = outH / GPT_IMAGE2_MAX_ASPECT;
        const extraCanvas = Math.ceil((targetW - outW) / scaleX);
        const extraLeft = Math.ceil(extraCanvas / 2);
        return {
            extra: {
                top: 0,
                bottom: 0,
                left: extraLeft,
                right: extraCanvas - extraLeft,
            },
            diagnostic: {
                code: "aspect-pad-added",
                message: "Horizontal padding was added so the GPT request stays within the 3:1 aspect limit.",
            },
        };
    }

    return zero;
}

function enforceAspectCap(
    padding: { top: number; right: number; bottom: number; left: number },
    masterLayer: PackOutpaintRect,
    sourceSize: PixelSize,
    diagnostics: PackOutpaintDiagnostic[],
): { top: number; right: number; bottom: number; left: number } {
    const cap = computeAspectCapExtra(padding, masterLayer, sourceSize);
    if (cap.diagnostic) diagnostics.push(cap.diagnostic);
    return {
        top: padding.top + cap.extra.top,
        right: padding.right + cap.extra.right,
        bottom: padding.bottom + cap.extra.bottom,
        left: padding.left + cap.extra.left,
    };
}

interface BuildPlanArgs {
    masterLayer: PackOutpaintRect;
    sourceSizePx: PixelSize;
    outputPadded: { top: number; right: number; bottom: number; left: number };
    aspectCapStrategy: PackAspectCapStrategy;
    diagnostics: PackOutpaintDiagnostic[];
    formatLayerRects?: Record<string, PackOutpaintLayerRect>;
}

function buildPackOutpaintPlanFromPadding(args: BuildPlanArgs): PackOutpaintPlan {
    const { masterLayer, sourceSizePx, outputPadded, aspectCapStrategy, diagnostics, formatLayerRects } = args;
    const requestCapExtra = aspectCapStrategy === "delivery-crop"
        ? computeAspectCapExtra(outputPadded, masterLayer, sourceSizePx)
        : ({ extra: { top: 0, right: 0, bottom: 0, left: 0 } } as AspectCapExtra);
    if (aspectCapStrategy === "delivery-crop" && requestCapExtra.diagnostic) {
        diagnostics.push(requestCapExtra.diagnostic);
    }

    const scaleX = sourceSizePx.width / masterLayer.width;
    const scaleY = sourceSizePx.height / masterLayer.height;
    const padPx = {
        left: Math.round(outputPadded.left * scaleX),
        right: Math.round(outputPadded.right * scaleX),
        top: Math.round(outputPadded.top * scaleY),
        bottom: Math.round(outputPadded.bottom * scaleY),
    };
    const requestExtraPadPx = {
        left: Math.round(requestCapExtra.extra.left * scaleX),
        right: Math.round(requestCapExtra.extra.right * scaleX),
        top: Math.round(requestCapExtra.extra.top * scaleY),
        bottom: Math.round(requestCapExtra.extra.bottom * scaleY),
    };
    const outputSizePx = {
        width: Math.max(1, Math.round(sourceSizePx.width + padPx.left + padPx.right)),
        height: Math.max(1, Math.round(sourceSizePx.height + padPx.top + padPx.bottom)),
    };
    const requestRawSize = {
        width: Math.max(1, outputSizePx.width + requestExtraPadPx.left + requestExtraPadPx.right),
        height: Math.max(1, outputSizePx.height + requestExtraPadPx.top + requestExtraPadPx.bottom),
    };
    const request = computeGptImage2RequestSize(requestRawSize);
    diagnostics.push(...request.diagnostics);

    if (aspectCapStrategy === "downscale-request" && request.size.width > 0 && request.size.height > 0) {
        const requestAspect = request.size.width / request.size.height;
        if (requestAspect > GPT_IMAGE2_MAX_ASPECT || requestAspect < 1 / GPT_IMAGE2_MAX_ASPECT) {
            diagnostics.push({
                code: "request-aspect-out-of-range",
                message: `Request aspect ${requestAspect.toFixed(2)} is outside the GPT Image 2 ${GPT_IMAGE2_MAX_ASPECT}:1 envelope; the configured engine must accept it.`,
            });
        }
    }

    const reqScaleX = request.size.width / requestRawSize.width;
    const reqScaleY = request.size.height / requestRawSize.height;
    const requestSourcePlacementPx = {
        x: Math.round((requestExtraPadPx.left + padPx.left) * reqScaleX),
        y: Math.round((requestExtraPadPx.top + padPx.top) * reqScaleY),
        width: Math.max(1, Math.round(sourceSizePx.width * reqScaleX)),
        height: Math.max(1, Math.round(sourceSizePx.height * reqScaleY)),
    };
    const cropRawX = Math.round(requestExtraPadPx.left * reqScaleX);
    const cropRawY = Math.round(requestExtraPadPx.top * reqScaleY);
    const cropRawW = Math.max(1, Math.round(outputSizePx.width * reqScaleX));
    const cropRawH = Math.max(1, Math.round(outputSizePx.height * reqScaleY));
    const cropX = Math.max(0, Math.min(cropRawX, request.size.width - 1));
    const cropY = Math.max(0, Math.min(cropRawY, request.size.height - 1));

    return {
        canvasPadding: outputPadded,
        nextMasterRect: {
            x: masterLayer.x - outputPadded.left,
            y: masterLayer.y - outputPadded.top,
            width: masterLayer.width + outputPadded.left + outputPadded.right,
            height: masterLayer.height + outputPadded.top + outputPadded.bottom,
        },
        outputSizePx,
        requestSizePx: request.size,
        sourcePlacementPx: {
            x: padPx.left,
            y: padPx.top,
            width: Math.round(sourceSizePx.width),
            height: Math.round(sourceSizePx.height),
        },
        requestSourcePlacementPx,
        requestOutputCropPx: {
            x: cropX,
            y: cropY,
            width: Math.max(1, Math.min(cropRawW, request.size.width - cropX)),
            height: Math.max(1, Math.min(cropRawH, request.size.height - cropY)),
        },
        formatLayerRects,
        diagnostics,
    };
}

interface SourceViewportMapping {
    formatId: string;
    viewport: PackOutpaintLayerRect;
    sourceToArtboard: {
        x: number;
        y: number;
        scaleX: number;
        scaleY: number;
    };
}

function gridFallback(
    diagnostics: PackOutpaintDiagnostic[],
    message: string,
    formatId?: string,
): { plan: null; diagnostics: PackOutpaintDiagnostic[] } {
    diagnostics.push({ code: "grid-union-fallback", formatId, message });
    return { plan: null, diagnostics };
}

function computeSourceViewportMapping(
    format: PackOutpaintFormat,
    layer: PackOutpaintRect,
    sourceSizePx: PixelSize,
    bleed: number,
): SourceViewportMapping | null {
    if (!validRect(layer) || format.width <= 0 || format.height <= 0) return null;

    const fit = computeImageFitProps(
        layer.objectFit ?? "fill",
        sourceSizePx.width,
        sourceSizePx.height,
        layer.width,
        layer.height,
        { focusX: layer.focusX, focusY: layer.focusY },
    );
    if (
        fit.cropWidth <= 0
        || fit.cropHeight <= 0
        || fit.drawWidth <= 0
        || fit.drawHeight <= 0
    ) {
        return null;
    }

    const sourcePerArtX = fit.cropWidth / fit.drawWidth;
    const sourcePerArtY = fit.cropHeight / fit.drawHeight;
    const drawOriginX = layer.x + fit.drawX;
    const drawOriginY = layer.y + fit.drawY;
    const viewport = {
        x: fit.cropX + (0 - drawOriginX) * sourcePerArtX - bleed * sourcePerArtX,
        y: fit.cropY + (0 - drawOriginY) * sourcePerArtY - bleed * sourcePerArtY,
        width: (format.width + bleed * 2) * sourcePerArtX,
        height: (format.height + bleed * 2) * sourcePerArtY,
    };
    const artPerSourceX = fit.drawWidth / fit.cropWidth;
    const artPerSourceY = fit.drawHeight / fit.cropHeight;
    return {
        formatId: format.id,
        viewport,
        sourceToArtboard: {
            x: drawOriginX - fit.cropX * artPerSourceX,
            y: drawOriginY - fit.cropY * artPerSourceY,
            scaleX: artPerSourceX,
            scaleY: artPerSourceY,
        },
    };
}

export function computeGridUnionOutpaintPlan(
    input: ComputePackOutpaintPlanInput,
): { plan: PackOutpaintPlan | null; diagnostics: PackOutpaintDiagnostic[] } {
    const bleed = input.options?.bleedPx ?? DEFAULT_BLEED_PX;
    const aspectCapStrategy: PackAspectCapStrategy = input.options?.aspectCapStrategy ?? "delivery-crop";
    const diagnostics: PackOutpaintDiagnostic[] = [];
    const sourceW = Math.max(1, Math.round(input.sourceSizePx.width));
    const sourceH = Math.max(1, Math.round(input.sourceSizePx.height));
    if (!validRect(input.masterLayer) || sourceW <= 0 || sourceH <= 0) {
        return gridFallback(diagnostics, "Grid-union planner received invalid master/source geometry.");
    }

    const mappings: SourceViewportMapping[] = [];
    for (const format of input.formats) {
        if (format.width <= 0 || format.height <= 0) continue;
        const targetLayer = format.isMaster
            ? input.masterLayer
            : findPackOutpaintTargetLayer(input.masterLayer, format);

        if (!targetLayer) {
            diagnostics.push({
                code: "missing-target-layer",
                formatId: format.id,
                message: "No matching image layer was found for this resize.",
            });
            return gridFallback(diagnostics, "Grid-union planner requires every format to have a matching image layer.", format.id);
        }
        if (!validRect(targetLayer)) {
            diagnostics.push({
                code: "invalid-target-layer",
                formatId: format.id,
                message: "Matching image layer has invalid dimensions.",
            });
            return gridFallback(diagnostics, "Grid-union planner received invalid target layer geometry.", format.id);
        }

        const mode = format.isMaster
            ? "relative_size"
            : resolveMode(targetLayer, input.masterLayer, format.layerBindings);
        if (mode === "content") {
            diagnostics.push({
                code: "content-sync-skipped",
                formatId: format.id,
                message: "Image sync mode is content-only, so geometry is not expanded for this resize.",
            });
            return gridFallback(diagnostics, "Grid-union planner does not support content-only image bindings.", format.id);
        }

        const mapping = computeSourceViewportMapping(
            format,
            targetLayer,
            { width: sourceW, height: sourceH },
            bleed,
        );
        if (!mapping) {
            return gridFallback(diagnostics, "Grid-union planner could not invert target layer geometry.", format.id);
        }
        mappings.push(mapping);
    }

    if (mappings.length === 0) {
        return gridFallback(diagnostics, "Grid-union planner found no usable formats.");
    }

    let minX = 0;
    let minY = 0;
    let maxX = sourceW;
    let maxY = sourceH;
    for (const mapping of mappings) {
        minX = Math.min(minX, mapping.viewport.x);
        minY = Math.min(minY, mapping.viewport.y);
        maxX = Math.max(maxX, mapping.viewport.x + mapping.viewport.width);
        maxY = Math.max(maxY, mapping.viewport.y + mapping.viewport.height);
    }

    const unionW = maxX - minX;
    const unionH = maxY - minY;
    if (!Number.isFinite(unionW) || !Number.isFinite(unionH) || unionW <= 0 || unionH <= 0) {
        return gridFallback(diagnostics, "Grid-union planner produced an empty union.");
    }
    if (unionW > sourceW * GRID_UNION_MAX_SOURCE_SCALE || unionH > sourceH * GRID_UNION_MAX_SOURCE_SCALE) {
        return gridFallback(diagnostics, "Grid-union planner produced an extreme union; falling back to padding planner.");
    }

    const padPx = {
        left: Math.ceil(Math.max(0, -minX)),
        top: Math.ceil(Math.max(0, -minY)),
        right: Math.ceil(Math.max(0, maxX - sourceW)),
        bottom: Math.ceil(Math.max(0, maxY - sourceH)),
    };
    const scaleX = sourceW / input.masterLayer.width;
    const scaleY = sourceH / input.masterLayer.height;
    const outputPadded = {
        top: padPx.top / scaleY,
        right: padPx.right / scaleX,
        bottom: padPx.bottom / scaleY,
        left: padPx.left / scaleX,
    };
    const outputW = Math.max(1, Math.round(sourceW + padPx.left + padPx.right));
    const outputH = Math.max(1, Math.round(sourceH + padPx.top + padPx.bottom));
    const formatLayerRects: Record<string, PackOutpaintLayerRect> = {};
    for (const mapping of mappings) {
        const { sourceToArtboard } = mapping;
        formatLayerRects[mapping.formatId] = {
            x: roundGeometry(sourceToArtboard.x - padPx.left * sourceToArtboard.scaleX),
            y: roundGeometry(sourceToArtboard.y - padPx.top * sourceToArtboard.scaleY),
            width: roundGeometry(outputW * sourceToArtboard.scaleX),
            height: roundGeometry(outputH * sourceToArtboard.scaleY),
        };
    }

    const plan = buildPackOutpaintPlanFromPadding({
        masterLayer: input.masterLayer,
        sourceSizePx: { width: sourceW, height: sourceH },
        outputPadded,
        aspectCapStrategy,
        diagnostics,
        formatLayerRects,
    });
    return { plan, diagnostics };
}

export function computePackOutpaintPlan(input: ComputePackOutpaintPlanInput): PackOutpaintPlan {
    const bleed = input.options?.bleedPx ?? DEFAULT_BLEED_PX;
    const masterLayer = input.masterLayer;
    const masterArtboard = input.masterArtboard;
    const diagnostics: PackOutpaintDiagnostic[] = [];
    const required = { top: 0, right: 0, bottom: 0, left: 0 };
    const tallTopReserveRatio = clampTopReserveRatio(input.options?.tallFormatTopReserveRatio);
    let needsTallTopReserve = false;

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
        if (tallTopReserveRatio > 0 && shouldApplyTallTopReserve(format, targetLayer)) {
            needsTallTopReserve = true;
        }

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

    const aspectCapStrategy: PackAspectCapStrategy = input.options?.aspectCapStrategy ?? "delivery-crop";
    const rawPaddedBase = {
        top: ceilNonNegative(required.top),
        right: ceilNonNegative(required.right),
        bottom: ceilNonNegative(required.bottom),
        left: ceilNonNegative(required.left),
    };
    const rawPadded = needsTallTopReserve
        ? applyTallFormatTopReserve(rawPaddedBase, masterLayer, tallTopReserveRatio)
        : rawPaddedBase;

    // Output padding controls the layer rect / nextMasterRect / outputSizePx.
    // Only the legacy "pad" strategy inflates the output to obey the GPT cap.
    const outputPadded = aspectCapStrategy === "pad"
        ? enforceAspectCap(rawPadded, masterLayer, input.sourceSizePx, diagnostics)
        : rawPadded;

    // Request-only cap pad keeps `outputSizePx` aligned with the pack rect for
    // "delivery-crop" while still feeding the GPT model an in-envelope canvas.
    const requestCapExtra = aspectCapStrategy === "delivery-crop"
        ? computeAspectCapExtra(outputPadded, masterLayer, input.sourceSizePx)
        : ({ extra: { top: 0, right: 0, bottom: 0, left: 0 } } as AspectCapExtra);
    if (aspectCapStrategy === "delivery-crop" && requestCapExtra.diagnostic) {
        diagnostics.push(requestCapExtra.diagnostic);
    }

    const scaleX = input.sourceSizePx.width / masterLayer.width;
    const scaleY = input.sourceSizePx.height / masterLayer.height;
    const padPx = {
        left: Math.round(outputPadded.left * scaleX),
        right: Math.round(outputPadded.right * scaleX),
        top: Math.round(outputPadded.top * scaleY),
        bottom: Math.round(outputPadded.bottom * scaleY),
    };
    const requestExtraPadPx = {
        left: Math.round(requestCapExtra.extra.left * scaleX),
        right: Math.round(requestCapExtra.extra.right * scaleX),
        top: Math.round(requestCapExtra.extra.top * scaleY),
        bottom: Math.round(requestCapExtra.extra.bottom * scaleY),
    };
    const outputSizePx = {
        width: Math.max(1, Math.round(input.sourceSizePx.width + padPx.left + padPx.right)),
        height: Math.max(1, Math.round(input.sourceSizePx.height + padPx.top + padPx.bottom)),
    };
    const requestRawSize = {
        width: Math.max(1, outputSizePx.width + requestExtraPadPx.left + requestExtraPadPx.right),
        height: Math.max(1, outputSizePx.height + requestExtraPadPx.top + requestExtraPadPx.bottom),
    };
    const request = computeGptImage2RequestSize(requestRawSize);
    diagnostics.push(...request.diagnostics);

    if (aspectCapStrategy === "downscale-request" && request.size.width > 0 && request.size.height > 0) {
        const requestAspect = request.size.width / request.size.height;
        if (requestAspect > GPT_IMAGE2_MAX_ASPECT || requestAspect < 1 / GPT_IMAGE2_MAX_ASPECT) {
            diagnostics.push({
                code: "request-aspect-out-of-range",
                message: `Request aspect ${requestAspect.toFixed(2)} is outside the GPT Image 2 ${GPT_IMAGE2_MAX_ASPECT}:1 envelope; the configured engine must accept it.`,
            });
        }
    }

    const reqScaleX = request.size.width / requestRawSize.width;
    const reqScaleY = request.size.height / requestRawSize.height;
    const requestSourcePlacementPx = {
        x: Math.round((requestExtraPadPx.left + padPx.left) * reqScaleX),
        y: Math.round((requestExtraPadPx.top + padPx.top) * reqScaleY),
        width: Math.max(1, Math.round(input.sourceSizePx.width * reqScaleX)),
        height: Math.max(1, Math.round(input.sourceSizePx.height * reqScaleY)),
    };
    const cropRawX = Math.round(requestExtraPadPx.left * reqScaleX);
    const cropRawY = Math.round(requestExtraPadPx.top * reqScaleY);
    const cropRawW = Math.max(1, Math.round(outputSizePx.width * reqScaleX));
    const cropRawH = Math.max(1, Math.round(outputSizePx.height * reqScaleY));
    const cropX = Math.max(0, Math.min(cropRawX, request.size.width - 1));
    const cropY = Math.max(0, Math.min(cropRawY, request.size.height - 1));
    const requestOutputCropPx = {
        x: cropX,
        y: cropY,
        width: Math.max(1, Math.min(cropRawW, request.size.width - cropX)),
        height: Math.max(1, Math.min(cropRawH, request.size.height - cropY)),
    };

    return {
        canvasPadding: outputPadded,
        nextMasterRect: {
            x: masterLayer.x - outputPadded.left,
            y: masterLayer.y - outputPadded.top,
            width: masterLayer.width + outputPadded.left + outputPadded.right,
            height: masterLayer.height + outputPadded.top + outputPadded.bottom,
        },
        outputSizePx,
        requestSizePx: request.size,
        sourcePlacementPx: {
            x: padPx.left,
            y: padPx.top,
            width: Math.round(input.sourceSizePx.width),
            height: Math.round(input.sourceSizePx.height),
        },
        requestSourcePlacementPx,
        requestOutputCropPx,
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
