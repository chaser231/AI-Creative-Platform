import type { FrameLayer, GradientPaint, Layer, Paint, VectorLayer } from "@/types";
import { normalizePaint } from "@/utils/paint";
import { hasRenderableGeometry, parseSvgPathToAbsSubpaths } from "@/utils/vectorGeometry";
import { parseSvgToEditableSubpaths } from "@/utils/svgImport";
import type Konva from "konva";
import type { OutlinedText } from "@/services/exportText";
import { resolveLayerPosition } from "@/services/exportCoords";

/**
 * Client-side EPS (Encapsulated PostScript) export.
 *
 * Generates vector PostScript directly from the layer tree — no server-side
 * converter and therefore no extra apt packages in the Docker build (see
 * .cursor/rules/deploy-pipeline.mdc). PostScript uses a bottom-left origin, so a
 * global `0 H translate / 1 -1 scale` lets the rest of the code use the editor's
 * top-left coordinates.
 *
 * Fidelity model:
 * - Text is emitted as outlined vector paths (`outlinedText`), which is the only
 *   reliable way to carry Cyrillic into PostScript (its base fonts can't encode
 *   it). When an outline is missing we fall back to `show` (Latin-only).
 * - Gradients render via PostScript axial/radial shading (`shfill`).
 * - PostScript has no alpha, so transparency is FLATTENED: every colour is
 *   alpha-composited over the current backdrop (artboard / parent frame fill).
 */

type Rgb = { r: number; g: number; b: number };
const WHITE: Rgb = { r: 1, g: 1, b: 1 };

export interface EpsExportOptions {
    layers: Layer[];
    width: number;
    height: number;
    artboardFill?: Paint;
    artboardFillEnabled?: boolean;
    outlinedText?: Map<string, OutlinedText>;
    stage?: Konva.Stage | null;
}

function n(v: number): string {
    return (Math.round(v * 1000) / 1000).toString();
}

function escapePs(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function parseHex(color: string): Rgb {
    const raw = color.trim().replace(/^#/, "");
    const expand = (v: string) => v.split("").map((c) => c + c).join("");
    const hex = raw.length === 3 || raw.length === 4 ? expand(raw) : raw;
    if (!/^[0-9a-fA-F]{6}/.test(hex)) {
        const m = color.match(/rgba?\(([^)]+)\)/i);
        if (m) {
            const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
            return { r: (parts[0] || 0) / 255, g: (parts[1] || 0) / 255, b: (parts[2] || 0) / 255 };
        }
        return { r: 0, g: 0, b: 0 };
    }
    return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
    };
}

/** Alpha-composite src over dst (flatten). */
function blendOver(src: Rgb, alpha: number, dst: Rgb): Rgb {
    const a = Math.max(0, Math.min(1, alpha));
    return {
        r: src.r * a + dst.r * (1 - a),
        g: src.g * a + dst.g * (1 - a),
        b: src.b * a + dst.b * (1 - a),
    };
}

function rgbCmd(c: Rgb): string {
    return `${n(c.r)} ${n(c.g)} ${n(c.b)} setrgbcolor`;
}

// ─── Path emitters ──────────────────────────────────────

function roundedRectPath(out: string[], w: number, h: number, r: number) {
    if (r <= 0) {
        out.push(`newpath 0 0 moveto ${n(w)} 0 lineto ${n(w)} ${n(h)} lineto 0 ${n(h)} lineto closepath`);
        return;
    }
    const rad = Math.min(r, w / 2, h / 2);
    out.push("newpath");
    out.push(`${n(rad)} 0 moveto`);
    out.push(`${n(w - rad)} 0 lineto`);
    out.push(`${n(w)} 0 ${n(w)} ${n(rad)} ${n(rad)} arcto 4 {pop} repeat`);
    out.push(`${n(w)} ${n(h - rad)} lineto`);
    out.push(`${n(w)} ${n(h)} ${n(w - rad)} ${n(h)} ${n(rad)} arcto 4 {pop} repeat`);
    out.push(`${n(rad)} ${n(h)} lineto`);
    out.push(`0 ${n(h)} 0 ${n(h - rad)} ${n(rad)} arcto 4 {pop} repeat`);
    out.push(`0 ${n(rad)} lineto`);
    out.push(`0 0 ${n(rad)} 0 ${n(rad)} arcto 4 {pop} repeat`);
    out.push("closepath");
}

