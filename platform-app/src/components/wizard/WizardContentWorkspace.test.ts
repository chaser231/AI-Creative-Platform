import { describe, expect, it } from "vitest";

import {
    buildDraftPreviewLayers,
    getPackOutpaintFormatsFromPreviewSources,
    getEditableLayerEntries,
    getPreviewFormatSources,
    inferOutpaintProductFocusX,
    resolveWizardOutpaintLayoutPlan,
    type EditableLayerEntry,
} from "./WizardContentWorkspace";
import type { Layer, LayerBinding } from "@/types";
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
    it("creates separate editable entries for duplicated text and image slots", () => {
        const layers = [
            {
                id: "cta-primary",
                type: "text",
                name: "CTA primary",
                slotId: "cta",
                text: "Old primary",
            },
            {
                id: "cta-secondary",
                type: "text",
                name: "CTA secondary",
                slotId: "cta",
                text: "Old secondary",
            },
            {
                id: "hero-photo",
                type: "image",
                name: "Hero photo",
                slotId: "image-primary",
                src: "hero.png",
            },
            {
                id: "detail-photo",
                type: "image",
                name: "Detail photo",
                slotId: "image-primary",
                src: "detail.png",
            },
        ] as unknown as Layer[];
        const template = {
            id: "duplicate-slots",
            name: "Duplicate slots",
            baseWidth: 1080,
            baseHeight: 1080,
            masterComponents: [],
            resizes: [],
        } as unknown as TemplatePackV2;

        const result = getEditableLayerEntries(template, layers);

        expect(result.map((entry) => entry.id)).toEqual([
            "cta-primary",
            "cta-secondary",
            "hero-photo",
            "detail-photo",
        ]);
        expect(result.filter((entry) => entry.type === "text").map((entry) => entry.slotOccurrence)).toEqual([0, 1]);
        expect(result.filter((entry) => entry.type === "image").map((entry) => entry.slotOccurrence)).toEqual([0, 1]);
    });

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

    it("applies independent drafts to layers that share the same slot", () => {
        const layers = [
            {
                id: "cta-primary",
                type: "text",
                name: "CTA primary",
                slotId: "cta",
                text: "Old primary",
                width: 160,
                height: 32,
            },
            {
                id: "cta-secondary",
                type: "text",
                name: "CTA secondary",
                slotId: "cta",
                text: "Old secondary",
                width: 160,
                height: 32,
            },
            {
                id: "hero-photo",
                type: "image",
                name: "Hero photo",
                slotId: "image-primary",
                src: "old-hero.png",
                width: 300,
                height: 200,
            },
            {
                id: "detail-photo",
                type: "image",
                name: "Detail photo",
                slotId: "image-primary",
                src: "old-detail.png",
                width: 300,
                height: 200,
            },
        ] as unknown as Layer[];
        const duplicateEntries = getEditableLayerEntries(
            {
                id: "duplicate-slots",
                name: "Duplicate slots",
                baseWidth: 1080,
                baseHeight: 1080,
                masterComponents: [],
                resizes: [],
            } as unknown as TemplatePackV2,
            layers,
        );

        const result = buildDraftPreviewLayers(
            layers,
            duplicateEntries,
            {
                "cta-primary": "Buy now",
                "cta-secondary": "Learn more",
            },
            {
                "hero-photo": "new-hero.png",
                "detail-photo": "new-detail.png",
            },
        );

        expect(result[0]).toMatchObject({ text: "Buy now" });
        expect(result[1]).toMatchObject({ text: "Learn more" });
        expect(result[2]).toMatchObject({ src: "new-hero.png" });
        expect(result[3]).toMatchObject({ src: "new-detail.png" });
    });

    it("matches duplicated slots in resize snapshots through masterId and layer bindings", () => {
        const masterLayers = [
            {
                id: "master-cta-primary",
                type: "text",
                name: "CTA primary",
                slotId: "cta",
                text: "Old primary",
                width: 160,
                height: 32,
            },
            {
                id: "master-cta-secondary",
                type: "text",
                name: "CTA secondary",
                slotId: "cta",
                text: "Old secondary",
                width: 160,
                height: 32,
            },
        ] as unknown as Layer[];
        const duplicateEntries = getEditableLayerEntries(
            {
                id: "duplicate-slots",
                name: "Duplicate slots",
                baseWidth: 1080,
                baseHeight: 1080,
                masterComponents: [],
                resizes: [],
            } as unknown as TemplatePackV2,
            masterLayers,
        );
        const resizeLayers = [
            {
                id: "resize-cta-primary",
                type: "text",
                name: "CTA primary",
                slotId: "cta",
                masterId: "master-cta-primary",
                text: "Old primary",
                width: 140,
                height: 28,
            },
            {
                id: "resize-cta-secondary",
                type: "text",
                name: "CTA secondary",
                slotId: "cta",
                text: "Old secondary",
                width: 140,
                height: 28,
            },
        ] as unknown as Layer[];
        const bindings = [
            {
                masterLayerId: "master-cta-secondary",
                targetLayerId: "resize-cta-secondary",
                syncContent: true,
                syncStyle: true,
                syncSize: false,
                syncPosition: false,
            },
        ] as LayerBinding[];

        const result = buildDraftPreviewLayers(
            resizeLayers,
            duplicateEntries,
            {
                "master-cta-primary": "Primary CTA",
                "master-cta-secondary": "Secondary CTA",
            },
            {},
            {},
            {},
            undefined,
            bindings,
        );

        expect(result[0]).toMatchObject({ text: "Primary CTA" });
        expect(result[1]).toMatchObject({ text: "Secondary CTA" });
    });

    it("keeps unique-slot fallback for legacy snapshots without ids or bindings", () => {
        const result = buildDraftPreviewLayers(
            [
                {
                    id: "resize-headline",
                    type: "text",
                    name: "Headline",
                    slotId: "headline",
                    text: "Old headline",
                    width: 200,
                    height: 40,
                },
            ] as unknown as Layer[],
            [
                {
                    id: "headline-entry",
                    type: "text",
                    name: "Headline",
                    slotId: "headline",
                    layerId: "master-headline",
                    source: "layer",
                    props: {},
                },
            ],
            { "headline-entry": "Fallback headline" },
            {},
        );

        expect(result[0]).toMatchObject({ text: "Fallback headline" });
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
