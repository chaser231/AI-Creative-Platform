import Konva from "konva";
import type { StrokeAlign, StrokeJoin } from "@/types";

export function resolveStrokeAlign(align?: StrokeAlign): StrokeAlign {
    return align ?? "center";
}

export function resolveStrokeJoin(join?: StrokeJoin): StrokeJoin {
    return join ?? "miter";
}

/** Konva `lineJoin` for stroke corners. */
export function strokeJoinToKonvaLineJoin(join?: StrokeJoin): "miter" | "round" | "bevel" {
    return resolveStrokeJoin(join);
}

/** Clamp corner radius to what Konva allows for a rect of the given size. */
export function capCornerRadius(radius: number, width: number, height: number): number {
    if (radius <= 0 || width <= 0 || height <= 0) return 0;
    return Math.min(radius, width / 2, height / 2);
}

/**
 * Inset stroke path so the stroke sits inside the layer box.
 * Path radius = layer radius − strokeWidth/2 so the inner stroke edge follows the fill outline.
 */
export function getInsideStrokePath(
    width: number,
    height: number,
    strokeWidth: number,
    cornerRadius = 0,
): { x: number; y: number; width: number; height: number; cornerRadius: number } {
    const half = strokeWidth / 2;
    const pathW = Math.max(0, width - strokeWidth);
    const pathH = Math.max(0, height - strokeWidth);
    const pathRadius = cornerRadius > 0 ? cornerRadius - half : 0;
    return {
        x: half,
        y: half,
        width: pathW,
        height: pathH,
        cornerRadius: capCornerRadius(pathRadius, pathW, pathH),
    };
}

/**
 * Outset stroke path so the stroke sits outside the layer box.
 * Path radius = layer radius + strokeWidth/2 so the inner stroke edge follows the fill outline.
 */
export function getOutsideStrokePath(
    width: number,
    height: number,
    strokeWidth: number,
    cornerRadius = 0,
): { x: number; y: number; width: number; height: number; cornerRadius: number } {
    const half = strokeWidth / 2;
    const pathW = width + strokeWidth;
    const pathH = height + strokeWidth;
    const pathRadius = cornerRadius > 0 ? cornerRadius + half : 0;
    return {
        x: -half,
        y: -half,
        width: pathW,
        height: pathH,
        cornerRadius: capCornerRadius(pathRadius, pathW, pathH),
    };
}

export interface LayerBoxClientRectOpts {
    width: number;
    height: number;
    strokeWidth: number;
    strokeAlign?: StrokeAlign;
    strokeEnabled?: boolean;
}

/**
 * Bounds = layer box + visible stroke extent (Figma-like), ignoring overflowing Konva children.
 */
export function computeLayerBoxClientRect(
    node: Konva.Node,
    opts: LayerBoxClientRectOpts,
    config?: {
        skipTransform?: boolean;
        skipStroke?: boolean;
        relativeTo?: Konva.Container;
    },
): { x: number; y: number; width: number; height: number } {
    let x = 0;
    let y = 0;
    let width = opts.width;
    let height = opts.height;

    if (
        !config?.skipStroke
        && opts.strokeEnabled !== false
        && opts.strokeWidth > 0
    ) {
        const exp = getStrokeBoundsExpansion(opts.strokeWidth, opts.strokeAlign);
        x += exp.x;
        y += exp.y;
        width += exp.width;
        height += exp.height;
    }

    const rect = { x, y, width, height };

    if (config?.skipTransform) {
        return rect;
    }

    const absoluteTransform = node.getAbsoluteTransform();
    const relativeToTransform = config?.relativeTo?.getAbsoluteTransform() ?? new Konva.Transform();
    const relativeTransform = relativeToTransform.copy().invert().multiply(absoluteTransform);

    const pts = [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.height },
        { x: rect.x, y: rect.y + rect.height },
    ].map((p) => relativeTransform.point(p));

    const minX = Math.min(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxX = Math.max(...pts.map((p) => p.x));
    const maxY = Math.max(...pts.map((p) => p.y));

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    };
}

export function installLayerBoxGetClientRect(
    node: Konva.Group,
    opts: LayerBoxClientRectOpts,
): void {
    node.getClientRect = (config) => computeLayerBoxClientRect(node, opts, config);
}

/** Extra bounds (local coords) that visible stroke adds beyond the layer box. */
export function getStrokeBoundsExpansion(
    strokeWidth: number,
    strokeAlign?: StrokeAlign,
): { x: number; y: number; width: number; height: number } {
    const sw = Math.max(0, strokeWidth);
    if (sw <= 0) return { x: 0, y: 0, width: 0, height: 0 };

    switch (resolveStrokeAlign(strokeAlign)) {
        case "inside":
            return { x: 0, y: 0, width: 0, height: 0 };
        case "outside":
            return { x: -sw, y: -sw, width: sw * 2, height: sw * 2 };
        case "center":
        default:
            return { x: -sw / 2, y: -sw / 2, width: sw, height: sw };
    }
}

export function roundedRectClipPath(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cornerRadius: number,
): void {
    const r = Math.min(cornerRadius, width / 2, height / 2);
    if (r <= 0) {
        ctx.rect(0, 0, width, height);
        return;
    }
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(width, 0, width, height, r);
    ctx.arcTo(width, height, 0, height, r);
    ctx.arcTo(0, height, 0, 0, r);
    ctx.arcTo(0, 0, width, 0, r);
    ctx.closePath();
}
