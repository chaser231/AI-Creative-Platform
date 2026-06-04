/**
 * Project a wizard "Расширить фон" override (which describes how the master
 * image-layer geometry changed) onto an arbitrary resize snapshot.
 *
 * The wizard records the override on the master layer once. To make the
 * extended image actually fill every resize (instead of being cropped back
 * into the original tiny slot by object-fit cover), we replay the same
 * geometry change on the matching image layer in each non-master snapshot
 * using exactly the model the studio uses for live master→instance sync:
 *
 *   - `layerBindings` with `imageSyncMode` ⇒ honour what the user picked
 *     in the studio (relative_size / relative_full / content)
 *   - no binding ⇒ default to `relative_size`, mirroring the studio default
 *     for image layers (see resolveImageSyncMode + applyCascade)
 *
 * Geometry math is shared with the studio cascade — `computeExpansionDelta`
 * comes straight from `bindingCascade.ts` and `applyConstraints` from
 * `resizeUtil.ts`.
 */

import { applyConstraints } from "@/utils/resizeUtil";
import { computeExpansionDelta } from "@/store/canvas/bindingCascade";
import { resolveImageSyncMode, migrateLegacyBinding } from "@/types";
import type { ImageFitMode, ImageSyncMode, Layer, LayerBinding } from "@/types";

export interface LayerRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * One per layer that the wizard expanded. Keys in
 * `Record<string, LayerExpansionOverride>` are the master layer/component
 * id used as the "anchor" — `slotId` and `masterId` are extra hints so we
 * can find the matching layer in non-master snapshots even when ids differ.
 */
export interface LayerExpansionOverride {
    /** Geometry of the master layer BEFORE the expand ran. */
    prev: LayerRect;
    /** Geometry of the master layer AFTER the expand ran. */
    next: LayerRect;
    /** Slot the expanded layer is bound to (most reliable cross-format key). */
    slotId?: string;
    /** Zero-based occurrence within layers that share the same type + slotId. */
    slotOccurrence?: number;
    /** Master component id, if the source layer had one. */
    masterId?: string;
    /**
     * If true, instance image layers in non-master snapshots are forced to
     * the resize artboard rect (`(0, 0, resizeArtboard.width,
     * resizeArtboard.height)`) instead of being projected through the
     * bindings cascade. This is what single-pass pack outpaint wants:
     * one bitmap is rendered with `objectFit: "cover"` into every format's
     * artboard, so the vertical extension of the bitmap shows up in tall
     * artboards (Feed, vertical) and the layer never overhangs the
     * artboard in any format.
     */
    fillInstanceArtboard?: boolean;
    /**
     * Experimental grid-union outpaint. Exact layer rects keyed by preview
     * format id; when present, projection preserves each format's original
     * image placement instead of using a global cover/focus crop.
     */
    formatRects?: Record<string, LayerRect>;
}

export interface LayerImageViewOverride {
    objectFit?: ImageFitMode;
    focusX?: number;
    focusY?: number;
}

export interface ArtboardSize {
    width: number;
    height: number;
}

interface ProjectArgs {
    /** Layers of the resize snapshot we're projecting onto. */
    resizeLayers: Layer[];
    /** Bindings declared on this resize (used to look up imageSyncMode). */
    resizeBindings?: LayerBinding[];
    /** Width/height of the resize artboard. */
    resizeArtboard: ArtboardSize;
    /** Preview/export format id used to resolve exact grid-union rects. */
    resizeFormatId?: string;
    /** Width/height of the master artboard. */
    masterArtboard: ArtboardSize;
    /** All overrides recorded by the wizard, keyed by anchor id. */
    overrides: Record<string, LayerExpansionOverride>;
    /** Optional image view overrides recorded by the wizard, keyed by anchor id. */
    imageViewOverrides?: Record<string, LayerImageViewOverride>;
}

