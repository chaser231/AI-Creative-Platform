import { describe, expect, it } from "vitest";
import { getCanvasStateForSave } from "@/utils/canvasState";
import { DEFAULT_ARTBOARD_PROPS, DEFAULT_RESIZE } from "@/store/canvas/types";

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
});
