"use client";

/**
 * ExpandOverlay — Konva overlay for free-form outpainting (Generative Expand)
 */

import { useCallback, useMemo } from "react";
import { Group, Rect, Text, Circle } from "react-konva";
import Konva from "konva";
import { useCanvasStore } from "@/store/canvasStore";
import {
    EXPAND_MAX_PADDING,
    computeTopPadding,
    computeBottomPadding,
    computeLeftPadding,
    computeRightPadding,
    expandHandleDragBound,
} from "@/utils/expandOverlayMath";

const EXPAND_CONTROL_NAME = "expand-control";

function stopExpandPointerEvent(e: Konva.KonvaEventObject<MouseEvent | DragEvent>) {
    e.cancelBubble = true;
}

function resetExpandHandleCursor(e: Konva.KonvaEventObject<MouseEvent | DragEvent>) {
    const container = e.target.getStage()?.container() as HTMLElement | undefined;
    if (container) container.style.cursor = "default";
}

function setExpandHandleCursor(e: Konva.KonvaEventObject<MouseEvent>, cursor: string) {
    const container = e.target.getStage()?.container() as HTMLElement | undefined;
    if (container) container.style.cursor = cursor;
}
const HANDLE_RADIUS = 5;
const HANDLE_HIT_WIDTH = 24;
const HANDLE_FILL = "#FFFFFF";
const HANDLE_STROKE = "#6366F1";
const HANDLE_STROKE_WIDTH = 1.5;
const OVERLAY_FILL = "rgba(99, 102, 241, 0.12)";
const DASH_STROKE = "#6366F1";
const DASH_PATTERN = [6, 4];

interface ExpandOverlayProps {
    layerId: string;
}

