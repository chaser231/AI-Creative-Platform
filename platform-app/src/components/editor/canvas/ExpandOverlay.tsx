"use client";

/**
 * ExpandOverlay — Konva overlay for free-form outpainting (Generative Expand)
 *
 * Renders on top of the selected image layer when expandMode is active:
 * - Semi-transparent blue overlay on expanded areas
 * - Dashed border around the new (expanded) bounding box
 * - 8 draggable handles (4 edges + 4 corners) to adjust per-side padding
 * - Live dimension label (e.g. "800 × 600") showing expanded size
 *
 * All coordinates are in canvas (stage) space; the overlay reads
 * the target layer's position from canvasStore.
 */

import { useRef, useCallback } from "react";
import { Group, Rect, Line, Text, Circle } from "react-konva";
import Konva from "konva";
import { useCanvasStore } from "@/store/canvasStore";

// ── Constants ──────────────────────────────────────────────
const HANDLE_RADIUS = 5;
const HANDLE_FILL = "#FFFFFF";
const HANDLE_STROKE = "#6366F1";
const HANDLE_STROKE_WIDTH = 1.5;
const OVERLAY_FILL = "rgba(99, 102, 241, 0.12)";     // semi-transparent indigo
const DASH_STROKE = "#6366F1";
const DASH_PATTERN = [6, 4];
const MAX_PADDING = 2000; // per-side pixel limit

interface ExpandOverlayProps {
    layerId: string;
}

