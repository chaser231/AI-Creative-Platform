/**
 * Weight-aware font loading.
 *
 * `document.fonts.ready` only guarantees that the @font-face rules known at
 * load time finished — it says nothing about whether the SPECIFIC weight a text
 * layer uses is resolvable. Measuring with a fallback weight (e.g. a 400 file
 * standing in for a missing 700) produces wrong glyph advances, which then get
 * persisted as geometry. These helpers load/verify fonts per (family, weight)
 * so measurement always runs against the real face.
 */

import type { RequiredFont } from "@/utils/fontUtils";
import { registerFont, parseNumericFontWeight } from "@/lib/customFonts";
import { resolvePreinstalledFontUrl } from "@/services/preinstalledFontResolver";
import { clearTextMeasureCache } from "@/utils/layoutEngine";

/** A specific weight of a family, e.g. `{ family: "YS Display", weight: "700" }`. */
export interface FontWeightRef {
    family: string;
    weight: string;
}

function fontsApi(): FontFaceSet | null {
    if (typeof document === "undefined" || !("fonts" in document)) return null;
    return document.fonts;
}

/** CSS `font` shorthand used for `document.fonts.load`/`check` of one weight. */
function fontSpec(family: string, numericWeight: number): string {
    return `${numericWeight} 16px "${family}"`;
}

function isWeightAvailable(fonts: FontFaceSet, family: string, numericWeight: number): boolean {
    try {
        return fonts.check(fontSpec(family, numericWeight));
    } catch {
        // `check` throws on a malformed spec; treat as "not available" so we try
        // to load it explicitly below.
        return false;
    }
}

/**
 * Ensure a single (family, weight) is resolvable. Strategy, cheapest first:
 *   1. already available → done;
 *   2. `document.fonts.load` whatever @font-face / FontFace is already declared;
 *   3. preinstalled families: resolve the concrete weight file and register a
 *      FontFace with an explicit weight descriptor, then load it.
 */
async function ensureSingleFontWeight(family: string, weight: string): Promise<void> {
    const fonts = fontsApi();
    if (!fonts || !family) return;

    const numericWeight = parseNumericFontWeight(weight);
    const spec = fontSpec(family, numericWeight);

    if (isWeightAvailable(fonts, family, numericWeight)) return;

    try {
        await fonts.load(spec);
        if (isWeightAvailable(fonts, family, numericWeight)) return;
    } catch {
        /* ignore — try the preinstalled fallback */
    }

    try {
        const url = await resolvePreinstalledFontUrl(family, numericWeight, false);
        if (url) {
            await registerFont(family, url, { weight: numericWeight });
            await fonts.load(spec).catch(() => undefined);
        }
    } catch {
        /* best effort — measurement will fall back to the closest face */
    }
}

/**
 * Load every (family, weight) used by the given layers' required fonts before
 * measurement. Best-effort: never throws, resolves once all attempts settle.
 */
export async function ensureFontWeightsLoaded(required: RequiredFont[]): Promise<void> {
    if (!fontsApi() || required.length === 0) return;

    await Promise.all(
        required.flatMap((rf) => {
            const weights = rf.weights.length > 0 ? rf.weights : ["400"];
            return weights.map((weight) => ensureSingleFontWeight(rf.family, weight));
        }),
    );
}

/**
 * Weight-aware counterpart to `findMissingFonts`: returns the (family, weight)
 * pairs that are still NOT resolvable after loading (e.g. a family is present
 * but the requested weight is not). Empty when running without a font API.
 */
export function findMissingFontWeights(required: RequiredFont[]): FontWeightRef[] {
    const fonts = fontsApi();
    if (!fonts) return [];

    const missing: FontWeightRef[] = [];
    for (const rf of required) {
        const weights = rf.weights.length > 0 ? rf.weights : ["400"];
        for (const weight of weights) {
            const numericWeight = parseNumericFontWeight(weight);
            if (!isWeightAvailable(fonts, rf.family, numericWeight)) {
                missing.push({ family: rf.family, weight });
            }
        }
    }
    return missing;
}

/**
 * Shared UI helper: wait for one (family, weight) to load, then drop stale
 * fallback measurements so the text box sizes to the real glyphs on the first
 * interaction. Used by every place that changes a layer's family or weight.
 */
export async function ensureFontLoaded(family: string, weight?: string | number): Promise<void> {
    const fonts = fontsApi();
    if (fonts) {
        const numericWeight = parseNumericFontWeight(weight);
        try {
            await fonts.load(fontSpec(family, numericWeight));
        } catch {
            /* ignore — fall back to whatever is available */
        }
    }
    clearTextMeasureCache();
}
