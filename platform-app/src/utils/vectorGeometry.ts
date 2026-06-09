import type { VectorAnchor, VectorSubpath } from "@/types";

/**
 * Vector geometry helpers.
 *
 * Anchor coordinates are stored normalized in the 0..1 range relative to the
 * layer bounding box. Rendering and export multiply by the layer width/height,
 * so non-uniform scaling distorts the path naturally (matching Figma when the
 * aspect ratio is unlocked) and uniform scaling preserves it.
 */

function fmt(n: number): string {
    // Trim to a reasonable precision and drop trailing zeros.
    const rounded = Math.round(n * 1000) / 1000;
    return Number.isFinite(rounded) ? String(rounded) : "0";
}

/** Build an SVG `d` string from normalized subpaths, scaled to width × height. */
export function subpathsToPathData(
    subpaths: VectorSubpath[],
    width = 1,
    height = 1,
): string {
    const commands: string[] = [];

    for (const subpath of subpaths) {
        const points = subpath.points;
        if (points.length === 0) continue;

        const sx = (v: number) => fmt(v * width);
        const sy = (v: number) => fmt(v * height);

        const first = points[0];
        commands.push(`M ${sx(first.x)} ${sy(first.y)}`);

        const segmentCount = subpath.closed ? points.length : points.length - 1;
        for (let i = 0; i < segmentCount; i += 1) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            const aOut = a.outX !== undefined && a.outY !== undefined
                ? { x: a.outX, y: a.outY }
                : null;
            const bIn = b.inX !== undefined && b.inY !== undefined
                ? { x: b.inX, y: b.inY }
                : null;

            if (aOut || bIn) {
                const c1 = aOut ?? { x: a.x, y: a.y };
                const c2 = bIn ?? { x: b.x, y: b.y };
                commands.push(
                    `C ${sx(c1.x)} ${sy(c1.y)} ${sx(c2.x)} ${sy(c2.y)} ${sx(b.x)} ${sy(b.y)}`,
                );
            } else {
                commands.push(`L ${sx(b.x)} ${sy(b.y)}`);
            }
        }

        if (subpath.closed) commands.push("Z");
    }

    return commands.join(" ");
}

/** Build an SVG `d` string from absolute-coordinate subpaths (no scaling). */
export function absSubpathsToPathData(subpaths: Array<{
    points: Array<{
        x: number; y: number;
        inX?: number; inY?: number;
        outX?: number; outY?: number;
    }>;
    closed: boolean;
}>): string {
    const commands: string[] = [];
    const sx = (v: number) => fmt(v);
    const sy = (v: number) => fmt(v);

    for (const subpath of subpaths) {
        const points = subpath.points;
        if (points.length === 0) continue;

        const first = points[0];
        commands.push(`M ${sx(first.x)} ${sy(first.y)}`);

        const segmentCount = subpath.closed ? points.length : points.length - 1;
        for (let i = 0; i < segmentCount; i += 1) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            const aOut = a.outX !== undefined && a.outY !== undefined
                ? { x: a.outX, y: a.outY }
                : null;
            const bIn = b.inX !== undefined && b.inY !== undefined
                ? { x: b.inX, y: b.inY }
                : null;

            if (aOut || bIn) {
                const c1 = aOut ?? { x: a.x, y: a.y };
                const c2 = bIn ?? { x: b.x, y: b.y };
                commands.push(
                    `C ${sx(c1.x)} ${sy(c1.y)} ${sx(c2.x)} ${sy(c2.y)} ${sx(b.x)} ${sy(b.y)}`,
                );
            } else {
                commands.push(`L ${sx(b.x)} ${sy(b.y)}`);
            }
        }

        if (subpath.closed) commands.push("Z");
    }

    return commands.join(" ");
}

/** Whether any subpath holds at least two points. */
export function hasRenderableGeometry(subpaths: VectorSubpath[] | undefined): boolean {
    if (!subpaths) return false;
    return subpaths.some((sp) => sp.points.length >= 2);
}

// ─── SVG path parsing ───────────────────────────────────

interface AbsAnchor {
    x: number;
    y: number;
    inX?: number;
    inY?: number;
    outX?: number;
    outY?: number;
}

interface AbsSubpath {
    points: AbsAnchor[];
    closed: boolean;
}

const NUMBER_RE = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

function tokenizePath(d: string): Array<{ cmd: string; args: number[] }> {
    const tokens: Array<{ cmd: string; args: number[] }> = [];
    const re = /([a-zA-Z])([^a-zA-Z]*)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(d)) !== null) {
        const cmd = match[1];
        const args = (match[2].match(NUMBER_RE) ?? []).map(Number);
        tokens.push({ cmd, args });
    }
    return tokens;
}

