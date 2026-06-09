import type Konva from "konva";
import type * as Ot from "opentype.js";
import type { Layer, TextLayer } from "@/types";
import { resolvePreinstalledFontUrl, resolveManifestFontFile, preinstalledFontCandidates } from "@/services/preinstalledFontResolver";

/**
 * Text outlining for vector export.
 *
 * Converts text layers into resolution-independent vector paths so SVG/EPS
 * exports don't depend on the viewer having the font (and so Cyrillic survives
 * the PostScript pipeline, which can't encode it otherwise). Line breaking,
 * alignment and baseline are read straight from the live Konva node so the
 * outline matches exactly what's on the canvas.
 */

export interface OutlinedText {
    /** Merged SVG path data in layer-local coordinates. */
    d: string;
    fill: string;
}

// ─── opentype.js loading (dynamic, browser-only) ────────

type OpentypeModule = typeof Ot;
let opentypePromise: Promise<OpentypeModule | null> | null = null;

function loadOpentype(): Promise<OpentypeModule | null> {
    if (!opentypePromise) {
        opentypePromise = import("opentype.js")
            .then((mod) => ((mod as unknown as { default?: OpentypeModule }).default ?? (mod as unknown as OpentypeModule)))
            .catch(() => null);
    }
    return opentypePromise;
}

// ─── Font resolution ────────────────────────────────────

const fontCache = new Map<string, Ot.Font | null>();

interface CssFontEntry {
    family: string;
    weight: number;
    italic: boolean;
    url: string;
}
let cssRegistry: CssFontEntry[] | null = null;

function parseWeightToken(token: string | undefined): number {
    if (!token) return 400;
    const t = token.trim().toLowerCase();
    if (t === "bold") return 700;
    if (t === "normal") return 400;
    const num = parseInt(t, 10);
    return Number.isFinite(num) ? num : 400;
}

/** Parse the layer's combined weight/style string (e.g. "700 italic"). */
function parseFontStyle(fontWeight: string | undefined): { weight: number; italic: boolean } {
    const italic = /italic|oblique/i.test(fontWeight ?? "");
    const weightToken = (fontWeight ?? "").replace(/italic|oblique|normal/gi, "").trim();
    return { weight: parseWeightToken(weightToken || fontWeight), italic };
}

function stripFamily(name: string): string {
    return name.replace(/['"]/g, "").trim().toLowerCase();
}

function buildCssRegistry(): CssFontEntry[] {
    if (cssRegistry) return cssRegistry;
    const entries: CssFontEntry[] = [];
    if (typeof document === "undefined") {
        cssRegistry = entries;
        return entries;
    }
    for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList | undefined;
        try {
            rules = sheet.cssRules;
        } catch {
            continue; // cross-origin sheet — not readable
        }
        if (!rules) continue;
        for (const rule of Array.from(rules)) {
            if (rule.constructor.name !== "CSSFontFaceRule" && (rule as CSSRule).type !== 5) continue;
            const style = (rule as CSSFontFaceRule).style;
            const family = stripFamily(style.getPropertyValue("font-family"));
            const src = style.getPropertyValue("src");
            if (!family || !src) continue;
            // Prefer an outline-parseable format (ttf/otf/woff; woff2 is not supported by opentype.js).
            const urlMatch = src.match(/url\(\s*['"]?([^'")]+\.(?:ttf|otf|woff))['"]?\s*\)/i);
            if (!urlMatch) continue;
            entries.push({
                family,
                weight: parseWeightToken(style.getPropertyValue("font-weight")),
                italic: /italic|oblique/i.test(style.getPropertyValue("font-style")),
                url: urlMatch[1],
            });
        }
    }
    cssRegistry = entries;
    return entries;
}

async function fetchFont(opentype: OpentypeModule, url: string): Promise<Ot.Font | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        return opentype.parse(buf);
    } catch {
        return null;
    }
}

async function resolveFont(family: string, weight: number, italic: boolean): Promise<Ot.Font | null> {
    const key = `${family}__${weight}__${italic ? 1 : 0}`;
    if (fontCache.has(key)) return fontCache.get(key) ?? null;

    const opentype = await loadOpentype();
    if (!opentype) {
        fontCache.set(key, null);
        return null;
    }

    const target = stripFamily(family);
    let font: Ot.Font | null = null;

    // 1. Generated manifest (fast, exact filename).
    const manifestFile = resolveManifestFontFile(family, weight, italic);
    if (manifestFile) {
        font = await fetchFont(opentype, `/fonts/${encodeURIComponent(manifestFile)}`);
    }

    // 2. HEAD/GET probe fallback.
    if (!font) {
        const preinstalledUrl = await resolvePreinstalledFontUrl(family, weight, italic);
        if (preinstalledUrl) font = await fetchFont(opentype, preinstalledUrl);
    }

    // 3. @font-face registry from fonts.css (encoded URLs).
    if (!font) {
        const registry = buildCssRegistry().filter((e) => e.family === target);
        if (registry.length > 0) {
            const styleMatches = registry.filter((e) => e.italic === italic);
            const pool = styleMatches.length > 0 ? styleMatches : registry;
            pool.sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight));
            for (const entry of pool) {
                const encoded = entry.url.includes(" ") ? entry.url.split("/").map((p, i, a) =>
                    i === a.length - 1 ? encodeURIComponent(p) : p,
                ).join("/") : entry.url;
                font = await fetchFont(opentype, encoded);
                if (font) break;
            }
        }
    }

    // 4. Brute-force filename candidates (covers registry misses).
    if (!font) {
        for (const filename of preinstalledFontCandidates(family, weight, italic)) {
            font = await fetchFont(opentype, `/fonts/${encodeURIComponent(filename)}`);
            if (font) break;
        }
    }

    // 5. User fonts in IndexedDB.
    if (!font) {
        try {
            const { getUserFonts, normalizeFontFamilyName } = await import("@/lib/customFonts");
            const userFonts = await getUserFonts();
            const match = userFonts.find((f) => stripFamily(normalizeFontFamilyName(f.name)) === target);
            if (match) font = opentype.parse(match.buffer);
        } catch {
            font = null;
        }
    }

    fontCache.set(key, font);
    return font;
}

