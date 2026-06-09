import type { VectorLayer, VectorSubpath } from "@/types";
import { hasRenderableGeometry, pathDataToSubpaths } from "@/utils/vectorGeometry";
import { parseSvgToEditableSubpaths, parseSvgToVector } from "@/utils/svgImport";

const PARSE_CACHE = new WeakMap<VectorLayer, { key: string; subpaths: VectorSubpath[] }>();

function layerParseKey(layer: VectorLayer): string {
    return [
        layer.id,
        layer.width,
        layer.height,
        layer.viewBoxWidth ?? "",
        layer.viewBoxHeight ?? "",
        layer.rawSvgPath ?? "",
        layer.inlineSvg ?? "",
        JSON.stringify(layer.subpaths),
    ].join("|");
}

export function countSubpathAnchors(subpaths: VectorSubpath[]): number {
    return subpaths.reduce((n, sp) => n + sp.points.length, 0);
}

/** Indices of anchors to render when the path is very dense (Figma imports). */
export function visibleAnchorIndices(subpaths: VectorSubpath[], maxAnchors = 40): Array<{ si: number; pi: number }> {
    const total = countSubpathAnchors(subpaths);
    if (total <= maxAnchors) {
        const all: Array<{ si: number; pi: number }> = [];
        subpaths.forEach((sp, si) => sp.points.forEach((_, pi) => all.push({ si, pi })));
        return all;
    }
    const step = Math.max(1, Math.ceil(total / maxAnchors));
    const visible: Array<{ si: number; pi: number }> = [];
    let idx = 0;
    subpaths.forEach((sp, si) => {
        sp.points.forEach((_, pi) => {
            if (idx % step === 0) visible.push({ si, pi });
            idx += 1;
        });
    });
    return visible;
}

/**
 * Figma boolean/subtract imports are compound even-odd paths. They render via
 * inlineSvg but cannot be faithfully edited anchor-by-anchor — dragging one
 * contour breaks the boolean result.
 */
export function isReadOnlyImportedPath(layer: VectorLayer): boolean {
    if (hasRenderableGeometry(layer.subpaths)) return false;
    if (!layer.inlineSvg) return false;
    const subpaths = parseEditableSubpaths(layer);
    if (!subpaths || subpaths.length === 0) return true;
    return subpaths.length > 1 || layer.fillRule === "evenodd";
}

/** Parse editable subpaths without mutating the layer (preview / overlay only). */
export function parseEditableSubpaths(layer: VectorLayer): VectorSubpath[] | null {
    const cacheKey = layerParseKey(layer);
    const cached = PARSE_CACHE.get(layer);
    if (cached?.key === cacheKey) {
        return cached.subpaths;
    }

    if (hasRenderableGeometry(layer.subpaths)) {
        PARSE_CACHE.set(layer, { key: cacheKey, subpaths: layer.subpaths });
        return layer.subpaths;
    }

    let subpaths: VectorSubpath[] | null = null;

    if (layer.inlineSvg) {
        subpaths = parseSvgToEditableSubpaths(layer.inlineSvg);
    }

    if (!subpaths && layer.rawSvgPath) {
        const normW = layer.viewBoxWidth ?? layer.width;
        const normH = layer.viewBoxHeight ?? layer.height;
        subpaths = pathDataToSubpaths(layer.rawSvgPath, normW, normH).subpaths;
    }

    if (!subpaths && layer.inlineSvg) {
        const pathD = parseSvgToVector(layer.inlineSvg)?.rawSvgPath;
        if (pathD) {
            const normW = layer.viewBoxWidth ?? layer.width;
            const normH = layer.viewBoxHeight ?? layer.height;
            subpaths = pathDataToSubpaths(pathD, normW, normH).subpaths;
        }
    }

    if (!hasRenderableGeometry(subpaths ?? undefined)) return null;

    PARSE_CACHE.set(layer, { key: cacheKey, subpaths: subpaths! });
    return subpaths;
}

/** Commit imported geometry to editable subpaths (call on first anchor edit). */
export function vectorLayerToEditableUpdates(layer: VectorLayer): Partial<VectorLayer> | null {
    if (isReadOnlyImportedPath(layer)) return null;

    const subpaths = parseEditableSubpaths(layer);
    if (!subpaths || hasRenderableGeometry(layer.subpaths)) return null;

    const fillRule = layer.fillRule ?? (subpaths.length > 1 ? "evenodd" : "nonzero");

    return {
        subpaths,
        fillRule,
        inlineSvg: undefined,
        rawSvgPath: undefined,
        viewBoxWidth: undefined,
        viewBoxHeight: undefined,
    };
}

export function canEnterVectorEdit(layer: VectorLayer): boolean {
    return hasRenderableGeometry(layer.subpaths) || parseEditableSubpaths(layer) !== null;
}

export function enterVectorEditMode(
    layer: VectorLayer,
    _updateLayer: (id: string, updates: Partial<VectorLayer>) => void,
    setVectorEditLayerId: (id: string | null) => void,
): void {
    if (canEnterVectorEdit(layer)) {
        setVectorEditLayerId(layer.id);
    }
}
