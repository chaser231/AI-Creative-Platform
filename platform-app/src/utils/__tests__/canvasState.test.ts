import { describe, expect, it } from "vitest";
import { getCanvasStateForSave, normalizeCanvasStateForLoad } from "@/utils/canvasState";
import { DEFAULT_ARTBOARD_PROPS, DEFAULT_RESIZE } from "@/store/canvas/types";
import type { Layer, ResizeFormat } from "@/types";

describe("getCanvasStateForSave", () => {
    it("serializes palette data and refreshes the active resize snapshot", () => {
        const layers = [
            {
                id: "layer-1",
                type: "image",
                name: "Hero",
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                rotation: 0,
                visible: true,
                locked: false,
                src: "https://storage.yandexcloud.net/acp-assets/templates/hero.png",
                objectFit: "cover",
            },
        ];
        const palette = {
            colors: [],
            backgrounds: [
                {
                    id: "bg-1",
                    type: "background",
                    name: "Hero background",
                    value: {
                        kind: "image",
                        src: "https://storage.yandexcloud.net/acp-assets/templates/bg.png",
                        fit: "cover",
                        focusX: 0.5,
                        focusY: 0.5,
                    },
                },
            ],
        };

        const state = getCanvasStateForSave({
            layers,
            masterComponents: [],
            componentInstances: [],
            resizes: [DEFAULT_RESIZE],
            activeResizeId: DEFAULT_RESIZE.id,
            artboardProps: DEFAULT_ARTBOARD_PROPS,
            canvasWidth: 1080,
            canvasHeight: 1080,
            palette,
        } as Parameters<typeof getCanvasStateForSave>[0]);

        expect(state.palette).toEqual(palette);
        expect(state.resizes[0].layerSnapshot).toEqual(layers);
    });

    it("keeps top-level layers aligned to master while refreshing active format snapshot", () => {
        const masterLayers = [{ id: "master-layer", type: "rectangle", name: "Master" }] as Layer[];
        const activeLayers = [{ id: "feed-layer", type: "rectangle", name: "Feed edited" }] as Layer[];
        const resizes = [
            {
                id: "feed",
                name: "Feed",
                width: 540,
                height: 225,
                label: "540 × 225",
                instancesEnabled: false,
                layerSnapshot: [{ id: "feed-old", type: "rectangle", name: "Feed old" }],
            },
            {
                id: "landing",
                name: "Landing Header",
                width: 1192,
                height: 300,
                label: "1192 × 300",
                instancesEnabled: false,
                isMaster: true,
                layerSnapshot: masterLayers,
            },
        ] as ResizeFormat[];

        const state = getCanvasStateForSave({
            layers: activeLayers,
            masterComponents: [],
            componentInstances: [],
            resizes,
            activeResizeId: "feed",
            artboardProps: DEFAULT_ARTBOARD_PROPS,
            canvasWidth: 540,
            canvasHeight: 225,
            palette: { colors: [], backgrounds: [] },
        });

        expect(state.layers).toEqual(masterLayers);
        expect(state.canvasWidth).toBe(1192);
        expect(state.canvasHeight).toBe(300);
        expect(state.resizes.find((resize) => resize.id === "feed")?.layerSnapshot).toEqual(activeLayers);
        expect(state.resizes.find((resize) => resize.id === "landing")?.layerSnapshot).toEqual(masterLayers);
    });
});

describe("normalizeCanvasStateForLoad", () => {
    it("opens the master resize from its snapshot even when master is not first", () => {
        const topLevelLayers = [{ id: "top-level", type: "text", name: "Top level" }] as Layer[];
        const feedLayers = [{ id: "feed-layer", type: "text", name: "Feed" }] as Layer[];
        const masterLayers = [{ id: "master-layer", type: "text", name: "Master" }] as Layer[];
        const resizes = [
            {
                id: "feed",
                name: "Feed",
                width: 540,
                height: 225,
                label: "540 × 225",
                instancesEnabled: false,
                layerSnapshot: feedLayers,
            },
            {
                id: "landing",
                name: "Landing Header",
                width: 1192,
                height: 300,
                label: "1192 × 300",
                instancesEnabled: false,
                isMaster: true,
                layerSnapshot: masterLayers,
            },
        ] as ResizeFormat[];

        const normalized = normalizeCanvasStateForLoad({
            layers: topLevelLayers,
            masterComponents: [],
            componentInstances: [],
            resizes,
            artboardProps: DEFAULT_ARTBOARD_PROPS,
            canvasWidth: 1192,
            canvasHeight: 300,
            palette: { colors: [], backgrounds: [] },
        });

        expect(normalized.activeResizeId).toBe("landing");
        expect(normalized.layers).toEqual(masterLayers);
        expect(normalized.canvasWidth).toBe(1192);
        expect(normalized.canvasHeight).toBe(300);
    });

    it("honors a valid saved active resize and loads that resize snapshot", () => {
        const activeLayers = [{ id: "hero-layer", type: "text", name: "Hero" }] as Layer[];
        const resizes = [
            {
                id: "master",
                name: "Основной формат",
                width: 1080,
                height: 1080,
                label: "1080 × 1080",
                instancesEnabled: false,
                isMaster: true,
                layerSnapshot: [{ id: "master-layer", type: "text", name: "Master" }],
            },
            {
                id: "hero",
                name: "Hero",
                width: 540,
                height: 225,
                label: "540 × 225",
                instancesEnabled: false,
                layerSnapshot: activeLayers,
            },
        ] as ResizeFormat[];

        const normalized = normalizeCanvasStateForLoad({
            layers: [],
            masterComponents: [],
            componentInstances: [],
            resizes,
            activeResizeId: "hero",
            artboardProps: DEFAULT_ARTBOARD_PROPS,
            canvasWidth: 1080,
            canvasHeight: 1080,
            palette: { colors: [], backgrounds: [] },
        });

        expect(normalized.activeResizeId).toBe("hero");
        expect(normalized.layers).toEqual(activeLayers);
        expect(normalized.canvasWidth).toBe(540);
        expect(normalized.canvasHeight).toBe(225);
    });
});
