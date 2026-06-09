import { PREINSTALLED_FONT_MANIFEST } from "@/config/preinstalledFontManifest";

/**
 * Resolve preinstalled TTF files in /public/fonts by family + weight + style.
 * Uses the generated manifest so export outlining does not depend on reading
 * @font-face rules from CSS (which can fail silently).
 */

const WEIGHT_CANDIDATES: Array<{ weight: number; regular: string; italic: string }> = [
    { weight: 100, regular: "Thin", italic: "Thin Italic" },
    { weight: 200, regular: "ExtraLight", italic: "ExtraLight Italic" },
    { weight: 300, regular: "Light", italic: "Light Italic" },
    { weight: 400, regular: "Regular", italic: "Italic" },
    { weight: 500, regular: "Medium", italic: "Medium Italic" },
    { weight: 600, regular: "Semibold", italic: "Semibold Italic" },
    { weight: 700, regular: "Bold", italic: "Bold Italic" },
    { weight: 800, regular: "Heavy", italic: "Heavy Italic" },
    { weight: 900, regular: "Black", italic: "Black Italic" },
];

function fontFileUrl(filename: string): string {
    return `/fonts/${encodeURIComponent(filename)}`;
}

/** Build candidate filenames ordered by closest weight match. */
export function preinstalledFontCandidates(
    family: string,
    weight: number,
    italic: boolean,
): string[] {
    const sorted = [...WEIGHT_CANDIDATES].sort(
        (a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight),
    );
    const names: string[] = [];
    for (const entry of sorted) {
        const suffix = italic ? entry.italic : entry.regular;
        names.push(`${family}-${suffix}.ttf`);
        // Some families use "Bd"/"Rg" abbreviations.
        if (suffix === "Bold") names.push(`${family}-Bd.ttf`);
        if (suffix === "Regular") names.push(`${family}-Rg.ttf`);
    }
    return [...new Set(names)];
}

/** Pick the closest manifest entry for family/weight/style. */
export function resolveManifestFontFile(
    family: string,
    weight: number,
    italic: boolean,
): string | null {
    const target = family.trim().toLowerCase();
    const pool = PREINSTALLED_FONT_MANIFEST.filter(
        (e) => e.family.trim().toLowerCase() === target && e.italic === italic,
    );
    const candidates = pool.length > 0 ? pool : PREINSTALLED_FONT_MANIFEST.filter(
        (e) => e.family.trim().toLowerCase() === target,
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight));
    return candidates[0].file;
}

/** Return the URL for the closest manifest font file, or null. */
export async function resolvePreinstalledFontUrl(
    family: string,
    weight: number,
    italic: boolean,
): Promise<string | null> {
    const manifestFile = resolveManifestFontFile(family, weight, italic);
    if (manifestFile) return fontFileUrl(manifestFile);

    for (const filename of preinstalledFontCandidates(family, weight, italic)) {
        const url = fontFileUrl(filename);
        try {
            const res = await fetch(url);
            if (res.ok) return url;
        } catch {
            // try next candidate
        }
    }
    return null;
}
