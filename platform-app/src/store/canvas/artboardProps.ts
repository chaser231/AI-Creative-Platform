import type { ResizeFormat } from "@/types";
import type { ArtboardProps } from "./types";
import { DEFAULT_ARTBOARD_PROPS } from "./types";
import type { CanvasStore } from "./types";
import type { ArtboardBackgroundImage, Paint, Swatch } from "@/types";
import { getMasterResize } from "./resizeFormatUtils";

export function cloneArtboardProps(props: ArtboardProps): ArtboardProps {
    return {
        ...props,
        cornerRadii: props.cornerRadii ? { ...props.cornerRadii } : undefined,
        backgroundImage: props.backgroundImage ? { ...props.backgroundImage } : undefined,
        strokeImage: props.strokeImage ? { ...props.strokeImage } : undefined,
    };
}

export function resolveFormatArtboardProps(
    format: Pick<ResizeFormat, "artboardProps"> | undefined,
    fallback: ArtboardProps = DEFAULT_ARTBOARD_PROPS,
): ArtboardProps {
    const base = { ...DEFAULT_ARTBOARD_PROPS, ...fallback };
    if (!format?.artboardProps) return base;
    return {
        ...base,
        ...format.artboardProps,
        cornerRadii: format.artboardProps.cornerRadii
            ? { ...base.cornerRadii, ...format.artboardProps.cornerRadii }
            : base.cornerRadii,
        backgroundImage: format.artboardProps.backgroundImage
            ? { ...base.backgroundImage, ...format.artboardProps.backgroundImage }
            : format.artboardProps.backgroundImage === undefined
                ? base.backgroundImage
                : undefined,
        strokeImage: format.artboardProps.strokeImage
            ? { ...base.strokeImage, ...format.artboardProps.strokeImage }
            : format.artboardProps.strokeImage === undefined
                ? base.strokeImage
                : undefined,
    };
}

/** Resolve artboard props for a preview/export format source (wizard, templates). */
export function resolvePreviewFormatArtboard(
    format: Pick<ResizeFormat, "artboardProps"> | undefined,
    fallback: ArtboardProps,
): ArtboardProps {
    return resolveFormatArtboardProps(format, fallback);
}

/**
 * Returns a stable object reference for useShallow consumers.
 * Prefer stored format.artboardProps; fall back to top-level artboardProps.
 */
export function selectActiveArtboardProps(state: Pick<CanvasStore, "resizes" | "activeResizeId" | "artboardProps">): ArtboardProps {
    const activeFormat = state.resizes.find((resize) => resize.id === state.activeResizeId);
    if (activeFormat?.artboardProps) return activeFormat.artboardProps;
    return state.artboardProps;
}

export function mergeArtboardPropsPatch(
    current: ArtboardProps,
    updates: Partial<ArtboardProps>,
): ArtboardProps {
    return {
        ...current,
        ...updates,
        fillSwatchRef:
            Object.prototype.hasOwnProperty.call(updates, "fill")
            && !Object.prototype.hasOwnProperty.call(updates, "fillSwatchRef")
                ? undefined
                : updates.fillSwatchRef ?? current.fillSwatchRef,
        cornerRadii: updates.cornerRadii
            ? { ...current.cornerRadii, ...updates.cornerRadii }
            : updates.cornerRadii === undefined
                ? current.cornerRadii
                : undefined,
        backgroundImage: updates.backgroundImage
            ? { ...current.backgroundImage, ...updates.backgroundImage }
            : Object.prototype.hasOwnProperty.call(updates, "backgroundImage")
                ? updates.backgroundImage
                : current.backgroundImage,
        strokeImage: updates.strokeImage
            ? { ...current.strokeImage, ...updates.strokeImage }
            : Object.prototype.hasOwnProperty.call(updates, "strokeImage")
                ? updates.strokeImage
                : current.strokeImage,
    };
}

