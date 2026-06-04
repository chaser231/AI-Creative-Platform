"use client";

import { Group, Rect, Shape } from "react-konva";
import type { LayerImageFill, Paint, StrokeAlign, StrokeJoin } from "@/types";
import { computeImageFitProps } from "@/utils/imageFitUtils";
import { paintToCanvasStyle } from "@/utils/paint";
import {
    capCornerRadiusValue,
    type CornerRadiusValue,
    getInsideStrokePath,
    getOutsideStrokePath,
    resolveStrokeAlign,
    strokeJoinToKonvaLineJoin,
} from "@/utils/strokeGeometry";

export interface AlignedStrokeRectProps {
    width: number;
    height: number;
    cornerRadius?: CornerRadiusValue;
    fill?: string;
    fillEnabled?: boolean;
    fillPriority?: string;
    fillLinearGradientStartPoint?: { x: number; y: number };
    fillLinearGradientEndPoint?: { x: number; y: number };
    fillLinearGradientColorStops?: (number | string)[];
    fillRadialGradientStartPoint?: { x: number; y: number };
    fillRadialGradientEndPoint?: { x: number; y: number };
    fillRadialGradientStartRadius?: number;
    fillRadialGradientEndRadius?: number;
    fillRadialGradientColorStops?: (number | string)[];
    stroke?: string;
    strokePaint?: Paint;
    strokeImage?: HTMLImageElement;
    strokeImageFill?: LayerImageFill;
    strokeWidth?: number;
    strokeAlign?: StrokeAlign;
    strokeJoin?: StrokeJoin;
    strokeEnabled?: boolean;
    listening?: boolean;
    id?: string;
    name?: string;
    shadowColor?: string;
    shadowBlur?: number;
}

function collectFillProps(props: AlignedStrokeRectProps): Record<string, unknown> {
    const {
        fill,
        fillPriority,
        fillLinearGradientStartPoint,
        fillLinearGradientEndPoint,
        fillLinearGradientColorStops,
        fillRadialGradientStartPoint,
        fillRadialGradientEndPoint,
        fillRadialGradientStartRadius,
        fillRadialGradientEndRadius,
        fillRadialGradientColorStops,
    } = props;
    return {
        ...(fill !== undefined ? { fill } : {}),
        ...(fillPriority !== undefined ? { fillPriority } : {}),
        ...(fillLinearGradientStartPoint !== undefined ? { fillLinearGradientStartPoint } : {}),
        ...(fillLinearGradientEndPoint !== undefined ? { fillLinearGradientEndPoint } : {}),
        ...(fillLinearGradientColorStops !== undefined ? { fillLinearGradientColorStops } : {}),
        ...(fillRadialGradientStartPoint !== undefined ? { fillRadialGradientStartPoint } : {}),
        ...(fillRadialGradientEndPoint !== undefined ? { fillRadialGradientEndPoint } : {}),
        ...(fillRadialGradientStartRadius !== undefined ? { fillRadialGradientStartRadius } : {}),
        ...(fillRadialGradientEndRadius !== undefined ? { fillRadialGradientEndRadius } : {}),
        ...(fillRadialGradientColorStops !== undefined ? { fillRadialGradientColorStops } : {}),
    };
}

function strokeLineProps(strokeJoin?: StrokeJoin) {
    return {
        lineJoin: strokeJoinToKonvaLineJoin(strokeJoin),
        miterLimit: 4,
    } as const;
}

function drawRoundedRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    cornerRadius: CornerRadiusValue,
) {
    const radii = Array.isArray(cornerRadius)
        ? cornerRadius
        : [cornerRadius, cornerRadius, cornerRadius, cornerRadius];
    const [tl, tr, br, bl] = radii;

    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + width - tr, y);
    ctx.arcTo(x + width, y, x + width, y + tr, tr);
    ctx.lineTo(x + width, y + height - br);
    ctx.arcTo(x + width, y + height, x + width - br, y + height, br);
    ctx.lineTo(x + bl, y + height);
    ctx.arcTo(x, y + height, x, y + height - bl, bl);
    ctx.lineTo(x, y + tl);
    ctx.arcTo(x, y, x + tl, y, tl);
    ctx.closePath();
}

function makeImagePattern(
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    imageFill: LayerImageFill | undefined,
    width: number,
    height: number,
) {
    const pattern = ctx.createPattern(image, "no-repeat");
    if (!pattern) return null;
    const naturalW = image.naturalWidth || image.width;
    const naturalH = image.naturalHeight || image.height;
    const fit = computeImageFitProps(imageFill?.fit ?? "cover", naturalW, naturalH, width, height, {
        focusX: imageFill?.focusX,
        focusY: imageFill?.focusY,
    });
    if (typeof DOMMatrix !== "undefined" && "setTransform" in pattern) {
        pattern.setTransform(new DOMMatrix([
            fit.drawWidth / Math.max(1, naturalW),
            0,
            0,
            fit.drawHeight / Math.max(1, naturalH),
            fit.drawX,
            fit.drawY,
        ]));
    }
    return pattern;
}