// ─── Canvas vertical metrics (match Konva exactly) ──────

let measureCanvas: HTMLCanvasElement | null = null;
function measureVMetrics(fontShorthand: string): { ascent: number; descent: number } {
    if (typeof document === "undefined") return { ascent: 0, descent: 0 };
    if (!measureCanvas) measureCanvas = document.createElement("canvas");
    const ctx = measureCanvas.getContext("2d");
    if (!ctx) return { ascent: 0, descent: 0 };
    ctx.font = fontShorthand;
    const m = ctx.measureText("M");
    const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? 0;
    const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? 0;
    return { ascent, descent };
}

function quoteFamily(family: string): string {
    return /\s/.test(family) ? `"${family}"` : family;
}

// ─── Outlining a single text layer ──────────────────────

async function outlineTextLayer(layer: TextLayer, group: Konva.Node): Promise<OutlinedText | null> {
    if (layer.fillEnabled === false) return null;
    const container = group as Konva.Container;
    const node = container.findOne?.((n: Konva.Node) => n.getClassName() === "Text") as Konva.Text | undefined;
    if (!node) return null;

    const lines = node.textArr;
    if (!lines || lines.length === 0) return null;

    const fontSize = node.fontSize();
    const lineHeightPx = node.lineHeight() * fontSize;
    const align = node.align();
    const verticalAlign = node.verticalAlign();
    const letterSpacing = node.letterSpacing() || 0;
    const padding = node.padding() || 0;
    const totalWidth = node.getWidth();
    const totalHeight = node.getHeight();
    const offsetY = node.offsetY() || 0;
    const family = node.fontFamily();
    // Konva stores weight in fontStyle ("800", "bold", "normal"); layer.fontWeight is authoritative.
    const weightSource = layer.fontWeight || node.fontStyle() || "400";
    const { weight, italic } = parseFontStyle(weightSource);
    const font = await resolveFont(family, weight, italic);
    if (!font) return null;

    const fontShorthand = `${weightSource} ${fontSize}px ${quoteFamily(family)}`;
    const { ascent, descent } = measureVMetrics(fontShorthand);
    const translateY0 = (ascent - descent) / 2 + lineHeightPx / 2;

    let alignY = 0;
    if (verticalAlign === "middle") {
        alignY = (totalHeight - lines.length * lineHeightPx - padding * 2) / 2;
    } else if (verticalAlign === "bottom") {
        alignY = totalHeight - lines.length * lineHeightPx - padding * 2;
    }

    const opentype = await loadOpentype();
    if (!opentype) return null;

    const fullPath = new opentype.Path();
    const unitsPerEm = font.unitsPerEm || 1000;

    lines.forEach((line, n) => {
        const text = line.text;
        if (!text) return;
        let lineX = padding;
        if (align === "right") lineX += totalWidth - line.width - padding * 2;
        else if (align === "center") lineX += (totalWidth - line.width - padding * 2) / 2;
        const baselineY = alignY + padding + translateY0 + n * lineHeightPx - offsetY;

        if (letterSpacing === 0) {
            const p = font.getPath(text, lineX, baselineY, fontSize);
            fullPath.extend(p);
        } else {
            // Per-glyph placement so letterSpacing matches the canvas.
            const glyphs = font.stringToGlyphs(text);
            let x = lineX;
            for (const g of glyphs) {
                const gp = g.getPath(x, baselineY, fontSize);
                fullPath.extend(gp);
                x += ((g.advanceWidth ?? 0) / unitsPerEm) * fontSize + letterSpacing;
            }
        }
    });

    const d = fullPath.toPathData(2);
    if (!d) return null;
    return { d, fill: layer.fill };
}

/**
 * Build outlined-text path data for every text layer on the stage. Returns a map
 * keyed by layer id; layers whose font can't be resolved are omitted (callers
 * fall back to `<text>`).
 */
export async function buildOutlinedTextMap(
    stage: Konva.Stage | null,
    layers: Layer[],
): Promise<Map<string, OutlinedText>> {
    const result = new Map<string, OutlinedText>();
    if (!stage) return result;

    const textLayers = layers.filter((l): l is TextLayer => l.type === "text");
    for (const layer of textLayers) {
        const group = stage.findOne("#" + layer.id);
        if (!group) continue;
        try {
            const outlined = await outlineTextLayer(layer, group);
            if (outlined) result.set(layer.id, outlined);
        } catch {
            // Skip — fallback handles it.
        }
    }
    return result;
}