interface AbsAnchor {
    x: number; y: number;
    inX?: number; inY?: number;
    outX?: number; outY?: number;
}
interface AbsSubpath { points: AbsAnchor[]; closed: boolean; }

function emitSubpaths(out: string[], subpaths: AbsSubpath[]) {
    out.push("newpath");
    for (const sp of subpaths) {
        const pts = sp.points;
        if (pts.length === 0) continue;
        out.push(`${n(pts[0].x)} ${n(pts[0].y)} moveto`);
        const segs = sp.closed ? pts.length : pts.length - 1;
        for (let i = 0; i < segs; i += 1) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            const aOut = a.outX !== undefined && a.outY !== undefined;
            const bIn = b.inX !== undefined && b.inY !== undefined;
            if (aOut || bIn) {
                const c1x = aOut ? (a.outX as number) : a.x;
                const c1y = aOut ? (a.outY as number) : a.y;
                const c2x = bIn ? (b.inX as number) : b.x;
                const c2y = bIn ? (b.inY as number) : b.y;
                out.push(`${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(b.x)} ${n(b.y)} curveto`);
            } else {
                out.push(`${n(b.x)} ${n(b.y)} lineto`);
            }
        }
        if (sp.closed) out.push("closepath");
    }
}

function vectorAbsSubpaths(layer: VectorLayer): AbsSubpath[] {
    const { width, height } = layer;
    if (hasRenderableGeometry(layer.subpaths)) {
        return layer.subpaths.map((sp) => ({
            closed: sp.closed,
            points: sp.points.map((p) => ({
                x: p.x * width,
                y: p.y * height,
                ...(p.inX !== undefined ? { inX: p.inX * width, inY: (p.inY ?? 0) * height } : {}),
                ...(p.outX !== undefined ? { outX: p.outX * width, outY: (p.outY ?? 0) * height } : {}),
            })),
        }));
    }
    if (layer.inlineSvg) {
        const subpaths = parseSvgToEditableSubpaths(layer.inlineSvg);
        if (subpaths?.length) {
            return subpaths.map((sp) => ({
                closed: sp.closed,
                points: sp.points.map((p) => ({
                    x: p.x * width,
                    y: p.y * height,
                    ...(p.inX !== undefined ? { inX: p.inX * width, inY: (p.inY ?? 0) * height } : {}),
                    ...(p.outX !== undefined ? { outX: p.outX * width, outY: (p.outY ?? 0) * height } : {}),
                })),
            }));
        }
    }
    if (layer.rawSvgPath) {
        const sx = layer.viewBoxWidth ? width / layer.viewBoxWidth : 1;
        const sy = layer.viewBoxHeight ? height / layer.viewBoxHeight : 1;
        return parseSvgPathToAbsSubpaths(layer.rawSvgPath).map((sp) => ({
            closed: sp.closed,
            points: sp.points.map((p) => ({
                x: p.x * sx,
                y: p.y * sy,
                ...(p.inX !== undefined ? { inX: p.inX * sx, inY: (p.inY ?? 0) * sy } : {}),
                ...(p.outX !== undefined ? { outX: p.outX * sx, outY: (p.outY ?? 0) * sy } : {}),
            })),
        }));
    }
    return [];
}

// ─── Gradient flattening (Level-2-safe, no shfill) ───────
// PostScript Level-3 shfill is unsupported in many EPS readers (Illustrator,
// After Effects). We approximate gradients with flat colour bands clipped to the
// shape, and alpha-composite each band over the backdrop.