function arcToCubics(
    x1: number,
    y1: number,
    rx: number,
    ry: number,
    angleDeg: number,
    largeArc: number,
    sweep: number,
    x2: number,
    y2: number,
): Array<[number, number, number, number, number, number]> {
    // Endpoint -> center parameterization (W3C SVG implementation notes).
    if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
    const phi = (angleDeg * Math.PI) / 180;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const dx = (x1 - x2) / 2;
    const dy = (y1 - y2) / 2;
    const x1p = cosPhi * dx + sinPhi * dy;
    const y1p = -sinPhi * dx + cosPhi * dy;
    let rxAbs = Math.abs(rx);
    let ryAbs = Math.abs(ry);
    const lambda = (x1p * x1p) / (rxAbs * rxAbs) + (y1p * y1p) / (ryAbs * ryAbs);
    if (lambda > 1) {
        const s = Math.sqrt(lambda);
        rxAbs *= s;
        ryAbs *= s;
    }
    const sign = largeArc === sweep ? -1 : 1;
    const num = rxAbs * rxAbs * ryAbs * ryAbs - rxAbs * rxAbs * y1p * y1p - ryAbs * ryAbs * x1p * x1p;
    const den = rxAbs * rxAbs * y1p * y1p + ryAbs * ryAbs * x1p * x1p;
    const co = sign * Math.sqrt(Math.max(0, num / den));
    const cxp = (co * (rxAbs * y1p)) / ryAbs;
    const cyp = (co * -(ryAbs * x1p)) / rxAbs;
    const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
    const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

    const angle = (ux: number, uy: number, vx: number, vy: number) => {
        const dot = ux * vx + uy * vy;
        const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
        let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
        if (ux * vy - uy * vx < 0) a = -a;
        return a;
    };
    const theta1 = angle(1, 0, (x1p - cxp) / rxAbs, (y1p - cyp) / ryAbs);
    let dTheta = angle(
        (x1p - cxp) / rxAbs,
        (y1p - cyp) / ryAbs,
        (-x1p - cxp) / rxAbs,
        (-y1p - cyp) / ryAbs,
    );
    if (sweep === 0 && dTheta > 0) dTheta -= 2 * Math.PI;
    if (sweep === 1 && dTheta < 0) dTheta += 2 * Math.PI;

    const segments = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
    const delta = dTheta / segments;
    const t = (4 / 3) * Math.tan(delta / 4);
    const result: Array<[number, number, number, number, number, number]> = [];

    let theta = theta1;
    for (let i = 0; i < segments; i += 1) {
        const cosT1 = Math.cos(theta);
        const sinT1 = Math.sin(theta);
        const theta2 = theta + delta;
        const cosT2 = Math.cos(theta2);
        const sinT2 = Math.sin(theta2);

        const e1x = cx + rxAbs * cosPhi * cosT1 - ryAbs * sinPhi * sinT1;
        const e1y = cy + rxAbs * sinPhi * cosT1 + ryAbs * cosPhi * sinT1;
        const e2x = cx + rxAbs * cosPhi * cosT2 - ryAbs * sinPhi * sinT2;
        const e2y = cy + rxAbs * sinPhi * cosT2 + ryAbs * cosPhi * sinT2;

        const d1x = -rxAbs * cosPhi * sinT1 - ryAbs * sinPhi * cosT1;
        const d1y = -rxAbs * sinPhi * sinT1 + ryAbs * cosPhi * cosT1;
        const d2x = -rxAbs * cosPhi * sinT2 - ryAbs * sinPhi * cosT2;
        const d2y = -rxAbs * sinPhi * sinT2 + ryAbs * cosPhi * cosT2;

        result.push([
            e1x + t * d1x,
            e1y + t * d1y,
            e2x - t * d2x,
            e2y - t * d2y,
            e2x,
            e2y,
        ]);
        theta = theta2;
    }
    return result;
}

