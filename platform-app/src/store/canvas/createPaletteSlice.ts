/**
 * Palette Slice — Template Swatches
 *
 * Holds the per-template palette (color + background swatches) and
 * exposes actions to:
 *  - CRUD swatches (add/update/remove/reorder)
 *  - Apply a swatch to a layer or to the artboard
 *  - Create a swatch from an existing layer fill or artboard background
 *  - Cascade value changes: when a swatch is edited, every layer (in the
 *    active `layers`, in every format `layerSnapshot`, in `masterComponents`
 *    and `componentInstances`) that references it via `swatchRefs.*` gets
 *    its concrete `fill` / `stroke` / `text` fill / artboard background
 *    updated in a single `set()` call.
 */

import type { StateCreator } from "zustand";
import type {
    CanvasStore,
    Layer,
    MasterComponent,
    ComponentInstance,
    Swatch,
    TemplatePalette,
    ArtboardBackgroundImage,
} from "./types";
import type {
    BackgroundSwatchValue,
    TextLayer,
    RectangleLayer,
    BadgeLayer,
    FrameLayer,
    Paint,
} from "@/types";
import { v4 as uuid } from "uuid";
import { pushSnapshot } from "./createHistorySlice";
import { isPaint, normalizePaint } from "@/utils/paint";
import {
    cascadeArtboardPropsForSwatchRemove,
    cascadeArtboardPropsForSwatchUpdateWithSwatch,
    patchActiveFormatArtboardProps,
    selectActiveArtboardProps,
    syncTopLevelArtboardPropsFromMaster,
} from "./artboardProps";

export type PaletteSlice = Pick<CanvasStore,
    | "palette"
    | "addSwatch"
    | "updateSwatch"
    | "removeSwatch"
    | "reorderSwatches"
    | "applyColorSwatchToLayer"
    | "applyBackgroundSwatchToArtboard"
    | "applyBackgroundSwatchToImageLayer"
    | "createSwatchFromLayerFill"
    | "createSwatchFromArtboardBackground"
>;

// ─── Helpers ────────────────────────────────────────────

function findSwatch(palette: TemplatePalette, swatchId: string): Swatch | undefined {
    return (
        palette.colors.find((s) => s.id === swatchId)
        ?? palette.backgrounds.find((s) => s.id === swatchId)
    );
}

/**
 * Resolve the concrete color hex a color/background-solid swatch represents.
 * Returns undefined for image-backgrounds (only relevant for artboard).
 */
function resolveColorFromSwatch(swatch: Swatch): string | undefined {
    if (swatch.type === "color") {
        const paint = isPaint(swatch.value) ? normalizePaint(swatch.value) : undefined;
        return paint?.kind === "solid" ? paint.color : undefined;
    }
    if (
        swatch.type === "background"
        && typeof swatch.value === "object"
        && (swatch.value as BackgroundSwatchValue).kind === "solid"
    ) {
        return (swatch.value as Extract<BackgroundSwatchValue, { kind: "solid" }>).color;
    }
    return undefined;
}

function resolvePaintFromSwatch(swatch: Swatch): Paint | undefined {
    if (swatch.type === "color" && isPaint(swatch.value)) {
        return swatch.value;
    }
    if (swatch.type === "background" && typeof swatch.value === "object") {
        const v = swatch.value as BackgroundSwatchValue;
        if (v.kind === "solid") return v.color;
        if (v.kind === "gradient") return v.paint;
    }
    return undefined;
}