const GEOM_DECIMALS = 100;
const round = (value: number): number => Math.round(value * GEOM_DECIMALS) / GEOM_DECIMALS;

/**
 * Find the override that matches a given layer in a non-master snapshot.
 * Match priority: direct id → masterId → occurrence-aware slot fallback.
 */
function findOverrideEntryForLayer(
    layer: Layer,
    overrides: Record<string, LayerExpansionOverride>,
    layerSlotOccurrences: Map<string, number>,
): { key: string; override: LayerExpansionOverride } | undefined {
    const directLayer = overrides[layer.id];
    if (directLayer) return { key: layer.id, override: directLayer };

    if (layer.masterId) {
        const direct = overrides[layer.masterId];
        if (direct) return { key: layer.masterId, override: direct };
        for (const [key, value] of Object.entries(overrides)) {
            if (value.masterId && value.masterId === layer.masterId) return { key, override: value };
        }
    }

    if (layer.slotId && layer.slotId !== "none") {
        const occurrence = layerSlotOccurrences.get(layer.id);
        for (const [key, value] of Object.entries(overrides)) {
            if (!value.slotId || value.slotId !== layer.slotId) continue;
            if (
                value.slotOccurrence === undefined
                || occurrence === undefined
                || value.slotOccurrence === occurrence
            ) {
                return { key, override: value };
            }
        }
    }

    return undefined;
}

function findViewOverrideForLayer(
    layer: Layer,
    imageViewOverrides: Record<string, LayerImageViewOverride> | undefined,
    overrideEntry: { key: string; override: LayerExpansionOverride } | undefined,
): LayerImageViewOverride | undefined {
    if (!imageViewOverrides) return undefined;
    if (layer.slotId && layer.slotId !== "none" && overrideEntry?.override.slotId === layer.slotId) {
        const byAnchorKey = imageViewOverrides[overrideEntry.key];
        if (byAnchorKey) return byAnchorKey;
    }
    if (layer.masterId) {
        const byMasterId = imageViewOverrides[layer.masterId];
        if (byMasterId) return byMasterId;
        if (overrideEntry?.override.masterId === layer.masterId) {
            const byAnchorKey = imageViewOverrides[overrideEntry.key];
            if (byAnchorKey) return byAnchorKey;
            const byOverrideMasterId = overrideEntry.override.masterId
                ? imageViewOverrides[overrideEntry.override.masterId]
                : undefined;
            if (byOverrideMasterId) return byOverrideMasterId;
        }
    }
    return imageViewOverrides[layer.id];
}

function applyViewOverride(layer: Layer, view: LayerImageViewOverride | undefined): Layer {
    if (!view || layer.type !== "image") return layer;
    return {
        ...layer,
        objectFit: view.objectFit ?? layer.objectFit,
        focusX: view.focusX ?? layer.focusX,
        focusY: view.focusY ?? layer.focusY,
    } as Layer;
}

function layerSlotKey(layer: Layer): string | undefined {
    return layer.slotId && layer.slotId !== "none" ? `${layer.type}:${layer.slotId}` : undefined;
}

function computeLayerSlotOccurrences(layers: Layer[]): Map<string, number> {
    const counts = new Map<string, number>();
    const result = new Map<string, number>();
    for (const layer of layers) {
        const key = layerSlotKey(layer);
        if (!key) continue;
        const occurrence = counts.get(key) ?? 0;
        counts.set(key, occurrence + 1);
        result.set(layer.id, occurrence);
    }
    return result;
}

/**
 * Resolve the imageSyncMode for a target layer based on this resize's
 * bindings. Falls back to `relative_size` (the studio default for image
 * layers) when no matching binding is declared.
 */
function resolveModeFor(
    layer: Layer,
    override: LayerExpansionOverride,
    bindings: LayerBinding[] | undefined,
): ImageSyncMode {
    if (bindings && bindings.length > 0) {
        const direct = bindings.find((b) => b.targetLayerId === layer.id);
        const matched = direct ?? bindings.find(
            (b) => override.masterId && b.masterLayerId === override.masterId,
        );
        if (matched) {
            const mode = resolveImageSyncMode(migrateLegacyBinding(matched));
            if (mode) return mode;
        }
    }
    return "relative_size";
}

