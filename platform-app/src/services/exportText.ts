import Konva from "konva";
import type * as Ot from "opentype.js";
import type { Layer, TextLayer } from "@/types";
import { resolvePreinstalledFontUrl, resolveManifestFontFile, preinstalledFontCandidates } from "@/services/preinstalledFontResolver";

/**
 * Text outlining for vector export.
 *
 * Converts text layers into resolution-independent vector paths so SVG/EPS
 * exports don't depend on the viewer having the font (and so Cyrillic survives
 * the PostScript pipeline). Line breaking and alignment are read from the live
 * Konva node. Glyph positions mirror Konva's `_sceneFunc` layout, then the
 * merged path is transformed into layer-group coordinates (offsetY, trim, flip).
 */

export interface OutlinedText {
    /** Merged SVG path data in layer-group coordinates. Absent when the font
     * could not be resolved and the caller should render live `<text>`. */
    d?: string;
    fill: string;
    /** Group-local baseline of the first rendered line — lets the `<text>`
     * fallback land where Konva actually draws it (offsetY / trim included). */
    fallbackFirstBaselineY?: number;
    /** Group-local line advance for subsequent `<text>` lines. */
    fallbackLineHeightPx?: number;
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

interface CssFontEntry {
    family: string;
    weight: number;
    italic: boolean;
    url: string;
}
let cssRegistry: CssFontEntry[] | null = null;

const NAMED_WEIGHTS: Record<string, number> = {
    thin: 100,
    hairline: 100,
    extralight: 200,
    "extra light": 200,
    ultralight: 200,
    light: 300,
    regular: 400,
    normal: 400,
    book: 400,
    medium: 500,
    semibold: 600,
    "semi bold": 600,
    demibold: 600,
    bold: 700,
    extrabold: 800,
    "extra bold": 800,
    heavy: 800,
    ultrabold: 800,
    black: 900,
};

function parseWeightToken(token: string | undefined): number {
    if (!token) return 400;
    const t = token.trim().toLowerCase().replace(/\s+/g, " ");
    if (NAMED_WEIGHTS[t] != null) return NAMED_WEIGHTS[t];
    const num = parseInt(t, 10);
    return Number.isFinite(num) ? num : 400;
}

function parseFontStyle(fontWeight: string | undefined): { weight: number; italic: boolean } {
    const italic = /italic|oblique/i.test(fontWeight ?? "");
    const weightToken = (fontWeight ?? "").replace(/italic|oblique|normal/gi, "").trim();
    return { weight: parseWeightToken(weightToken || fontWeight), italic };
}

function stripFamily(name: string): string {
    return name.replace(/['"]/g, "").trim().toLowerCase();
}

/**
 * The Konva node's `fontFamily()` can be a CSS stack ("YS Compressed", sans-serif).
 * Manifest/registry lookups need just the primary family, so take the first
 * segment and drop quotes.
 */
function primaryFamily(name: string): string {
    return (name.split(",")[0] ?? name).replace(/['"]/g, "").trim();
}

function buildCssRegistry(): CssFontEntry[] {
    // Don't cache an empty registry: it may have been built before the app's
    // @font-face stylesheets finished loading. Retrying keeps the live browser
    // font mapping (the most accurate source) available at export time.
    if (cssRegistry && cssRegistry.length > 0) return cssRegistry;
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
            continue;
        }
        if (!rules) continue;
        for (const rule of Array.from(rules)) {
            if (rule.constructor.name !== "CSSFontFaceRule" && (rule as CSSRule).type !== 5) continue;
            const style = (rule as CSSFontFaceRule).style;
            const family = stripFamily(style.getPropertyValue("font-family"));
            const src = style.getPropertyValue("src");
            if (!family || !src) continue;
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

function isMissingGlyph(glyph: Ot.Glyph | undefined): boolean {
    if (!glyph) return true;
    if (glyph.name === ".notdef" || glyph.name === ".null") return true;
    // index 0 is .notdef in most fonts; avoid rejecting valid glyphs on other indices.
    if (glyph.index === 0 && (glyph.unicode === undefined || glyph.unicode === 0)) return true;
    return false;
}

function fontSupportsChars(font: Ot.Font, chars: string): boolean {
    if (!chars) return true;
    for (const ch of chars) {
        if (ch === "\n" || ch === "\r" || ch === "\t" || ch === " ") continue;
        if (isMissingGlyph(font.charToGlyph(ch))) return false;
    }
    return true;
}

async function collectFontCandidates(
    familyRaw: string,
    weight: number,
    italic: boolean,
): Promise<string[]> {
    const family = primaryFamily(familyRaw);
    const urls: string[] = [];
    const manifestFile = resolveManifestFontFile(family, weight, italic);
    if (manifestFile) urls.push(`/fonts/${encodeURIComponent(manifestFile)}`);

    const preinstalledUrl = await resolvePreinstalledFontUrl(family, weight, italic);
    if (preinstalledUrl) urls.push(preinstalledUrl);

    const target = stripFamily(family);
    const collapsed = target.replace(/\s+/g, "");
    const registry = buildCssRegistry().filter(
        (e) => e.family === target || e.family.replace(/\s+/g, "") === collapsed,
    );
    const styleMatches = registry.filter((e) => e.italic === italic);
    const pool = styleMatches.length > 0 ? styleMatches : registry;
    pool.sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight));
    for (const entry of pool) {
        const encoded = entry.url.includes(" ")
            ? entry.url.split("/").map((p, i, a) => (i === a.length - 1 ? encodeURIComponent(p) : p)).join("/")
            : entry.url;
        urls.push(encoded);
    }

    for (const filename of preinstalledFontCandidates(family, weight, italic)) {
        urls.push(`/fonts/${encodeURIComponent(filename)}`);
        const otf = filename.replace(/\.ttf$/i, ".otf");
        if (otf !== filename) urls.push(`/fonts/${encodeURIComponent(otf)}`);
    }

    return [...new Set(urls)];
}

/**
 * Parsed fonts cached by URL — not by "(family, weight, text)". The old keying
 * collided whenever two different strings shared the same family/weight and the
 * same `text.length`: the font chosen for the first string (which only had to
 * cover ITS glyphs) was reused for the second, so e.g. a Latin run could hand a
 * Latin-only face to a Cyrillic run → `.notdef` glyphs → garbage outlines.
 * A URL is a stable identity for the actual file, so this cache is collision-free.
 */
const fontFileCache = new Map<string, Ot.Font | null>();

async function loadFontFile(opentype: OpentypeModule, url: string): Promise<Ot.Font | null> {
    if (fontFileCache.has(url)) return fontFileCache.get(url) ?? null;
    const font = await fetchFont(opentype, url);
    fontFileCache.set(url, font);
    return font;
}

// Comprehensive Cyrillic+Latin faces shipped in /public/fonts. Used only as a
// last resort so a layer whose exact face can't be matched still outlines with
// REAL glyphs (curves) instead of falling back to a `<text>` element.
const GLOBAL_FALLBACK_FONT_FILES = [
    "YS Text-Regular.ttf",
    "YS Text-Medium.ttf",
    "YS Text-Bold.ttf",
    "YS Display-Regular.ttf",
    "YS Display-Medium.ttf",
];

async function resolveFontForText(
    family: string,
    weight: number,
    italic: boolean,
    sampleText: string,
): Promise<Ot.Font | null> {
    const opentype = await loadOpentype();
    if (!opentype) return null;

    const uniqueChars = [...new Set(sampleText.replace(/\s/g, ""))].join("");

    // 1) Family-specific candidates, in best-weight order. Accept the first one
    //    that FULLY covers the text — never a partial match (which renders
    //    `.notdef` and looks like a smeared blob in the export).
    const urls = await collectFontCandidates(family, weight, italic);
    for (const url of urls) {
        const candidate = await loadFontFile(opentype, url);
        if (candidate && fontSupportsChars(candidate, uniqueChars)) return candidate;
    }

    // 2) User-uploaded font matching the family.
    try {
        const { getUserFonts, normalizeFontFamilyName } = await import("@/lib/customFonts");
        const userFonts = await getUserFonts();
        const target = stripFamily(primaryFamily(family));
        const match = userFonts.find((f) => stripFamily(normalizeFontFamilyName(f.name)) === target);
        if (match) {
            const parsed = opentype.parse(match.buffer);
            if (parsed && fontSupportsChars(parsed, uniqueChars)) return parsed;
        }
    } catch {
        // ignore and fall through to the global fallback
    }

    // 3) Global Cyrillic-capable fallback — keeps the "everything becomes curves"
    //    guarantee even when the exact face is unknown. Substitutes the typeface
    //    only when nothing better exists; coverage is still required so we never
    //    emit garbage.
    for (const file of GLOBAL_FALLBACK_FONT_FILES) {
        const candidate = await loadFontFile(opentype, `/fonts/${encodeURIComponent(file)}`);
        if (candidate && fontSupportsChars(candidate, uniqueChars)) return candidate;
    }

    return null;
}

// ─── Canvas vertical metrics (Konva-compatible fallback) ─

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

function readKonvaMetrics(node: Konva.Text, fontShorthand: string): { ascent: number; descent: number } {
    const measureSize = (node as Konva.Text & { measureSize?: (t: string) => {
        fontBoundingBoxAscent?: number;
        fontBoundingBoxDescent?: number;
        actualBoundingBoxAscent?: number;
        actualBoundingBoxDescent?: number;
    } }).measureSize;
    if (measureSize) {
        const m = measureSize.call(node, "M");
        const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? 0;
        const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? 0;
        if (ascent > 0 || descent > 0) return { ascent, descent };
    }
    return measureVMetrics(fontShorthand);
}

function appendGlyphRun(
    fullPath: Ot.Path,
    font: Ot.Font,
    text: string,
    startX: number,
    baselineY: number,
    fontSize: number,
    letterSpacing: number,
): void {
    const unitsPerEm = font.unitsPerEm || 1000;
    const glyphs = font.stringToGlyphs(text);
    let x = startX;
    let prevGlyph: Ot.Glyph | null = null;
    for (const glyph of glyphs) {
        if (prevGlyph && font.getKerningValue) {
            const kern = font.getKerningValue(prevGlyph, glyph);
            if (kern) x += (kern / unitsPerEm) * fontSize;
        }
        const gp = glyph.getPath(x, baselineY, fontSize);
        fullPath.extend(gp);
        x += ((glyph.advanceWidth ?? 0) / unitsPerEm) * fontSize + letterSpacing;
        prevGlyph = glyph;
    }
}

function textToGroupTransform(textNode: Konva.Text, group: Konva.Node): Konva.Transform {
    return group.getAbsoluteTransform().copy().invert().multiply(textNode.getAbsoluteTransform());
}

function mapPathCommands(
    path: Ot.Path,
    mapPoint: (x: number, y: number) => { x: number; y: number },
): void {
    for (const cmd of path.commands) {
        switch (cmd.type) {
            case "M":
            case "L": {
                const p = mapPoint(cmd.x, cmd.y);
                cmd.x = p.x;
                cmd.y = p.y;
                break;
            }
            case "Q": {
                const p1 = mapPoint(cmd.x1, cmd.y1);
                const p = mapPoint(cmd.x, cmd.y);
                cmd.x1 = p1.x;
                cmd.y1 = p1.y;
                cmd.x = p.x;
                cmd.y = p.y;
                break;
            }
            case "C": {
                const p1 = mapPoint(cmd.x1, cmd.y1);
                const p2 = mapPoint(cmd.x2, cmd.y2);
                const p = mapPoint(cmd.x, cmd.y);
                cmd.x1 = p1.x;
                cmd.y1 = p1.y;
                cmd.x2 = p2.x;
                cmd.y2 = p2.y;
                cmd.x = p.x;
                cmd.y = p.y;
                break;
            }
            default:
                break;
        }
    }
}

function transformOutlinePath(path: Ot.Path, transform: Konva.Transform): void {
    const m = transform.getMatrix();
    mapPathCommands(path, (x, y) => ({
        x: m[0] * x + m[2] * y + m[4],
        y: m[1] * x + m[3] * y + m[5],
    }));
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
    // Mirror Konva `_sceneFunc` exactly: glyph layout uses the node's own width
    // and height. Vertical-trim offsetY lives in the node's transform, so the
    // `text → group` matrix below carries it into the final coordinates without
    // any manual box math (which previously fought the renderer and clipped).
    const totalWidth = node.width();
    const totalHeight = node.height();
    const family = node.fontFamily();
    const weightSource = layer.fontWeight || node.fontStyle() || "400";
    const { weight, italic } = parseFontStyle(weightSource);

    const fontShorthand = `${weightSource} ${fontSize}px ${quoteFamily(family)}`;
    const { ascent, descent } = readKonvaMetrics(node, fontShorthand);
    const translateY0 = (ascent - descent) / 2 + lineHeightPx / 2;

    let alignY = 0;
    if (verticalAlign === "middle") {
        alignY = (totalHeight - lines.length * lineHeightPx - padding * 2) / 2;
    } else if (verticalAlign === "bottom") {
        alignY = totalHeight - lines.length * lineHeightPx - padding * 2;
    }

    const firstLineIndex = lines.findIndex((l) => l.text);
    if (firstLineIndex < 0) return null;

    // Group-local baseline metrics — used to position the live `<text>` safety
    // net on the rare path where no font file can be parsed at all.
    const t2g = textToGroupTransform(node, container);
    const firstBaselineLocalY = alignY + padding + translateY0 + firstLineIndex * lineHeightPx;
    const baselineP0 = t2g.point({ x: 0, y: firstBaselineLocalY });
    const baselineP1 = t2g.point({ x: 0, y: firstBaselineLocalY + lineHeightPx });
    const fallbackFirstBaselineY = baselineP0.y;
    const fallbackLineHeightPx = baselineP1.y - baselineP0.y;

    const sampleText = lines.map((l) => l.text).join("");
    const font = await resolveFontForText(family, weight, italic, sampleText);
    if (!font) {
        return { fill: layer.fill, fallbackFirstBaselineY, fallbackLineHeightPx };
    }

    const opentype = await loadOpentype();
    if (!opentype) {
        return { fill: layer.fill, fallbackFirstBaselineY, fallbackLineHeightPx };
    }

    const fullPath = new opentype.Path();

    lines.forEach((line, n) => {
        const text = line.text;
        if (!text) return;
        let lineX = padding;
        if (align === "right") lineX += totalWidth - line.width - padding * 2;
        else if (align === "center") lineX += (totalWidth - line.width - padding * 2) / 2;

        // Glyph baseline mirrors Konva `_sceneFunc` exactly (alphabetic
        // baseline). opentype places the same baseline at the same Y, so once
        // the path goes through the live `text → group` transform there is no
        // residual drift to "correct" — keep the geometry untouched.
        const baselineY = alignY + padding + translateY0 + n * lineHeightPx;
        appendGlyphRun(fullPath, font, text, lineX, baselineY, fontSize, letterSpacing);
    });

    transformOutlinePath(fullPath, t2g);

    const d = fullPath.toPathData(3);
    if (!d || /NaN|Infinity/.test(d)) {
        return { fill: layer.fill, fallbackFirstBaselineY, fallbackLineHeightPx };
    }
    return { d, fill: layer.fill, fallbackFirstBaselineY, fallbackLineHeightPx };
}

/**
 * Build outlined-text path data for every text layer on the stage.
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
            // Skip — caller falls back to <text>.
        }
    }
    return result;
}
