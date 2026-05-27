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
    /** Master component id, if the source layer had one. */
    masterId?: string;
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
 * Match priority: slotId (most stable) → masterId → direct id equality.
 */
function findOverrideEntryForLayer(
    layer: Layer,
    overrides: Record<string, LayerExpansionOverride>,
): { key: string; override: LayerExpansionOverride } | undefined {
    if (layer.slotId && layer.slotId !== "none") {
        for (const [key, value] of Object.entries(overrides)) {
            if (value.slotId && value.slotId === layer.slotId) return { key, override: value };
        }
    }
    if (layer.masterId) {
        const direct = overrides[layer.masterId];
        if (direct) return { key: layer.masterId, override: direct };
        for (const [key, value] of Object.entries(overrides)) {
            if (value.masterId && value.masterId === layer.masterId) return { key, override: value };
        }
    }
    const direct = overrides[layer.id];
    return direct ? { key: layer.id, override: direct } : undefined;
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
    const { resizeLayers, resizeBindings, resizeArtboard, masterArtboard, overrides, imageViewOverrides } = args;
    const hasViewOverrides = imageViewOverrides ? Object.keys(imageViewOverrides).length > 0 : false;

    if (Object.keys(overrides).length === 0 && !hasViewOverrides) return resizeLayers;
    if (resizeLayers.length === 0) return resizeLayers;

    return resizeLayers.map((layer) => {
        if (layer.type !== "image") return layer;
        if ((layer as { isFixedAsset?: boolean }).isFixedAsset) return layer;

        const overrideEntry = findOverrideEntryForLayer(layer, overrides);
        const viewOverride = findViewOverrideForLayer(layer, imageViewOverrides, overrideEntry);
        const layerWithView = applyViewOverride(layer, viewOverride);
        const override = overrideEntry?.override;
        if (!override) return layerWithView;

        const mode = resolveModeFor(layer, override, resizeBindings);
        if (mode === "content") return layerWithView;

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
