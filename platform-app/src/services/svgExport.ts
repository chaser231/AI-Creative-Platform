import type {
    FrameLayer,
    Layer,
    Paint,
    VectorLayer,
} from "@/types";
import { normalizePaint } from "@/utils/paint";
import { subpathsToPathData, hasRenderableGeometry } from "@/utils/vectorGeometry";
import type { OutlinedText } from "@/services/exportText";

/**
 * SVG export. Walks a `Layer[]` tree into a standalone SVG document.
 *
 * Fidelity notes:
 * - Text is emitted as `<text>` with `<tspan>` lines split on explicit newlines;
 *   automatic word-wrapping from the Konva renderer is not reproduced.
 * - Gradients (linear/radial) are emitted into `<defs>`; angular/diamond fall
 *   back to their first stop colour.
 */

export interface SvgExportOptions {
    layers: Layer[];
    width: number;
    height: number;
    artboardFill?: Paint;
    artboardFillEnabled?: boolean;
    background?: boolean;
    /** Pre-computed outlined text (layer id -> vector path). When present, text
     * layers render as `<path>` instead of `<text>` for font-independent output. */
    outlinedText?: Map<string, OutlinedText>;
    /** Pre-fetched base64 data-URIs for image layers (layer id -> data URI), so
     * the SVG is self-contained and renders offline. */
    embeddedImages?: Map<string, string>;
}

function escapeXml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

interface Defs {
    items: string[];
    counter: number;
}

/** Returns { fill, fillOpacity } and registers gradient defs as needed. */
function paintToSvgFill(
    paint: Paint | undefined,
    defs: Defs,
    width: number,
    height: number,
): { fill: string; fillOpacity: number } {
    const np = normalizePaint(paint ?? "#000000");
    if (np.kind === "solid") {
        return { fill: np.color, fillOpacity: np.opacity };
    }

    if (np.gradientType === "linear" || np.gradientType === "radial") {
        const id = `grad${defs.counter++}`;
        const stops = np.stops
            .map((s) => `<stop offset="${round(s.offset * 100)}%" stop-color="${s.color}" stop-opacity="${round(s.opacity)}" />`)
            .join("");
        if (np.gradientType === "linear") {
            const start = np.start ?? { x: 0, y: 0.5 };
            const end = np.end ?? { x: 1, y: 0.5 };
            defs.items.push(
                `<linearGradient id="${id}" x1="${round(start.x * width)}" y1="${round(start.y * height)}" x2="${round(end.x * width)}" y2="${round(end.y * height)}" gradientUnits="userSpaceOnUse">${stops}</linearGradient>`,
            );
        } else {
            const center = np.center ?? { x: 0.5, y: 0.5 };
            const r = (np.radius ?? 0.7) * Math.max(width, height);
            defs.items.push(
                `<radialGradient id="${id}" cx="${round(center.x * width)}" cy="${round(center.y * height)}" r="${round(r)}" gradientUnits="userSpaceOnUse">${stops}</radialGradient>`,
            );
        }
        return { fill: `url(#${id})`, fillOpacity: 1 };
    }

    // angular / diamond: approximate with first stop
    return { fill: np.stops[0]?.color ?? "#000000", fillOpacity: np.stops[0]?.opacity ?? 1 };
}

function strokeColor(paint: Paint | undefined): string | null {
    if (paint === undefined || paint === "") return null;
    const np = normalizePaint(paint);
    return np.kind === "solid" ? np.color : np.stops[0]?.color ?? null;
}

function layerTransform(layer: Layer): string {
    const parts: string[] = [`translate(${round(layer.x)} ${round(layer.y)})`];
    if (layer.rotation) parts.push(`rotate(${round(layer.rotation)})`);
    if (layer.flipX || layer.flipY) {
        const sx = layer.flipX ? -1 : 1;
        const sy = layer.flipY ? -1 : 1;
        const tx = layer.flipX ? layer.width : 0;
        const ty = layer.flipY ? layer.height : 0;
        parts.push(`translate(${round(tx)} ${round(ty)})`);
        parts.push(`scale(${sx} ${sy})`);
    }
    return parts.join(" ");
}

function renderRectLike(
    layer: Layer & { width: number; height: number },
    fill: Paint | undefined,
    fillEnabled: boolean | undefined,
    stroke: Paint | undefined,
    strokeWidth: number | undefined,
    cornerRadius: number | undefined,
    defs: Defs,
): string {
    const attrs: string[] = [`x="0"`, `y="0"`, `width="${round(layer.width)}"`, `height="${round(layer.height)}"`];
    if (cornerRadius) attrs.push(`rx="${round(cornerRadius)}"`);
    if (fillEnabled === false) {
        attrs.push(`fill="none"`);
    } else {
        const { fill: f, fillOpacity } = paintToSvgFill(fill, defs, layer.width, layer.height);
        attrs.push(`fill="${f}"`);
        if (fillOpacity < 1) attrs.push(`fill-opacity="${round(fillOpacity)}"`);
    }
    const sc = strokeColor(stroke);
    if (sc && strokeWidth) {
        attrs.push(`stroke="${sc}"`, `stroke-width="${round(strokeWidth)}"`);
    }
    return `<rect ${attrs.join(" ")} />`;
}

