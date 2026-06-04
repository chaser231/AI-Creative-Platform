"use client";

import { Group, Rect } from "react-konva";
import type { StrokeAlign, StrokeJoin } from "@/types";
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
