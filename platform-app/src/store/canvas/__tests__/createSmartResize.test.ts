import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "@/store/canvasStore";
import { DEFAULT_ARTBOARD_PROPS, DEFAULT_RESIZE } from "@/store/canvas/types";
import type { RectangleLayer, ResizeFormat } from "@/types";

function resetStore() {
    useCanvasStore.getState().resetCanvas();
    useCanvasStore.setState({
        history: [],
        future: [],
        layers: [],
        selectedLayerIds: [],
        resizes: [DEFAULT_RESIZE],
        activeResizeId: "master",
        canvasWidth: DEFAULT_RESIZE.width,
        canvasHeight: DEFAULT_RESIZE.height,
        artboardProps: { ...DEFAULT_ARTBOARD_PROPS },
        palette: { colors: [], backgrounds: [] },
    });
}

function rect(overrides: Partial<RectangleLayer> = {}): RectangleLayer {
    return {
        id: "rect",
        type: "rectangle",
        name: "Rect",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        visible: true,
        locked: false,
        fill: "#FFFFFF",
        stroke: "",
        strokeWidth: 0,
        cornerRadius: 0,
        ...overrides,
    };
}

function resize(overrides: Partial<ResizeFormat> = {}): ResizeFormat {
    return {
        ...DEFAULT_RESIZE,
        width: 100,
        height: 100,
        label: "100 × 100",
        ...overrides,
    };
}

describe("canvas resize slice createSmartResize", () => {
    beforeEach(() => {
        resetStore();
    });

    it("appends and activates the generated format", () => {
        useCanvasStore.setState({
            layers: [rect({ id: "source", name: "Source" })],
            selectedLayerIds: ["source"],
            activeResizeId: "master",
            canvasWidth: 100,
            canvasHeight: 100,
            resizes: [resize({ id: "master", isMaster: true })],
        });

        const result = useCanvasStore.getState().createSmartResize({
            name: "Story",
            width: 200,
            height: 100,
        });

        const state = useCanvasStore.getState();
        const generated = state.resizes.find((format) => format.id === result.resizeId);
        expect(generated).toMatchObject({
            name: "Story",
            width: 200,
            height: 100,
            label: "200 × 100",
        });
        expect(state.resizes).toHaveLength(2);
        expect(state.activeResizeId).toBe(result.resizeId);
        expect(state.canvasWidth).toBe(200);
        expect(state.canvasHeight).toBe(100);
        expect(state.layers).toBe(generated?.layerSnapshot);
        expect(state.layers[0].id).not.toBe("source");
        expect(state.selectedLayerIds).toEqual([]);
    });

    it("snapshots the previous active layers before switching", () => {
        const activeLayer = rect({ id: "active", name: "Active" });
        useCanvasStore.setState({
            layers: [activeLayer],
            activeResizeId: "master",
            canvasWidth: 100,
            canvasHeight: 100,
            resizes: [resize({ id: "master", isMaster: true })],
        });

        useCanvasStore.getState().createSmartResize({
            name: "Generated",
            width: 120,
            height: 120,
        });

        const state = useCanvasStore.getState();
        const master = state.resizes.find((format) => format.id === "master");
        expect(master?.layerSnapshot).toEqual([activeLayer]);
        expect(state.layers[0].id).not.toBe(activeLayer.id);
    });

    it("does not mutate source layers or inactive resize snapshots", () => {
        const activeLayer = rect({ id: "active", name: "Active", x: 8 });
        const inactiveLayer = rect({
            id: "wide-layer",
            name: "Wide",
            x: 20,
            y: 10,
            width: 60,
            height: 40,
            responsive: { behavior: "fluid" },
        });
        const inactiveResize = resize({
            id: "wide",
            name: "Wide",
            width: 200,
            height: 100,
            label: "200 × 100",
            layerSnapshot: [inactiveLayer],
        });
        const activeBefore = JSON.stringify(activeLayer);
        const inactiveBefore = JSON.stringify(inactiveResize);

        useCanvasStore.setState({
            layers: [activeLayer],
            activeResizeId: "master",
            canvasWidth: 100,
            canvasHeight: 100,
            resizes: [resize({ id: "master", isMaster: true }), inactiveResize],
        });

        useCanvasStore.getState().createSmartResize({
            name: "Generated wide",
            width: 400,
            height: 200,
        });

        const state = useCanvasStore.getState();
        expect(JSON.stringify(activeLayer)).toBe(activeBefore);
        expect(JSON.stringify(inactiveResize)).toBe(inactiveBefore);
        expect(state.resizes.find((format) => format.id === "wide")).toBe(inactiveResize);
    });

    it("returns diagnostics for invalid generated geometry", () => {
        useCanvasStore.setState({
            layers: [
                rect({
                    id: "bad",
                    name: "Bad",
                    x: 95,
                    y: 10,
                    width: 20,
                    height: 20,
                    responsive: { canHide: true },
                }),
            ],
            activeResizeId: "master",
            canvasWidth: 100,
            canvasHeight: 100,
            resizes: [resize({ id: "master", isMaster: true })],
        });

        const result = useCanvasStore.getState().createSmartResize({
            name: "Small",
            width: 100,
            height: 100,
        });

        const state = useCanvasStore.getState();
        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                code: "layer-out-of-bounds",
                layerName: "Bad",
                severity: "warning",
            }),
        ]);
        expect(state.layers[0].visible).toBe(false);
    });
});