function renderText(layer: Layer & { type: "text" }): string {
    const lines = (layer.textTransform === "uppercase"
        ? layer.text.toUpperCase()
        : layer.textTransform === "lowercase"
            ? layer.text.toLowerCase()
            : layer.text
    ).split("\n");
    const anchor = layer.align === "center" ? "middle" : layer.align === "right" ? "end" : "start";
    const xPos = layer.align === "center" ? layer.width / 2 : layer.align === "right" ? layer.width : 0;
    const fillVisible = layer.fillEnabled !== false;
    const lineHeight = (layer.lineHeight || 1.2) * layer.fontSize;
    const tspans = lines
        .map((line, i) => `<tspan x="${round(xPos)}" dy="${i === 0 ? round(layer.fontSize) : round(lineHeight)}">${escapeXml(line)}</tspan>`)
        .join("");
    const fontStyle = /italic/i.test(layer.fontWeight) ? ` font-style="italic"` : "";
    const weight = layer.fontWeight ? ` font-weight="${escapeXml(layer.fontWeight.replace(/italic/i, "").trim() || "400")}"` : "";
    return `<text x="${round(xPos)}" y="0" font-family="${escapeXml(layer.fontFamily)}" font-size="${round(layer.fontSize)}"${weight}${fontStyle} fill="${fillVisible ? layer.fill : "none"}" text-anchor="${anchor}"${layer.letterSpacing ? ` letter-spacing="${round(layer.letterSpacing)}"` : ""}>${tspans}</text>`;
}

function renderInlineSvgVector(layer: VectorLayer): string {
    if (!layer.inlineSvg) return "";
    const inner = layer.inlineSvg
        .replace(/^[\s\S]*?<svg[^>]*>/i, "")
        .replace(/<\/svg>\s*$/i, "");
    const vbMatch = layer.inlineSvg.match(/viewBox="([^"]+)"/i);
    const viewBox = vbMatch?.[1] ?? `0 0 ${round(layer.viewBoxWidth ?? layer.width)} ${round(layer.viewBoxHeight ?? layer.height)}`;
    return `<svg x="0" y="0" width="${round(layer.width)}" height="${round(layer.height)}" viewBox="${viewBox}" overflow="visible">${inner}</svg>`;
}

function renderVector(layer: VectorLayer, defs: Defs): string {
    if (layer.inlineSvg) return renderInlineSvgVector(layer);

    const useRaw = !!layer.rawSvgPath;
    const useSubpaths = !useRaw && hasRenderableGeometry(layer.subpaths);
    let d = "";
    let inner = "";
    if (useSubpaths) {
        d = subpathsToPathData(layer.subpaths, layer.width, layer.height);
    } else if (layer.rawSvgPath) {
        d = layer.rawSvgPath;
        const sx = layer.viewBoxWidth ? layer.width / layer.viewBoxWidth : 1;
        const sy = layer.viewBoxHeight ? layer.height / layer.viewBoxHeight : 1;
        if (sx !== 1 || sy !== 1) inner = ` transform="scale(${round(sx)} ${round(sy)})"`;
    }
    if (!d) return "";
    const attrs: string[] = [`d="${escapeXml(d)}"`];
    if (layer.fillRule === "evenodd") attrs.push(`fill-rule="evenodd"`);
    if (layer.fillEnabled === false) {
        attrs.push(`fill="none"`);
    } else {
        const { fill, fillOpacity } = paintToSvgFill(layer.fill, defs, layer.width, layer.height);
        attrs.push(`fill="${fill}"`);
        if (fillOpacity < 1) attrs.push(`fill-opacity="${round(fillOpacity)}"`);
    }
    const sc = layer.strokeEnabled ? strokeColor(layer.stroke) : null;
    if (sc && layer.strokeWidth) {
        attrs.push(`stroke="${sc}"`, `stroke-width="${round(layer.strokeWidth)}"`);
        if (layer.strokeJoin) attrs.push(`stroke-linejoin="${layer.strokeJoin}"`);
    }
    if (inner) {
        return `<g${inner}><path ${attrs.join(" ")} /></g>`;
    }
    return `<path ${attrs.join(" ")} />`;
}