export function ExpandOverlay({ layerId }: ExpandOverlayProps) {
    const layers = useCanvasStore((s) => s.layers);
    const expandPadding = useCanvasStore((s) => s.expandPadding);
    const setExpandPadding = useCanvasStore((s) => s.setExpandPadding);
    const zoom = useCanvasStore((s) => s.zoom);
    const canvasWidth = useCanvasStore((s) => s.canvasWidth);
    const canvasHeight = useCanvasStore((s) => s.canvasHeight);

    const layer = layers.find((l) => l.id === layerId);

    const origX = layer?.x ?? 0;
    const origY = layer?.y ?? 0;
    const origW = layer?.width ?? 0;
    const origH = layer?.height ?? 0;

    const { top, right, bottom, left } = expandPadding;
    const expX = origX - left;
    const expY = origY - top;
    const expW = origW + left + right;
    const expH = origH + top + bottom;

    const hr = HANDLE_RADIUS / zoom;
    const hsw = HANDLE_STROKE_WIDTH / zoom;
    const hitWidth = HANDLE_HIT_WIDTH / zoom;

    const dragBoundFunc = useMemo(
        () => (pos: { x: number; y: number }) =>
            expandHandleDragBound(pos, canvasWidth, canvasHeight, EXPAND_MAX_PADDING),
        [canvasWidth, canvasHeight],
    );

    const onDragTop = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const node = e.target as Konva.Circle;
            const newTop = computeTopPadding(origY, node.y());
            setExpandPadding({ top: newTop });
            node.y(origY - newTop);
            node.x(origX + origW / 2);
        },
        [origY, origX, origW, setExpandPadding],
    );

    const onDragBottom = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const node = e.target as Konva.Circle;
            const newBottom = computeBottomPadding(origY, origH, node.y());
            setExpandPadding({ bottom: newBottom });
            node.y(origY + origH + newBottom);
            node.x(origX + origW / 2);
        },
        [origY, origH, origX, origW, setExpandPadding],
    );

    const onDragLeft = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const node = e.target as Konva.Circle;
            const newLeft = computeLeftPadding(origX, node.x());
            setExpandPadding({ left: newLeft });
            node.x(origX - newLeft);
            node.y(origY + origH / 2);
        },
        [origX, origY, origH, setExpandPadding],
    );

    const onDragRight = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const node = e.target as Konva.Circle;
            const newRight = computeRightPadding(origX, origW, node.x());
            setExpandPadding({ right: newRight });
            node.x(origX + origW + newRight);
            node.y(origY + origH / 2);
        },
        [origX, origW, origY, origH, setExpandPadding],
    );

    const onDragTopLeft = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const node = e.target as Konva.Circle;
            const newTop = computeTopPadding(origY, node.y());
            const newLeft = computeLeftPadding(origX, node.x());
            setExpandPadding({ top: newTop, left: newLeft });
            node.x(origX - newLeft);
            node.y(origY - newTop);
        },
        [origX, origY, setExpandPadding],
    );

    const onDragTopRight = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const node = e.target as Konva.Circle;
            const newTop = computeTopPadding(origY, node.y());
            const newRight = computeRightPadding(origX, origW, node.x());
            setExpandPadding({ top: newTop, right: newRight });
            node.x(origX + origW + newRight);
            node.y(origY - newTop);
        },
        [origX, origW, origY, setExpandPadding],
    );

    const onDragBottomLeft = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const node = e.target as Konva.Circle;
            const newBottom = computeBottomPadding(origY, origH, node.y());
            const newLeft = computeLeftPadding(origX, node.x());
            setExpandPadding({ bottom: newBottom, left: newLeft });
            node.x(origX - newLeft);
            node.y(origY + origH + newBottom);
        },
        [origX, origY, origH, setExpandPadding],
    );

    const onDragBottomRight = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const node = e.target as Konva.Circle;
            const newBottom = computeBottomPadding(origY, origH, node.y());
            const newRight = computeRightPadding(origX, origW, node.x());
            setExpandPadding({ bottom: newBottom, right: newRight });
            node.x(origX + origW + newRight);
            node.y(origY + origH + newBottom);
        },
        [origX, origW, origY, origH, setExpandPadding],
    );

    const handleCommonProps = {
        radius: hr,
        fill: HANDLE_FILL,
        stroke: HANDLE_STROKE,
        strokeWidth: hsw,
        draggable: true,
        dragBoundFunc,
        hitStrokeWidth: hitWidth,
        name: EXPAND_CONTROL_NAME,
        onMouseDown: stopExpandPointerEvent,
        onDragStart: stopExpandPointerEvent,
        onDragEnd: resetExpandHandleCursor,
    };

    const hasPadding = top > 0 || right > 0 || bottom > 0 || left > 0;
    const labelFontSize = Math.max(11, 12 / zoom);

    if (!layer || layer.type !== "image") return null;

    return (
        <Group listening={true} name={EXPAND_CONTROL_NAME}>
            {top > 0 && (
                <Rect x={expX} y={expY} width={expW} height={top} fill={OVERLAY_FILL} listening={false} />
            )}
            {bottom > 0 && (
                <Rect x={expX} y={origY + origH} width={expW} height={bottom} fill={OVERLAY_FILL} listening={false} />
            )}
            {left > 0 && (
                <Rect x={expX} y={origY} width={left} height={origH} fill={OVERLAY_FILL} listening={false} />
            )}
            {right > 0 && (
                <Rect x={origX + origW} y={origY} width={right} height={origH} fill={OVERLAY_FILL} listening={false} />
            )}

            <Rect
                x={origX}
                y={origY}
                width={origW}
                height={origH}
                stroke="#6366F1"
                strokeWidth={1.5 / zoom}
                fill="transparent"
                listening={false}
            />

            {hasPadding && (
                <Rect
                    x={expX}
                    y={expY}
                    width={expW}
                    height={expH}
                    stroke={DASH_STROKE}
                    strokeWidth={1.5 / zoom}
                    dash={DASH_PATTERN.map((d) => d / zoom)}
                    fill="transparent"
                    listening={false}
                />
            )}

            {hasPadding && (
                <Group x={expX + expW / 2} y={expY + expH + 8 / zoom} listening={false}>
                    <Rect
                        x={-40 / zoom}
                        y={-2 / zoom}
                        width={80 / zoom}
                        height={18 / zoom}
                        fill="#6366F1"
                        cornerRadius={3 / zoom}
                    />
                    <Text
                        text={`${Math.round(origW + left + right)} × ${Math.round(origH + top + bottom)}`}
                        x={-40 / zoom}
                        y={0}
                        width={80 / zoom}
                        height={14 / zoom}
                        align="center"
                        verticalAlign="middle"
                        fontSize={labelFontSize}
                        fill="#FFFFFF"
                        fontFamily="Inter, system-ui, sans-serif"
                    />
                </Group>
            )}

            <Circle
                {...handleCommonProps}
                x={origX + origW / 2}
                y={origY - top}
                onDragMove={onDragTop}
                onMouseEnter={(e) => { setExpandHandleCursor(e, "n-resize"); }}
                onMouseLeave={(e) => { resetExpandHandleCursor(e); }}
            />
            <Circle
                {...handleCommonProps}
                x={origX + origW / 2}
                y={origY + origH + bottom}
                onDragMove={onDragBottom}
                onMouseEnter={(e) => { setExpandHandleCursor(e, "s-resize"); }}
                onMouseLeave={(e) => { resetExpandHandleCursor(e); }}
            />
            <Circle
                {...handleCommonProps}
                x={origX - left}
                y={origY + origH / 2}
                onDragMove={onDragLeft}
                onMouseEnter={(e) => { setExpandHandleCursor(e, "w-resize"); }}
                onMouseLeave={(e) => { resetExpandHandleCursor(e); }}
            />
            <Circle
                {...handleCommonProps}
                x={origX + origW + right}
                y={origY + origH / 2}
                onDragMove={onDragRight}
                onMouseEnter={(e) => { setExpandHandleCursor(e, "e-resize"); }}
                onMouseLeave={(e) => { resetExpandHandleCursor(e); }}
            />
            <Circle
                {...handleCommonProps}
                x={origX - left}
                y={origY - top}
                onDragMove={onDragTopLeft}
                onMouseEnter={(e) => { setExpandHandleCursor(e, "nw-resize"); }}
                onMouseLeave={(e) => { resetExpandHandleCursor(e); }}
            />
            <Circle
                {...handleCommonProps}
                x={origX + origW + right}
                y={origY - top}
                onDragMove={onDragTopRight}
                onMouseEnter={(e) => { setExpandHandleCursor(e, "ne-resize"); }}
                onMouseLeave={(e) => { resetExpandHandleCursor(e); }}
            />
            <Circle
                {...handleCommonProps}
                x={origX - left}
                y={origY + origH + bottom}
                onDragMove={onDragBottomLeft}
                onMouseEnter={(e) => { setExpandHandleCursor(e, "sw-resize"); }}
                onMouseLeave={(e) => { resetExpandHandleCursor(e); }}
            />
            <Circle
                {...handleCommonProps}
                x={origX + origW + right}
                y={origY + origH + bottom}
                onDragMove={onDragBottomRight}
                onMouseEnter={(e) => { setExpandHandleCursor(e, "se-resize"); }}
                onMouseLeave={(e) => { resetExpandHandleCursor(e); }}
            />
        </Group>
    );
}
