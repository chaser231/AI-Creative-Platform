import type { VectorLayer, VectorSubpath } from "@/types";
import {
    parseSvgPathToAbsSubpaths,
    absSubpathsToPathData,
    computeAbsBounds,
    normalizeAbsSubpaths,
    normalizeAbsSubpathsInBox,
} from "@/utils/vectorGeometry";

// ─── SVG transform handling ─────────────────────────────
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const SVG_NS = "http://www.w3.org/2000/svg";

function multiply(m1: Matrix, m2: Matrix): Matrix {
    const [a1, b1, c1, d1, e1, f1] = m1;
    const [a2, b2, c2, d2, e2, f2] = m2;
    return [
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    ];
}

function applyMatrix(m: Matrix, x: number, y: number): { x: number; y: number } {
    return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function isIdentity(m: Matrix): boolean {
    return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

function parseTransform(value: string | null): Matrix {
    if (!value) return IDENTITY;
    let result: Matrix = IDENTITY;
    const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(value)) !== null) {
        const fn = match[1].toLowerCase();
        const args = (match[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
        let m: Matrix = IDENTITY;
        switch (fn) {
            case "matrix":
                if (args.length === 6) m = args as Matrix;
                break;
            case "translate":
                m = [1, 0, 0, 1, args[0] || 0, args[1] || 0];
                break;
            case "scale": {
                const sx = args[0] ?? 1;
                const sy = args[1] ?? sx;
                m = [sx, 0, 0, sy, 0, 0];
                break;
            }
            case "rotate": {
                const angle = ((args[0] || 0) * Math.PI) / 180;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                if (args.length >= 3) {
                    const [, cxArg, cyArg] = args;
                    m = multiply([1, 0, 0, 1, cxArg, cyArg], multiply([cos, sin, -sin, cos, 0, 0], [1, 0, 0, 1, -cxArg, -cyArg]));
                } else {
                    m = [cos, sin, -sin, cos, 0, 0];
                }
                break;
            }
            case "skewx":
                m = [1, 0, Math.tan(((args[0] || 0) * Math.PI) / 180), 1, 0, 0];
                break;
            case "skewy":
                m = [1, Math.tan(((args[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
                break;
        }
        result = multiply(result, m);
    }
    return result;
}

function accumulatedTransform(el: Element): Matrix {
    const chain: Matrix[] = [];
    let node: Element | null = el;
    while (node && node.tagName.toLowerCase() !== "svg") {
        chain.push(parseTransform(node.getAttribute("transform")));
        node = node.parentElement;
    }
    let total: Matrix = IDENTITY;
    for (let i = chain.length - 1; i >= 0; i -= 1) {
        total = multiply(total, chain[i]);
    }
    return total;
}

export interface ImportedVector {
    subpaths: VectorSubpath[];
    width: number;
    height: number;
    rawSvgPath?: string;
    viewBoxWidth?: number;
    viewBoxHeight?: number;
    inlineSvg?: string;
    fill: string;
    fillRule: "nonzero" | "evenodd";
    stroke?: string;
    strokeWidth?: number;
}

type AbsSubpath = ReturnType<typeof parseSvgPathToAbsSubpaths>[number];

function rectToPath(x: number, y: number, w: number, h: number, rx: number, ry: number): string {
    if (rx <= 0 && ry <= 0) {
        return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
    }
    const rxC = Math.min(rx || ry, w / 2);
    const ryC = Math.min(ry || rx, h / 2);
    return [
        `M ${x + rxC} ${y}`,
        `H ${x + w - rxC}`,
        `A ${rxC} ${ryC} 0 0 1 ${x + w} ${y + ryC}`,
        `V ${y + h - ryC}`,
        `A ${rxC} ${ryC} 0 0 1 ${x + w - rxC} ${y + h}`,
        `H ${x + rxC}`,
        `A ${rxC} ${ryC} 0 0 1 ${x} ${y + h - ryC}`,
        `V ${y + ryC}`,
        `A ${rxC} ${ryC} 0 0 1 ${x + rxC} ${y}`,
        "Z",
    ].join(" ");
}

function ellipseToPath(cx: number, cy: number, rx: number, ry: number): string {
    return [
        `M ${cx - rx} ${cy}`,
        `A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy}`,
        `A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`,
        "Z",
    ].join(" ");
}

function pointsToPath(points: string, closed: boolean): string {
    const nums = (points.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    if (nums.length < 4) return "";
    const parts: string[] = [`M ${nums[0]} ${nums[1]}`];
    for (let i = 2; i < nums.length - 1; i += 2) {
        parts.push(`L ${nums[i]} ${nums[i + 1]}`);
    }
    if (closed) parts.push("Z");
    return parts.join(" ");
}

function num(el: Element, attr: string, fallback = 0): number {
    const v = el.getAttribute(attr);
    if (v === null) return fallback;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
}

function readFill(el: Element): string | null {
    const direct = el.getAttribute("fill");
    if (direct) return direct;
    const style = el.getAttribute("style");
    if (style) {
        const match = style.match(/fill\s*:\s*([^;]+)/i);
        if (match) return match[1].trim();
    }
    return null;
}

function readStroke(el: Element): string | null {
    const direct = el.getAttribute("stroke");
    if (direct && direct !== "none") return direct;
    const style = el.getAttribute("style");
    if (style) {
        const match = style.match(/stroke\s*:\s*([^;]+)/i);
        if (match && match[1].trim() !== "none") return match[1].trim();
    }
    return null;
}

/** Walk ancestors (incl. self) for the first meaningful fill. */
function readInheritedFill(el: Element): string | null {
    let node: Element | null = el;
    while (node && node.tagName.toLowerCase() !== "svg") {
        const f = readFill(node);
        if (f && f !== "none") return f;
        node = node.parentElement;
    }
    return null;
}

function readInheritedFillRule(el: Element): "nonzero" | "evenodd" {
    let node: Element | null = el;
    while (node && node.tagName.toLowerCase() !== "svg") {
        const rule = node.getAttribute("fill-rule") || node.getAttribute("clip-rule");
        if (rule === "evenodd") return "evenodd";
        node = node.parentElement;
    }
    return "nonzero";
}

function readInheritedStroke(el: Element): string | null {
    let node: Element | null = el;
    while (node && node.tagName.toLowerCase() !== "svg") {
        const s = readStroke(node);
        if (s) return s;
        node = node.parentElement;
    }
    return null;
}

function elementToPathData(el: Element): string {
    const tag = el.tagName.toLowerCase();
    switch (tag) {
        case "path":
            return el.getAttribute("d") ?? "";
        case "rect":
            return rectToPath(num(el, "x"), num(el, "y"), num(el, "width"), num(el, "height"), num(el, "rx"), num(el, "ry"));
        case "circle": {
            const r = num(el, "r");
            return ellipseToPath(num(el, "cx"), num(el, "cy"), r, r);
        }
        case "ellipse":
            return ellipseToPath(num(el, "cx"), num(el, "cy"), num(el, "rx"), num(el, "ry"));
        case "line":
            return `M ${num(el, "x1")} ${num(el, "y1")} L ${num(el, "x2")} ${num(el, "y2")}`;
        case "polyline":
            return pointsToPath(el.getAttribute("points") ?? "", false);
        case "polygon":
            return pointsToPath(el.getAttribute("points") ?? "", true);
        default:
            return "";
    }
}

function escapeAttr(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

const SHAPE_SELECTOR = "path, rect, circle, ellipse, line, polyline, polygon";
const HIDDEN_CONTAINER_TAGS = new Set(["defs", "clippath", "mask", "symbol", "metadata"]);

function isInsideHiddenContainer(el: Element): boolean {
    let node: Element | null = el.parentElement;
    while (node) {
        const tag = node.tagName.toLowerCase();
        if (HIDDEN_CONTAINER_TAGS.has(tag)) return true;
        if (tag === "svg") break;
        node = node.parentElement;
    }
    return false;
}

function isHiddenShape(el: Element): boolean {
    const style = el.getAttribute("style") ?? "";
    if (/\bdisplay\s*:\s*none/i.test(style)) return true;
    if (/\bvisibility\s*:\s*hidden/i.test(style)) return true;
    const opacity = el.getAttribute("opacity");
    if (opacity !== null && parseFloat(opacity) === 0) return true;
    const fill = readInheritedFill(el);
    const stroke = readInheritedStroke(el);
    if (fill === "none" && !stroke) return true;
    return false;
}

function offsetAbsSubpaths(abs: AbsSubpath[], minX: number, minY: number): AbsSubpath[] {
    const ox = (v: number) => v - minX;
    const oy = (v: number) => v - minY;
    return abs.map((sp) => ({
        closed: sp.closed,
        points: sp.points.map((p) => ({
            x: ox(p.x),
            y: oy(p.y),
            ...(p.inX !== undefined && p.inY !== undefined ? { inX: ox(p.inX), inY: oy(p.inY) } : {}),
            ...(p.outX !== undefined && p.outY !== undefined ? { outX: ox(p.outX), outY: oy(p.outY) } : {}),
        })),
    }));
}

function transformAbsSubpaths(abs: AbsSubpath[], m: Matrix): AbsSubpath[] {
    return abs.map((sp) => ({
        closed: sp.closed,
        points: sp.points.map((p) => {
            const a = applyMatrix(m, p.x, p.y);
            const out: typeof p = { x: a.x, y: a.y };
            if (p.inX !== undefined && p.inY !== undefined) {
                const i = applyMatrix(m, p.inX, p.inY);
                out.inX = i.x; out.inY = i.y;
            }
            if (p.outX !== undefined && p.outY !== undefined) {
                const o = applyMatrix(m, p.outX, p.outY);
                out.outX = o.x; out.outY = o.y;
            }
            return out;
        }),
    }));
}

function visibleShapesFromSvg(svg: Element): Element[] {
    return Array.from(svg.querySelectorAll(SHAPE_SELECTOR))
        .filter((shape) => !isInsideHiddenContainer(shape) && !isHiddenShape(shape));
}

function shapesToAbsSubpaths(shapes: Element[]): AbsSubpath[] {
    const allAbs: AbsSubpath[] = [];
    for (const shape of shapes) {
        const d = elementToPathData(shape);
        if (!d) continue;
        const abs = parseSvgPathToAbsSubpaths(d);
        if (abs.length === 0) continue;
        const m = accumulatedTransform(shape);
        allAbs.push(...(isIdentity(m) ? abs : transformAbsSubpaths(abs, m)));
    }
    return allAbs;
}

/** Parse viewBox from an inline SVG snippet (matches KonvaImage stretch mapping). */
export function parseInlineSvgViewBox(inlineSvg: string): { x: number; y: number; width: number; height: number } | null {
    const match = inlineSvg.match(/viewBox=["']([^"']+)["']/i);
    if (!match) return null;
    const nums = match[1].trim().split(/[\s,]+/).map(Number);
    if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return null;
    const width = Math.max(1e-6, nums[2]);
    const height = Math.max(1e-6, nums[3]);
    return { x: nums[0], y: nums[1], width, height };
}

/**
 * Parse SVG into normalized editable subpaths aligned to the inline SVG viewBox.
 * Use for edit overlays so anchor positions match the rasterized preview.
 */
export function parseSvgToEditableSubpaths(svgText: string): VectorSubpath[] | null {
    if (typeof DOMParser === "undefined") return null;
    let doc: Document;
    try {
        doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    } catch {
        return null;
    }
    if (doc.querySelector("parsererror")) return null;
    const svg = doc.querySelector("svg");
    if (!svg) return null;

    const shapes = visibleShapesFromSvg(svg);
    const allAbs = shapesToAbsSubpaths(shapes);
    if (allAbs.length === 0) return null;

    const inline = buildInlineSvg(shapes);
    const vb = inline ? parseInlineSvgViewBox(inline.svg) : null;
    if (vb) {
        return normalizeAbsSubpathsInBox(allAbs, vb.width, vb.height, vb.x, vb.y).subpaths;
    }
    return normalizeAbsSubpaths(allAbs).subpaths;
}

/** Build a faithful inline SVG (browser-measured bbox) for boolean/subtract art. */
function buildInlineSvg(shapes: Element[]): { svg: string; width: number; height: number } | null {
    if (typeof document === "undefined") return null;

    const scratch = document.createElementNS(SVG_NS, "svg");
    scratch.setAttribute("xmlns", SVG_NS);
    scratch.style.cssText = "position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden;pointer-events:none";
    const root = document.createElementNS(SVG_NS, "g");

    for (const shape of shapes) {
        const d = elementToPathData(shape);
        if (!d) continue;
        const m = accumulatedTransform(shape);
        const wrap = document.createElementNS(SVG_NS, "g");
        if (!isIdentity(m)) wrap.setAttribute("transform", `matrix(${m.join(" ")})`);
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        const fill = readInheritedFill(shape);
        if (fill && fill !== "none") path.setAttribute("fill", fill);
        if (readInheritedFillRule(shape) === "evenodd") path.setAttribute("fill-rule", "evenodd");
        const stroke = readInheritedStroke(shape);
        if (stroke) path.setAttribute("stroke", stroke);
        wrap.appendChild(path);
        root.appendChild(wrap);
    }

    if (!root.childNodes.length) return null;
    scratch.appendChild(root);
    document.body.appendChild(scratch);
    let bbox: DOMRect;
    try {
        bbox = root.getBBox();
    } catch {
        document.body.removeChild(scratch);
        return null;
    }
    document.body.removeChild(scratch);

    const width = Math.max(1e-6, bbox.width);
    const height = Math.max(1e-6, bbox.height);

    const parts: string[] = [];
    for (const shape of shapes) {
        const d = elementToPathData(shape);
        if (!d) continue;
        const m = accumulatedTransform(shape);
        const fill = readInheritedFill(shape);
        const rule = readInheritedFillRule(shape);
        const stroke = readInheritedStroke(shape);
        const attrs: string[] = [`d="${escapeAttr(d)}"`];
        if (fill && fill !== "none") attrs.push(`fill="${escapeAttr(fill)}"`);
        if (rule === "evenodd") attrs.push(`fill-rule="evenodd"`);
        if (stroke) attrs.push(`stroke="${escapeAttr(stroke)}"`);
        const xform = isIdentity(m) ? "" : ` transform="matrix(${m.join(" ")})"`;
        parts.push(`<g${xform}><path ${attrs.join(" ")}/></g>`);
    }

    const svg = `<svg xmlns="${SVG_NS}" viewBox="${bbox.x} ${bbox.y} ${width} ${height}" width="${width}" height="${height}">${parts.join("")}</svg>`;
    return { svg, width, height };
}

/**
 * Parse SVG into a vector layer. Figma boolean/subtract exports use even-odd
 * compound paths and group-level fill-rule — we preserve them via inlineSvg +
 * rawSvgPath instead of editable subpaths.
 */
export function parseSvgToVector(svgText: string): ImportedVector | null {
    if (typeof DOMParser === "undefined") return null;
    let doc: Document;
    try {
        doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    } catch {
        return null;
    }
    if (doc.querySelector("parsererror")) return null;
    const svg = doc.querySelector("svg");
    if (!svg) return null;

    const shapes = visibleShapesFromSvg(svg);
    if (shapes.length === 0) return null;

    const allAbs = shapesToAbsSubpaths(shapes);
    if (allAbs.length === 0) return null;

    let fill: string | null = null;
    let fillRule: "nonzero" | "evenodd" = "nonzero";
    let stroke: string | null = null;
    let strokeWidth = 0;

    for (const shape of shapes) {
        const d = elementToPathData(shape);
        if (!d) continue;

        if (fill === null) {
            const shapeFill = readInheritedFill(shape);
            if (shapeFill && shapeFill !== "none") fill = shapeFill;
        }
        if (readInheritedFillRule(shape) === "evenodd") fillRule = "evenodd";
        if (stroke === null) {
            const shapeStroke = readInheritedStroke(shape);
            if (shapeStroke) {
                stroke = shapeStroke;
                strokeWidth = num(shape, "stroke-width", 1);
            }
        }
    }

    // Compound contours (boolean/subtract) almost always need even-odd.
    if (allAbs.length > 1 && fillRule === "nonzero") fillRule = "evenodd";

    const bounds = computeAbsBounds(allAbs);
    const naturalWidth = Math.max(1e-6, bounds.maxX - bounds.minX);
    const naturalHeight = Math.max(1e-6, bounds.maxY - bounds.minY);
    const offset = offsetAbsSubpaths(allAbs, bounds.minX, bounds.minY);
    const rawSvgPath = absSubpathsToPathData(offset);

    const inline = buildInlineSvg(shapes);

    return {
        subpaths: [],
        width: inline?.width ?? naturalWidth,
        height: inline?.height ?? naturalHeight,
        rawSvgPath,
        viewBoxWidth: naturalWidth,
        viewBoxHeight: naturalHeight,
        inlineSvg: inline?.svg,
        fill: fill && fill !== "none" ? fill : "#111827",
        fillRule,
        ...(stroke ? { stroke, strokeWidth } : {}),
    };
}

export function looksLikeSvg(text: string): boolean {
    return /<svg[\s>]/i.test(text);
}

/** Geometry-only props for Figma import — preserves caller width/height. */
export function importedVectorToLayerProps(imported: ImportedVector): Partial<VectorLayer> {
    return {
        subpaths: [],
        rawSvgPath: imported.rawSvgPath,
        viewBoxWidth: imported.viewBoxWidth ?? imported.width,
        viewBoxHeight: imported.viewBoxHeight ?? imported.height,
        inlineSvg: imported.inlineSvg,
        fill: imported.fill,
        fillEnabled: true,
        fillRule: imported.fillRule,
        stroke: imported.stroke ?? "#000000",
        strokeEnabled: !!imported.stroke,
        strokeWidth: imported.strokeWidth ?? 0,
    };
}

export function importedVectorToOverrides(
    imported: ImportedVector,
    opts: { x: number; y: number; maxSize?: number; name?: string },
): Partial<VectorLayer> {
    const maxSize = opts.maxSize ?? 400;
    const scale = Math.min(maxSize / imported.width, maxSize / imported.height, 1);
    const width = Math.max(1, Math.round(imported.width * scale));
    const height = Math.max(1, Math.round(imported.height * scale));
    return {
        name: opts.name ?? "Vector",
        x: opts.x,
        y: opts.y,
        width,
        height,
        ...importedVectorToLayerProps(imported),
    };
}

export const __test__ = { parseTransform, applyMatrix, multiply, isInsideHiddenContainer, isHiddenShape, readInheritedFillRule };

export function svgTextToVectorOverrides(
    svgText: string,
    opts: { x: number; y: number; maxSize?: number; name?: string },
): Partial<VectorLayer> | null {
    const imported = parseSvgToVector(svgText);
    if (!imported) return null;
    return importedVectorToOverrides(imported, opts);
}
