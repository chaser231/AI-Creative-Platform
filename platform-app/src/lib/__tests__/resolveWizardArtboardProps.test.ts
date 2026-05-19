import { describe, expect, it } from "vitest";

import {
    applyBackgroundSwatchToArtboardProps,
    resolveWizardArtboardProps,
} from "@/lib/resolveWizardArtboardProps";
import type { TemplatePackV2 } from "@/services/templateService";
import { DEFAULT_ARTBOARD_PROPS } from "@/store/canvas/types";

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
