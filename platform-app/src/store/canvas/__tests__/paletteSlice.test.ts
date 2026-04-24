import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "@/store/canvasStore";
import { DEFAULT_ARTBOARD_PROPS, DEFAULT_RESIZE } from "@/store/canvas/types";
import type { ImageLayer, RectangleLayer, ResizeFormat } from "@/types";

function resetStore() {
    useCanvasStore.getState().resetCanvas();
    useCanvasStore.setState({
        history: [],
        future: [],
        selectedLayerIds: [],
        resizes: [DEFAULT_RESIZE],
        activeResizeId: "master",
        artboardProps: { ...DEFAULT_ARTBOARD_PROPS },
        palette: { colors: [], backgrounds: [] },
    });
}

describe("canvas palette slice", () => {
    beforeEach(() => {
        resetStore();
    });

    it("cascades color swatch edits to active layers and resize snapshots", () => {
        const layer: RectangleLayer = {
            id: "rect-1",
            type: "rectangle",
            name: "Rect",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            visible: true,
            locked: false,
            fill: "#111111",
            stroke: "",
            strokeWidth: 0,
            cornerRadius: 0,
            swatchRefs: { fill: "color-1" },
        };
        const resize: ResizeFormat = {
            ...DEFAULT_RESIZE,
            layerSnapshot: [layer],
        };
        useCanvasStore.setState({
            layers: [layer],
            resizes: [resize],
            palette: {
                colors: [{ id: "color-1", type: "color", name: "Brand", value: "#111111" }],
                backgrounds: [],
            },
        });

        useCanvasStore.getState().updateSwatch("color-1", { value: "#FFCC00" });

        const state = useCanvasStore.getState();
        expect((state.layers[0] as RectangleLayer).fill).toBe("#FFCC00");
        expect((state.resizes[0].layerSnapshot?.[0] as RectangleLayer).fill).toBe("#FFCC00");
    });

    it("cascades image background swatch edits to artboard and image layer refs", () => {
        const oldUrl = "https://storage.yandexcloud.net/acp-assets/templates/old.png";
        const nextUrl = "https://storage.yandexcloud.net/acp-assets/templates/next.png";
        const layer: ImageLayer = {
            id: "image-1",
            type: "image",
            name: "Image",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            visible: true,
            locked: false,
            src: oldUrl,
            objectFit: "cover",
            focusX: 0.5,
            focusY: 0.5,
            swatchRefs: { src: "bg-1" },
        };
        const resize: ResizeFormat = {
            ...DEFAULT_RESIZE,
            layerSnapshot: [layer],
        };
        useCanvasStore.setState({
            layers: [layer],
            resizes: [resize],
            artboardProps: {
                ...DEFAULT_ARTBOARD_PROPS,
                backgroundImage: {
                    src: oldUrl,
                    fit: "cover",
                    opacity: 0.7,
                    focusX: 0.5,
                    focusY: 0.5,
                    swatchRef: "bg-1",
                },
            },
            palette: {
                colors: [],
                backgrounds: [
                    {
                        id: "bg-1",
                        type: "background",
                        name: "Background",
                        value: { kind: "image", src: oldUrl, fit: "cover", focusX: 0.5, focusY: 0.5 },
                    },
                ],
            },
        });

        useCanvasStore.getState().updateSwatch("bg-1", {
            value: { kind: "image", src: nextUrl, fit: "contain", focusX: 0.25, focusY: 0.75 },
        });

        const state = useCanvasStore.getState();
        expect((state.layers[0] as ImageLayer).src).toBe(nextUrl);
        expect((state.resizes[0].layerSnapshot?.[0] as ImageLayer).src).toBe(nextUrl);
        expect(state.artboardProps.backgroundImage).toEqual({
            src: nextUrl,
            fit: "contain",
            opacity: 0.7,
            focusX: 0.25,
            focusY: 0.75,
            swatchRef: "bg-1",
        });
    });
});