/** Parse an SVG path `d` string into absolute-coordinate subpaths. */
export function parseSvgPathToAbsSubpaths(d: string): AbsSubpath[] {
    const tokens = tokenizePath(d);
    const subpaths: AbsSubpath[] = [];
    let current: AbsSubpath | null = null;

    let cx = 0;
    let cy = 0;
    let startX = 0;
    let startY = 0;
    let prevCmd = "";
    let prevC2x = 0;
    let prevC2y = 0;
    let prevQx = 0;
    let prevQy = 0;

    const pushPoint = (p: AbsAnchor) => {
        if (!current) {
            current = { points: [], closed: false };
            subpaths.push(current);
        }
        current.points.push(p);
    };
    const lastPoint = () => (current && current.points.length > 0 ? current.points[current.points.length - 1] : null);

    for (const token of tokens) {
        const code = token.cmd;
        const upper = code.toUpperCase();
        const rel = code !== upper;
        const a = token.args;

        const stride =
            upper === "M" || upper === "L" || upper === "T" ? 2 :
            upper === "H" || upper === "V" ? 1 :
            upper === "C" ? 6 :
            upper === "S" || upper === "Q" ? 4 :
            upper === "A" ? 7 :
            upper === "Z" ? 0 : 2;

        const groups: number[][] = stride === 0 ? [[]] : [];
        for (let i = 0; i < a.length; i += stride) groups.push(a.slice(i, i + stride));

        for (let g = 0; g < groups.length; g += 1) {
            const args = groups[g];
            if (upper === "M") {
                let nx = args[0];
                let ny = args[1];
                if (rel) { nx += cx; ny += cy; }
                // Implicit moveto pairs after the first become linetos.
                if (g === 0) {
                    current = { points: [], closed: false };
                    subpaths.push(current);
                    pushPoint({ x: nx, y: ny });
                    startX = nx;
                    startY = ny;
                } else {
                    pushPoint({ x: nx, y: ny });
                }
                cx = nx; cy = ny;
            } else if (upper === "L") {
                let nx = args[0];
                let ny = args[1];
                if (rel) { nx += cx; ny += cy; }
                pushPoint({ x: nx, y: ny });
                cx = nx; cy = ny;
            } else if (upper === "H") {
                let nx = args[0];
                if (rel) nx += cx;
                pushPoint({ x: nx, y: cy });
                cx = nx;
            } else if (upper === "V") {
                let ny = args[0];
                if (rel) ny += cy;
                pushPoint({ x: cx, y: ny });
                cy = ny;
            } else if (upper === "C") {
                let c1x = args[0], c1y = args[1], c2x = args[2], c2y = args[3], nx = args[4], ny = args[5];
                if (rel) { c1x += cx; c1y += cy; c2x += cx; c2y += cy; nx += cx; ny += cy; }
                const prev = lastPoint();
                if (prev) { prev.outX = c1x; prev.outY = c1y; }
                pushPoint({ x: nx, y: ny, inX: c2x, inY: c2y });
                prevC2x = c2x; prevC2y = c2y;
                cx = nx; cy = ny;
            } else if (upper === "S") {
                let c2x = args[0], c2y = args[1], nx = args[2], ny = args[3];
                if (rel) { c2x += cx; c2y += cy; nx += cx; ny += cy; }
                const reflectC1x = "CS".includes(prevCmd.toUpperCase()) ? 2 * cx - prevC2x : cx;
                const reflectC1y = "CS".includes(prevCmd.toUpperCase()) ? 2 * cy - prevC2y : cy;
                const prev = lastPoint();
                if (prev) { prev.outX = reflectC1x; prev.outY = reflectC1y; }
                pushPoint({ x: nx, y: ny, inX: c2x, inY: c2y });
                prevC2x = c2x; prevC2y = c2y;
                cx = nx; cy = ny;
            } else if (upper === "Q") {
                let qx = args[0], qy = args[1], nx = args[2], ny = args[3];
                if (rel) { qx += cx; qy += cy; nx += cx; ny += cy; }
                // Convert quadratic to cubic.
                const c1x = cx + (2 / 3) * (qx - cx);
                const c1y = cy + (2 / 3) * (qy - cy);
                const c2x = nx + (2 / 3) * (qx - nx);
                const c2y = ny + (2 / 3) * (qy - ny);
                const prev = lastPoint();
                if (prev) { prev.outX = c1x; prev.outY = c1y; }
                pushPoint({ x: nx, y: ny, inX: c2x, inY: c2y });
                prevQx = qx; prevQy = qy;
                cx = nx; cy = ny;
            } else if (upper === "T") {
                let nx = args[0], ny = args[1];
                if (rel) { nx += cx; ny += cy; }
                const qx = "QT".includes(prevCmd.toUpperCase()) ? 2 * cx - prevQx : cx;
                const qy = "QT".includes(prevCmd.toUpperCase()) ? 2 * cy - prevQy : cy;
                const c1x = cx + (2 / 3) * (qx - cx);
                const c1y = cy + (2 / 3) * (qy - cy);
                const c2x = nx + (2 / 3) * (qx - nx);
                const c2y = ny + (2 / 3) * (qy - ny);
                const prev = lastPoint();
                if (prev) { prev.outX = c1x; prev.outY = c1y; }
                pushPoint({ x: nx, y: ny, inX: c2x, inY: c2y });
                prevQx = qx; prevQy = qy;
                cx = nx; cy = ny;
            } else if (upper === "A") {
                let rx = args[0], ry = args[1];
                const xRot = args[2], largeArc = args[3], sweep = args[4];
                let nx = args[5], ny = args[6];
                if (rel) { nx += cx; ny += cy; }
                const cubics = arcToCubics(cx, cy, rx, ry, xRot, largeArc, sweep, nx, ny);
                for (const [c1x, c1y, c2x, c2y, ex, ey] of cubics) {
                    const prev = lastPoint();
                    if (prev) { prev.outX = c1x; prev.outY = c1y; }
                    pushPoint({ x: ex, y: ey, inX: c2x, inY: c2y });
                    cx = ex; cy = ey;
                }
            } else if (upper === "Z") {
                if (current) {
                    current.closed = true;
                    cx = startX; cy = startY;
                }
            }
            prevCmd = code;
        }
    }

    return subpaths.filter((sp) => sp.points.length > 0);
}

