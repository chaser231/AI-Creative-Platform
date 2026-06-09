import type { AdaptationDiagnostic, FrameLayer, Layer, TextLayer } from "@/types";
import { applyAllAutoLayouts, measureTextLayer } from "@/utils/layoutEngine";
import { applyTextContainerLimits } from "@/utils/textContainerLimits";
import { shrinkTextToFitBox } from "@/utils/textFit";
import { projectTree, type ArtboardSize } from "@/services/adaptationProjection";

export type { ArtboardSize };

export type AdaptationPipelineOptions = {
    scaleFonts?: boolean;
    applyTextFit?: boolean;
    applyContainerLimits?: boolean;
    validateAndHide?: boolean;
    preserveStretchedRootAL?: boolean;
};

export const AdaptationPresets = {
    full: {
        scaleFonts: true,
        applyTextFit: true,
        applyContainerLimits: true,
        validateAndHide: true,
        preserveStretchedRootAL: true,
    },
    manualResize: {
        scaleFonts: false,
        applyTextFit: false,
        applyContainerLimits: false,
        validateAndHide: false,
        preserveStretchedRootAL: false,
    },
} satisfies Record<string, AdaptationPipelineOptions>;

const GEOMETRY_EPSILON = 1;

const DEFAULT_OPTIONS: Required<AdaptationPipelineOptions> = {
    scaleFonts: true,
    applyTextFit: true,
    applyContainerLimits: true,
    validateAndHide: true,
    preserveStretchedRootAL: true,
};

/** Shared layer-based adaptation kernel for studio «Адаптировать» and manual resize. */
export function runAdaptationPipeline(
    layers: Layer[],
    sourceSize: ArtboardSize,
    targetSize: ArtboardSize,
    options?: AdaptationPipelineOptions,
): { layers: Layer[]; diagnostics: AdaptationDiagnostic[] } {
    const resolved = { ...DEFAULT_OPTIONS, ...options };
    const diagnostics: AdaptationDiagnostic[] = [];

    const projected = projectTree(layers, sourceSize, targetSize, {
        scaleFonts: resolved.scaleFonts,
    });

    let layouted = applyAllAutoLayouts(projected);
    if (resolved.preserveStretchedRootAL) {
        layouted = preserveStretchedRootAutoLayoutGeometry(projected, layouted);
    }

    let next = remeasureAdaptedTextBoxes(layouted);
    if (resolved.applyContainerLimits) {
        next = applyTextContainerLimitsToLayers(next);
    }
    if (resolved.applyTextFit) {
        next = applyTextFitShrink(next);
    }
    if (resolved.validateAndHide) {
        next = validateAndApplyHide(next, targetSize, diagnostics);
    }

    return { layers: next, diagnostics };
}

function preserveStretchedRootAutoLayoutGeometry(
    projected: Layer[],
    layouted: Layer[],
): Layer[] {
    const projectedById = new Map(projected.map((layer) => [layer.id, layer]));
    const childIdSet = new Set<string>();
    for (const layer of layouted) {
        if (layer.type !== "frame") continue;
        for (const childId of (layer as FrameLayer).childIds) childIdSet.add(childId);
    }

    return layouted.map((layer) => {
        if (childIdSet.has(layer.id) || layer.type !== "frame") return layer;
        const frame = layer as FrameLayer;
        if (!frame.layoutMode || frame.layoutMode === "none") return layer;
        const constraints = frame.constraints;
        if (constraints?.horizontal !== "stretch" || constraints?.vertical !== "stretch") {
            return layer;
        }
        const source = projectedById.get(layer.id);
        if (!source) return layer;
        return {
            ...layer,
            x: source.x,
            y: source.y,
            width: source.width,
            height: source.height,
        };
    });
}

function applyTextContainerLimitsToLayers(layers: Layer[]): Layer[] {
    return layers.map((layer) => (
        layer.type === "text" ? applyTextContainerLimits(layer as TextLayer) : layer
    ));
}

function applyTextFitShrink(layers: Layer[]): Layer[] {
    return layers.map((layer) => (
        layer.type === "text" ? shrinkTextToFitBox(layer as TextLayer) : layer
    ));
}

function remeasureAdaptedTextBoxes(layers: Layer[]): Layer[] {
    return layers.map((layer) => {
        if (layer.type !== "text") return layer;
        const text = layer as TextLayer;
        const adj = text.textAdjust ?? "auto_width";

        if (adj === "auto_width") {
            const size = measureTextLayer(text);
            return { ...text, width: size.width, height: size.height };
        }
        if (adj === "auto_height") {
            const size = measureTextLayer(text, text.width);
            return { ...text, height: size.height };
        }

        const size = measureTextLayer(text, text.width);
        return { ...text, height: size.height };
    });
}

function validateAndApplyHide(
    layers: Layer[],
    targetSize: ArtboardSize,
    diagnostics: AdaptationDiagnostic[],
): Layer[] {
    let changed = false;
    const nextLayers = layers.map((layer) => {
        const diagnostic = getLayerDiagnostic(layer, targetSize);
        if (!diagnostic) return layer;

        diagnostics.push(diagnostic);
        if (layer.responsive?.canHide) {
            changed = true;
            return { ...layer, visible: false } as Layer;
        }
        return layer;
    });

    return changed ? nextLayers : layers;
}

function getLayerDiagnostic(layer: Layer, targetSize: ArtboardSize): AdaptationDiagnostic | null {
    const hasInvalidGeometry = ![layer.x, layer.y, layer.width, layer.height].every(Number.isFinite)
        || layer.width <= 0
        || layer.height <= 0;
    if (hasInvalidGeometry) {
        return {
            code: "invalid-layer-geometry",
            severity: "warning",
            layerId: layer.id,
            layerName: layer.name,
            message: `Layer "${layer.name}" has invalid geometry after resize generation.`,
        };
    }

    if (layer.responsive?.behavior === "background") return null;

    const outOfBounds =
        layer.x < -GEOMETRY_EPSILON ||
        layer.y < -GEOMETRY_EPSILON ||
        layer.x + layer.width > targetSize.width + GEOMETRY_EPSILON ||
        layer.y + layer.height > targetSize.height + GEOMETRY_EPSILON;

    if (!outOfBounds) return null;
    return {
        code: "layer-out-of-bounds",
        severity: "warning",
        layerId: layer.id,
        layerName: layer.name,
        message: `Layer "${layer.name}" extends outside the generated artboard.`,
    };
}