export function patchActiveFormatArtboardProps(
    resizes: ResizeFormat[],
    activeResizeId: string,
    updates: Partial<ArtboardProps>,
    fallback: ArtboardProps,
): { resizes: ResizeFormat[]; topLevelArtboardProps: ArtboardProps } {
    const activeFormat = resizes.find((resize) => resize.id === activeResizeId);
    if (!activeFormat) {
        if (process.env.NODE_ENV !== "production") {
            console.warn(
                `[artboardProps] patchActiveFormatArtboardProps: activeResizeId "${activeResizeId}" not found in resizes`,
            );
        }
        return {
            resizes,
            topLevelArtboardProps: syncTopLevelArtboardPropsFromMaster(resizes, fallback),
        };
    }

    const current = resolveFormatArtboardProps(activeFormat, fallback);
    const merged = mergeArtboardPropsPatch(current, updates);
    const nextResizes = resizes.map((resize) =>
        resize.id === activeResizeId
            ? { ...resize, artboardProps: merged }
            : resize,
    );

    return {
        resizes: nextResizes,
        topLevelArtboardProps: syncTopLevelArtboardPropsFromMaster(nextResizes, fallback),
    };
}

export function syncTopLevelArtboardPropsFromMaster(
    resizes: ResizeFormat[],
    fallback: ArtboardProps,
): ArtboardProps {
    const master = getMasterResize(resizes);
    if (master?.artboardProps) return master.artboardProps;
    return master ? resolveFormatArtboardProps(master, fallback) : fallback;
}

export function cascadeArtboardPropsForSwatchUpdateWithSwatch(
    resizes: ResizeFormat[],
    fallback: ArtboardProps,
    swatchId: string,
    paint: Paint | undefined,
    updatedSwatch: Swatch,
    bgImageFromSwatch: (
        swatch: Swatch,
        existing: ArtboardBackgroundImage | undefined,
    ) => ArtboardBackgroundImage | undefined,
): ResizeFormat[] {
    return resizes.map((resize) => {
        const resolved = resolveFormatArtboardProps(resize, fallback);
        let next = resolved;
        let changed = false;

        if (paint !== undefined && resolved.fillSwatchRef === swatchId) {
            next = { ...next, fill: paint };
            changed = true;
        }

        if (resolved.backgroundImage?.swatchRef === swatchId) {
            const bg = bgImageFromSwatch(updatedSwatch, resolved.backgroundImage);
            if (bg) {
                next = { ...next, backgroundImage: bg };
                changed = true;
            } else if (updatedSwatch.type === "background" && typeof updatedSwatch.value === "object") {
                next = { ...next, backgroundImage: undefined };
                if (paint !== undefined) {
                    next = { ...next, fill: paint };
                }
                changed = true;
            }
        }

        if (!changed) return resize;
        return { ...resize, artboardProps: next };
    });
}

export function cascadeArtboardPropsForSwatchRemove(
    resizes: ResizeFormat[],
    fallback: ArtboardProps,
    swatchId: string,
    mode: "detach" | "replace",
    replacement?: {
        paint?: Paint;
        fillSwatchRef?: string;
        resolveBgImage?: (
            existing: ArtboardBackgroundImage | undefined,
        ) => ArtboardBackgroundImage | undefined;
    },
): ResizeFormat[] {
    return resizes.map((resize) => {
        const resolved = resolveFormatArtboardProps(resize, fallback);
        let next = resolved;
        let changed = false;

        if (resolved.fillSwatchRef === swatchId) {
            if (mode === "replace" && replacement?.paint) {
                next = {
                    ...next,
                    fill: replacement.paint,
                    fillSwatchRef: replacement.fillSwatchRef,
                };
            } else {
                next = { ...next, fillSwatchRef: undefined };
            }
            changed = true;
        }

        if (resolved.backgroundImage?.swatchRef === swatchId) {
            if (mode === "replace" && replacement?.resolveBgImage) {
                const bg = replacement.resolveBgImage(resolved.backgroundImage);
                next = bg
                    ? { ...next, backgroundImage: bg }
                    : { ...next, backgroundImage: undefined };
            } else if (mode === "replace") {
                next = { ...next, backgroundImage: undefined };
            } else {
                next = {
                    ...next,
                    backgroundImage: { ...resolved.backgroundImage, swatchRef: undefined },
                };
            }
            changed = true;
        }

        if (!changed) return resize;
        return { ...resize, artboardProps: next };
    });
}
