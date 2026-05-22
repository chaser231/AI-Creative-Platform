import type { CanvasStore, Layer, ResizeFormat } from "@/store/canvas/types";

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
                ? cloneLayers(resize.layerSnapshot)
                : resize.layerSnapshot,
            layerBindings: resize.layerBindings
                ? resize.layerBindings.map((binding) => ({ ...binding }))
                : resize.layerBindings,
        }))
        : [];
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
    const topLevelLayers = cloneLayers(state.layers ?? fallback.layers);
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
    const resizesWithSnapshot = store.resizes.map((resize) =>
        resize.id === store.activeResizeId
            ? { ...resize, layerSnapshot: store.layers }
            : resize
    );
    const activeResize = resizesWithSnapshot.find((resize) => resize.id === store.activeResizeId);
    const masterResize = getMasterResize(resizesWithSnapshot);
    const canonicalResize = masterResize ?? activeResize;
    const canonicalLayers = canonicalResize
        ? (canonicalResize.id === store.activeResizeId
            ? store.layers
            : canonicalResize.layerSnapshot ?? store.layers)
        : store.layers;

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