function gradientT(np: GradientPaint, nx: number, ny: number): number {
    const s = np.start ?? { x: 0, y: 0.5 };
    const e = np.end ?? { x: 1, y: 0.5 };
    const dx = e.x - s.x;
    const dy = e.y - s.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return 0;
    return ((nx - s.x) * dx + (ny - s.y) * dy) / len2;
}

function sampleGradient(np: GradientPaint, t: number, alpha: number, backdrop: Rgb): Rgb {
    const stops = np.stops;
    if (stops.length === 0) return backdrop;
    const clamped = Math.max(0, Math.min(1, t));
    let i = 0;
    while (i < stops.length - 1 && stops[i + 1].offset < clamped) i += 1;
    const a = stops[i];
    const b = stops[Math.min(i + 1, stops.length - 1)];
    const range = b.offset - a.offset;
    const localT = range < 1e-9 ? 0 : (clamped - a.offset) / range;
    const ca = blendOver(parseHex(a.color), a.opacity * alpha, backdrop);
    const cb = blendOver(parseHex(b.color), b.opacity * alpha, backdrop);
    return {
        r: ca.r + (cb.r - ca.r) * localT,
        g: ca.g + (cb.g - ca.g) * localT,
        b: ca.b + (cb.b - ca.b) * localT,
    };
}

function emitGradientBands(
    out: string[],
    np: GradientPaint,
    w: number,
    h: number,
    alpha: number,
    backdrop: Rgb,
) {
    const steps = 48;
    const start = np.start ?? { x: 0, y: 0.5 };
    const end = np.end ?? { x: 1, y: 0.5 };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const vertical = Math.abs(dx) < Math.abs(dy) * 0.35;
    const horizontal = Math.abs(dy) < Math.abs(dx) * 0.35;

    if (np.gradientType === "radial") {
        const center = np.center ?? { x: 0.5, y: 0.5 };
        const cx = center.x * w;
        const cy = center.y * h;
        const maxR = (np.radius ?? 0.7) * Math.max(w, h);
        // Paint concentric discs outside→in (Level-2 `arc` only, no arcn/shfill).
        for (let i = steps - 1; i >= 0; i -= 1) {
            const r = maxR * (i + 1) / steps;
            const t = i / Math.max(1, steps - 1);
            out.push(rgbCmd(sampleGradient(np, t, alpha, backdrop)));
            out.push(`newpath ${n(cx)} ${n(cy)} ${n(r)} 0 360 arc closepath fill`);
        }
        return;
    }

    if (vertical) {
        for (let i = 0; i < steps; i += 1) {
            const y0 = h * i / steps;
            const y1 = h * (i + 1) / steps;
            const ny = ((y0 + y1) / 2) / h;
            const t = gradientT(np, 0.5, ny);
            out.push(rgbCmd(sampleGradient(np, t, alpha, backdrop)));
            out.push(`newpath 0 ${n(y0)} moveto ${n(w)} ${n(y0)} lineto ${n(w)} ${n(y1)} lineto 0 ${n(y1)} lineto closepath fill`);
        }
        return;
    }

    if (horizontal) {
        for (let i = 0; i < steps; i += 1) {
            const x0 = w * i / steps;
            const x1 = w * (i + 1) / steps;
            const nx = ((x0 + x1) / 2) / w;
            const t = gradientT(np, nx, 0.5);
            out.push(rgbCmd(sampleGradient(np, t, alpha, backdrop)));
            out.push(`newpath ${n(x0)} 0 moveto ${n(x1)} 0 lineto ${n(x1)} ${n(h)} lineto ${n(x0)} ${n(h)} lineto closepath fill`);
        }
        return;
    }

    // Diagonal: slice along the dominant axis.
    for (let i = 0; i < steps; i += 1) {
        const y0 = h * i / steps;
        const y1 = h * (i + 1) / steps;
        const ny = ((y0 + y1) / 2) / h;
        const t = gradientT(np, 0.5, ny);
        out.push(rgbCmd(sampleGradient(np, t, alpha, backdrop)));
        out.push(`newpath 0 ${n(y0)} moveto ${n(w)} ${n(y0)} lineto ${n(w)} ${n(y1)} lineto 0 ${n(y1)} lineto closepath fill`);
    }
}