function renderLayer(layer: Layer, all: Layer[], defs: Defs, outlined?: Map<string, OutlinedText>, images?: Map<string, string>): string {
    if (layer.visible === false) return "";
    const opacity = layer.opacity ?? 1;
    const opacityAttr = opacity < 1 ? ` opacity="${round(opacity)}"` : "";
    const transform = layerTransform(layer);
    let body = "";

    switch (layer.type) {
        case "rectangle":
            body = renderRectLike(layer, layer.fill, layer.fillEnabled, layer.stroke, layer.strokeWidth, layer.cornerRadius, defs);
            break;
        case "image": {
            const par = layer.objectFit === "contain" ? "xMidYMid meet" : layer.objectFit === "fill" ? "none" : "xMidYMid slice";
            const clipId = layer.cornerRadius ? `clip${defs.counter++}` : null;
            if (clipId) {
                defs.items.push(`<clipPath id="${clipId}"><rect x="0" y="0" width="${round(layer.width)}" height="${round(layer.height)}" rx="${round(layer.cornerRadius ?? 0)}" /></clipPath>`);
            }
            const href = images?.get(layer.id) ?? layer.src;
            body = `<image href="${escapeXml(href)}" x="0" y="0" width="${round(layer.width)}" height="${round(layer.height)}" preserveAspectRatio="${par}"${clipId ? ` clip-path="url(#${clipId})"` : ""} />`;
            break;
        }
        case "text": {
            const ot = outlined?.get(layer.id);
            body = ot ? `<path d="${escapeXml(ot.d)}" fill="${escapeXml(ot.fill)}" />` : renderText(layer);
            break;
        }
        case "badge": {
            const radius = layer.shape === "pill" ? layer.height / 2 : layer.shape === "circle" ? layer.width / 2 : 4;
            const { fill, fillOpacity } = paintToSvgFill(layer.fill, defs, layer.width, layer.height);
            const rect = `<rect x="0" y="0" width="${round(layer.width)}" height="${round(layer.height)}" rx="${round(radius)}" fill="${layer.fillEnabled === false ? "none" : fill}"${fillOpacity < 1 ? ` fill-opacity="${round(fillOpacity)}"` : ""} />`;
            const text = `<text x="${round(layer.width / 2)}" y="${round(layer.height / 2)}" font-family="Inter" font-size="${round(layer.fontSize)}" fill="${layer.textColor}" text-anchor="middle" dominant-baseline="central">${escapeXml(layer.label)}</text>`;
            body = rect + text;
            break;
        }
        case "vector":
            body = renderVector(layer, defs);
            break;
        case "frame": {
            const frame = layer as FrameLayer;
            const fillRect = renderRectLike(frame, frame.fill, frame.fillEnabled, undefined, undefined, frame.cornerRadius, defs);
            const childIds = Array.isArray(frame.childIds) ? frame.childIds : [];
            const children = childIds
                .map((id) => all.find((l) => l.id === id))
                .filter((l): l is Layer => !!l)
                // Children are positioned absolutely; render relative to the frame origin.
                .map((child) => renderLayer({ ...child, x: child.x - frame.x, y: child.y - frame.y }, all, defs, outlined, images))
                .join("");
            let inner = fillRect + children;
            if (frame.clipContent) {
                const clipId = `clip${defs.counter++}`;
                defs.items.push(`<clipPath id="${clipId}"><rect x="0" y="0" width="${round(frame.width)}" height="${round(frame.height)}"${frame.cornerRadius ? ` rx="${round(frame.cornerRadius)}"` : ""} /></clipPath>`);
                inner = `<g clip-path="url(#${clipId})">${inner}</g>`;
            }
            // Stroke drawn on top.
            const sc = strokeColor(frame.stroke);
            if (sc && frame.strokeWidth) {
                inner += `<rect x="0" y="0" width="${round(frame.width)}" height="${round(frame.height)}"${frame.cornerRadius ? ` rx="${round(frame.cornerRadius)}"` : ""} fill="none" stroke="${sc}" stroke-width="${round(frame.strokeWidth)}" />`;
            }
            body = inner;
            break;
        }
        default:
            body = "";
    }

    if (!body) return "";
    return `<g transform="${transform}"${opacityAttr}>${body}</g>`;
}

export function layersToSvg(options: SvgExportOptions): string {
    const { layers, width, height, artboardFill, artboardFillEnabled, background = true } = options;
    const defs: Defs = { items: [], counter: 0 };

    // Frame children are rendered by their parent frame.
    const childIds = new Set<string>();
    for (const l of layers) {
        if (l.type === "frame" && Array.isArray((l as FrameLayer).childIds)) {
            (l as FrameLayer).childIds.forEach((id) => childIds.add(id));
        }
    }
    const topLevel = layers.filter((l) => !childIds.has(l.id));

    const bodyParts: string[] = [];
    if (background && artboardFillEnabled !== false) {
        const { fill, fillOpacity } = paintToSvgFill(artboardFill ?? "#FFFFFF", defs, width, height);
        bodyParts.push(`<rect x="0" y="0" width="${round(width)}" height="${round(height)}" fill="${fill}"${fillOpacity < 1 ? ` fill-opacity="${round(fillOpacity)}"` : ""} />`);
    }
    for (const layer of topLevel) {
        bodyParts.push(renderLayer(layer, layers, defs, options.outlinedText, options.embeddedImages));
    }

    const defsBlock = defs.items.length > 0 ? `<defs>${defs.items.join("")}</defs>` : "";
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}">${defsBlock}${bodyParts.join("")}</svg>`;
}

/** Serialize a subset of layers to an SVG sized to their combined bounds. */
export function layersToSvgFragment(layers: Layer[], outlinedText?: Map<string, OutlinedText>): string {
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
    const shifted = layers.map((l) => ({ ...l, x: l.x - minX, y: l.y - minY }));
    return layersToSvg({ layers: shifted as Layer[], width, height, background: false, outlinedText });
}
