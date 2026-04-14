import { migrateLegacyBinding } from "@/types";
import type { LayerBinding, Layer } from "./types";

/** Property sets for each sync category */
const CONTENT_PROPS = ["text", "src", "label"] as const;
const STYLE_PROPS = [
    "fill", "stroke", "strokeWidth", "fontSize", "fontFamily", "fontWeight",
    "align", "letterSpacing", "lineHeight", "cornerRadius", "objectFit",
    "focusX", "focusY",
    "textColor", "textAdjust", "truncateText", "verticalTrim",
] as const;
const SIZE_PROPS = ["width", "height"] as const;
const POSITION_PROPS = ["x", "y", "rotation"] as const;

/**
 * Build the list of properties to sync based on binding flags.
 * Auto-migrates legacy syncMode if flags are missing.
 */
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
 * Apply master cascade to target layers based on bindings.
 * Returns updated layers array (or same reference if no changes).
 */
export function applyCascade(
    targetLayers: Layer[],
    masterLayers: Layer[],
    bindings: LayerBinding[],
): Layer[] {
    if (bindings.length === 0 || masterLayers.length === 0) return targetLayers;

    const masterMap = new Map<string, Layer>();
    masterLayers.forEach((layer) => masterMap.set(layer.id, layer));

    let changed = false;
    const result = targetLayers.map((layer) => {
        const rawBinding = bindings.find((binding) => binding.targetLayerId === layer.id);
        if (!rawBinding) return layer;

        const binding = rawBinding.syncContent !== undefined
            ? rawBinding
            : migrateLegacyBinding(rawBinding);

        if (!binding.syncContent && !binding.syncStyle && !binding.syncSize && !binding.syncPosition) {
            return layer;
        }

        const masterLayer = masterMap.get(binding.masterLayerId);
        if (!masterLayer) return layer;

        const propsToSync = getPropsForBinding(binding);
        const updates: Record<string, unknown> = {};
        let hasUpdate = false;

        for (const prop of propsToSync) {
            const masterVal = (masterLayer as unknown as Record<string, unknown>)[prop];
            const targetVal = (layer as unknown as Record<string, unknown>)[prop];
            if (masterVal !== targetVal) {
                updates[prop] = masterVal;
                hasUpdate = true;
            }
        }

        if (!hasUpdate) return layer;

        changed = true;
        return { ...layer, ...updates } as Layer;
    });

    return changed ? result : targetLayers;
}
