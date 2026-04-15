import { migrateLegacyBinding, resolveImageSyncMode } from "@/types";
import type { ImageSyncMode, LayerBinding, Layer } from "./types";
import { applyConstraints } from "@/utils/resizeUtil";

const CONTENT_PROPS = ["text", "src", "label"] as const;
const STYLE_PROPS = [
    "fill", "stroke", "strokeWidth", "fontSize", "fontFamily", "fontWeight",
    "align", "letterSpacing", "lineHeight", "cornerRadius", "objectFit",
    "focusX", "focusY",
    "textColor", "textAdjust", "truncateText", "verticalTrim", "textTransform",
] as const;
const SIZE_PROPS = ["width", "height"] as const;
const POSITION_PROPS = ["x", "y", "rotation"] as const;
const GEOM_KEYS = new Set(["x", "y", "width", "height"]);

export interface ArtboardSize { width: number; height: number }

export interface CascadeContext {
    masterArtboard: ArtboardSize;
    targetArtboard: ArtboardSize;
}

export function getPropsForBinding(binding: LayerBinding): readonly string[] {
    if (binding.syncContent === undefined && binding.syncMode) {
        const migrated = migrateLegacyBinding(binding);
        return getPropsForBinding(migrated);
    }
    const props: string[] = [];
    if (binding.syncContent) props.push(...CONTENT_PROPS);
    if (binding.syncStyle) props.push(...STYLE_PROPS);
    if (binding.syncSize) props.push(...SIZE_PROPS);
    if (binding.syncPosition) props.push(...POSITION_PROPS);
    return props;
}

/**
 * "relative_size" delta: compute how the master image changed (ratio + direction),
 * then apply the same proportional change to the instance's OWN geometry.
 *
 * Master grew 30% to the left → instance also grows 30% to the left from its own rect.
 */
function computeExpansionDelta(
    prevMaster: { x: number; y: number; width: number; height: number },
    newMaster: { x: number; y: number; width: number; height: number },
    instance: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } | null {
    const dW = newMaster.width - prevMaster.width;
    const dH = newMaster.height - prevMaster.height;
    const dX = newMaster.x - prevMaster.x;
    const dY = newMaster.y - prevMaster.y;

    if (dW === 0 && dH === 0 && dX === 0 && dY === 0) return null;

    let newW = instance.width;
    let newX = instance.x;
    let newH = instance.height;
    let newY = instance.y;

    if (dW !== 0 && prevMaster.width > 0) {
        const instanceDW = instance.width * (dW / prevMaster.width);
        newW = instance.width + instanceDW;
        const leftGrowth = prevMaster.x - newMaster.x;
        const leftFraction = leftGrowth / dW;
        newX = instance.x - instanceDW * leftFraction;
    }

    if (dH !== 0 && prevMaster.height > 0) {
        const instanceDH = instance.height * (dH / prevMaster.height);
        newH = instance.height + instanceDH;
        const topGrowth = prevMaster.y - newMaster.y;
        const topFraction = topGrowth / dH;
        newY = instance.y - instanceDH * topFraction;
    }

    return {
        x: Math.round(newX * 100) / 100,
        y: Math.round(newY * 100) / 100,
        width: Math.round(newW * 100) / 100,
        height: Math.round(newH * 100) / 100,
    };
}

/**
 * Apply master cascade to target layers based on bindings.
 *
 * Image sync modes (`imageSyncMode`):
 * - "content": only src/objectFit/focus, geometry untouched
 * - "relative_size": content + expansion delta (ratio + direction from master applied
 *   to instance's own geometry). Requires `prevMasterLayers` for delta computation.
 * - "relative_full": content + full proportional mapping (scale/scale)
 *
 * Default for image layers: "relative_size".
 */
