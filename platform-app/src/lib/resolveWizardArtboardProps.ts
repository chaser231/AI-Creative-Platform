import type {
    ArtboardBackgroundImage,
    BackgroundSwatchValue,
    Paint,
    Swatch,
    TemplatePalette,
} from "@/types";
import { DEFAULT_PALETTE } from "@/types";
import type { TemplatePackV2 } from "@/services/templateService";
import { DEFAULT_ARTBOARD_PROPS, type ArtboardProps } from "@/store/canvas/types";
import { isPaint } from "@/utils/paint";

function findSwatch(palette: TemplatePalette, id: string): Swatch | undefined {
    return palette.colors.find((swatch) => swatch.id === id)
        ?? palette.backgrounds.find((swatch) => swatch.id === id);
}

function resolvePaintFromSwatch(swatch: Swatch): Paint | undefined {
    if (swatch.type === "color" && isPaint(swatch.value)) {
        return swatch.value;
    }
    if (swatch.type === "background" && typeof swatch.value === "object") {
        const value = swatch.value as BackgroundSwatchValue;
        if (value.kind === "solid") return value.color;
        if (value.kind === "gradient") return value.paint;
    }
    return undefined;
}

function bgImageFromSwatch(
    swatch: Swatch,
    existing: ArtboardBackgroundImage | undefined,
): ArtboardBackgroundImage | undefined {
    if (swatch.type !== "background" || typeof swatch.value !== "object") return undefined;
    const value = swatch.value as BackgroundSwatchValue;
    if (value.kind !== "image") return undefined;
    return {
        src: value.src,
        fit: value.fit,
        focusX: value.focusX,
        focusY: value.focusY,
        opacity: existing?.opacity ?? 1,
        swatchRef: swatch.id,
    };
}

/**
 * Merges template artboard props with defaults and resolves palette swatch refs.
 */
export function resolveWizardArtboardProps(
    template: Pick<TemplatePackV2, "artboardProps" | "palette">,
): ArtboardProps {
    const palette = template.palette ?? DEFAULT_PALETTE;
    const raw = {
        ...DEFAULT_ARTBOARD_PROPS,
        ...(template.artboardProps as Partial<ArtboardProps> | undefined),
    };

    let fill = raw.fill;
    if (raw.fillSwatchRef) {
        const swatch = findSwatch(palette, raw.fillSwatchRef);
        const paint = swatch ? resolvePaintFromSwatch(swatch) : undefined;
        if (paint !== undefined) fill = paint;
    }

    let backgroundImage = raw.backgroundImage;
    if (backgroundImage?.swatchRef) {
        const swatch = findSwatch(palette, backgroundImage.swatchRef);
        if (swatch) {
            const bg = bgImageFromSwatch(swatch, backgroundImage);
            if (bg) backgroundImage = bg;
        }
    }

    return { ...raw, fill, backgroundImage };
}

/** Applies a palette background swatch to artboard props (wizard-local, no store). */
export function applyBackgroundSwatchToArtboardProps(
    current: ArtboardProps,
    palette: TemplatePalette,
    swatchId: string,
): ArtboardProps {
    const swatch = palette.backgrounds.find((candidate) => candidate.id === swatchId);
    if (!swatch || swatch.type !== "background" || typeof swatch.value !== "object") {
        return current;
    }

    const value = swatch.value as BackgroundSwatchValue;
    if (value.kind === "solid") {
        return {
            ...current,
            fill: value.color,
            fillSwatchRef: swatch.id,
            backgroundImage: undefined,
        };
    }
    if (value.kind === "gradient") {
        return {
            ...current,
            fill: value.paint,
            fillSwatchRef: swatch.id,
            backgroundImage: undefined,
        };
    }
    const bg: ArtboardBackgroundImage = {
        src: value.src,
        fit: value.fit,
        focusX: value.focusX,
        focusY: value.focusY,
        opacity: current.backgroundImage?.opacity ?? 1,
        swatchRef: swatch.id,
    };
    return { ...current, backgroundImage: bg };
}
