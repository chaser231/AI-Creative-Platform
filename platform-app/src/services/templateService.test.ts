import { describe, expect, it } from "vitest";
import { serializeTemplate } from "@/services/templateService";
import type { RectangleLayer, ResizeFormat } from "@/types";

describe("serializeTemplate", () => {
    it("preserves raw canvas fields needed for reusable palettes", () => {
        const layer: RectangleLayer = {
            id: "rect-1",
            type: "rectangle",
            name: "Rect",
            x: 0,
            y: 0,
            width: 120,
            height: 80,
            rotation: 0,
            visible: true,
            locked: false,
            fill: "#FFCC00",
            stroke: "",
            strokeWidth: 0,
            cornerRadius: 0,
            swatchRefs: { fill: "brand" },
        };
        const palette = {
            colors: [{ id: "brand", type: "color" as const, name: "Brand", value: "#FFCC00" }],
            backgrounds: [
                {
                    id: "hero-bg",
                    type: "background" as const,
                    name: "Hero",
                    value: {
                        kind: "image" as const,
                        src: "https://storage.yandexcloud.net/acp-assets/templates/hero.png",
                        fit: "cover" as const,
                        focusX: 0.5,
                        focusY: 0.5,
                    },
                },
            ],
        };

        const pack = serializeTemplate(
            { name: "Palette Template" },
            [],
            [],
            [],
            [layer],
            {
                palette,
                artboardProps: {
                    fill: "#FFFFFF",
                    backgroundImage: {
                        src: "https://storage.yandexcloud.net/acp-assets/templates/hero.png",
                        fit: "cover",
                        swatchRef: "hero-bg",
                    },
                },
                canvasWidth: 480,
                canvasHeight: 360,
            },
        );

        expect(pack.layers).toEqual([layer]);
        expect(pack.palette).toEqual(palette);
        expect(pack.artboardProps?.backgroundImage).toMatchObject({ swatchRef: "hero-bg" });
        expect(pack.baseWidth).toBe(480);
        expect(pack.baseHeight).toBe(360);
    });

    it("preserves an edited default master format instead of dropping id=master", () => {
        const layer: RectangleLayer = {
            id: "rect-1",
            type: "rectangle",
            name: "Edited default",
            x: 0,
            y: 0,
            width: 120,
            height: 80,
            rotation: 0,
            visible: true,
            locked: false,
            fill: "#FFCC00",
            stroke: "",
            strokeWidth: 0,
            cornerRadius: 0,
        };
        const resizes: ResizeFormat[] = [
            {
                id: "master",
                name: "Основной формат",
                width: 540,
                height: 225,
                label: "540 × 225",
                instancesEnabled: false,
                isMaster: true,
            },
        ];

        const pack = serializeTemplate(
            { name: "Default Format Template" },
            [],
            resizes,
            [],
            [layer],
            {
                canvasWidth: 540,
                canvasHeight: 225,
            },
        );

        expect(pack.resizes).toHaveLength(1);
        expect(pack.resizes[0]).toMatchObject({
            id: "master",
            name: "Основной формат",
            width: 540,
            height: 225,
            isMaster: true,
        });
        expect(pack.resizes[0]?.layerSnapshot).toEqual([layer]);
    });
});
