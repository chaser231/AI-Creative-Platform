import { describe, expect, it } from "vitest";

import {
    applyBackgroundSwatchToArtboardProps,
    applyWizardArtboardPropsToPack,
    buildWizardArtboardPropsByFormatId,
    resolveWizardArtboardProps,
} from "@/lib/resolveWizardArtboardProps";
import type { TemplatePackV2 } from "@/services/templateService";
import { DEFAULT_ARTBOARD_PROPS, type ArtboardProps } from "@/store/canvas/types";

const baseTemplate = {
    artboardProps: undefined,
    palette: { colors: [], backgrounds: [] },
} satisfies Pick<TemplatePackV2, "artboardProps" | "palette">;

describe("resolveWizardArtboardProps", () => {
    it("uses defaults when template has no artboard props", () => {
        expect(resolveWizardArtboardProps(baseTemplate)).toEqual(DEFAULT_ARTBOARD_PROPS);
    });

    it("preserves plain fill color", () => {
        const result = resolveWizardArtboardProps({
            ...baseTemplate,
            artboardProps: { fill: "#312A46" },
        });
        expect(result.fill).toBe("#312A46");
    });

    it("resolves fillSwatchRef from color swatch", () => {
        const result = resolveWizardArtboardProps({
            artboardProps: { fill: "#FFFFFF", fillSwatchRef: "brand" },
            palette: {
                colors: [{ id: "brand", type: "color", name: "Brand", value: "#312A46" }],
                backgrounds: [],
            },
        });
        expect(result.fill).toBe("#312A46");
    });

    it("resolves fillSwatchRef from background solid swatch", () => {
        const result = resolveWizardArtboardProps({
            artboardProps: { fillSwatchRef: "bg-solid" },
            palette: {
                colors: [],
                backgrounds: [{
                    id: "bg-solid",
                    type: "background",
                    name: "Solid",
                    value: { kind: "solid", color: "#112233" },
                }],
            },
        });
        expect(result.fill).toBe("#112233");
    });

    it("resolves backgroundImage.swatchRef from image swatch", () => {
        const result = resolveWizardArtboardProps({
            artboardProps: {
                backgroundImage: { src: "", fit: "cover", swatchRef: "hero-bg" },
            },
            palette: {
                colors: [],
                backgrounds: [{
                    id: "hero-bg",
                    type: "background",
                    name: "Hero",
                    value: {
                        kind: "image",
                        src: "https://example.com/hero.png",
                        fit: "cover",
                    },
                }],
            },
        });
        expect(result.backgroundImage?.src).toBe("https://example.com/hero.png");
        expect(result.backgroundImage?.swatchRef).toBe("hero-bg");
    });
});

describe("buildWizardArtboardPropsByFormatId", () => {
    it("builds per-format props from template resizes", () => {
        const byFormat = buildWizardArtboardPropsByFormatId({
            artboardProps: { cornerRadius: 8 },
            palette: { colors: [], backgrounds: [] },
            resizes: [
                { id: "master", name: "Master", width: 1080, height: 1080, label: "M", instancesEnabled: false, isMaster: true },
                {
                    id: "story",
                    name: "Story",
                    width: 1080,
                    height: 1920,
                    label: "S",
                    instancesEnabled: true,
                    artboardProps: { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 24 },
                },
            ],
        });
        expect(byFormat.master?.cornerRadius).toBe(8);
        expect(byFormat.story?.cornerRadius).toBe(24);
    });
});

describe("applyWizardArtboardPropsToPack", () => {
    it("writes per-format props and master mirror on pack", () => {
        const pack = applyWizardArtboardPropsToPack(
            {
                id: "pack",
                name: "Pack",
                artboardProps: { cornerRadius: 0 },
                palette: { colors: [], backgrounds: [] },
                resizes: [
                    { id: "master", name: "Master", width: 1080, height: 1080, label: "M", instancesEnabled: false, isMaster: true },
                    { id: "banner", name: "Banner", width: 970, height: 250, label: "B", instancesEnabled: true },
                ],
            } as unknown as TemplatePackV2,
            {
                master: { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 4 },
                banner: { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 16 },
            },
        );
        expect(pack.resizes?.find((r) => r.id === "banner")?.artboardProps?.cornerRadius).toBe(16);
        expect((pack.artboardProps as ArtboardProps | undefined)?.cornerRadius).toBe(4);
    });
});

describe("applyBackgroundSwatchToArtboardProps", () => {
    it("applies image background swatch", () => {
        const next = applyBackgroundSwatchToArtboardProps(
            DEFAULT_ARTBOARD_PROPS,
            {
                colors: [],
                backgrounds: [{
                    id: "img",
                    type: "background",
                    name: "Img",
                    value: { kind: "image", src: "https://example.com/bg.jpg", fit: "contain" },
                }],
            },
            "img",
        );
        expect(next.backgroundImage?.src).toBe("https://example.com/bg.jpg");
        expect(next.backgroundImage?.fit).toBe("contain");
    });
});
