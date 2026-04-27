import type { CanvasStore } from "@/store/canvas/types";

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

    return {
        layers: store.layers,
        masterComponents: store.masterComponents,
        componentInstances: store.componentInstances,
        resizes: resizesWithSnapshot,
        artboardProps: store.artboardProps,
        canvasWidth: store.canvasWidth,
        canvasHeight: store.canvasHeight,
        palette: store.palette,
    };
}