export function applyCascade(
    targetLayers: Layer[],
    masterLayers: Layer[],
    bindings: LayerBinding[],
    context?: CascadeContext,
    prevMasterLayers?: Layer[],
): Layer[] {
    if (bindings.length === 0 || masterLayers.length === 0) return targetLayers;

    const masterMap = new Map<string, Layer>();
    masterLayers.forEach((l) => masterMap.set(l.id, l));

    const prevMasterMap = prevMasterLayers
        ? new Map<string, Layer>(prevMasterLayers.map((l) => [l.id, l]))
        : undefined;

    const hasContext = context
        && context.masterArtboard.width > 0
        && context.masterArtboard.height > 0;

    let changed = false;
    const result = targetLayers.map((layer) => {
        const rawBinding = bindings.find((b) => b.targetLayerId === layer.id);
        if (!rawBinding) return layer;

        const binding = rawBinding.syncContent !== undefined
            ? rawBinding
            : migrateLegacyBinding(rawBinding);

        const masterLayer = masterMap.get(binding.masterLayerId);
        if (!masterLayer) return layer;

        const isImage = masterLayer.type === "image";
        const imgMode: ImageSyncMode | undefined = isImage
            ? (resolveImageSyncMode(binding) ?? "relative_size")
            : undefined;

        const hasAnySyncFlag = binding.syncContent || binding.syncStyle || binding.syncSize || binding.syncPosition;
        if (!hasAnySyncFlag && !imgMode) return layer;
        if (!hasAnySyncFlag && imgMode === "content") return layer;

        const propsToSync = getPropsForBinding(binding);
        const updates: Record<string, unknown> = {};
        let hasUpdate = false;

        const syncNonGeomProps = () => {
            for (const prop of propsToSync) {
                if (GEOM_KEYS.has(prop)) continue;
                const masterVal = (masterLayer as unknown as Record<string, unknown>)[prop];
                const targetVal = (layer as unknown as Record<string, unknown>)[prop];
                if (masterVal !== targetVal) {
                    updates[prop] = masterVal;
                    hasUpdate = true;
                }
            }
        };

        if (isImage && imgMode === "relative_size") {
            syncNonGeomProps();

            if (prevMasterMap) {
                const prevMaster = prevMasterMap.get(binding.masterLayerId);
                if (prevMaster) {
                    const delta = computeExpansionDelta(
                        prevMaster as { x: number; y: number; width: number; height: number },
                        masterLayer as { x: number; y: number; width: number; height: number },
                        layer as { x: number; y: number; width: number; height: number },
                    );
                    if (delta) {
                        for (const [key, val] of Object.entries(delta)) {
                            const targetVal = (layer as unknown as Record<string, unknown>)[key];
                            if (val !== targetVal) {
                                updates[key] = val;
                                hasUpdate = true;
                            }
                        }
                    }
                }
            }
        } else if (isImage && hasContext && imgMode === "relative_full") {
            syncNonGeomProps();

            const propRect = applyConstraints(
                {
                    x: masterLayer.x, y: masterLayer.y,
                    width: masterLayer.width, height: masterLayer.height,
                    constraints: { horizontal: "scale", vertical: "scale" },
                },
                context!.masterArtboard,
                context!.targetArtboard,
            );
            for (const [key, val] of Object.entries(propRect)) {
                const targetVal = (layer as unknown as Record<string, unknown>)[key];
                if (val !== targetVal) {
                    updates[key] = val;
                    hasUpdate = true;
                }
            }
        } else if (isImage && imgMode === "content") {
            syncNonGeomProps();
        } else {
            for (const prop of propsToSync) {
                const masterVal = (masterLayer as unknown as Record<string, unknown>)[prop];
                const targetVal = (layer as unknown as Record<string, unknown>)[prop];
                if (masterVal !== targetVal) {
                    updates[prop] = masterVal;
                    hasUpdate = true;
                }
            }
        }

        if (!hasUpdate) return layer;
        changed = true;
        return { ...layer, ...updates } as Layer;
    });

    return changed ? result : targetLayers;
}
