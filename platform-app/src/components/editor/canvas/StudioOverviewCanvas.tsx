"use client";

/**
 * StudioOverviewCanvas — Phase 1 (read-only)
 *
 * World-space "all-formats" overview canvas. Renders every project resize
 * format as a tiled artboard in a single Konva stage you can pan and zoom,
 * Figma-Slides-style. Read-only: click a tile to make it the active format,
 * double-click to dive back into the single-artboard studio view.
 *
 * Reuses the world-space `ArtboardGroup` primitive — each tile self-loads its
 * images, sharing decoded `HTMLImageElement`s via the module-level cache in
 * `artboardImages.ts`, so dozens of tiles that reference the same URL cost one
 * fetch in total.
 *
 * Phase 2 will light up in-place editing on the active artboard; Phase 1
 * intentionally keeps every tile `listening={false}` and overlays a transparent
 * hit-test rect on top for selection chrome.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Layer, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import { useCanvasStore } from "@/store/canvasStore";
import { useThemeStore } from "@/store/themeStore";
import { ArtboardGroup } from "@/components/editor/canvas/ArtboardContent";
import {
    computeOverviewLayout,
    DEFAULT_OVERVIEW_GAP,
    DEFAULT_OVERVIEW_LABEL_HEIGHT,
} from "@/components/editor/canvas/overviewLayout";

const ROW_WIDTH = 4500;
const TILE_GAP = DEFAULT_OVERVIEW_GAP;
const LABEL_HEIGHT = DEFAULT_OVERVIEW_LABEL_HEIGHT;

const LABEL_FONT_SIZE = 28;
const LABEL_SUB_FONT_SIZE = 22;
const LABEL_LINE_SPACING = 6;
const LABEL_TOP_PADDING = 16;

const ACCENT_SELECTED = "#7C5CFC";
const ACCENT_HOVER = "#A899FF";

const ZOOM_MIN = 0.02;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.05;

const AUTO_FIT_PADDING = 96;

/**
 * Local copy of `useResolvedCanvasAppearance` (the studio's theme→light/dark
 * resolver); the original lives privately inside `WizardContentWorkspace.tsx`.
 * Kept tiny and side-effect-free to avoid coupling to wizard internals.
 */