function PaintedStrokeRect({
    width,
    height,
    cornerRadius,
    strokePaint,
    strokeImage,
    strokeImageFill,
    strokeWidth,
    strokeAlign,
    strokeJoin,
}: {
    width: number;
    height: number;
    cornerRadius: CornerRadiusValue;
    strokePaint?: Paint;
    strokeImage?: HTMLImageElement;
    strokeImageFill?: LayerImageFill;
    strokeWidth: number;
    strokeAlign?: StrokeAlign;
    strokeJoin?: StrokeJoin;
}) {
    const align = resolveStrokeAlign(strokeAlign);
    const path = align === "inside"
        ? getInsideStrokePath(width, height, strokeWidth, cornerRadius)
        : align === "outside"
            ? getOutsideStrokePath(width, height, strokeWidth, cornerRadius)
            : { x: 0, y: 0, width, height, cornerRadius };

    return (
        <Shape
            listening={false}
            sceneFunc={(context) => {
                const ctx = (context as unknown as { _context?: CanvasRenderingContext2D })._context;
                if (!ctx) return;
                ctx.save();
                ctx.lineWidth = strokeWidth;
                ctx.lineJoin = strokeJoinToKonvaLineJoin(strokeJoin);
                ctx.miterLimit = 4;
                const pattern = strokeImage ? makeImagePattern(ctx, strokeImage, strokeImageFill, width, height) : null;
                ctx.strokeStyle = pattern ?? paintToCanvasStyle(ctx, strokePaint ?? "#000000", width, height);
                ctx.globalAlpha *= strokeImage ? strokeImageFill?.opacity ?? 1 : 1;
                drawRoundedRectPath(ctx, path.x, path.y, path.width, path.height, path.cornerRadius);
                ctx.stroke();
                ctx.restore();
            }}
        />
    );
}

/**
 * Renders a filled rectangle with Figma-like stroke alignment (inside / center / outside).
 * Coordinates are local: origin at top-left of the layer box (0,0).
 */
export function AlignedStrokeRect(props: AlignedStrokeRectProps) {
    const {
        width,
        height,
        cornerRadius = 0,
        stroke,
        strokePaint,
        strokeImage,
        strokeImageFill,
        strokeWidth = 0,
        strokeAlign,
        strokeJoin,
        strokeEnabled = true,
        listening,
        id,
        name,
        shadowColor,
        shadowBlur,
        fillEnabled = true,
    } = props;

    const fillProps = fillEnabled === false
        ? { fill: "transparent" as const, fillPriority: "color" as const }
        : collectFillProps(props);

    const sw = strokeEnabled === false ? 0 : Math.max(0, strokeWidth);
    const strokeColor = strokeEnabled === false || !stroke || sw <= 0 ? undefined : stroke;
    const hasPaintedStroke = strokeEnabled !== false && sw > 0 && (!!strokePaint || !!strokeImage);
    const align = resolveStrokeAlign(strokeAlign);
    const lineProps = strokeLineProps(strokeJoin);

    const shadowProps = {
        ...(shadowColor !== undefined ? { shadowColor } : {}),
        ...(shadowBlur !== undefined ? { shadowBlur } : {}),
    };

    // Visual only — parent Group owns hit area and drag (see CanvasLayer).
    const shapeListening = listening ?? false;

    const resolvedCornerRadius = capCornerRadiusValue(cornerRadius, width, height);

    const fillRectProps = {
        x: 0,
        y: 0,
        width,
        height,
        cornerRadius: resolvedCornerRadius,
        listening: shapeListening,
        ...(id !== undefined ? { id } : {}),
        ...(name !== undefined ? { name } : {}),
        ...fillProps,
        ...shadowProps,
    };

    if (hasPaintedStroke) {
        return (
            <Group>
                <Rect {...fillRectProps} />
                <PaintedStrokeRect
                    width={width}
                    height={height}
                    cornerRadius={resolvedCornerRadius}
                    strokePaint={strokePaint}
                    strokeImage={strokeImage}
                    strokeImageFill={strokeImageFill}
                    strokeWidth={sw}
                    strokeAlign={strokeAlign}
                    strokeJoin={strokeJoin}
                />
            </Group>
        );
    }

    if (!strokeColor) {
        return <Rect {...fillRectProps} />;
    }

    if (align === "center") {
        return (
            <Rect
                {...fillRectProps}
                stroke={strokeColor}
                strokeWidth={sw}
                {...lineProps}
            />
        );
    }

    if (align === "inside") {
        const path = getInsideStrokePath(width, height, sw, cornerRadius);
        return (
            <Group>
                <Rect {...fillRectProps} />
                <Rect
                    x={path.x}
                    y={path.y}
                    width={path.width}
                    height={path.height}
                    cornerRadius={path.cornerRadius}
                    fill="transparent"
                    stroke={strokeColor}
                    strokeWidth={sw}
                    listening={false}
                    {...lineProps}
                />
            </Group>
        );
    }

    // outside — stroke path sits outside the fill box; fill stays full size
    const path = getOutsideStrokePath(width, height, sw, cornerRadius);
    return (
        <Group>
            <Rect {...fillRectProps} />
            <Rect
                x={path.x}
                y={path.y}
                width={path.width}
                height={path.height}
                cornerRadius={path.cornerRadius}
                fill="transparent"
                stroke={strokeColor}
                strokeWidth={sw}
                listening={false}
                {...lineProps}
            />
        </Group>
    );
}
