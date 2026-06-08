import type { CanvasStore, Layer, ResizeFormat } from "@/store/canvas/types";
import type { LayerResponsiveSettings } from "@/types";

type CanvasStateSource = Pick<
    CanvasStore,
    | "layers"
    | "masterComponents"
    | "componentInstances"
    | "resizes"
    | "activeResizeId"
    | "artboardProps"
    | "canvasWidth"
    | "canvasHeight"
    | "palette"
>;

type CanvasStateLoadFallback = Partial<CanvasStateSource>;

type CanvasStateForLoad = Partial<CanvasStateSource> & {
    activeResizeId?: string | null;
};

function cloneLayers(layers: Layer[] | undefined): Layer[] {
    return Array.isArray(layers) ? layers.map((layer) => ({ ...layer })) : [];
}

function cloneResizes(resizes: ResizeFormat[] | undefined): ResizeFormat[] {
    return Array.isArray(resizes)
        ? resizes.map((resize) => ({
            ...resize,
            layerSnapshot: resize.layerSnapshot
                ? migrateLayersForLoad(cloneLayers(resize.layerSnapshot))
                : resize.layerSnapshot,
            layerBindings: resize.layerBindings
                ? resize.layerBindings.map((binding) => ({ ...binding }))
                : resize.layerBindings,
            adaptationDiagnostics: resize.adaptationDiagnostics
                ? resize.adaptationDiagnostics.map((diagnostic) => ({ ...diagnostic }))
                : resize.adaptationDiagnostics,
        }))
        : [];
}

function compactResponsiveSettings(settings: LayerResponsiveSettings): LayerResponsiveSettings | undefined {
    const next: LayerResponsiveSettings = { ...settings };
    if (!next.role?.trim()) delete next.role;
    else next.role = next.role.trim();
    if (!next.behavior || next.behavior === "auto") delete next.behavior;
    if (!next.canHide) delete next.canHide;
    if (next.minFontSize === undefined || next.minFontSize === 8) delete next.minFontSize;
    if (next.maxFontSize === undefined || next.maxFontSize <= 0) delete next.maxFontSize;
    return Object.keys(next).length > 0 ? next : undefined;
}

function migrateLayerResponsive(layer: Layer): Layer {
    if (!layer.responsive) return layer;

    const responsive = { ...layer.responsive } as LayerResponsiveSettings & {
        behavior?: LayerResponsiveSettings["behavior"] | "decorative";
        priority?: number;
    };
    if ((responsive.behavior as string | undefined) === "decorative") delete responsive.behavior;
    delete responsive.priority;

    const compacted = compactResponsiveSettings(responsive);
    if (compacted === layer.responsive) return layer;
    return { ...layer, responsive: compacted };
}

export function migrateLayersForLoad(layers: Layer[]): Layer[] {
    return layers.map((layer) => migrateLayerResponsive(layer));
}

export function getMasterResize(resizes: ResizeFormat[]): ResizeFormat | undefined {
    return resizes.find((resize) => resize.isMaster)
        ?? resizes.find((resize) => resize.id === "master")
        ?? resizes[0];
}

function resolveActiveResizeId(
    resizes: ResizeFormat[],
    requestedActiveResizeId?: string | null,
): string {
    if (requestedActiveResizeId && resizes.some((resize) => resize.id === requestedActiveResizeId)) {
        return requestedActiveResizeId;
    }
    return getMasterResize(resizes)?.id ?? "master";
}

/**
 * Hydrate a canvas/template state so `activeResizeId`, `layers`, and artboard
 * size all describe the same format. This prevents the first listed format
 * from inheriting top-level layers that actually belong to master or to the
 * last active format saved into the template.
 */
export function normalizeCanvasStateForLoad(
    state: CanvasStateForLoad,
    fallback: CanvasStateLoadFallback = {},
) {
    const resizes = cloneResizes(state.resizes ?? fallback.resizes);
    const activeResizeId = resolveActiveResizeId(resizes, state.activeResizeId);
    const activeResize = resizes.find((resize) => resize.id === activeResizeId);
    const topLevelLayers = migrateLayersForLoad(cloneLayers(state.layers ?? fallback.layers));
    const layers = activeResize?.layerSnapshot !== undefined
        ? cloneLayers(activeResize.layerSnapshot)
        : topLevelLayers;

    return {
        layers,
        masterComponents: state.masterComponents ?? fallback.masterComponents ?? [],
        componentInstances: state.componentInstances ?? fallback.componentInstances ?? [],
        resizes,
        activeResizeId,
        artboardProps: state.artboardProps ?? fallback.artboardProps,
        canvasWidth: activeResize?.width ?? state.canvasWidth ?? fallback.canvasWidth ?? 1080,
        canvasHeight: activeResize?.height ?? state.canvasHeight ?? fallback.canvasHeight ?? 1080,
        palette: state.palette ?? fallback.palette,
    };
}

/**
 * Build the canvas state object for persistence.
 * Ensures the active format's layerSnapshot is updated with the current layers
 * before serialization, so per-format snapshots are always fresh.
 */
export function getCanvasStateForSave(store: CanvasStateSource) {
    const migratedLayers = migrateLayersForLoad(cloneLayers(store.layers));
    const resizesWithSnapshot = store.resizes.map((resize) => {
        const snapshot = resize.id === store.activeResizeId
            ? migratedLayers
            : resize.layerSnapshot;
        return {
            ...resize,
            layerSnapshot: snapshot
                ? migrateLayersForLoad(cloneLayers(snapshot))
                : snapshot,
        };
    });
    const activeResize = resizesWithSnapshot.find((resize) => resize.id === store.activeResizeId);
    const masterResize = getMasterResize(resizesWithSnapshot);
    const canonicalResize = masterResize ?? activeResize;
    const canonicalLayers = canonicalResize
        ? (canonicalResize.id === store.activeResizeId
            ? migratedLayers
            : canonicalResize.layerSnapshot ?? migratedLayers)
        : migratedLayers;

    return {
        layers: canonicalLayers,
        masterComponents: store.masterComponents,
        componentInstances: store.componentInstances,
        resizes: resizesWithSnapshot,
        activeResizeId: store.activeResizeId,
        artboardProps: store.artboardProps,
        canvasWidth: canonicalResize?.width ?? store.canvasWidth,
        canvasHeight: canonicalResize?.height ?? store.canvasHeight,
        palette: store.palette,
    };
}