function useResolvedCanvasAppearance(): "light" | "dark" {
    const theme = useThemeStore((s) => s.theme);
    const [systemDark, setSystemDark] = useState(() => {
        if (typeof window === "undefined") return false;
        return window.matchMedia("(prefers-color-scheme: dark)").matches;
    });

    useEffect(() => {
        if (theme !== "system") return;
        if (typeof window === "undefined") return;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, [theme]);

    if (theme === "dark") return "dark";
    if (theme === "light") return "light";
    return systemDark ? "dark" : "light";
}

export function StudioOverviewCanvas() {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const stageRef = useRef<Konva.Stage | null>(null);
    const autoFittedRef = useRef(false);
    /** Last format count we auto-fit for — a change re-arms the fit. */
    const lastFitCountRef = useRef(0);
    /** Suppress tile hover state updates while the user pans the stage. */
    const isDraggingRef = useRef(false);

    const [size, setSize] = useState({ w: 0, h: 0 });
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    const appearance = useResolvedCanvasAppearance();

    const resizes = useCanvasStore((s) => s.resizes);
    const activeResizeId = useCanvasStore((s) => s.activeResizeId);
    const layers = useCanvasStore((s) => s.layers);
    const artboardProps = useCanvasStore((s) => s.artboardProps);
    const overviewZoom = useCanvasStore((s) => s.overviewZoom);
    const overviewX = useCanvasStore((s) => s.overviewX);
    const overviewY = useCanvasStore((s) => s.overviewY);
    const setOverviewZoom = useCanvasStore((s) => s.setOverviewZoom);
    const setOverviewPosition = useCanvasStore((s) => s.setOverviewPosition);
    const setActiveResize = useCanvasStore((s) => s.setActiveResize);
    const setViewMode = useCanvasStore((s) => s.setViewMode);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                setSize({ w: width, h: height });
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const layout = useMemo(
        () =>
            computeOverviewLayout(
                resizes.map((r) => ({ id: r.id, width: r.width, height: r.height })),
                { gap: TILE_GAP, rowWidth: ROW_WIDTH, labelHeight: LABEL_HEIGHT },
            ),
        [resizes],
    );

    // Auto-fit once both the container and the layout are measured. Re-arms
    // when formats appear after an initial empty state (e.g. project loads
    // asynchronously after this component mounts).
    useEffect(() => {
        if (size.w === 0 || size.h === 0) return;
        if (resizes.length === 0) return;
        if (layout.totalWidth === 0 || layout.totalHeight === 0) return;
        // Re-fit on first measure and whenever the set of formats changes.
        const countChanged = lastFitCountRef.current !== resizes.length;
        if (autoFittedRef.current && !countChanged) return;

        const availableW = Math.max(1, size.w - AUTO_FIT_PADDING * 2);
        const availableH = Math.max(1, size.h - AUTO_FIT_PADDING * 2);
        const fitScale = Math.min(
            availableW / layout.totalWidth,
            availableH / layout.totalHeight,
            1,
        );
        const clamped = Math.min(Math.max(fitScale, ZOOM_MIN), ZOOM_MAX);
        const cx = (size.w - layout.totalWidth * clamped) / 2;
        const cy = (size.h - layout.totalHeight * clamped) / 2;
        setOverviewZoom(clamped);
        setOverviewPosition(cx, cy);
        autoFittedRef.current = true;
        lastFitCountRef.current = resizes.length;
    }, [
        layout.totalHeight,
        layout.totalWidth,
        resizes.length,
        setOverviewPosition,
        setOverviewZoom,
        size.h,
        size.w,
    ]);

    const handleWheel = useCallback(
        (e: Konva.KonvaEventObject<WheelEvent>) => {
            e.evt.preventDefault();
            const stage = stageRef.current;
            if (!stage) return;

            if (e.evt.ctrlKey || e.evt.metaKey) {
                const pointer = stage.getPointerPosition();
                if (!pointer) return;
                const oldScale = overviewZoom;
                const newScale =
                    e.evt.deltaY < 0 ? oldScale * ZOOM_STEP : oldScale / ZOOM_STEP;
                const clamped = Math.min(Math.max(newScale, ZOOM_MIN), ZOOM_MAX);
                const worldPoint = {
                    x: (pointer.x - overviewX) / oldScale,
                    y: (pointer.y - overviewY) / oldScale,
                };
                setOverviewZoom(clamped);
                setOverviewPosition(
                    pointer.x - worldPoint.x * clamped,
                    pointer.y - worldPoint.y * clamped,
                );
            } else {
                setOverviewPosition(
                    overviewX - e.evt.deltaX,
                    overviewY - e.evt.deltaY,
                );
            }
        },
        [overviewX, overviewY, overviewZoom, setOverviewPosition, setOverviewZoom],
    );

    const handleDragStart = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            if (e.target !== stageRef.current) return;
            isDraggingRef.current = true;
        },
        [],
    );

    // Keep the store position in sync DURING the drag, not just at the end —
    // otherwise any re-render mid-drag (the store feeds `x`/`y` back into the
    // controlled Stage) would snap the stage back to its pre-drag position.
    const handleDragMove = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            if (e.target !== stageRef.current) return;
            const stage = stageRef.current;
            if (!stage) return;
            setOverviewPosition(stage.x(), stage.y());
        },
        [setOverviewPosition],
    );

    const handleDragEnd = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            if (e.target !== stageRef.current) return;
            isDraggingRef.current = false;
            const stage = stageRef.current;
            if (!stage) return;
            setOverviewPosition(stage.x(), stage.y());
        },
        [setOverviewPosition],
    );

    const handleTileEnter = useCallback((id: string) => {
        if (isDraggingRef.current) return;
        setHoveredId(id);
    }, []);

    const handleTileLeave = useCallback((id: string) => {
        if (isDraggingRef.current) return;
        setHoveredId((current) => (current === id ? null : current));
    }, []);

    const handleTileClick = useCallback(
        (id: string) => {
            setActiveResize(id);
        },
        [setActiveResize],
    );

    const handleTileDblClick = useCallback(
        (id: string) => {
            setActiveResize(id);
            setViewMode("single");
        },
        [setActiveResize, setViewMode],
    );

    const matFill = appearance === "dark" ? "#0F1115" : "#F6F7F9";
    const dotColor =
        appearance === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,17,21,0.06)";
    const labelColor = appearance === "dark" ? "#E5E7EB" : "#111827";
    const subLabelColor = appearance === "dark" ? "#9CA3AF" : "#6B7280";

    const matStyle = useMemo(
        () => ({
            backgroundColor: matFill,
            backgroundImage: `radial-gradient(${dotColor} 1px, transparent 1px)`,
            backgroundSize: "24px 24px",
        }),
        [matFill, dotColor],
    );

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 overflow-hidden"
            style={matStyle}
        >
            {size.w > 0 && size.h > 0 && (
                <Stage
                    ref={stageRef}
                    width={size.w}
                    height={size.h}
                    scaleX={overviewZoom}
                    scaleY={overviewZoom}
                    x={overviewX}
                    y={overviewY}
                    draggable
                    onWheel={handleWheel}
                    onDragStart={handleDragStart}
                    onDragMove={handleDragMove}
                    onDragEnd={handleDragEnd}
                >
                    <Layer>
                        {resizes.map((format, index) => {
                            const tile = layout.tiles[index];
                            if (!tile) return null;

                            const isActive = format.id === activeResizeId;
                            const isHovered = hoveredId === format.id && !isActive;

                            // Layers live on the store ONLY for the active format —
                            // every other format renders from its persisted snapshot.
                            const formatLayers = isActive
                                ? layers
                                : format.layerSnapshot ?? [];

                            // Keep the highlight ring visually constant on screen by
                            // dividing the screen-space stroke by world zoom.
                            const screenStroke = isActive ? 4 : isHovered ? 2 : 0;
                            const ringStrokeWidth =
                                screenStroke > 0
                                    ? screenStroke / Math.max(overviewZoom, ZOOM_MIN)
                                    : 0;
                            const ringColor = isActive ? ACCENT_SELECTED : ACCENT_HOVER;

                            const labelY = format.height + LABEL_TOP_PADDING;
                            const subLabelY =
                                labelY + LABEL_FONT_SIZE + LABEL_LINE_SPACING;
                            const sizeLabel = `${format.width} × ${format.height}`;
                            const subLabelText = format.isMaster
                                ? `${sizeLabel}  •  Мастер`
                                : sizeLabel;

                            return (
                                <Group key={format.id} x={tile.x} y={tile.y}>
                                    <ArtboardGroup
                                        layers={formatLayers}
                                        width={format.width}
                                        height={format.height}
                                        offsetX={0}
                                        offsetY={0}
                                        listening={false}
                                        clip
                                        fill={artboardProps.fill}
                                        fillEnabled={artboardProps.fillEnabled}
                                        backgroundImage={artboardProps.backgroundImage}
                                        cornerRadius={artboardProps.cornerRadius}
                                        stroke={artboardProps.stroke}
                                        strokeMode={artboardProps.strokeMode}
                                        strokeImage={artboardProps.strokeImage}
                                        strokeWidth={artboardProps.strokeWidth}
                                        strokeAlign={artboardProps.strokeAlign}
                                        strokeJoin={artboardProps.strokeJoin}
                                    />
                                    {ringStrokeWidth > 0 && (
                                        <Rect
                                            x={-ringStrokeWidth / 2}
                                            y={-ringStrokeWidth / 2}
                                            width={format.width + ringStrokeWidth}
                                            height={format.height + ringStrokeWidth}
                                            stroke={ringColor}
                                            strokeWidth={ringStrokeWidth}
                                            cornerRadius={Math.max(
                                                4,
                                                artboardProps.cornerRadius,
                                            )}
                                            listening={false}
                                        />
                                    )}
                                    <Text
                                        x={0}
                                        y={labelY}
                                        width={format.width}
                                        text={format.name}
                                        fontSize={LABEL_FONT_SIZE}
                                        fontFamily="Inter"
                                        fontStyle={isActive ? "600" : "500"}
                                        fill={labelColor}
                                        align="left"
                                        listening={false}
                                    />
                                    <Text
                                        x={0}
                                        y={subLabelY}
                                        width={format.width}
                                        text={subLabelText}
                                        fontSize={LABEL_SUB_FONT_SIZE}
                                        fontFamily="Inter"
                                        fill={subLabelColor}
                                        align="left"
                                        listening={false}
                                    />
                                    {/* Transparent hit area on top — keeps clicks
                                        reliable even when the artboard fill is
                                        disabled / transparent. */}
                                    <Rect
                                        x={0}
                                        y={0}
                                        width={format.width}
                                        height={format.height}
                                        fill="transparent"
                                        onClick={() => handleTileClick(format.id)}
                                        onTap={() => handleTileClick(format.id)}
                                        onDblClick={() => handleTileDblClick(format.id)}
                                        onDblTap={() => handleTileDblClick(format.id)}
                                        onMouseEnter={() => handleTileEnter(format.id)}
                                        onMouseLeave={() => handleTileLeave(format.id)}
                                    />
                                </Group>
                            );
                        })}
                    </Layer>
                </Stage>
            )}
        </div>
    );
}