/** Tight-ish bounding box over anchors and their control handles. */
export function computeAbsBounds(subpaths: AbsSubpath[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const consider = (x: number, y: number) => {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    };
    for (const sp of subpaths) {
        for (const p of sp.points) {
            consider(p.x, p.y);
            if (p.inX !== undefined && p.inY !== undefined) consider(p.inX, p.inY);
            if (p.outX !== undefined && p.outY !== undefined) consider(p.outX, p.outY);
        }
    }
    if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    return { minX, minY, maxX, maxY };
}

/**
 * Normalize absolute subpaths into 0..1 space. Returns the normalized subpaths
 * plus the natural width/height of the source bounding box.
 */
export function normalizeAbsSubpaths(absSubpaths: AbsSubpath[]): {
    subpaths: VectorSubpath[];
    width: number;
    height: number;
} {
    const bounds = computeAbsBounds(absSubpaths);
    const width = Math.max(1e-6, bounds.maxX - bounds.minX);
    const height = Math.max(1e-6, bounds.maxY - bounds.minY);
    return normalizeAbsSubpathsInBox(absSubpaths, width, height, bounds.minX, bounds.minY);
}

/** Normalize path coords into 0..1 using an explicit box (e.g. Figma viewBox size). */
export function normalizeAbsSubpathsInBox(
    absSubpaths: AbsSubpath[],
    boxWidth: number,
    boxHeight: number,
    originX = 0,
    originY = 0,
): {
    subpaths: VectorSubpath[];
    width: number;
    height: number;
} {
    const width = Math.max(1e-6, boxWidth);
    const height = Math.max(1e-6, boxHeight);
    const nx = (x: number) => (x - originX) / width;
    const ny = (y: number) => (y - originY) / height;

    const subpaths: VectorSubpath[] = absSubpaths.map((sp) => ({
        closed: sp.closed,
        points: sp.points.map((p): VectorAnchor => {
            const hasIn = p.inX !== undefined && p.inY !== undefined;
            const hasOut = p.outX !== undefined && p.outY !== undefined;
            return {
                x: nx(p.x),
                y: ny(p.y),
                ...(hasIn ? { inX: nx(p.inX as number), inY: ny(p.inY as number) } : {}),
                ...(hasOut ? { outX: nx(p.outX as number), outY: ny(p.outY as number) } : {}),
                type: hasIn || hasOut ? "bezier" : "corner",
            };
        }),
    }));

    return { subpaths, width, height };
}

/** Parse a path `d` string straight into normalized subpaths + natural size. */
export function pathDataToSubpaths(
    d: string,
    boxWidth?: number,
    boxHeight?: number,
): {
    subpaths: VectorSubpath[];
    width: number;
    height: number;
} {
    const abs = parseSvgPathToAbsSubpaths(d);
    if (boxWidth !== undefined && boxHeight !== undefined) {
        const bounds = computeAbsBounds(abs);
        return normalizeAbsSubpathsInBox(abs, boxWidth, boxHeight, bounds.minX, bounds.minY);
    }
    return normalizeAbsSubpaths(abs);
}

// ─── Built-in shape factories (normalized 0..1) ─────────

/** A simple closed polygon star, normalized to the unit box. */
export function makeStarSubpaths(points = 5, innerRatio = 0.45): VectorSubpath[] {
    const anchors: VectorAnchor[] = [];
    const cx = 0.5;
    const cy = 0.5;
    const outer = 0.5;
    const inner = outer * innerRatio;
    const count = points * 2;
    for (let i = 0; i < count; i += 1) {
        const r = i % 2 === 0 ? outer : inner;
        const angle = -Math.PI / 2 + (i * Math.PI) / points;
        anchors.push({
            x: cx + r * Math.cos(angle),
            y: cy + r * Math.sin(angle),
            type: "corner",
        });
    }
    return [{ points: anchors, closed: true }];
}

/** Layer-local pixel position of an anchor for editing overlays. */
export function anchorToLocalPx(
    anchor: { x: number; y: number },
    width: number,
    height: number,
): { x: number; y: number } {
    return { x: anchor.x * width, y: anchor.y * height };
}