export function ExpandOverlay({ layerId }: ExpandOverlayProps) {
    const layers = useCanvasStore((s) => s.layers);
    const expandPadding = useCanvasStore((s) => s.expandPadding);
    const setExpandPadding = useCanvasStore((s) => s.setExpandPadding);
    const zoom = useCanvasStore((s) => s.zoom);

    const layer = layers.find((l) => l.id === layerId);

    // Use safe fallback values so hooks below always run (React Rules of Hooks)
    const origX = layer?.x ?? 0;
    const origY = layer?.y ?? 0;
    const origW = layer?.width ?? 0;
    const origH = layer?.height ?? 0;

    // Expanded bounds (outward from original)
    const { top, right, bottom, left } = expandPadding;
    const expX = origX - left;
    const expY = origY - top;
    const expW = origW + left + right;
    const expH = origH + top + bottom;

    // Handle size scales inversely with zoom for consistent screen-space appearance
    const hr = HANDLE_RADIUS / zoom;
    const hsw = HANDLE_STROKE_WIDTH / zoom;

    // Clamp helper
    const clamp = (v: number, min: number, max: number) =>
        Math.max(min, Math.min(max, v));

    // ── Edge drag handlers ─────────────────────────────────
    // Each handler captures the drag delta and applies it to the corresponding padding side

    const onDragTop = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const node = e.target as Konva.Circle;
            const newTop = clamp(origY - node.y(), 0, MAX_PADDING);
            setExpandPadding({ top: Math.round(newTop) });
            node.y(origY - newTop);
            node.x(origX + origW / 2);
        },
        [origY, origX, origW, setExpandPadding],
    );

    const onDragBottom = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const node = e.target as Konva.Circle;
            const newBottom = clamp(node.y() - (origY + origH), 0, MAX_PADDING);
            setExpandPadding({ bottom: Math.round(newBottom) });
            node.y(origY + origH + newBottom);
            node.x(origX + origW / 2);
        },
        [origY, origH, origX, origW, setExpandPadding],
    );

    const onDragLeft = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const node = e.target as Konva.Circle;
            const newLeft = clamp(origX - node.x(), 0, MAX_PADDING);
            setExpandPadding({ left: Math.round(newLeft) });
            node.x(origX - newLeft);
            node.y(origY + origH / 2);
        },
        [origX, origY, origH, setExpandPadding],
    );

    const onDragRight = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const node = e.target as Konva.Circle;
            const newRight = clamp(node.x() - (origX + origW), 0, MAX_PADDING);
            setExpandPadding({ right: Math.round(newRight) });
            node.x(origX + origW + newRight);
            node.y(origY + origH / 2);
        },
        [origX, origW, origY, origH, setExpandPadding],
    );

    // ── Corner drag handlers ──────────────────────────────
    const onDragTopLeft = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const node = e.target as Konva.Circle;
            const newTop = clamp(origY - node.y(), 0, MAX_PADDING);
            const newLeft = clamp(origX - node.x(), 0, MAX_PADDING);
            setExpandPadding({ top: Math.round(newTop), left: Math.round(newLeft) });
            node.x(origX - newLeft);
            node.y(origY - newTop);
        },
        [origX, origY, setExpandPadding],
    );

    const onDragTopRight = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const node = e.target as Konva.Circle;
            const newTop = clamp(origY - node.y(), 0, MAX_PADDING);
            const newRight = clamp(node.x() - (origX + origW), 0, MAX_PADDING);
            setExpandPadding({ top: Math.round(newTop), right: Math.round(newRight) });
            node.x(origX + origW + newRight);
            node.y(origY - newTop);
        },
        [origX, origW, origY, setExpandPadding],
    );

    const onDragBottomLeft = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const node = e.target as Konva.Circle;
            const newBottom = clamp(node.y() - (origY + origH), 0, MAX_PADDING);
            const newLeft = clamp(origX - node.x(), 0, MAX_PADDING);
            setExpandPadding({ bottom: Math.round(newBottom), left: Math.round(newLeft) });
            node.x(origX - newLeft);
            node.y(origY + origH + newBottom);
        },
        [origX, origY, origH, setExpandPadding],
    );

    const onDragBottomRight = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const node = e.target as Konva.Circle;
            const newBottom = clamp(node.y() - (origY + origH), 0, MAX_PADDING);
            const newRight = clamp(node.x() - (origX + origW), 0, MAX_PADDING);
            setExpandPadding({ bottom: Math.round(newBottom), right: Math.round(newRight) });
            node.x(origX + origW + newRight);
            node.y(origY + origH + newBottom);
        },
        [origX, origW, origY, origH, setExpandPadding],
    );

    const hasPadding = top > 0 || right > 0 || bottom > 0 || left > 0;
    const labelFontSize = Math.max(11, 12 / zoom);

    // ── Early return AFTER all hooks (React Rules of Hooks) ──
    if (!layer || layer.type !== "image") return null;

    return (
        <Group listening={true}>
            {/* ── Semi-transparent overlay on expanded areas ── */}
            {/* Top strip */}
            {top > 0 && (
                <Rect x={expX} y={expY} width={expW} height={top} fill={OVERLAY_FILL} />
            )}
            {/* Bottom strip */}
            {bottom > 0 && (
                <Rect x={expX} y={origY + origH} width={expW} height={bottom} fill={OVERLAY_FILL} />
            )}
            {/* Left strip (between top and bottom) */}
            {left > 0 && (
                <Rect x={expX} y={origY} width={left} height={origH} fill={OVERLAY_FILL} />
            )}
            {/* Right strip (between top and bottom) */}
            {right > 0 && (
                <Rect x={origX + origW} y={origY} width={right} height={origH} fill={OVERLAY_FILL} />
            )}

            {/* ── Original layer border (solid) ── */}
            <Rect
                x={origX}
                y={origY}
                width={origW}
                height={origH}
                stroke="#6366F1"
                strokeWidth={1.5 / zoom}
                fill="transparent"
            />

            {/* ── Expanded border (dashed) ── */}
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
                />
            )}

            {/* ── Dimension label ── */}
            {hasPadding && (
                <Group x={expX + expW / 2} y={expY + expH + 8 / zoom}>
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

            {/* ── Edge handles (mid-points of each side) ── */}
            {/* Top */}
            <Circle
                x={origX + origW / 2}
                y={origY - top}
                radius={hr}
                fill={HANDLE_FILL}
                stroke={HANDLE_STROKE}
                strokeWidth={hsw}
                draggable
                onDragMove={onDragTop}
                dragBoundFunc={(pos) => ({ x: pos.x, y: pos.y })} // free drag vertically
                onMouseEnter={(e) => { (e.target.getStage()?.container() as HTMLDivElement).style.cursor = "n-resize"; }}
                onMouseLeave={(e) => { (e.target.getStage()?.container() as HTMLDivElement).style.cursor = "default"; }}
            />
            {/* Bottom */}
            <Circle
                x={origX + origW / 2}
                y={origY + origH + bottom}
                radius={hr}
                fill={HANDLE_FILL}
                stroke={HANDLE_STROKE}
                strokeWidth={hsw}
                draggable
                onDragMove={onDragBottom}
                onMouseEnter={(e) => { (e.target.getStage()?.container() as HTMLDivElement).style.cursor = "s-resize"; }}
                onMouseLeave={(e) => { (e.target.getStage()?.container() as HTMLDivElement).style.cursor = "default"; }}
            />
            {/* Left */}
            <Circle
                x={origX - left}
                y={origY + origH / 2}
                radius={hr}
                fill={HANDLE_FILL}
                stroke={HANDLE_STROKE}
                strokeWidth={hsw}
                draggable
                onDragMove={onDragLeft}
                onMouseEnter={(e) => { (e.target.getStage()?.container() as HTMLDivElement).style.cursor = "w-resize"; }}
                onMouseLeave={(e) => { (e.target.getStage()?.container() as HTMLDivElement).style.cursor = "default"; }}
            />
            {/* Right */}
            <Circle
                x={origX + origW + right}
                y={origY + origH / 2}
                radius={hr}
                fill={HANDLE_FILL}
                stroke={HANDLE_STROKE}
                strokeWidth={hsw}
                draggable
                onDragMove={onDragRight}
                onMouseEnter={(e) => { (e.target.getStage()?.container() as HTMLDivElement).style.cursor = "e-resize"; }}
                onMouseLeave={(e) => { (e.target.getStage()?.container() as HTMLDivElement).style.cursor = "default"; }}
            />

            {/* ── Corner handles ── */}
            {/* Top-Left */}
            <Circle
                x={origX - left}
                y={origY - top}
                radius={hr}
                fill={HANDLE_FILL}
                stroke={HANDLE_STROKE}
                strokeWidth={hsw}
                draggable
                onDragMove={onDragTopLeft}
                onMouseEnter={(e) => { (e.target.getStage()?.container() as HTMLDivElement).style.cursor = "nw-resize"; }}
                onMouseLeave={(e) => { (e.target.getStage()?.container() as HTMLDivElement).style.cursor = "default"; }}
            />
            {/* Top-Right */}
            <Circle
                x={origX + origW + right}
                y={origY - top}
                radius={hr}
                fill={HANDLE_FILL}
                stroke={HANDLE_STROKE}
                strokeWidth={hsw}
                draggable
                onDragMove={onDragTopRight}
                onMouseEnter={(e) => { (e.target.getStage()?.container() as HTMLDivElement).style.cursor = "ne-resize"; }}
                onMouseLeave={(e) => { (e.target.getStage()?.container() as HTMLDivElement).style.cursor = "default"; }}
            />
            {/* Bottom-Left */}
            <Circle
                x={origX - left}
                y={origY + origH + bottom}
                radius={hr}
                fill={HANDLE_FILL}
                stroke={HANDLE_STROKE}
                strokeWidth={hsw}
                draggable
                onDragMove={onDragBottomLeft}
                onMouseEnter={(e) => { (e.target.getStage()?.container() as HTMLDivElement).style.cursor = "sw-resize"; }}
                onMouseLeave={(e) => { (e.target.getStage()?.container() as HTMLDivElement).style.cursor = "default"; }}
            />
            {/* Bottom-Right */}
            <Circle
                x={origX + origW + right}
                y={origY + origH + bottom}
                radius={hr}
                fill={HANDLE_FILL}
                stroke={HANDLE_STROKE}
                strokeWidth={hsw}
                draggable
                onDragMove={onDragBottomRight}
                onMouseEnter={(e) => { (e.target.getStage()?.container() as HTMLDivElement).style.cursor = "se-resize"; }}
                onMouseLeave={(e) => { (e.target.getStage()?.container() as HTMLDivElement).style.cursor = "default"; }}
            />
        </Group>
    );
}