/** Fill the path produced by `emitPath` with a paint, flattening transparency. */
function fillShape(
    out: string[],
    emitPath: () => void,
    paint: Paint | undefined,
    w: number,
    h: number,
    alpha: number,
    backdrop: Rgb,
    evenOdd = false,
) {
    const np = normalizePaint(paint ?? "#000000");
    if (np.kind === "gradient" && (np.gradientType === "linear" || np.gradientType === "radial")) {
        out.push("gsave");
        emitPath();
        out.push(evenOdd ? "eoclip" : "clip");
        emitGradientBands(out, np, w, h, alpha, backdrop);
        out.push("grestore");
        return;
    }
    const solid = np.kind === "solid"
        ? blendOver(parseHex(np.color), np.opacity * alpha, backdrop)
        : blendOver(parseHex(np.stops[0]?.color ?? "#000000"), (np.stops[0]?.opacity ?? 1) * alpha, backdrop);
    emitPath();
    out.push(rgbCmd(solid));
    out.push(evenOdd ? "eofill" : "fill");
}

function strokeShape(
    out: string[],
    emitPath: () => void,
    paint: Paint | undefined,
    widthPx: number,
    alpha: number,
    backdrop: Rgb,
) {
    if (!paint || paint === "" || widthPx <= 0) return;
    const np = normalizePaint(paint);
    const solid = np.kind === "solid"
        ? blendOver(parseHex(np.color), np.opacity * alpha, backdrop)
        : blendOver(parseHex(np.stops[0]?.color ?? "#000000"), (np.stops[0]?.opacity ?? 1) * alpha, backdrop);
    emitPath();
    out.push(rgbCmd(solid));
    out.push(`${n(widthPx)} setlinewidth stroke`);
}

/** Effective backdrop colour seen *through* a paint (for flattening children). */
function resolveBackdrop(paint: Paint | undefined, alpha: number, parent: Rgb): Rgb {
    const np = normalizePaint(paint ?? "#000000");
    if (np.kind === "solid") return blendOver(parseHex(np.color), np.opacity * alpha, parent);
    return blendOver(parseHex(np.stops[0]?.color ?? "#000000"), (np.stops[0]?.opacity ?? 1) * alpha, parent);
}

// ─── Layer emit ─────────────────────────────────────────

function childPositionInFrame(child: Layer, frame: FrameLayer, stage?: Konva.Stage | null): { x: number; y: number } {
    if (stage) return resolveLayerPosition(child, stage);
    return { x: child.x - frame.x, y: child.y - frame.y };
}

