import { describe, expect, it } from "vitest";

import { buildDraftPreviewLayers, type EditableLayerEntry } from "./WizardContentWorkspace";
import type { Layer } from "@/types";

const entries: EditableLayerEntry[] = [
    {
        id: "headline-entry",
        type: "text",
        name: "Заголовок",
        slotId: "headline",
        layerId: "headline-layer",
        source: "layer",
        props: {},
    },
    {
        id: "photo-entry",
        type: "image",
        name: "Фото",
        slotId: "photo",
        layerId: "photo-layer",
        source: "layer",
        props: {},
    },
    {
        id: "badge-entry",
        type: "badge",
        name: "Бейдж",
        slotId: "badge",
        layerId: "badge-layer",
        source: "layer",
        props: {},
    },
];

describe("buildDraftPreviewLayers", () => {
    it("applies text and badge color drafts", () => {
        const layers = [
            {
                id: "headline-layer",
                type: "text",
                slotId: "headline",
                text: "Old",
                fill: "#111111",
                width: 200,
                height: 40,
            },
            {
                id: "badge-layer",
                type: "badge",
                slotId: "badge",
                label: "Old badge",
                textColor: "#222222",
                width: 100,
                height: 32,
            },
        ] as unknown as Layer[];

        const result = buildDraftPreviewLayers(
            layers,
            entries,
            { "headline-entry": "New", "badge-entry": "New badge" },
            {},
            {},
            {
                "headline-entry": { fill: "#ffffff" },
                "badge-entry": { textColor: "#000000" },
            },
        );

        expect(result[0]).toMatchObject({ text: "New", fill: "#ffffff" });
        expect(result[1]).toMatchObject({ label: "New badge", textColor: "#000000" });
    });

    it("applies image focus drafts and geometry override together", () => {
        const layers = [
            {
                id: "photo-layer",
                type: "image",
                slotId: "photo",
                src: "old.png",
                objectFit: "cover",
                focusX: 0.5,
                width: 300,
                height: 100,
                x: 10,
                y: 20,
            },
        ] as unknown as Layer[];

        const result = buildDraftPreviewLayers(
            layers,
            entries,
            {},
            { "photo-entry": "new.png" },
            { "photo-entry": { objectFit: "cover", focusX: 0, focusY: 0.5 } },
            {},
            {
                "photo-entry": {
                    prev: { x: 10, y: 20, width: 300, height: 100 },
                    next: { x: -20, y: 20, width: 360, height: 100 },
                    slotId: "photo",
                },
            },
        );

        expect(result[0]).toMatchObject({
            src: "new.png",
            objectFit: "cover",
            focusX: 0,
            focusY: 0.5,
            x: -20,
            width: 360,
        });
    });
});