/** Apply a fill/stroke color override to a layer based on swatchRefs. */
function applyPaintRefsToLayer<T extends { swatchRefs?: Layer["swatchRefs"] } & Partial<Layer>>(
    layer: T,
    swatchId: string,
    paint: Paint,
): T {
    if (!layer.swatchRefs) return layer;
    let changed = false;
    const next = { ...layer } as T & Record<string, unknown>;
    if (layer.swatchRefs.fill === swatchId && (next as { fill?: Paint }).fill !== undefined) {
        (next as { fill?: Paint }).fill = paint;
        changed = true;
    }
    if (layer.swatchRefs.stroke === swatchId && (next as { stroke?: Paint }).stroke !== undefined) {
        const normalized = typeof paint === "string" ? undefined : normalizePaint(paint);
        const color = typeof paint === "string" ? paint : normalized?.kind === "solid" ? normalized.color : undefined;
        if (color) {
            (next as { stroke?: Paint }).stroke = color;
            changed = true;
        }
    }
    if (layer.swatchRefs.text === swatchId) {
        const normalized = typeof paint === "string" ? undefined : normalizePaint(paint);
        const color = typeof paint === "string" ? paint : normalized?.kind === "solid" ? normalized.color : undefined;
        if (!color) return changed ? next : layer;
        // Text layer uses `fill` for text color; badge uses `textColor`.
        if ((next as { type?: string }).type === "badge") {
            (next as { textColor?: string }).textColor = color;
            changed = true;
        } else if ((next as { fill?: string }).fill !== undefined) {
            (next as { fill?: string }).fill = color;
            changed = true;
        }
    }
    return changed ? next : layer;
}

function cascadeLayers(layers: Layer[], swatchId: string, paint: Paint): Layer[] {
    let changed = false;
    const next = layers.map((l) => {
        const nl = applyPaintRefsToLayer(l, swatchId, paint) as Layer;
        if (nl !== l) changed = true;
        return nl;
    });
    return changed ? next : layers;
}

/** Apply an image-background override to image layers and shape image fills. */
function applyImageRefToLayer(
    layer: Layer,
    swatchId: string,
    value: Extract<BackgroundSwatchValue, { kind: "image" }>,
): Layer {
    let changed = false;
    let next = layer as Layer & Record<string, unknown>;

    if (layer.type === "image" && layer.swatchRefs?.src === swatchId) {
        next = {
            ...next,
            src: value.src,
            objectFit: value.fit,
            focusX: value.focusX,
            focusY: value.focusY,
        };
        changed = true;
    }

    if (
        (layer.type === "rectangle" || layer.type === "frame")
        && layer.imageFill?.swatchRef === swatchId
    ) {
        next = {
            ...next,
            imageFill: {
                ...layer.imageFill,
                src: value.src,
                fit: value.fit,
                focusX: value.focusX,
                focusY: value.focusY,
                swatchRef: swatchId,
            },
        };
        changed = true;
    }

    return changed ? next as Layer : layer;
}

function cascadeImageLayers(
    layers: Layer[],
    swatchId: string,
    value: Extract<BackgroundSwatchValue, { kind: "image" }>,
): Layer[] {
    let changed = false;
    const next = layers.map((l) => {
        const nl = applyImageRefToLayer(l, swatchId, value);
        if (nl !== l) changed = true;
        return nl;
    });
    return changed ? next : layers;
}

function cascadeMasters(masters: MasterComponent[], swatchId: string, paint: Paint): MasterComponent[] {
    let changed = false;
    const next = masters.map((m) => {
        const props = m.props as MasterComponent["props"] & { swatchRefs?: Layer["swatchRefs"] };
        if (!props.swatchRefs) return m;
        const updated = applyPaintRefsToLayer(props, swatchId, paint);
        if (updated === props) return m;
        changed = true;
        return { ...m, props: updated as MasterComponent["props"] };
    });
    return changed ? next : masters;
}

function cascadeInstances(instances: ComponentInstance[], swatchId: string, paint: Paint): ComponentInstance[] {
    let changed = false;
    const next = instances.map((inst) => {
        const local = inst.localProps as ComponentInstance["localProps"] & { swatchRefs?: Layer["swatchRefs"] };
        if (!local.swatchRefs) return inst;
        const updated = applyPaintRefsToLayer(local, swatchId, paint);
        if (updated === local) return inst;
        changed = true;
        return { ...inst, localProps: updated as ComponentInstance["localProps"] };
    });
    return changed ? next : instances;
}

