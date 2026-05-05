import type { GradientPaint, GradientType, Paint, PaintPoint, PaintStop, SolidPaint } from "@/types";

export type NormalizedPaint = SolidPaint | GradientPaint;

const DEFAULT_SOLID: SolidPaint = { kind: "solid", color: "#FFFFFF", opacity: 1 };
const PATTERN_CACHE_LIMIT = 80;
const patternCache = new Map<string, HTMLCanvasElement>();

function clamp01(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

function clampAngle(value: number) {
    if (!Number.isFinite(value)) return 0;
    return ((value % 360) + 360) % 360;
}

function makeId(prefix = "stop") {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePoint(point: PaintPoint | undefined, fallback: PaintPoint): PaintPoint {
    return {
        x: clamp01(point?.x ?? fallback.x),
        y: clamp01(point?.y ?? fallback.y),
    };
}

export function isSolidPaint(value: Paint | undefined): value is SolidPaint {
    return typeof value === "object" && value !== null && value.kind === "solid";
}

export function isGradientPaint(value: Paint | undefined): value is GradientPaint {
    return typeof value === "object" && value !== null && value.kind === "gradient";
}

export function isPaint(value: unknown): value is Paint {
    return typeof value === "string" || isSolidPaint(value as Paint) || isGradientPaint(value as Paint);
}

export function normalizeStops(stops: PaintStop[] | undefined): PaintStop[] {
    const source = stops && stops.length >= 2
        ? stops
        : [
            { id: makeId("stop"), offset: 0, color: "#FF5C4D", opacity: 1 },
            { id: makeId("stop"), offset: 1, color: "#8341EF", opacity: 1 },
        ];

    return source
        .map((stop, index) => ({
            id: stop.id || makeId("stop"),
            offset: clamp01(stop.offset ?? index / Math.max(1, source.length - 1)),
            color: stop.color || "#000000",
            opacity: clamp01(stop.opacity ?? 1),
        }))
        .sort((a, b) => a.offset - b.offset);
}

export function normalizePaint(value: Paint | undefined, fallback: Paint = DEFAULT_SOLID): NormalizedPaint {
    if (typeof value === "string") {
        if (value.trim().toLowerCase() === "transparent") {
            return { kind: "solid", color: "#000000", opacity: 0 };
        }
        return { kind: "solid", color: value || DEFAULT_SOLID.color, opacity: 1 };
    }

    if (isSolidPaint(value)) {
        return {
            kind: "solid",
            color: value.color || DEFAULT_SOLID.color,
            opacity: clamp01(value.opacity ?? 1),
        };
    }

    if (isGradientPaint(value)) {
        return {
            kind: "gradient",
            gradientType: value.gradientType ?? "linear",
            stops: normalizeStops(value.stops),
            angle: clampAngle(value.angle ?? 0),
            start: normalizePoint(value.start, { x: 0, y: 0.5 }),
            end: normalizePoint(value.end, { x: 1, y: 0.5 }),
            center: normalizePoint(value.center, { x: 0.5, y: 0.5 }),
            radius: clamp01(value.radius ?? 0.7),
        };
    }

    return normalizePaint(fallback);
}

export function makeSolidPaint(color = "#FFFFFF", opacity = 1): SolidPaint {
    return { kind: "solid", color, opacity: clamp01(opacity) };
}

export function makeGradientPaint(
    gradientType: GradientType = "linear",
    stops?: PaintStop[],
    angle = 0,
): GradientPaint {
    return {
        kind: "gradient",
        gradientType,
        stops: normalizeStops(stops),
        angle: clampAngle(angle),
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
        center: { x: 0.5, y: 0.5 },
        radius: 0.7,
    };
}

export function gradientEndpointsFromAngle(angle: number): { start: PaintPoint; end: PaintPoint } {
    const radians = (clampAngle(angle) * Math.PI) / 180;
    const dx = Math.cos(radians) / 2;
    const dy = Math.sin(radians) / 2;
    return {
        start: { x: clamp01(0.5 - dx), y: clamp01(0.5 - dy) },
        end: { x: clamp01(0.5 + dx), y: clamp01(0.5 + dy) },
    };
}

function parseHexColor(color: string): { r: number; g: number; b: number; a: number } | null {
    const raw = color.trim().replace(/^#/, "");
    const expand = (v: string) => v.split("").map((ch) => ch + ch).join("");
    const hex = raw.length === 3 || raw.length === 4 ? expand(raw) : raw;
    if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return null;
    return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
}

function parseRgbColor(color: string): { r: number; g: number; b: number; a: number } | null {
    const match = color.trim().match(/^rgba?\(([^)]+)\)$/i);
    if (!match) return null;
    const parts = match[1].split(",").map((part) => part.trim());
    if (parts.length < 3) return null;
    return {
        r: Number(parts[0]),
        g: Number(parts[1]),
        b: Number(parts[2]),
        a: parts[3] === undefined ? 1 : Number(parts[3]),
    };
}

function parseColor(color: string) {
    if (color.trim().toLowerCase() === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    return parseHexColor(color) ?? parseRgbColor(color);
}

function colorToCss(color: string, opacity = 1): string {
    const parsed = parseColor(color);
    const alpha = clamp01((parsed?.a ?? 1) * opacity);
    if (!parsed) return opacity >= 1 ? color : `rgba(0, 0, 0, ${alpha})`;
    if (alpha >= 0.999 && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color.trim())) {
        return color;
    }
    return `rgba(${Math.round(parsed.r)}, ${Math.round(parsed.g)}, ${Math.round(parsed.b)}, ${alpha})`;
}

export function paintToCssBackground(value: Paint | undefined): string {
    const paint = normalizePaint(value);
    if (paint.kind === "solid") return colorToCss(paint.color, paint.opacity);

    const stops = paint.stops
        .map((stop) => `${colorToCss(stop.color, stop.opacity)} ${Math.round(stop.offset * 100)}%`)
        .join(", ");

    if (paint.gradientType === "radial") return `radial-gradient(circle, ${stops})`;
    if (paint.gradientType === "angular") return `conic-gradient(from ${paint.angle}deg, ${stops})`;
    if (paint.gradientType === "diamond") return `radial-gradient(closest-side at 50% 50%, ${stops})`;
    return `linear-gradient(${paint.angle + 90}deg, ${stops})`;
}

function gradientColorStops(stops: PaintStop[]): Array<number | string> {
    return normalizeStops(stops).flatMap((stop) => [stop.offset, colorToCss(stop.color, stop.opacity)]);
}

function linearPoints(paint: GradientPaint, width: number, height: number) {
    if (paint.start && paint.end) {
        return {
            start: { x: paint.start.x * width, y: paint.start.y * height },
            end: { x: paint.end.x * width, y: paint.end.y * height },
        };
    }

    const angle = (paint.angle * Math.PI) / 180;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const length = Math.abs(width * ux) + Math.abs(height * uy);
    const cx = width / 2;
    const cy = height / 2;
    return {
        start: { x: cx - (ux * length) / 2, y: cy - (uy * length) / 2 },
        end: { x: cx + (ux * length) / 2, y: cy + (uy * length) / 2 },
    };
}

function cachePattern(key: string, create: () => HTMLCanvasElement | null) {
    const cached = patternCache.get(key);
    if (cached) return cached;
    const next = create();
    if (!next) return null;
    patternCache.set(key, next);
    if (patternCache.size > PATTERN_CACHE_LIMIT) {
        const first = patternCache.keys().next().value;
        if (first) patternCache.delete(first);
    }
    return next;
}

function createPatternCanvas(paint: GradientPaint, width: number, height: number): HTMLCanvasElement | null {
    if (typeof document === "undefined") return null;
    const maxSide = 512;
    const scale = Math.min(1, maxSide / Math.max(width, height, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const stops = normalizeStops(paint.stops);
    if (paint.gradientType === "angular") {
        const gradient = ctx.createConicGradient(
            (paint.angle * Math.PI) / 180,
            canvas.width * (paint.center?.x ?? 0.5),
            canvas.height * (paint.center?.y ?? 0.5),
        );
        stops.forEach((stop) => gradient.addColorStop(stop.offset, colorToCss(stop.color, stop.opacity)));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return canvas;
    }

    const image = ctx.createImageData(canvas.width, canvas.height);
    const parsedStops = stops.map((stop) => ({
        ...stop,
        rgba: parseColor(stop.color) ?? { r: 0, g: 0, b: 0, a: 1 },
    }));
    const cx = canvas.width * (paint.center?.x ?? 0.5);
    const cy = canvas.height * (paint.center?.y ?? 0.5);
    const maxDistance = Math.max(cx, canvas.width - cx) + Math.max(cy, canvas.height - cy);

    for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
            const t = clamp01((Math.abs(x - cx) + Math.abs(y - cy)) / Math.max(1, maxDistance));
            let left = parsedStops[0];
            let right = parsedStops[parsedStops.length - 1];
            for (let i = 0; i < parsedStops.length - 1; i += 1) {
                if (t >= parsedStops[i].offset && t <= parsedStops[i + 1].offset) {
                    left = parsedStops[i];
                    right = parsedStops[i + 1];
                    break;
                }
            }
            const span = Math.max(0.0001, right.offset - left.offset);
            const local = clamp01((t - left.offset) / span);
            const idx = (y * canvas.width + x) * 4;
            image.data[idx] = Math.round(left.rgba.r + (right.rgba.r - left.rgba.r) * local);
            image.data[idx + 1] = Math.round(left.rgba.g + (right.rgba.g - left.rgba.g) * local);
            image.data[idx + 2] = Math.round(left.rgba.b + (right.rgba.b - left.rgba.b) * local);
            image.data[idx + 3] = Math.round((left.rgba.a * left.opacity + (right.rgba.a * right.opacity - left.rgba.a * left.opacity) * local) * 255);
        }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
}

export function paintToKonvaProps(
    value: Paint | undefined,
    width: number,
    height: number,
): Record<string, unknown> {
    const paint = normalizePaint(value);
    if (paint.kind === "solid") {
        return {
            fill: colorToCss(paint.color, paint.opacity),
            fillPriority: "color",
        };
    }

    if (paint.gradientType === "linear") {
        const { start, end } = linearPoints(paint, width, height);
        return {
            fillPriority: "linear-gradient",
            fillLinearGradientStartPoint: start,
            fillLinearGradientEndPoint: end,
            fillLinearGradientColorStops: gradientColorStops(paint.stops),
        };
    }

    if (paint.gradientType === "radial") {
        const center = paint.center ?? { x: 0.5, y: 0.5 };
        return {
            fillPriority: "radial-gradient",
            fillRadialGradientStartPoint: { x: center.x * width, y: center.y * height },
            fillRadialGradientEndPoint: { x: center.x * width, y: center.y * height },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius: Math.max(width, height) * (paint.radius ?? 0.7),
            fillRadialGradientColorStops: gradientColorStops(paint.stops),
        };
    }

    const cacheKey = JSON.stringify({ paint, width: Math.round(width), height: Math.round(height) });
    const pattern = cachePattern(cacheKey, () => createPatternCanvas(paint, width, height));
    if (!pattern) return { fill: paintToCssBackground(paint), fillPriority: "color" };
    return {
        fillPriority: "pattern",
        fillPatternImage: pattern,
        fillPatternRepeat: "no-repeat",
        fillPatternScaleX: width / pattern.width,
        fillPatternScaleY: height / pattern.height,
    };
}

export function flipGradientPaint(value: Paint): GradientPaint {
    const paint = normalizePaint(value).kind === "gradient" ? normalizePaint(value) as GradientPaint : makeGradientPaint();
    return {
        ...paint,
        stops: normalizeStops(paint.stops).map((stop) => ({ ...stop, offset: 1 - stop.offset })).sort((a, b) => a.offset - b.offset),
    };
}

export function rotateGradientPaint(value: Paint, delta = 45): GradientPaint {
    const paint = normalizePaint(value).kind === "gradient" ? normalizePaint(value) as GradientPaint : makeGradientPaint();
    const angle = clampAngle(paint.angle + delta);
    return { ...paint, angle, ...gradientEndpointsFromAngle(angle) };
}

export function setGradientEndpoints(value: Paint, start: PaintPoint, end: PaintPoint): GradientPaint {
    const normalized = normalizePaint(value);
    const paint = normalized.kind === "gradient" ? normalized : makeGradientPaint();
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    return {
        ...paint,
        gradientType: paint.gradientType === "linear" ? "linear" : paint.gradientType,
        start: normalizePoint(start, { x: 0, y: 0.5 }),
        end: normalizePoint(end, { x: 1, y: 0.5 }),
        angle: clampAngle((Math.atan2(dy, dx) * 180) / Math.PI),
    };
}

export function gradientLabel(value: Paint | undefined): string {
    const paint = normalizePaint(value);
    if (paint.kind === "solid") return paint.opacity < 1 ? `${Math.round(paint.opacity * 100)}%` : paint.color;
    const labels: Record<GradientType, string> = {
        linear: "Linear",
        radial: "Radial",
        angular: "Angular",
        diamond: "Diamond",
    };
    return labels[paint.gradientType];
}