function emitLayer(
    out: string[],
    layer: Layer,
    all: Layer[],
    alpha: number,
    backdrop: Rgb,
    outlined?: Map<string, OutlinedText>,
    stage?: Konva.Stage | null,
) {
    if (layer.visible === false) return;
    const a = alpha * (layer.opacity ?? 1);
    const pos = resolveLayerPosition(layer, stage);

    out.push("gsave");
    out.push(`${n(pos.x)} ${n(pos.y)} translate`);
    if (layer.rotation) out.push(`${n(layer.rotation)} rotate`);
    if (layer.flipX || layer.flipY) {
        const sx = layer.flipX ? -1 : 1;
        const sy = layer.flipY ? -1 : 1;
        out.push(`${n(layer.flipX ? layer.width : 0)} ${n(layer.flipY ? layer.height : 0)} translate`);
        out.push(`${sx} ${sy} scale`);
    }

    switch (layer.type) {
        case "rectangle": {
            if (layer.fillEnabled !== false) {
                fillShape(out, () => roundedRectPath(out, layer.width, layer.height, layer.cornerRadius), layer.fill, layer.width, layer.height, a, backdrop);
            }
            if (layer.strokeEnabled !== false) {
                strokeShape(out, () => roundedRectPath(out, layer.width, layer.height, layer.cornerRadius), layer.stroke, layer.strokeWidth, a, backdrop);
            }
            break;
        }
        case "vector": {
            const abs = vectorAbsSubpaths(layer);
            if (abs.length > 0) {
                if (layer.fillEnabled !== false) {
                    fillShape(out, () => emitSubpaths(out, abs), layer.fill, layer.width, layer.height, a, backdrop, layer.fillRule === "evenodd");
                }
                if (layer.strokeEnabled && (layer.strokeWidth ?? 0) > 0) {
                    strokeShape(out, () => emitSubpaths(out, abs), layer.stroke, layer.strokeWidth ?? 1, a, backdrop);
                }
            }
            break;
        }
        case "badge": {
            const radius = layer.shape === "circle" ? layer.width / 2 : layer.shape === "pill" ? layer.height / 2 : 4;
            if (layer.fillEnabled !== false) {
                fillShape(out, () => roundedRectPath(out, layer.width, layer.height, radius), layer.fill, layer.width, layer.height, a, backdrop);
            }
            const ot = outlined?.get(layer.id);
            if (ot?.d) {
                const abs = parseSvgPathToAbsSubpaths(ot.d);
                fillShape(out, () => emitSubpaths(out, abs), ot.fill, layer.width, layer.height, a, backdrop);
            } else {
                emitTextFallback(out, layer.label, layer.fontSize, "Helvetica", parseHex(layer.textColor), layer.width / 2, layer.height / 2 + layer.fontSize / 3, "center", a, backdrop);
            }
            break;
        }
        case "text": {
            const ot = outlined?.get(layer.id);
            if (ot?.d) {
                const abs = parseSvgPathToAbsSubpaths(ot.d);
                if (abs.length > 0) {
                    fillShape(out, () => emitSubpaths(out, abs), ot.fill, layer.width, layer.height, a, backdrop);
                }
            } else if (layer.fillEnabled !== false) {
                // Latin-only fallback (Cyrillic needs the outline path above).
                const lines = (layer.textTransform === "uppercase" ? layer.text.toUpperCase()
                    : layer.textTransform === "lowercase" ? layer.text.toLowerCase()
                    : layer.text).split("\n");
                const lineHeight = (layer.lineHeight || 1.2) * layer.fontSize;
                const fontName = psFontName(layer.fontWeight);
                lines.forEach((line, i) => {
                    const baseY = layer.fontSize + i * lineHeight;
                    const xPos = layer.align === "center" ? layer.width / 2 : layer.align === "right" ? layer.width : 0;
                    emitTextFallback(out, line, layer.fontSize, fontName, parseHex(layer.fill), xPos, baseY, layer.align, a, backdrop);
                });
            }
            break;
        }
        case "frame": {
            const frame = layer as FrameLayer;
            if (frame.clipContent) {
                roundedRectPath(out, frame.width, frame.height, frame.cornerRadius);
                out.push("clip");
            }
            if (frame.fillEnabled !== false) {
                fillShape(out, () => roundedRectPath(out, frame.width, frame.height, frame.cornerRadius), frame.fill, frame.width, frame.height, a, backdrop);
            }
            // Children flatten over the frame fill (if any), else the inherited backdrop.
            const childBackdrop = frame.fillEnabled !== false ? resolveBackdrop(frame.fill, a, backdrop) : backdrop;
            const childIds = Array.isArray(frame.childIds) ? frame.childIds : [];
            for (const id of childIds) {
                const child = all.find((l) => l.id === id);
                if (child) {
                    const rel = childPositionInFrame(child, frame, stage);
                    emitLayer(out, { ...child, x: rel.x, y: rel.y }, all, a, childBackdrop, outlined, stage);
                }
            }
            break;
        }
        default:
            break;
    }

    out.push("grestore");
}