/**
 * Compose a new ArtboardBackgroundImage from a background-image swatch,
 * preserving the existing opacity so edits don't clobber user choices.
 */
function bgImageFromSwatch(
    swatch: Swatch,
    existing: ArtboardBackgroundImage | undefined,
): ArtboardBackgroundImage | undefined {
    if (swatch.type !== "background" || typeof swatch.value !== "object") return undefined;
    const v = swatch.value as BackgroundSwatchValue;
    if (v.kind !== "image") return undefined;
    return {
        src: v.src,
        fit: v.fit,
        focusX: v.focusX,
        focusY: v.focusY,
        opacity: existing?.opacity ?? 1,
        swatchRef: swatch.id,
    };
}

// ─── Slice ──────────────────────────────────────────────

export const createPaletteSlice: StateCreator<CanvasStore, [], [], PaletteSlice> = (set, get) => ({
    palette: { colors: [], backgrounds: [] },

    addSwatch: (swatch) => {
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);
        const id = uuid();
        set((state) => {
            const bucket: "colors" | "backgrounds" = swatch.type === "color" ? "colors" : "backgrounds";
            const list = state.palette[bucket];
            const newSwatch: Swatch = { ...swatch, id, sortOrder: swatch.sortOrder ?? list.length };
            return {
                palette: {
                    ...state.palette,
                    [bucket]: [...list, newSwatch],
                },
            } as Partial<CanvasStore>;
        });
        return id;
    },

    updateSwatch: (id, updates) => {
        const state = get();
        const existing = findSwatch(state.palette, id);
        if (!existing) return;
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);

        set((s) => {
            const bucket: "colors" | "backgrounds" = existing.type === "color" ? "colors" : "backgrounds";
            const list = s.palette[bucket].map((sw) =>
                sw.id === id ? ({ ...sw, ...updates, id: sw.id, type: sw.type } as Swatch) : sw,
            );
            const updatedSwatch = list.find((sw) => sw.id === id)!;

            // Cascade:
            //  - color change: propagate new hex to every layer/master/instance
            //    that references this swatch, plus active artboard fill if
            //    currently driven by this swatch (not supported today — fill
            //    has no swatchRef — left as a no-op).
            //  - image-background change: refresh artboardProps.backgroundImage
            //    if it was applied from this swatch.
            const paint = resolvePaintFromSwatch(updatedSwatch);
            let layers = s.layers;
            let masters = s.masterComponents;
            let instances = s.componentInstances;
            let resizes = s.resizes;

            if (paint !== undefined) {
                layers = cascadeLayers(layers, id, paint);
                masters = cascadeMasters(masters, id, paint);
                instances = cascadeInstances(instances, id, paint);
                resizes = s.resizes.map((r) => {
                    if (!r.layerSnapshot) return r;
                    const next = cascadeLayers(r.layerSnapshot, id, paint);
                    return next === r.layerSnapshot ? r : { ...r, layerSnapshot: next };
                });
            }

            // Image-background swatch: cascade `src` to every image layer
            // referencing this swatch (active layers + every format snapshot).
            if (
                updatedSwatch.type === "background"
                && typeof updatedSwatch.value === "object"
                && (updatedSwatch.value as BackgroundSwatchValue).kind === "image"
            ) {
                const imageValue = updatedSwatch.value as Extract<BackgroundSwatchValue, { kind: "image" }>;
                layers = cascadeImageLayers(layers, id, imageValue);
                resizes = resizes.map((r) => {
                    if (!r.layerSnapshot) return r;
                    const next = cascadeImageLayers(r.layerSnapshot, id, imageValue);
                    return next === r.layerSnapshot ? r : { ...r, layerSnapshot: next };
                });
            }

            // Artboard swatch cascade across all formats.
            if (paint !== undefined || (updatedSwatch.type === "background" && typeof updatedSwatch.value === "object")) {
                resizes = cascadeArtboardPropsForSwatchUpdateWithSwatch(
                    resizes,
                    s.artboardProps,
                    id,
                    paint,
                    updatedSwatch,
                    bgImageFromSwatch,
                );
            }
            const artboardProps = syncTopLevelArtboardPropsFromMaster(resizes, s.artboardProps);

            return {
                palette: { ...s.palette, [bucket]: list },
                layers,
                masterComponents: masters,
                componentInstances: instances,
                resizes,
                artboardProps,
            } as Partial<CanvasStore>;
        });
    },

    removeSwatch: (id, mode, replaceWithId) => {
        const state = get();
        const existing = findSwatch(state.palette, id);
        if (!existing) return;
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);

        set((s) => {
            const bucket: "colors" | "backgrounds" = existing.type === "color" ? "colors" : "backgrounds";
            const remaining = s.palette[bucket].filter((sw) => sw.id !== id);

            const REF_KEYS = ["fill", "stroke", "text", "src"] as const;

            const detachRef = (refs: Layer["swatchRefs"] | undefined): Layer["swatchRefs"] | undefined => {
                if (!refs) return refs;
                let changed = false;
                const next: Layer["swatchRefs"] = { ...refs };
                REF_KEYS.forEach((k) => {
                    if (next[k] === id) {
                        delete next[k];
                        changed = true;
                    }
                });
                if (!changed) return refs;
                return Object.keys(next).length === 0 ? undefined : next;
            };

            const replaceRef = (refs: Layer["swatchRefs"] | undefined): Layer["swatchRefs"] | undefined => {
                if (!refs) return refs;
                let changed = false;
                const next: Layer["swatchRefs"] = { ...refs };
                REF_KEYS.forEach((k) => {
                    if (next[k] === id) {
                        if (replaceWithId) {
                            next[k] = replaceWithId;
                        } else {
                            delete next[k];
                        }
                        changed = true;
                    }
                });
                if (!changed) return refs;
                return Object.keys(next).length === 0 ? undefined : next;
            };

            const mapRefs = mode === "replace" ? replaceRef : detachRef;

            const layers = s.layers.map((l) => {
                const nr = mapRefs(l.swatchRefs);
                if (nr === l.swatchRefs) return l;
                return { ...l, swatchRefs: nr } as Layer;
            });
            const masters = s.masterComponents.map((m) => {
                const nr = mapRefs((m.props as { swatchRefs?: Layer["swatchRefs"] }).swatchRefs);
                const props = m.props as { swatchRefs?: Layer["swatchRefs"] };
                if (nr === props.swatchRefs) return m;
                return { ...m, props: { ...m.props, swatchRefs: nr } as MasterComponent["props"] };
            });
            const instances = s.componentInstances.map((inst) => {
                const local = inst.localProps as { swatchRefs?: Layer["swatchRefs"] };
                const nr = mapRefs(local.swatchRefs);
                if (nr === local.swatchRefs) return inst;
                return {
                    ...inst,
                    localProps: { ...inst.localProps, swatchRefs: nr } as ComponentInstance["localProps"],
                };
            });
            const resizes = s.resizes.map((r) => {
                if (!r.layerSnapshot) return r;
                let changed = false;
                const nextSnap = r.layerSnapshot.map((l) => {
                    const nr = mapRefs(l.swatchRefs);
                    if (nr === l.swatchRefs) return l;
                    changed = true;
                    return { ...l, swatchRefs: nr } as Layer;
                });
                return changed ? { ...r, layerSnapshot: nextSnap } : r;
            });

            let nextResizes = resizes;
            const replacementSwatch = mode === "replace" && replaceWithId
                ? findSwatch({ ...s.palette, [bucket]: remaining }, replaceWithId)
                : undefined;
            const replacementPaint = replacementSwatch ? resolvePaintFromSwatch(replacementSwatch) : undefined;
            nextResizes = cascadeArtboardPropsForSwatchRemove(
                resizes,
                s.artboardProps,
                id,
                mode === "replace" ? "replace" : "detach",
                mode === "replace" && replacementSwatch
                    ? {
                        paint: replacementPaint,
                        fillSwatchRef: replaceWithId,
                        resolveBgImage: (existing) => (
                            replacementSwatch
                                ? bgImageFromSwatch(replacementSwatch, existing)
                                : undefined
                        ),
                    }
                    : undefined,
            );
            const syncedArtboardProps = syncTopLevelArtboardPropsFromMaster(nextResizes, s.artboardProps);

            return {
                palette: { ...s.palette, [bucket]: remaining },
                layers,
                masterComponents: masters,
                componentInstances: instances,
                resizes: nextResizes,
                artboardProps: syncedArtboardProps,
            } as Partial<CanvasStore>;
        });

        // In replace mode, also cascade the replacement's value onto any
        // refs that now point at it — keeps colors/srcs consistent even if
        // the replaced-with swatch has a different value.
        if (mode === "replace" && replaceWithId) {
            const nextState = get();
            const replacement = findSwatch(nextState.palette, replaceWithId);
            if (replacement) {
                const paint = resolvePaintFromSwatch(replacement);
                const imageValue =
                    replacement.type === "background"
                    && typeof replacement.value === "object"
                    && (replacement.value as BackgroundSwatchValue).kind === "image"
                        ? (replacement.value as Extract<BackgroundSwatchValue, { kind: "image" }>)
                        : undefined;

                if (paint !== undefined || imageValue !== undefined) {
                    set((s) => {
                        let layers = s.layers;
                        let masters = s.masterComponents;
                        let instances = s.componentInstances;
                        let resizes = s.resizes;
                        if (paint !== undefined) {
                            layers = cascadeLayers(layers, replaceWithId, paint);
                            masters = cascadeMasters(masters, replaceWithId, paint);
                            instances = cascadeInstances(instances, replaceWithId, paint);
                            resizes = resizes.map((r) => {
                                if (!r.layerSnapshot) return r;
                                const next = cascadeLayers(r.layerSnapshot, replaceWithId, paint);
                                return next === r.layerSnapshot ? r : { ...r, layerSnapshot: next };
                            });
                        }
                        if (imageValue !== undefined) {
                            layers = cascadeImageLayers(layers, replaceWithId, imageValue);
                            resizes = resizes.map((r) => {
                                if (!r.layerSnapshot) return r;
                                const next = cascadeImageLayers(r.layerSnapshot, replaceWithId, imageValue);
                                return next === r.layerSnapshot ? r : { ...r, layerSnapshot: next };
                            });
                        }
                        return { layers, masterComponents: masters, componentInstances: instances, resizes };
                    });
                }
            }
        }
    },

    reorderSwatches: (type, ids) => {
        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);
        set((s) => {
            const bucket: "colors" | "backgrounds" = type === "color" ? "colors" : "backgrounds";
            const byId = new Map(s.palette[bucket].map((sw) => [sw.id, sw] as const));
            const reordered: Swatch[] = [];
            ids.forEach((id, idx) => {
                const sw = byId.get(id);
                if (sw) reordered.push({ ...sw, sortOrder: idx });
            });
            // Append swatches not present in `ids` at the end (shouldn't normally happen)
            for (const sw of s.palette[bucket]) {
                if (!ids.includes(sw.id)) reordered.push(sw);
            }
            return {
                palette: { ...s.palette, [bucket]: reordered },
            } as Partial<CanvasStore>;
        });
    },

    applyColorSwatchToLayer: (layerId, swatchId, target = "fill") => {
        const state = get();
        const swatch = findSwatch(state.palette, swatchId);
        if (!swatch) return;
        const paint = resolvePaintFromSwatch(swatch);
        const color = resolveColorFromSwatch(swatch);
        if (target === "fill" && paint === undefined) return;
        if (target !== "fill" && color === undefined) return;
        const layer = state.layers.find((l) => l.id === layerId);
        if (!layer) return;

        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);

        set((s) => {
            const updateOne = (l: Layer): Layer => {
                if (l.id !== layerId) return l;
                const nextRefs: Layer["swatchRefs"] = { ...(l.swatchRefs ?? {}), [target]: swatchId };
                const next = { ...l, swatchRefs: nextRefs } as Layer & Record<string, unknown>;
                if (target === "fill") {
                    if ("fill" in next) (next as { fill: Paint }).fill = paint!;
                } else if (target === "stroke") {
                    if ("stroke" in next) (next as { stroke: Paint }).stroke = color!;
                }
                return next as Layer;
            };

            const layers = s.layers.map(updateOne);
            const resizes = s.resizes.map((r) => {
                if (!r.layerSnapshot) return r;
                const next = r.layerSnapshot.map(updateOne);
                return { ...r, layerSnapshot: next };
            });

            // Masters/instances: find master that matches this layer
            let masters = s.masterComponents;
            let instances = s.componentInstances;
            const layerMasterId = layer.masterId;
            if (layerMasterId) {
                masters = s.masterComponents.map((m) => {
                    if (m.id !== layerMasterId) return m;
                    const props = m.props as MasterComponent["props"] & Record<string, unknown>;
                    const nextRefs: Layer["swatchRefs"] = { ...(props.swatchRefs ?? {}), [target]: swatchId };
                    const nextProps: Record<string, unknown> = { ...props, swatchRefs: nextRefs };
                    if (target === "fill" && "fill" in nextProps) nextProps.fill = paint!;
                    if (target === "stroke" && "stroke" in nextProps) nextProps.stroke = color!;
                    return { ...m, props: nextProps as unknown as MasterComponent["props"] };
                });
                instances = s.componentInstances.map((inst) => {
                    if (inst.masterId !== layerMasterId) return inst;
                    const local = inst.localProps as ComponentInstance["localProps"] & Record<string, unknown>;
                    const nextRefs: Layer["swatchRefs"] = { ...(local.swatchRefs ?? {}), [target]: swatchId };
                    const nextLocal: Record<string, unknown> = { ...local, swatchRefs: nextRefs };
                    if (target === "fill" && "fill" in nextLocal) nextLocal.fill = paint!;
                    if (target === "stroke" && "stroke" in nextLocal) nextLocal.stroke = color!;
                    return { ...inst, localProps: nextLocal as unknown as ComponentInstance["localProps"] };
                });
            }

            return {
                layers,
                resizes,
                masterComponents: masters,
                componentInstances: instances,
            } as Partial<CanvasStore>;
        });
    },

    applyBackgroundSwatchToImageLayer: (layerId, swatchId) => {
        const state = get();
        const swatch = findSwatch(state.palette, swatchId);
        if (!swatch || swatch.type !== "background") return;
        if (typeof swatch.value !== "object") return;
        const v = swatch.value as BackgroundSwatchValue;
        if (v.kind !== "image") return;
        const layer = state.layers.find((l) => l.id === layerId);
        if (!layer || layer.type !== "image") return;

        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);

        set((s) => {
            const updateOne = (l: Layer): Layer => {
                if (l.id !== layerId || l.type !== "image") return l;
                const nextRefs: Layer["swatchRefs"] = { ...(l.swatchRefs ?? {}), src: swatchId };
                return { ...l, src: v.src, swatchRefs: nextRefs } as Layer;
            };
            const layers = s.layers.map(updateOne);
            const resizes = s.resizes.map((r) => {
                if (!r.layerSnapshot) return r;
                const next = r.layerSnapshot.map(updateOne);
                return { ...r, layerSnapshot: next };
            });
            return { layers, resizes } as Partial<CanvasStore>;
        });
    },

    applyBackgroundSwatchToArtboard: (swatchId) => {
        const state = get();
        const swatch = findSwatch(state.palette, swatchId);
        if (!swatch || swatch.type !== "background") return;

        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);

        set((s) => {
            const activeProps = selectActiveArtboardProps(s);
            const v = swatch.value as BackgroundSwatchValue;
            if (typeof v !== "object") return s;
            if (v.kind === "solid") {
                const patched = patchActiveFormatArtboardProps(
                    s.resizes,
                    s.activeResizeId,
                    {
                        fill: v.color,
                        fillSwatchRef: swatch.id,
                        backgroundImage: undefined,
                    },
                    s.artboardProps,
                );
                return {
                    resizes: patched.resizes,
                    artboardProps: patched.topLevelArtboardProps,
                } as Partial<CanvasStore>;
            }
            if (v.kind === "gradient") {
                const patched = patchActiveFormatArtboardProps(
                    s.resizes,
                    s.activeResizeId,
                    {
                        fill: v.paint,
                        fillSwatchRef: swatch.id,
                        backgroundImage: undefined,
                    },
                    s.artboardProps,
                );
                return {
                    resizes: patched.resizes,
                    artboardProps: patched.topLevelArtboardProps,
                } as Partial<CanvasStore>;
            }
            const bg: ArtboardBackgroundImage = {
                src: v.src,
                fit: v.fit,
                focusX: v.focusX,
                focusY: v.focusY,
                opacity: activeProps.backgroundImage?.opacity ?? 1,
                swatchRef: swatch.id,
            };
            const patched = patchActiveFormatArtboardProps(
                s.resizes,
                s.activeResizeId,
                { backgroundImage: bg },
                s.artboardProps,
            );
            return {
                resizes: patched.resizes,
                artboardProps: patched.topLevelArtboardProps,
            } as Partial<CanvasStore>;
        });
    },

    createSwatchFromLayerFill: (layerId, name) => {
        const state = get();
        const layer = state.layers.find((l) => l.id === layerId);
        if (!layer) return null;
        // Only meaningful for layers that carry a `fill` color
        const fill = (layer as TextLayer | RectangleLayer | BadgeLayer | FrameLayer).fill;
        if (!fill || !isPaint(fill)) return null;

        const swatchName = name?.trim() || `Цвет ${state.palette.colors.length + 1}`;
        const id = get().addSwatch({ type: "color", name: swatchName, value: fill });

        // Link the source layer to the new swatch so a subsequent edit cascades.
        get().applyColorSwatchToLayer(layerId, id, "fill");
        return id;
    },

    createSwatchFromArtboardBackground: (name) => {
        const state = get();
        const activeProps = selectActiveArtboardProps(state);
        const bg = activeProps.backgroundImage;
        const swatchName = name?.trim() || `Фон ${state.palette.backgrounds.length + 1}`;

        if (bg?.src) {
            const id = get().addSwatch({
                type: "background",
                name: swatchName,
                value: {
                    kind: "image",
                    src: bg.src,
                    fit: bg.fit,
                    focusX: bg.focusX,
                    focusY: bg.focusY,
                },
            });
            const patched = patchActiveFormatArtboardProps(
                get().resizes,
                get().activeResizeId,
                {
                    backgroundImage: { ...bg, swatchRef: id },
                },
                get().artboardProps,
            );
            set({
                resizes: patched.resizes,
                artboardProps: patched.topLevelArtboardProps,
            });
            return id;
        }

        // No image background → snapshot the solid fill as a background swatch
        const fill = activeProps.fill;
        if (!fill || !isPaint(fill)) return null;
        const paint = normalizePaint(fill);
        const id = get().addSwatch({
            type: "background",
            name: swatchName,
            value: paint.kind === "gradient"
                ? { kind: "gradient", paint }
                : { kind: "solid", color: paint.color },
        });
        const patched = patchActiveFormatArtboardProps(
            get().resizes,
            get().activeResizeId,
            { fillSwatchRef: id },
            get().artboardProps,
        );
        set({
            resizes: patched.resizes,
            artboardProps: patched.topLevelArtboardProps,
        });
        return id;
    },
});

// Re-export helpers so the updateLayer guard can reuse the same logic if needed.
export { resolveColorFromSwatch };
