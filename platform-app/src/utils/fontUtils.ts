/**
 * Font Utilities — Template Font Embedding
 *
 * Figma-like missing font detection for templates.
 * Extracts required fonts on save, detects missing fonts on load,
 * and applies font replacements.
 */

import type { Layer, TextLayer, FrameLayer } from "@/types";
import { PREINSTALLED_FONT_FAMILIES } from "@/config/preinstalledFonts";
import { getUserFonts } from "@/lib/customFonts";

// ─── Types ──────────────────────────────────────────────

export interface RequiredFont {
    /** Font family name, e.g. "YS Display" */
    family: string;
    /** Weights used in the template, e.g. ["400", "700"] */
    weights: string[];
    /** IDs of layers using this font (for context in the modal) */
    usedInLayers: string[];
}

// ─── System fonts available in all browsers ─────────────

const SYSTEM_FONTS = [
    "Inter", "Roboto", "Open Sans", "Montserrat",
    "PT Sans", "Outfit", "Arial", "Georgia",
    "Helvetica", "Times New Roman", "Courier New",
    "Verdana", "Trebuchet MS", "Palatino",
    "Garamond", "Comic Sans MS", "Impact",
    "sans-serif", "serif", "monospace",
];

// ─── Extract Required Fonts ─────────────────────────────

/**
 * Recursively walks all layers (including frame children) and
 * collects unique fontFamily + fontWeight pairs from text layers.
 */
export function extractRequiredFonts(layers: Layer[]): RequiredFont[] {
    const fontMap = new Map<string, { weights: Set<string>; layerIds: Set<string> }>();

    function visitLayer(layer: Layer) {
        if (layer.type === "text") {
            const textLayer = layer as TextLayer;
            const family = textLayer.fontFamily;
            if (!family) return;

            if (!fontMap.has(family)) {
                fontMap.set(family, { weights: new Set(), layerIds: new Set() });
            }
            const entry = fontMap.get(family)!;
            entry.weights.add(textLayer.fontWeight || "400");
            entry.layerIds.add(layer.id);
        }

        // Recurse into frame children
        if (layer.type === "frame") {
            const frame = layer as FrameLayer;
            for (const childId of frame.childIds) {
                const child = layers.find(l => l.id === childId);
                if (child) visitLayer(child);
            }
        }
    }

    for (const layer of layers) {
        visitLayer(layer);
    }

    return Array.from(fontMap.entries()).map(([family, data]) => ({
        family,
        weights: Array.from(data.weights).sort(),
        usedInLayers: Array.from(data.layerIds),
    }));
}

// ─── Get Available Font Families ────────────────────────

/**
 * Returns list of all font families available in the current browser context:
 * preinstalled (from public/fonts), system, and user-uploaded (from IndexedDB).
 */
export async function getAvailableFontFamilies(): Promise<string[]> {
    const families = new Set<string>([
        ...SYSTEM_FONTS,
        ...PREINSTALLED_FONT_FAMILIES,
    ]);

    // Add user-uploaded fonts from IndexedDB
    try {
        const userFonts = await getUserFonts();
        for (const f of userFonts) {
            families.add(f.name);
        }
    } catch (e) {
        console.warn("Failed to load user fonts for availability check:", e);
    }

    // Also scan document.fonts for any runtime-loaded fonts
    if (typeof document !== "undefined" && "fonts" in document) {
        document.fonts.forEach((font) => {
            const name = font.family.replace(/['"]/g, "");
            families.add(name);
        });
    }

    return Array.from(families).sort();
}

/**
 * Synchronous version using only statically known fonts.
 * For cases where async isn't possible.
 */
export function getAvailableFontFamiliesSync(): string[] {
    const families = new Set<string>([
        ...SYSTEM_FONTS,
        ...PREINSTALLED_FONT_FAMILIES,
    ]);

    if (typeof document !== "undefined" && "fonts" in document) {
        document.fonts.forEach((font) => {
            const name = font.family.replace(/['"]/g, "");
            families.add(name);
        });
    }

    return Array.from(families).sort();
}

// ─── Find Missing Fonts ─────────────────────────────────

/**
 * Compares required fonts against available fonts.
 * Returns only those that are NOT available locally.
 */
export function findMissingFonts(
    required: RequiredFont[],
    available: string[]
): RequiredFont[] {
    const availableSet = new Set(available.map(f => f.toLowerCase()));

    return required.filter(
        rf => !availableSet.has(rf.family.toLowerCase())
    );
}

// ─── Apply Font Replacements ────────────────────────────

/**
 * Replace fontFamily in all text layers according to the replacement map.
 * Returns a new array with updated layers (non-destructive).
 *
 * @param layers - flat layers array
 * @param replacementMap - old fontFamily → new fontFamily
 */
export function applyFontReplacements(
    layers: Layer[],
    replacementMap: Record<string, string>
): Layer[] {
    if (Object.keys(replacementMap).length === 0) return layers;

    return layers.map(layer => {
        if (layer.type !== "text") return layer;

        const textLayer = layer as TextLayer;
        const replacement = replacementMap[textLayer.fontFamily];
        if (!replacement) return layer;

        return {
            ...textLayer,
            fontFamily: replacement,
        } as Layer;
    });
}
