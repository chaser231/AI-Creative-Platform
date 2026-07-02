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
        const imageFillLayer: RectangleLayer = {
            id: "rect-image-fill-1",
            type: "rectangle",
            name: "Image Fill Rect",
            x: 120,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            visible: true,
            locked: false,
            fill: "#FFFFFF",
            fillMode: "image",
            imageFill: {
                src: oldUrl,
                fit: "cover",
                opacity: 0.8,
                focusX: 0.5,
                focusY: 0.5,
                swatchRef: "bg-1",
            },
            stroke: "",
            strokeWidth: 0,
            cornerRadius: 0,
        };
        const resize: ResizeFormat = {
            ...DEFAULT_RESIZE,
            layerSnapshot: [layer, imageFillLayer],
        };
        useCanvasStore.setState({
            layers: [layer, imageFillLayer],
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
        expect((state.layers[1] as RectangleLayer).imageFill).toMatchObject({
            src: nextUrl,
            fit: "contain",
            focusX: 0.25,
            focusY: 0.75,
            opacity: 0.8,
            swatchRef: "bg-1",
        });
        expect((state.resizes[0].layerSnapshot?.[1] as RectangleLayer).imageFill).toMatchObject({
            src: nextUrl,
            fit: "contain",
            focusX: 0.25,
            focusY: 0.75,
            opacity: 0.8,
            swatchRef: "bg-1",
        });
        expect(state.artboardProps.backgroundImage).toEqual({
            src: nextUrl,
            fit: "contain",
            opacity: 0.7,
            focusX: 0.25,
            focusY: 0.75,
            swatchRef: "bg-1",
        });
        expect(state.resizes[0].artboardProps?.backgroundImage).toEqual(state.artboardProps.backgroundImage);
    });

    it("updates artboard swatch cascade only on formats that reference the swatch", () => {
        useCanvasStore.setState({
            layers: [],
            resizes: [
                {
                    ...DEFAULT_RESIZE,
                    id: "master",
                    artboardProps: {
                        ...DEFAULT_ARTBOARD_PROPS,
                        fillSwatchRef: "color-1",
                        fill: "#111111",
                    },
                },
                {
                    ...DEFAULT_RESIZE,
                    id: "other",
                    name: "Other",
                    label: "800 × 600",
                    width: 800,
                    height: 600,
                    artboardProps: {
                        ...DEFAULT_ARTBOARD_PROPS,
                        fillSwatchRef: "color-2",
                        fill: "#222222",
                    },
                },
            ],
            activeResizeId: "master",
            artboardProps: {
                ...DEFAULT_ARTBOARD_PROPS,
                fillSwatchRef: "color-1",
                fill: "#111111",
            },
            palette: {
                colors: [
                    { id: "color-1", type: "color", name: "Primary", value: "#111111" },
                    { id: "color-2", type: "color", name: "Secondary", value: "#222222" },
                ],
                backgrounds: [],
            },
        });

        useCanvasStore.getState().updateSwatch("color-1", { value: "#333333" });

        const state = useCanvasStore.getState();
        expect(state.resizes.find((r) => r.id === "master")?.artboardProps?.fill).toBe("#333333");
        expect(state.resizes.find((r) => r.id === "other")?.artboardProps?.fill).toBe("#222222");
    });

    it("removeSwatch detaches artboard background swatch only on matching formats", () => {
        useCanvasStore.setState({
            layers: [],
            resizes: [
                {
                    ...DEFAULT_RESIZE,
                    id: "master",
                    artboardProps: {
                        ...DEFAULT_ARTBOARD_PROPS,
                        backgroundImage: {
                            src: "https://example.com/a.png",
                            fit: "cover",
                            swatchRef: "bg-1",
                        },
                    },
                },
                {
                    ...DEFAULT_RESIZE,
                    id: "other",
                    name: "Other",
                    label: "800 × 600",
                    width: 800,
                    height: 600,
                    artboardProps: {
                        ...DEFAULT_ARTBOARD_PROPS,
                        backgroundImage: {
                            src: "https://example.com/b.png",
                            fit: "cover",
                            swatchRef: "bg-2",
                        },
                    },
                },
            ],
            activeResizeId: "master",
            artboardProps: {
                ...DEFAULT_ARTBOARD_PROPS,
                backgroundImage: {
                    src: "https://example.com/a.png",
                    fit: "cover",
                    swatchRef: "bg-1",
                },
            },
            palette: {
                colors: [],
                backgrounds: [
                    {
                        id: "bg-1",
                        type: "background",
                        name: "BG A",
                        value: { kind: "image", src: "https://example.com/a.png", fit: "cover" },
                    },
                    {
                        id: "bg-2",
                        type: "background",
                        name: "BG B",
                        value: { kind: "image", src: "https://example.com/b.png", fit: "cover" },
                    },
                ],
            },
            history: [],
            future: [],
        });

        useCanvasStore.getState().removeSwatch("bg-1", "detach");

        const state = useCanvasStore.getState();
        expect(state.resizes.find((r) => r.id === "master")?.artboardProps?.backgroundImage?.swatchRef).toBeUndefined();
        expect(state.resizes.find((r) => r.id === "master")?.artboardProps?.backgroundImage?.src).toBe("https://example.com/a.png");
        expect(state.resizes.find((r) => r.id === "other")?.artboardProps?.backgroundImage?.swatchRef).toBe("bg-2");
    });
});