/**
 * Apply every wizard expand override to the corresponding image layer in a
 * single resize snapshot. Non-image layers and layers without a matching
 * override are returned untouched.
 */
export function projectExpansionToResize(args: ProjectArgs): Layer[] {
    const { resizeLayers, resizeBindings, resizeArtboard, resizeFormatId, masterArtboard, overrides, imageViewOverrides } = args;
    const hasViewOverrides = imageViewOverrides ? Object.keys(imageViewOverrides).length > 0 : false;

    if (Object.keys(overrides).length === 0 && !hasViewOverrides) return resizeLayers;
    if (resizeLayers.length === 0) return resizeLayers;

    const layerSlotOccurrences = computeLayerSlotOccurrences(resizeLayers);

    return resizeLayers.map((layer) => {
        if (layer.type !== "image") return layer;
        if ((layer as { isFixedAsset?: boolean }).isFixedAsset) return layer;

        const overrideEntry = findOverrideEntryForLayer(layer, overrides, layerSlotOccurrences);
        const viewOverride = findViewOverrideForLayer(layer, imageViewOverrides, overrideEntry);
        const layerWithView = applyViewOverride(layer, viewOverride);
        const override = overrideEntry?.override;
        if (!override) return layerWithView;

        const mode = resolveModeFor(layer, override, resizeBindings);
        if (mode === "content") return layerWithView;

        const exactRect = resizeFormatId && override.formatRects
            ? override.formatRects[resizeFormatId]
            : undefined;
        if (exactRect) {
            return {
                ...layerWithView,
                x: round(exactRect.x),
                y: round(exactRect.y),
                width: round(exactRect.width),
                height: round(exactRect.height),
            } as Layer;
        }

        // Single-pass pack outpaint: every instance image layer becomes
        // the resize artboard so a single bitmap can be `cover`-fitted
        // into every format. This bypasses the bindings cascade for the
        // outpaint geometry, which used to produce layer rects that
        // overhung the artboard and hid the vertical extension of the
        // bitmap in tall formats.
        if (
            override.fillInstanceArtboard
            && resizeArtboard.width > 0
            && resizeArtboard.height > 0
        ) {
            return {
                ...layerWithView,
                x: 0,
                y: 0,
                width: round(resizeArtboard.width),
                height: round(resizeArtboard.height),
            } as Layer;
        }

        const instanceRect: LayerRect = {
            x: Number(layer.x ?? 0),
            y: Number(layer.y ?? 0),
            width: Number(layer.width ?? 0),
            height: Number(layer.height ?? 0),
        };

        if (mode === "relative_size") {
            const delta = computeExpansionDelta(override.prev, override.next, instanceRect);
            if (!delta) return layerWithView;
            return {
                ...layerWithView,
                x: round(delta.x),
                y: round(delta.y),
                width: round(delta.width),
                height: round(delta.height),
            } as Layer;
        }

        // relative_full → ignore the instance's local layout, project the
        // master rect onto the resize artboard via uniform scale on both axes.
        if (
            masterArtboard.width <= 0
            || masterArtboard.height <= 0
            || resizeArtboard.width <= 0
            || resizeArtboard.height <= 0
        ) {
            return layerWithView;
        }

        const scaled = applyConstraints(
            {
                x: override.next.x,
                y: override.next.y,
                width: override.next.width,
                height: override.next.height,
                constraints: { horizontal: "scale", vertical: "scale" },
            },
            masterArtboard,
            resizeArtboard,
        );

        return {
            ...layerWithView,
            x: round(scaled.x),
            y: round(scaled.y),
            width: round(scaled.width),
            height: round(scaled.height),
        } as Layer;
    });
}
