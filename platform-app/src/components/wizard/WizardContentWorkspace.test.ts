import { describe, expect, it } from "vitest";

import {
    buildDraftPreviewLayers,
    getPackOutpaintFormatsFromPreviewSources,
    getPreviewFormatSources,
    inferOutpaintProductFocusX,
    resolveWizardOutpaintLayoutPlan,
    type EditableLayerEntry,
} from "./WizardContentWorkspace";
import type { Layer } from "@/types";
import type { TemplatePackV2 } from "@/services/templateService";

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

describe("wizard selected-format preview sources", () => {
    it("keeps hidden master formats in the outpaint plan even when the rail hides them", () => {
        const masterLayer = {
            id: "master-image",
            type: "image",
            name: "Master image",
            slotId: "photo",
            x: 0,
            y: 0,
            width: 1192,
            height: 300,
            rotation: 0,
            visible: true,
            locked: false,
            src: "master.png",
        } as unknown as Layer;
        const verticalLayer = {
            ...masterLayer,
            id: "vertical-image",
            masterId: "master-image",
            width: 470,
            height: 762,
        } as unknown as Layer;
        const template = {
            id: "pack__wizard_selection",
            name: "Selected pack",
            baseWidth: 1192,
            baseHeight: 300,
            masterComponents: [],
            resizes: [
                {
                    id: "master",
                    name: "Master",
                    width: 1192,
                    height: 300,
                    _wizardHidden: true,
                    layerSnapshot: [masterLayer],
                },
                {
                    id: "vertical",
                    name: "Vertical",
                    width: 470,
                    height: 762,
                    layerSnapshot: [verticalLayer],
                },
            ],
            _wizardSelectedOnly: true,
        } as unknown as TemplatePackV2;

        const previewSources = getPreviewFormatSources(template);
        expect(previewSources.map((format) => [format.id, format.hidden])).toEqual([
            ["master", true],
            ["vertical", undefined],
        ]);
        expect(previewSources.filter((format) => !format.hidden).map((format) => format.id)).toEqual(["vertical"]);

        const outpaintFormats = getPackOutpaintFormatsFromPreviewSources(previewSources);
        expect(outpaintFormats.map((format) => format.id)).toEqual(["master", "vertical"]);
        expect(outpaintFormats[0]).toMatchObject({
            id: "master",
            isMaster: true,
            width: 1192,
            height: 300,
        });
    });

    it("preserves pack-fill master semantics for selected-only packs without explicit isMaster", () => {
        const masterLayer = {
            id: "master-image",
            type: "image",
            name: "Master image",
            slotId: "photo",
            x: 0,
            y: 0,
            width: 1192,
            height: 300,
            rotation: 0,
            visible: true,
            locked: false,
            src: "master.png",
        } as unknown as Layer;
        const template = {
            id: "pack__wizard_selection",
            name: "Selected pack",
            baseWidth: 1192,
            baseHeight: 300,
            masterComponents: [],
            resizes: [
                {
                    id: "landing",
                    name: "Landing Header",
                    width: 1192,
                    height: 300,
                    layerSnapshot: [masterLayer],
                },
            ],
            _wizardSelectedOnly: true,
        } as unknown as TemplatePackV2;

        const previewSources = getPreviewFormatSources(template);
        expect(previewSources).toHaveLength(1);
        expect(previewSources[0]).toMatchObject({
            id: "landing",
            isMaster: true,
            hidden: undefined,
        });
    });
});

describe("resolveWizardOutpaintLayoutPlan", () => {
    it("defaults to the current padding planner", () => {
        expect(resolveWizardOutpaintLayoutPlan(undefined, undefined)).toBe("padding");
        expect(resolveWizardOutpaintLayoutPlan("unknown", null)).toBe("padding");
    });

    it("enables grid-union from env and lets localStorage override it", () => {
        expect(resolveWizardOutpaintLayoutPlan("grid-union", null)).toBe("grid-union");
        expect(resolveWizardOutpaintLayoutPlan("grid-union", "padding")).toBe("padding");
        expect(resolveWizardOutpaintLayoutPlan(undefined, "grid-union")).toBe("grid-union");
    });
});

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

describe("inferOutpaintProductFocusX", () => {
    it("shifts focus toward the product side when foreground content anchors left", () => {
        const layers = [
            {
                id: "main-image",
                type: "image",
                slotId: "photo",
                x: 0,
                y: 0,
                width: 1192,
                height: 300,
                src: "burger.png",
            },
            {
                id: "headline",
                type: "text",
                x: 120,
                y: 120,
                width: 420,
                height: 64,
                text: "Sale",
                fontSize: 48,
            },
            {
                id: "logo",
                type: "image",
                name: "Логотип",
                isFixedAsset: true,
                x: 140,
                y: 60,
                width: 180,
                height: 60,
                src: "logo.png",
            },
        ] as unknown as Layer[];

        expect(
            inferOutpaintProductFocusX(
                layers,
                { id: "main-image", slotId: "photo" },
                { width: 1192, height: 300 },
                0.5,
            ),
        ).toBeCloseTo(0.88);
    });

    it("keeps explicit non-center user focus stronger than layout inference", () => {
        const layers = [
            {
                id: "main-image",
                type: "image",
                slotId: "photo",
                x: 0,
                y: 0,
                width: 1192,
                height: 300,
                src: "burger.png",
            },
            {
                id: "headline",
                type: "text",
                x: 120,
                y: 120,
                width: 420,
                height: 64,
                text: "Sale",
                fontSize: 48,
            },
        ] as unknown as Layer[];

        expect(
            inferOutpaintProductFocusX(
                layers,
                { id: "main-image", slotId: "photo" },
                { width: 1192, height: 300 },
                1,
            ),
        ).toBe(1);
    });
});