function psFontName(weight: string): string {
    const bold = /bold|[7-9]00/i.test(weight);
    const italic = /italic/i.test(weight);
    if (bold && italic) return "Helvetica-BoldOblique";
    if (bold) return "Helvetica-Bold";
    if (italic) return "Helvetica-Oblique";
    return "Helvetica";
}

function emitTextFallback(
    out: string[],
    text: string,
    size: number,
    fontName: string,
    color: Rgb,
    x: number,
    y: number,
    anchor: "left" | "center" | "right",
    alpha: number,
    backdrop: Rgb,
) {
    if (!text) return;
    out.push(rgbCmd(blendOver(color, alpha, backdrop)));
    out.push(`/${fontName} findfont [${n(size)} 0 0 ${n(-size)} 0 0] makefont setfont`);
    const escaped = `(${escapePs(text)})`;
    if (anchor === "left") {
        out.push(`${n(x)} ${n(y)} moveto ${escaped} show`);
    } else {
        const factor = anchor === "center" ? 2 : 1;
        out.push(`${escaped} stringwidth pop ${factor} div ${n(x)} exch sub ${n(y)} moveto ${escaped} show`);
    }
}

export function layersToEps(options: EpsExportOptions): string {
    const { layers, width, height, artboardFill, artboardFillEnabled, outlinedText, stage } = options;
    const out: string[] = [];

    out.push("%!PS-Adobe-3.0 EPSF-3.0");
    out.push(`%%BoundingBox: 0 0 ${Math.ceil(width)} ${Math.ceil(height)}`);
    out.push("%%Pages: 1");
    out.push("%%EndComments");
    out.push("gsave");
    out.push(`0 ${n(height)} translate`);
    out.push("1 -1 scale");

    // The backdrop colour used to flatten transparency. When the artboard fill is
    // off we flatten over white (EPS has no transparent canvas).
    const artboardRgb = artboardFillEnabled !== false
        ? resolveBackdrop(artboardFill, 1, WHITE)
        : WHITE;

    if (artboardFillEnabled !== false) {
        fillShape(out, () => roundedRectPath(out, width, height, 0), artboardFill ?? "#FFFFFF", width, height, 1, WHITE);
    }

    const childIds = new Set<string>();
    for (const l of layers) {
        if (l.type === "frame" && Array.isArray((l as FrameLayer).childIds)) {
            (l as FrameLayer).childIds.forEach((id) => childIds.add(id));
        }
    }
    const topLevel = layers.filter((l) => !childIds.has(l.id));
    for (const layer of topLevel) emitLayer(out, layer, layers, 1, artboardRgb, outlinedText, stage);

    out.push("grestore");
    out.push("showpage");
    out.push("%%EOF");
    return out.join("\n");
}

/**
 * Serialize a layer subtree (e.g. a frame + its children) to an EPS sized to the
 * combined bounds. `layers` must already include any frame children referenced
 * by frames in the set.
 */
export function layersToEpsFragment(layers: Layer[], outlinedText?: Map<string, OutlinedText>): string {
    if (layers.length === 0) return "";
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of layers) {
        minX = Math.min(minX, l.x);
        minY = Math.min(minY, l.y);
        maxX = Math.max(maxX, l.x + l.width);
        maxY = Math.max(maxY, l.y + l.height);
    }
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const shifted = layers.map((l) => ({ ...l, x: l.x - minX, y: l.y - minY })) as Layer[];
    return layersToEps({ layers: shifted, width, height, artboardFillEnabled: false, outlinedText });
}
