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
} from "@/types";
import { v4 as uuid } from "uuid";
import { pushSnapshot } from "./createHistorySlice";

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
    if (swatch.type === "color" && typeof swatch.value === "string") {
        return swatch.value;
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

/** Apply a fill/stroke color override to a layer based on swatchRefs. */
function applyColorRefsToLayer<T extends { swatchRefs?: Layer["swatchRefs"] } & Partial<Layer>>(
    layer: T,
    swatchId: string,
    color: string,
): T {
    if (!layer.swatchRefs) return layer;
    let changed = false;
    const next = { ...layer } as T & Record<string, unknown>;
    if (layer.swatchRefs.fill === swatchId && (next as { fill?: string }).fill !== undefined) {
        (next as { fill?: string }).fill = color;
        changed = true;
    }
    if (layer.swatchRefs.stroke === swatchId && (next as { stroke?: string }).stroke !== undefined) {
        (next as { stroke?: string }).stroke = color;
        changed = true;
    }
    if (layer.swatchRefs.text === swatchId) {
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

function cascadeLayers(layers: Layer[], swatchId: string, color: string): Layer[] {
    let changed = false;
    const next = layers.map((l) => {
        const nl = applyColorRefsToLayer(l, swatchId, color) as Layer;
        if (nl !== l) changed = true;
        return nl;
    });
    return changed ? next : layers;
}

/** Apply an image-src override to an image layer based on swatchRefs.src. */
function applyImageRefToLayer(layer: Layer, swatchId: string, src: string): Layer {
    if (layer.type !== "image" || layer.swatchRefs?.src !== swatchId) return layer;
    return { ...layer, src } as Layer;
}

function cascadeImageLayers(layers: Layer[], swatchId: string, src: string): Layer[] {
    let changed = false;
    const next = layers.map((l) => {
        const nl = applyImageRefToLayer(l, swatchId, src);
        if (nl !== l) changed = true;
        return nl;
    });
    return changed ? next : layers;
}

function cascadeMasters(masters: MasterComponent[], swatchId: string, color: string): MasterComponent[] {
    let changed = false;
    const next = masters.map((m) => {
        const props = m.props as MasterComponent["props"] & { swatchRefs?: Layer["swatchRefs"] };
        if (!props.swatchRefs) return m;
        const updated = applyColorRefsToLayer(props, swatchId, color);
        if (updated === props) return m;
        changed = true;
        return { ...m, props: updated as MasterComponent["props"] };
    });
    return changed ? next : masters;
}

function cascadeInstances(instances: ComponentInstance[], swatchId: string, color: string): ComponentInstance[] {
    let changed = false;
    const next = instances.map((inst) => {
        const local = inst.localProps as ComponentInstance["localProps"] & { swatchRefs?: Layer["swatchRefs"] };
        if (!local.swatchRefs) return inst;
        const updated = applyColorRefsToLayer(local, swatchId, color);
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
            const color = resolveColorFromSwatch(updatedSwatch);
            let layers = s.layers;
            let masters = s.masterComponents;
            let instances = s.componentInstances;
            let resizes = s.resizes;

            if (color !== undefined) {
                layers = cascadeLayers(layers, id, color);
                masters = cascadeMasters(masters, id, color);
                instances = cascadeInstances(instances, id, color);
                resizes = s.resizes.map((r) => {
                    if (!r.layerSnapshot) return r;
                    const next = cascadeLayers(r.layerSnapshot, id, color);
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
                const newSrc = (updatedSwatch.value as Extract<BackgroundSwatchValue, { kind: "image" }>).src;
                layers = cascadeImageLayers(layers, id, newSrc);
                resizes = resizes.map((r) => {
                    if (!r.layerSnapshot) return r;
                    const next = cascadeImageLayers(r.layerSnapshot, id, newSrc);
                    return next === r.layerSnapshot ? r : { ...r, layerSnapshot: next };
                });
            }

            // Artboard background image swatch: if currently applied, refresh.
            let artboardProps = s.artboardProps;
            if (
                updatedSwatch.type === "background"
                && typeof updatedSwatch.value === "object"
                && artboardProps.backgroundImage?.swatchRef === id
            ) {
                const bg = bgImageFromSwatch(updatedSwatch, artboardProps.backgroundImage);
                if (bg) {
                    artboardProps = { ...artboardProps, backgroundImage: bg };
                } else {
                    // Swatch switched from image → solid: drop the backgroundImage.
                    artboardProps = { ...artboardProps, backgroundImage: undefined };
                    if (color !== undefined) {
                        artboardProps = { ...artboardProps, fill: color };
                    }
                }
            }

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

            // Artboard background: if driven by this swatch, drop the link.
            let artboardProps = s.artboardProps;
            if (artboardProps.backgroundImage?.swatchRef === id) {
                if (mode === "replace" && replaceWithId) {
                    const replacement = findSwatch({ ...s.palette, [bucket]: remaining }, replaceWithId);
                    const bg = replacement ? bgImageFromSwatch(replacement, artboardProps.backgroundImage) : undefined;
                    artboardProps = bg
                        ? { ...artboardProps, backgroundImage: bg }
                        : { ...artboardProps, backgroundImage: undefined };
                } else {
                    // Detach → keep current image but drop the backlink
                    artboardProps = {
                        ...artboardProps,
                        backgroundImage: { ...artboardProps.backgroundImage, swatchRef: undefined },
                    };
                }
            }

            return {
                palette: { ...s.palette, [bucket]: remaining },
                layers,
                masterComponents: masters,
                componentInstances: instances,
                resizes,
                artboardProps,
            } as Partial<CanvasStore>;
        });

        // In replace mode, also cascade the replacement's value onto any
        // refs that now point at it — keeps colors/srcs consistent even if
        // the replaced-with swatch has a different value.
        if (mode === "replace" && replaceWithId) {
            const nextState = get();
            const replacement = findSwatch(nextState.palette, replaceWithId);
            if (replacement) {
                const color = resolveColorFromSwatch(replacement);
                const newImgSrc =
                    replacement.type === "background"
                    && typeof replacement.value === "object"
                    && (replacement.value as BackgroundSwatchValue).kind === "image"
                        ? (replacement.value as Extract<BackgroundSwatchValue, { kind: "image" }>).src
                        : undefined;

                if (color !== undefined || newImgSrc !== undefined) {
                    set((s) => {
                        let layers = s.layers;
                        let masters = s.masterComponents;
                        let instances = s.componentInstances;
                        let resizes = s.resizes;
                        if (color !== undefined) {
                            layers = cascadeLayers(layers, replaceWithId, color);
                            masters = cascadeMasters(masters, replaceWithId, color);
                            instances = cascadeInstances(instances, replaceWithId, color);
                            resizes = resizes.map((r) => {
                                if (!r.layerSnapshot) return r;
                                const next = cascadeLayers(r.layerSnapshot, replaceWithId, color);
                                return next === r.layerSnapshot ? r : { ...r, layerSnapshot: next };
                            });
                        }
                        if (newImgSrc !== undefined) {
                            layers = cascadeImageLayers(layers, replaceWithId, newImgSrc);
                            resizes = resizes.map((r) => {
                                if (!r.layerSnapshot) return r;
                                const next = cascadeImageLayers(r.layerSnapshot, replaceWithId, newImgSrc);
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
        const color = resolveColorFromSwatch(swatch);
        if (color === undefined) return;
        const layer = state.layers.find((l) => l.id === layerId);
        if (!layer) return;

        pushSnapshot(set as (p: Partial<CanvasStore>) => void, get);

        set((s) => {
            const updateOne = (l: Layer): Layer => {
                if (l.id !== layerId) return l;
                const nextRefs: Layer["swatchRefs"] = { ...(l.swatchRefs ?? {}), [target]: swatchId };
                const next = { ...l, swatchRefs: nextRefs } as Layer & Record<string, unknown>;
                if (target === "fill") {
                    if ("fill" in next) (next as { fill: string }).fill = color;
                } else if (target === "stroke") {
                    if ("stroke" in next) (next as { stroke: string }).stroke = color;
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
                    if (target === "fill" && "fill" in nextProps) nextProps.fill = color;
                    if (target === "stroke" && "stroke" in nextProps) nextProps.stroke = color;
                    return { ...m, props: nextProps as unknown as MasterComponent["props"] };
                });
                instances = s.componentInstances.map((inst) => {
                    if (inst.masterId !== layerMasterId) return inst;
                    const local = inst.localProps as ComponentInstance["localProps"] & Record<string, unknown>;
                    const nextRefs: Layer["swatchRefs"] = { ...(local.swatchRefs ?? {}), [target]: swatchId };
                    const nextLocal: Record<string, unknown> = { ...local, swatchRefs: nextRefs };
                    if (target === "fill" && "fill" in nextLocal) nextLocal.fill = color;
                    if (target === "stroke" && "stroke" in nextLocal) nextLocal.stroke = color;
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
            const v = swatch.value as BackgroundSwatchValue;
            if (typeof v !== "object") return s;
            if (v.kind === "solid") {
                return {
                    artboardProps: {
                        ...s.artboardProps,
                        fill: v.color,
                        backgroundImage: undefined,
                    },
                } as Partial<CanvasStore>;
            }
            // image
            const bg: ArtboardBackgroundImage = {
                src: v.src,
                fit: v.fit,
                focusX: v.focusX,
                focusY: v.focusY,
                opacity: s.artboardProps.backgroundImage?.opacity ?? 1,
                swatchRef: swatch.id,
            };
            return {
                artboardProps: { ...s.artboardProps, backgroundImage: bg },
            } as Partial<CanvasStore>;
        });
    },

    createSwatchFromLayerFill: (layerId, name) => {
        const state = get();
        const layer = state.layers.find((l) => l.id === layerId);
        if (!layer) return null;
        // Only meaningful for layers that carry a `fill` color
        const fill = (layer as TextLayer | RectangleLayer | BadgeLayer | FrameLayer).fill;
        if (!fill || typeof fill !== "string") return null;

        const swatchName = name?.trim() || `Цвет ${state.palette.colors.length + 1}`;
        const id = get().addSwatch({ type: "color", name: swatchName, value: fill });

        // Link the source layer to the new swatch so a subsequent edit cascades.
        get().applyColorSwatchToLayer(layerId, id, "fill");
        return id;
    },

    createSwatchFromArtboardBackground: (name) => {
        const state = get();
        const bg = state.artboardProps.backgroundImage;
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
            // Backlink the existing background to the new swatch.
            set((s) => ({
                artboardProps: {
                    ...s.artboardProps,
                    backgroundImage: s.artboardProps.backgroundImage
                        ? { ...s.artboardProps.backgroundImage, swatchRef: id }
                        : s.artboardProps.backgroundImage,
                },
            }));
            return id;
        }

        // No image background → snapshot the solid fill as a background swatch
        const fill = state.artboardProps.fill;
        if (!fill) return null;
        return get().addSwatch({
            type: "background",
            name: swatchName,
            value: { kind: "solid", color: fill },
        });
    },
});

// Re-export helpers so the updateLayer guard can reuse the same logic if needed.
export { resolveColorFromSwatch };
