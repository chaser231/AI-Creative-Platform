"use client";

import { useRef, useCallback, useEffect, useState, useMemo, memo, Fragment, type ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { Stage, Layer, Rect, Text, Image as KonvaImage, Transformer, Group, Line, Circle, Path } from "react-konva";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import type { CornerRadii, Layer as LayerType, TextLayer, BadgeLayer, FrameLayer, ImageLayer, VectorLayer, VectorAnchor, LayerImageFill, Paint, LayerUpdate } from "@/types";
import { subpathsToPathData, hasRenderableGeometry, normalizeAbsSubpaths, computeAbsBounds } from "@/utils/vectorGeometry";
import { svgTextToVectorOverrides, looksLikeSvg } from "@/utils/svgImport";
import { enterVectorEditMode, isReadOnlyImportedPath, parseEditableSubpaths, visibleAnchorIndices } from "@/utils/vectorEdit";
import {
    applyBBoxToProxy,
    computeUnionBBoxFromDrag,
} from "@/utils/groupTransform";
import { GroupSelectionTransformer, MULTI_TRANSFORM_PROXY_ID } from "./GroupSelectionTransformer";
import { enforceLockedAspectOnNode, lockedAspectDimensions } from "@/utils/aspectRatioLock";
import type { CornerRadiusValue } from "@/utils/strokeGeometry";
import { computeImageFitProps } from "@/utils/imageFitUtils";
import { ContextMenu, buildLayerContextMenuItems, buildMultiSelectionContextMenuItems } from "../ContextMenu";
import { useSearchParams } from "next/navigation";
import { computeSnap, computeHoverDistances, computeResizeSnap, SnapResult, DistanceMeasurement, SpacingGuide } from "@/services/snapService";
import type { ActiveEdge, NodeBounds } from "@/services/snapService";
import { isFocusedOnInput } from "@/utils/keyboard";
import Konva from "konva";
import { useImage } from "./useImage";
import { SelectionTransformer, FrameChildTransformer } from "./transformers";
import { ExpandOverlay } from "./ExpandOverlay";
import { InpaintMaskOverlay } from "@/components/inpaint/InpaintMaskOverlay";
import { useOptionalSharedInpaintMask } from "@/components/inpaint/InpaintContext";
import { InlineTextEditor } from "./InlineTextEditor";
import { SnapGuides } from "./SnapGuides";
import { usePanZoom } from "./usePanZoom";
import { ArtboardBackgroundRenderer } from "./ArtboardBackgroundRenderer";
import { useFigmaVectorInlineSvg } from "@/hooks/useFigmaVectorInlineSvg";
import { useProjectLibrary } from "@/hooks/useProjectLibrary";
import { normalizePaint, paintToKonvaProps, setGradientEndpoints } from "@/utils/paint";
import { canLayerFitInFrame, collectAncestorFrameIds } from "@/utils/frameDropUtils";
import { installLayerBoxGetClientRect } from "@/utils/strokeGeometry";
import { AlignedStrokeRect } from "./AlignedStrokeRect";
import { resolveKonvaLayerId } from "./resolveKonvaLayerId";
import { getPointerArtboardPosition, worldPointToArtboard } from "./getPointerArtboardPosition";
import { artboardToWorld, worldToArtboard } from "./overviewCoords";
import { ArtboardGroup } from "./ArtboardContent";
import { InlineSvgVectorImage } from "./InlineSvgVectorImage";
import {
    computeOverviewLayout,
    DEFAULT_OVERVIEW_GAP,
    DEFAULT_OVERVIEW_LABEL_HEIGHT,
} from "./overviewLayout";
import { SLICE_OVERLAY_NAME, withSliceOverlaysHidden } from "./sliceOverlay";
import { LayoutGridLayer } from "./LayoutGridLayer";
import { EDITOR_CHROME_NAME, EXPORT_ARTBOARD_FRAME_NAME } from "@/utils/stageExportCapture";
import { selectActiveLayoutGrids } from "@/store/canvas/createLayoutGridSlice";
import { getLayoutGridSnapLines } from "@/utils/layoutGrid";
import {
    FLIP_LAYER_CONTENT_NAME,
    getTextTransformBaseSize,
    normalizeLiveTextTransform,
    syncTextTransformNodes,
    TEXT_LAYER_BOUNDS_NAME,
    TEXT_LAYER_CONTENT_NAME,
} from "./textTransformUtils";
import { getTextRenderOffsetY } from "@/utils/layoutEngine";
import { getEffectiveTextRenderHeight, shouldUseTextEllipsis } from "@/utils/textContainerLimits";
import { computeLayerBoxClientRect } from "@/utils/strokeGeometry";
/* ─── Constants ───────────────────────────────────── */
const FRAME_HIGHLIGHT_STROKE = "#6366F1";
const FRAME_HIGHLIGHT_WIDTH = 2;

/* ─── Overview layout/zoom constants ──────────────── */
// Canvas hosts the overview directly. Do not retune in isolation — overview
// tiles share these values via overviewLayout.computeOverviewLayout.
const OVERVIEW_ROW_WIDTH = 4500;
const OVERVIEW_TILE_GAP = DEFAULT_OVERVIEW_GAP;
const OVERVIEW_LABEL_HEIGHT = DEFAULT_OVERVIEW_LABEL_HEIGHT;
const OVERVIEW_LABEL_FONT_SIZE = 28;
const OVERVIEW_LABEL_SUB_FONT_SIZE = 22;
// Brand UI typeface (loaded via next/font on <body>); overview labels are app
// chrome, not artboard content, so they use the brand font rather than "Inter".
const OVERVIEW_LABEL_FONT_FAMILY = "Plus Jakarta Sans, system-ui, sans-serif";
const OVERVIEW_LABEL_LINE_SPACING = 6;
const OVERVIEW_LABEL_TOP_PADDING = 16;
const OVERVIEW_ACCENT_SELECTED = "#7C5CFC";
const OVERVIEW_ACCENT_HOVER = "#A899FF";
const OVERVIEW_ZOOM_MIN = 0.02;
const OVERVIEW_ZOOM_MAX = 3;
const OVERVIEW_ZOOM_STEP = 1.05;
const OVERVIEW_AUTO_FIT_PADDING = 96;

/* ─── Pen tool ─────────────────────────────────────── */
interface PenDraftAnchor {
    x: number;
    y: number;
    inX?: number;
    inY?: number;
    outX?: number;
    outY?: number;
}

const PEN_STROKE = "#6366F1";



/* ─── Canvas Layer ────────────────────────────────── */
interface CanvasLayerProps {
    layer: LayerType;
    isSelected: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSelect: (e: Konva.KonvaEventObject<any>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onDragStart: (e: Konva.KonvaEventObject<any>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onDragMove: (e: Konva.KonvaEventObject<any>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onDragEnd: (e: Konva.KonvaEventObject<any>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onTransformEnd: (e: Konva.KonvaEventObject<any>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onTransform?: (e: Konva.KonvaEventObject<any>) => void;
    onDblClickText: (layer: LayerType & { type: "text" }, node: Konva.Text) => void;
    isEditing: boolean;
    isAutoLayoutChild?: boolean;
    onHover?: (layerId: string | null) => void;
}

const CanvasLayer = memo(function CanvasLayer({
    layer,
    isSelected,
    onSelect,
    onDragStart,
    onDragMove,
    onDragEnd,
    onTransformEnd,
    onTransform,
    onDblClickText,
    isEditing,
    isAutoLayoutChild,
    onHover,
}: CanvasLayerProps) {
    const shapeRef = useRef<Konva.Shape>(null);
    const groupRef = useRef<Konva.Group>(null);
    const activeTool = useCanvasStore((s) => s.activeTool);

    useEffect(() => {
        if (!groupRef.current || (layer.type !== "rectangle" && layer.type !== "frame")) return;
        const strokeLayer = layer as LayerType & { type: "rectangle" | "frame" };
        installLayerBoxGetClientRect(groupRef.current, {
            width: strokeLayer.width,
            height: strokeLayer.height,
            strokeWidth: strokeLayer.strokeWidth,
            strokeAlign: strokeLayer.strokeAlign,
            strokeEnabled: strokeLayer.strokeEnabled,
        });
    }, [
        layer.type,
        layer.width,
        layer.height,
        layer.type === "rectangle" || layer.type === "frame" ? layer.strokeWidth : 0,
        layer.type === "rectangle" || layer.type === "frame" ? layer.strokeAlign : undefined,
        layer.type === "rectangle" || layer.type === "frame" ? layer.strokeJoin : undefined,
        layer.type === "rectangle" || layer.type === "frame" ? layer.strokeEnabled : undefined,
    ]);

    // Text: pin the selection/hover bounds to the layer box. With vertical trim
    // the Konva Text node keeps its natural height (so all lines still render)
    // and is shifted up via offsetY — that would otherwise leak the Group's
    // client-rect above/below the trimmed box. We override getClientRect here.
    //
    // The override is installed via a ref callback (during commit) rather than an
    // effect so it is in place BEFORE the SelectionTransformer's effect reads the
    // rect. An effect-based install raced the transformer and left the selection
    // box at the untrimmed height until the next reselect/toggle.
    const textBoxRef = useRef({ width: layer.width, height: layer.height });
    textBoxRef.current = { width: layer.width, height: layer.height };
    const attachTextGroupRef = useCallback((node: Konva.Group | null) => {
        groupRef.current = node;
        if (node) {
            node.getClientRect = (config) => {
                const bounds = node.findOne<Konva.Rect>(`.${TEXT_LAYER_BOUNDS_NAME}`);
                const width = bounds?.width() ?? textBoxRef.current.width;
                const height = bounds?.height() ?? textBoxRef.current.height;
                return computeLayerBoxClientRect(
                    node,
                    { width, height, strokeWidth: 0 },
                    config,
                );
            };
        }
    }, []);

    if (!layer.visible) return null;

    const commonProps = {
        id: layer.id,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        rotation: layer.rotation,
        opacity: layer.opacity ?? 1,
        draggable: !layer.locked && !isEditing && !isAutoLayoutChild && activeTool === "select",
        listening: activeTool === "select",
        onClick: onSelect,
        onTap: onSelect,
        onDragStart,
        onDragMove,
        onDragEnd,
        onTransformEnd,
        onTransform,
        onDblClick: (e: Konva.KonvaEventObject<MouseEvent>) => {
            // For text, we already handle dblClick in the <Text> node itself to trigger editing.
            // But for other shapes inside frames, a double click should deep-select them natively.
            if (layer.type !== "text") {
                // If it's already selected, don't do anything (or maybe keep it selected). 
                // We'll pass it to onSelect, but we'll attach a custom property to bypass frame redirection.
                (e.evt as any)._isDeepSelect = true;
                onSelect(e);
            }
        },
        onMouseEnter: () => onHover?.(layer.id),
        onMouseLeave: () => onHover?.(null),
    };

    return (
        <>
            {layer.type === "rectangle" && (
                <Group ref={groupRef as React.RefObject<Konva.Group | null>} {...commonProps}>
                    <Rect
                        x={0}
                        y={0}
                        width={layer.width}
                        height={layer.height}
                        fill="rgba(0,0,0,0.001)"
                        listening={activeTool === "select"}
                        perfectDrawEnabled={false}
                    />
                    <FlipLayerContent layer={layer}>
                        <StyledBoxFill
                            width={layer.width}
                            height={layer.height}
                            cornerRadius={resolveCornerRadius(layer.cornerRadius, layer.cornerRadii)}
                            fill={layer.fill}
                            fillMode={layer.fillMode}
                            fillEnabled={layer.fillEnabled}
                            imageFill={layer.imageFill}
                        />
                        <StyledBoxStroke
                            width={layer.width}
                            height={layer.height}
                            cornerRadius={resolveCornerRadius(layer.cornerRadius, layer.cornerRadii)}
                            stroke={layer.stroke}
                            strokeMode={layer.strokeMode}
                            strokeImageFill={layer.strokeImage}
                            strokeWidth={layer.strokeWidth}
                            strokeAlign={layer.strokeAlign}
                            strokeJoin={layer.strokeJoin}
                            strokeEnabled={layer.strokeEnabled}
                        />
                    </FlipLayerContent>
                </Group>
            )}
            {layer.type === "text" && !isEditing && (
                <Group ref={attachTextGroupRef} {...commonProps}>
                    <Rect
                        name={TEXT_LAYER_BOUNDS_NAME}
                        width={layer.width}
                        height={layer.height}
                        fill="transparent"
                        listening={false}
                    />
                    <FlipLayerContent layer={layer}>
                        <Text
                            name={TEXT_LAYER_CONTENT_NAME}
                            ref={shapeRef as React.RefObject<Konva.Text | null>}
                            width={layer.textAdjust === "auto_width" ? undefined : layer.width}
                            height={layer.textAdjust === "auto_width" || layer.textAdjust === "auto_height"
                                ? undefined
                                : getEffectiveTextRenderHeight(layer)}
                            offsetY={getTextRenderOffsetY(layer)}
                            text={layer.textTransform === "uppercase" ? layer.text.toUpperCase() : layer.textTransform === "lowercase" ? layer.text.toLowerCase() : layer.text}
                            fontSize={layer.fontSize}
                            fontFamily={layer.fontFamily}
                            fontStyle={layer.fontWeight || "normal"}
                            fill={layer.fillEnabled === false ? "transparent" : layer.fill}
                            align={layer.align}
                            verticalAlign={layer.verticalAlign || "top"}
                            letterSpacing={layer.letterSpacing}
                            lineHeight={layer.lineHeight}
                            wrap={layer.textAdjust === "auto_width" ? "none" : "word"}
                            ellipsis={layer.textAdjust === "fixed" ? shouldUseTextEllipsis(layer) : false}
                            onDblClick={() => {
                                if (shapeRef.current) {
                                    onDblClickText(layer as LayerType & { type: "text" }, shapeRef.current as Konva.Text);
                                }
                            }}
                            onDblTap={() => {
                                if (shapeRef.current) {
                                    onDblClickText(layer as LayerType & { type: "text" }, shapeRef.current as Konva.Text);
                                }
                            }}
                        />
                    </FlipLayerContent>
                </Group>
            )}
            {layer.type === "image" && (
                <ImageLayerRenderer
                    shapeRef={shapeRef}
                    layer={layer}
                    commonProps={commonProps}
                />
            )}
            {layer.type === "vector" && (
                <VectorLayerRenderer
                    groupRef={groupRef}
                    layer={layer}
                    commonProps={commonProps}
                />
            )}
            {layer.type === "badge" && (
                <BadgeLayerRenderer
                    groupRef={groupRef}
                    layer={layer}
                    commonProps={commonProps}
                />
            )}
            {layer.type === "slice" && (
                <SliceLayerRenderer
                    groupRef={groupRef}
                    layer={layer}
                    commonProps={commonProps}
                    isSelected={isSelected}
                />
            )}
            {layer.type === "frame" && (
                <FrameLayerRenderer
                    groupRef={groupRef}
                    layer={layer as FrameLayer}
                    commonProps={commonProps}
                    isSelected={isSelected}
                    onSelect={onSelect}
                    onDragStart={onDragStart}
                    onDragMove={onDragMove}
                    onDragEnd={onDragEnd}
                    onTransformEnd={onTransformEnd}
                    onDblClickText={onDblClickText}
                    isEditing={isEditing}
                    onHover={onHover}
                />
            )}
        </>
    );
});

function ImageLayerRenderer({
    shapeRef,
    layer,
    commonProps,
}: {
    shapeRef: React.RefObject<Konva.Shape | null>;
    layer: LayerType & { type: "image" };
    commonProps: Record<string, unknown>;
}) {
    const image = useImage(layer.src);
    const figmaInlineSvg = useFigmaVectorInlineSvg(layer.src, layer.metadata?.figmaOriginalType);
    const fillMode = layer.fillMode ?? "image";
    const cornerRadius = resolveCornerRadius(layer.cornerRadius ?? 0, layer.cornerRadii);

    return (
        <Group
            ref={shapeRef as React.RefObject<Konva.Group | null>}
            {...commonProps}
        >
            <Rect
                width={layer.width}
                height={layer.height}
                fill="rgba(0,0,0,0.001)"
                listening={commonProps.listening as boolean}
                perfectDrawEnabled={false}
            />
            <FlipLayerContent layer={layer}>
                {fillMode === "paint" ? (
                    <StyledBoxFill
                        width={layer.width}
                        height={layer.height}
                        cornerRadius={cornerRadius}
                        fill={layer.fill ?? "#FFFFFF"}
                        fillMode="paint"
                        fillEnabled={layer.fillEnabled}
                    />
                ) : figmaInlineSvg ? (
                    <InlineSvgVectorImage
                        inlineSvg={figmaInlineSvg}
                        width={layer.width}
                        height={layer.height}
                    />
                ) : image ? (
                    <ImageFillContent
                        image={image}
                        width={layer.width}
                        height={layer.height}
                        cornerRadius={cornerRadius}
                        fitMode={(layer as ImageLayer).objectFit || "cover"}
                        opacity={layer.fillEnabled === false ? 0 : 1}
                        focusX={layer.focusX}
                        focusY={layer.focusY}
                    />
                ) : null}
                <StyledBoxStroke
                    width={layer.width}
                    height={layer.height}
                    cornerRadius={cornerRadius}
                    stroke={layer.stroke}
                    strokeMode={layer.strokeMode}
                    strokeImageFill={layer.strokeImage}
                    strokeWidth={layer.strokeWidth ?? 0}
                    strokeAlign={layer.strokeAlign}
                    strokeJoin={layer.strokeJoin}
                    strokeEnabled={layer.strokeEnabled}
                />
            </FlipLayerContent>
        </Group>
    );
}

/**
 * Slice overlay renderer — a dashed export-region marker (Figma-like).
 * Only the dashed border and the name label are interactive, so layers
 * underneath the slice region stay clickable. The whole group is named
 * `SLICE_OVERLAY_NAME` and is hidden during raster export captures.
 */
function SliceLayerRenderer({
    groupRef,
    layer,
    commonProps,
    isSelected,
}: {
    groupRef: React.RefObject<Konva.Group | null>;
    layer: LayerType & { type: "slice" };
    commonProps: Record<string, unknown>;
    isSelected: boolean;
}) {
    const zoom = useCanvasStore((s) => s.zoom);
    const inv = 1 / Math.max(zoom, 0.01);
    const accent = isSelected ? "#6366F1" : "#F97316";
    const labelFontSize = 11 * inv;
    const labelWidth = Math.max(40 * inv, layer.name.length * labelFontSize * 0.62);

    return (
        <Group ref={groupRef} name={SLICE_OVERLAY_NAME} {...commonProps}>
            <Rect
                width={layer.width}
                height={layer.height}
                stroke={accent}
                strokeWidth={1 * inv}
                dash={[4 * inv, 4 * inv]}
                fillEnabled={false}
                hitStrokeWidth={8 * inv}
                listening={commonProps.listening as boolean}
                perfectDrawEnabled={false}
            />
            <Text
                x={0}
                y={-(labelFontSize + 5 * inv)}
                width={labelWidth}
                text={layer.name}
                fontSize={labelFontSize}
                fontFamily="Inter, sans-serif"
                fill={accent}
                listening={commonProps.listening as boolean}
            />
        </Group>
    );
}

function FlipLayerContent({ layer, children }: { layer: Pick<LayerType, "width" | "height" | "flipX" | "flipY">; children: ReactNode }) {
    if (!layer.flipX && !layer.flipY) return <>{children}</>;
    return (
        <Group
            name={FLIP_LAYER_CONTENT_NAME}
            x={layer.flipX ? layer.width : 0}
            y={layer.flipY ? layer.height : 0}
            scaleX={layer.flipX ? -1 : 1}
            scaleY={layer.flipY ? -1 : 1}
        >
            {children}
        </Group>
    );
}

/** Resolve a Paint to a flat stroke color (gradients fall back to first stop). */
function resolveStrokeColor(paint: Paint | undefined): string | undefined {
    if (paint === undefined || paint === "") return undefined;
    const normalized = normalizePaint(paint);
    if (normalized.kind === "solid") return normalized.color;
    return normalized.stops[0]?.color;
}

function VectorLayerRenderer({
    groupRef,
    layer,
    commonProps,
}: {
    groupRef: React.RefObject<Konva.Group | null>;
    layer: VectorLayer;
    commonProps: Record<string, unknown>;
}) {
    const activeTool = useCanvasStore((s) => s.activeTool);
    const vectorEditLayerId = useCanvasStore((s) => s.vectorEditLayerId);
    const setVectorEditLayerId = useCanvasStore((s) => s.setVectorEditLayerId);
    const updateLayer = useCanvasStore((s) => s.updateLayer);
    const width = layer.width;
    const height = layer.height;
    const isEditing = vectorEditLayerId === layer.id;

    // The non-editing render priority below (inlineSvg → subpaths → rawSvgPath)
    // must stay in sync with resolveReadOnlyVectorRenderMode() in
    // vectorRenderMode.ts, which drives the read-only overview tiles + PreviewCanvas.
    const hasInline = !!layer.inlineSvg;
    const useRaw = !hasInline && !!layer.rawSvgPath;
    const useSubpaths = hasRenderableGeometry(layer.subpaths);
    const keepImportedPreview = isEditing && (hasInline || useRaw) && !useSubpaths;
    const pathData = useSubpaths
        ? subpathsToPathData(layer.subpaths, width, height)
        : layer.rawSvgPath ?? "";
    const rawScaleX = useRaw && layer.viewBoxWidth ? width / layer.viewBoxWidth : 1;
    const rawScaleY = useRaw && layer.viewBoxHeight ? height / layer.viewBoxHeight : 1;

    const fillProps = layer.fillEnabled === false
        ? { fillEnabled: false }
        : paintToKonvaProps(layer.fill, width, height);
    const strokeColor = layer.strokeEnabled ? resolveStrokeColor(layer.stroke) : undefined;

    return (
        <Group
            ref={groupRef as React.RefObject<Konva.Group | null>}
            {...commonProps}
            onDblClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
                (commonProps.onClick as ((ev: Konva.KonvaEventObject<MouseEvent>) => void) | undefined)?.(e);
                if (activeTool !== "select") return;
                if (useSubpaths) {
                    setVectorEditLayerId(layer.id);
                    return;
                }
                if (hasInline || useRaw) {
                    enterVectorEditMode(layer, updateLayer, setVectorEditLayerId);
                }
            }}
        >
            <Rect
                x={0}
                y={0}
                width={width}
                height={height}
                fill="rgba(0,0,0,0.001)"
                listening={activeTool === "select"}
                perfectDrawEnabled={false}
            />
            <FlipLayerContent layer={layer}>
                {keepImportedPreview && hasInline ? (
                    <InlineSvgVectorImage inlineSvg={layer.inlineSvg!} width={width} height={height} />
                ) : keepImportedPreview && useRaw ? (
                    <Path
                        data={layer.rawSvgPath!}
                        scaleX={rawScaleX}
                        scaleY={rawScaleY}
                        {...fillProps}
                        fillRule={layer.fillRule ?? "nonzero"}
                        stroke={strokeColor}
                        strokeWidth={strokeColor ? layer.strokeWidth ?? 0 : 0}
                        lineJoin={layer.strokeJoin ?? "miter"}
                        strokeScaleEnabled={false}
                        listening={false}
                        perfectDrawEnabled={false}
                    />
                ) : hasInline && !isEditing ? (
                    <InlineSvgVectorImage inlineSvg={layer.inlineSvg!} width={width} height={height} />
                ) : (
                    <Path
                        data={pathData}
                        scaleX={rawScaleX}
                        scaleY={rawScaleY}
                        {...fillProps}
                        fillRule={layer.fillRule ?? "nonzero"}
                        stroke={strokeColor}
                        strokeWidth={strokeColor ? layer.strokeWidth ?? 0 : 0}
                        lineJoin={layer.strokeJoin ?? "miter"}
                        strokeScaleEnabled={false}
                        listening={false}
                        perfectDrawEnabled={false}
                    />
                )}
            </FlipLayerContent>
        </Group>
    );
}

/** Interactive anchor + handle editing overlay for a vector layer. */
function VectorEditOverlay({
    layer,
    zoom,
    onChange,
}: {
    layer: VectorLayer;
    zoom: number;
    onChange: (id: string, updates: LayerUpdate) => void;
}) {
    const { x, y, width, height } = layer;
    const subpaths = useMemo(() => parseEditableSubpaths(layer) ?? [], [layer]);
    const readOnly = isReadOnlyImportedPath(layer);
    const needsConversion = !readOnly && (!!layer.inlineSvg || !!layer.rawSvgPath);
    const visibleAnchors = useMemo(
        () => (readOnly ? [] : visibleAnchorIndices(subpaths, needsConversion ? 12 : 40)),
        [subpaths, needsConversion, readOnly],
    );
    const [selectedAnchor, setSelectedAnchor] = useState<{ si: number; pi: number } | null>(null);
    const anchorR = 4.5 / zoom;
    const handleR = 3.5 / zoom;
    const strokeW = 1 / zoom;
    const outlinePath = useMemo(
        () => (subpaths.length > 0 ? subpathsToPathData(subpaths, width, height) : ""),
        [subpaths, width, height],
    );

    const toScene = (nx: number, ny: number) => ({ x: x + nx * width, y: y + ny * height });
    const toNorm = (sx: number, sy: number) => ({
        x: width !== 0 ? (sx - x) / width : 0,
        y: height !== 0 ? (sy - y) / height : 0,
    });

    const commitSubpathUpdate = (next: typeof subpaths) => {
        if (readOnly) return;
        if (needsConversion && !hasRenderableGeometry(layer.subpaths)) {
            onChange(layer.id, {
                subpaths: next,
                fillRule: layer.fillRule ?? (next.length > 1 ? "evenodd" : "nonzero"),
                inlineSvg: undefined,
                rawSvgPath: undefined,
                viewBoxWidth: undefined,
                viewBoxHeight: undefined,
            });
        } else {
            onChange(layer.id, { subpaths: next });
        }
    };

    const updateAnchor = (si: number, pi: number, mut: (p: VectorAnchorLike) => VectorAnchorLike) => {
        const next = subpaths.map((sp, i) =>
            i !== si ? sp : { ...sp, points: sp.points.map((p, j) => (j !== pi ? p : mut({ ...p }))) },
        );
        commitSubpathUpdate(next);
    };

    return (
        <Group listening={!readOnly}>
            {(readOnly || needsConversion) ? (
                <Rect
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    stroke={PEN_STROKE}
                    strokeWidth={strokeW}
                    dash={[6 / zoom, 4 / zoom]}
                    listening={false}
                    perfectDrawEnabled={false}
                />
            ) : outlinePath ? (
                <Path
                    x={x}
                    y={y}
                    data={outlinePath}
                    stroke={PEN_STROKE}
                    strokeWidth={strokeW}
                    fill="transparent"
                    listening={false}
                    perfectDrawEnabled={false}
                />
            ) : null}
            {readOnly && (
                <Text
                    x={x}
                    y={y + height + 8 / zoom}
                    width={width}
                    text="Boolean-контур (Subtract): редактирование точек недоступно"
                    fontSize={11 / zoom}
                    fill="#6366F1"
                    listening={false}
                    perfectDrawEnabled={false}
                />
            )}
            {visibleAnchors.map(({ si, pi }) => {
                const p = subpaths[si]?.points[pi];
                if (!p) return null;
                const a = toScene(p.x, p.y);
                const isSelected = selectedAnchor?.si === si && selectedAnchor?.pi === pi;
                const hasIn = isSelected && p.inX !== undefined && p.inY !== undefined;
                const hasOut = isSelected && p.outX !== undefined && p.outY !== undefined;
                const inPt = hasIn ? toScene(p.inX as number, p.inY as number) : null;
                const outPt = hasOut ? toScene(p.outX as number, p.outY as number) : null;
                return (
                    <Fragment key={`${si}-${pi}`}>
                        {inPt && <Line points={[a.x, a.y, inPt.x, inPt.y]} stroke={PEN_STROKE} strokeWidth={strokeW} listening={false} perfectDrawEnabled={false} />}
                        {outPt && <Line points={[a.x, a.y, outPt.x, outPt.y]} stroke={PEN_STROKE} strokeWidth={strokeW} listening={false} perfectDrawEnabled={false} />}
                        {inPt && (
                            <Circle
                                x={inPt.x}
                                y={inPt.y}
                                radius={handleR}
                                fill="#FFFFFF"
                                stroke={PEN_STROKE}
                                strokeWidth={strokeW}
                                draggable
                                perfectDrawEnabled={false}
                                onDragMove={(e) => {
                                    const n = toNorm(e.target.x(), e.target.y());
                                    updateAnchor(si, pi, (pt) => ({ ...pt, inX: n.x, inY: n.y, type: "bezier" }));
                                }}
                            />
                        )}
                        {outPt && (
                            <Circle
                                x={outPt.x}
                                y={outPt.y}
                                radius={handleR}
                                fill="#FFFFFF"
                                stroke={PEN_STROKE}
                                strokeWidth={strokeW}
                                draggable
                                perfectDrawEnabled={false}
                                onDragMove={(e) => {
                                    const n = toNorm(e.target.x(), e.target.y());
                                    updateAnchor(si, pi, (pt) => ({ ...pt, outX: n.x, outY: n.y, type: "bezier" }));
                                }}
                            />
                        )}
                        <Circle
                            x={a.x}
                            y={a.y}
                            radius={anchorR}
                            fill={isSelected ? PEN_STROKE : "#FFFFFF"}
                            stroke={PEN_STROKE}
                            strokeWidth={strokeW}
                            draggable
                            perfectDrawEnabled={false}
                            onMouseDown={(e) => {
                                e.cancelBubble = true;
                                setSelectedAnchor({ si, pi });
                            }}
                            onDragMove={(e) => {
                                const n = toNorm(e.target.x(), e.target.y());
                                const dx = n.x - p.x;
                                const dy = n.y - p.y;
                                updateAnchor(si, pi, (pt) => ({
                                    ...pt,
                                    x: n.x,
                                    y: n.y,
                                    ...(pt.inX !== undefined ? { inX: pt.inX + dx, inY: (pt.inY as number) + dy } : {}),
                                    ...(pt.outX !== undefined ? { outX: pt.outX + dx, outY: (pt.outY as number) + dy } : {}),
                                }));
                            }}
                            onDblClick={(e) => {
                                e.cancelBubble = true;
                                setSelectedAnchor({ si, pi });
                                updateAnchor(si, pi, (pt) => {
                                    if (pt.inX !== undefined || pt.outX !== undefined) {
                                        const { inX, inY, outX, outY, ...rest } = pt;
                                        void inX; void inY; void outX; void outY;
                                        return { ...rest, type: "corner" };
                                    }
                                    return {
                                        ...pt,
                                        inX: pt.x - 0.08,
                                        inY: pt.y,
                                        outX: pt.x + 0.08,
                                        outY: pt.y,
                                        type: "bezier",
                                    };
                                });
                            }}
                        />
                    </Fragment>
                );
            })}
        </Group>
    );
}

type VectorAnchorLike = VectorAnchor;

function PenPreview({
    points,
    cursor,
    zoom,
}: {
    points: PenDraftAnchor[];
    cursor: { x: number; y: number } | null;
    zoom: number;
}) {
    // Build a path through the committed anchors plus a rubber-band to the cursor.
    const previewAnchors = cursor
        ? [...points, { x: cursor.x, y: cursor.y }]
        : points;
    const d = subpathsToPathData(
        [{ points: previewAnchors.map((p) => ({ ...p, type: "corner" as const })), closed: false }],
        1,
        1,
    );
    const handleRadius = 3 / zoom;
    const anchorRadius = 4 / zoom;
    return (
        <Group listening={false}>
            <Path data={d} stroke={PEN_STROKE} strokeWidth={1.5 / zoom} />
            {points.map((p, i) => (
                <Fragment key={i}>
                    {p.outX !== undefined && p.outY !== undefined && (
                        <>
                            <Line points={[p.x, p.y, p.outX, p.outY]} stroke={PEN_STROKE} strokeWidth={1 / zoom} />
                            <Circle x={p.outX} y={p.outY} radius={handleRadius} fill="#FFFFFF" stroke={PEN_STROKE} strokeWidth={1 / zoom} />
                        </>
                    )}
                    {p.inX !== undefined && p.inY !== undefined && (
                        <>
                            <Line points={[p.x, p.y, p.inX, p.inY]} stroke={PEN_STROKE} strokeWidth={1 / zoom} />
                            <Circle x={p.inX} y={p.inY} radius={handleRadius} fill="#FFFFFF" stroke={PEN_STROKE} strokeWidth={1 / zoom} />
                        </>
                    )}
                    <Circle
                        x={p.x}
                        y={p.y}
                        radius={anchorRadius}
                        fill={i === 0 ? PEN_STROKE : "#FFFFFF"}
                        stroke={PEN_STROKE}
                        strokeWidth={1.5 / zoom}
                    />
                </Fragment>
            ))}
        </Group>
    );
}

function resolveCornerRadius(cornerRadius = 0, cornerRadii?: CornerRadii): CornerRadiusValue {
    if (!cornerRadii) return cornerRadius;
    return [
        cornerRadii.topLeft ?? cornerRadius,
        cornerRadii.topRight ?? cornerRadius,
        cornerRadii.bottomRight ?? cornerRadius,
        cornerRadii.bottomLeft ?? cornerRadius,
    ];
}

function roundedRectClipFunc(width: number, height: number, cornerRadius: CornerRadiusValue = 0) {
    const radii = Array.isArray(cornerRadius) ? cornerRadius : [cornerRadius, cornerRadius, cornerRadius, cornerRadius];
    const [tl, tr, br, bl] = radii.map((radius) => Math.min(Math.max(0, radius), Math.min(width, height) / 2));
    if (tl <= 0 && tr <= 0 && br <= 0 && bl <= 0) {
        return (ctx: Konva.Context) => {
            ctx.rect(0, 0, width, height);
        };
    }
    return (ctx: Konva.Context) => {
        ctx.beginPath();
        ctx.moveTo(tl, 0);
        ctx.lineTo(width - tr, 0);
        ctx.arcTo(width, 0, width, tr, tr);
        ctx.lineTo(width, height - br);
        ctx.arcTo(width, height, width - br, height, br);
        ctx.lineTo(bl, height);
        ctx.arcTo(0, height, 0, height - bl, bl);
        ctx.lineTo(0, tl);
        ctx.arcTo(0, 0, tl, 0, tl);
        ctx.closePath();
    };
}

function ImageFillContent({
    image,
    width,
    height,
    cornerRadius,
    fitMode,
    opacity = 1,
    focusX,
    focusY,
}: {
    image: HTMLImageElement;
    width: number;
    height: number;
    cornerRadius?: CornerRadiusValue;
    fitMode: ImageLayer["objectFit"];
    opacity?: number;
    focusX?: number;
    focusY?: number;
}) {
    const naturalW = image.naturalWidth || image.width;
    const naturalH = image.naturalHeight || image.height;
    const fit = computeImageFitProps(fitMode || "cover", naturalW, naturalH, width, height, {
        focusX,
        focusY,
    });

    return (
        <Group clipFunc={roundedRectClipFunc(width, height, cornerRadius)}>
            <KonvaImage
                image={image}
                x={fit.drawX}
                y={fit.drawY}
                width={fit.drawWidth}
                height={fit.drawHeight}
                crop={{ x: fit.cropX, y: fit.cropY, width: fit.cropWidth, height: fit.cropHeight }}
                opacity={opacity}
            />
        </Group>
    );
}

function ShapeImageFill({
    imageFill,
    width,
    height,
    cornerRadius,
}: {
    imageFill?: LayerImageFill;
    width: number;
    height: number;
    cornerRadius?: CornerRadiusValue;
}) {
    const image = useImage(imageFill?.src ?? "");
    if (!imageFill || !image) return null;
    return (
        <ImageFillContent
            image={image}
            width={width}
            height={height}
            cornerRadius={cornerRadius}
            fitMode={imageFill.fit}
            opacity={imageFill.opacity ?? 1}
            focusX={imageFill.focusX}
            focusY={imageFill.focusY}
        />
    );
}

function StyledBoxFill({
    width,
    height,
    cornerRadius,
    fill,
    fillMode,
    fillEnabled,
    imageFill,
}: {
    width: number;
    height: number;
    cornerRadius?: CornerRadiusValue;
    fill: Paint;
    fillMode?: "paint" | "image";
    fillEnabled?: boolean;
    imageFill?: LayerImageFill;
}) {
    if (fillEnabled === false) return null;
    if (fillMode === "image" && imageFill?.src) {
        return (
            <ShapeImageFill
                imageFill={imageFill}
                width={width}
                height={height}
                cornerRadius={cornerRadius}
            />
        );
    }
    return (
        <AlignedStrokeRect
            width={width}
            height={height}
            cornerRadius={cornerRadius}
            {...paintToKonvaProps(fill, width, height)}
            strokeEnabled={false}
        />
    );
}

function StyledBoxStroke({
    width,
    height,
    cornerRadius,
    stroke,
    strokeMode,
    strokeImageFill,
    strokeWidth = 0,
    strokeAlign,
    strokeJoin,
    strokeEnabled,
}: {
    width: number;
    height: number;
    cornerRadius?: CornerRadiusValue;
    stroke?: Paint;
    strokeMode?: "paint" | "image";
    strokeImageFill?: LayerImageFill;
    strokeWidth?: number;
    strokeAlign?: ImageLayer["strokeAlign"];
    strokeJoin?: ImageLayer["strokeJoin"];
    strokeEnabled?: boolean;
}) {
    const image = useImage(strokeMode === "image" ? strokeImageFill?.src ?? "" : "");
    const strokeIsImage = strokeMode === "image" && !!strokeImageFill?.src;
    return (
        <AlignedStrokeRect
            width={width}
            height={height}
            cornerRadius={cornerRadius}
            fillEnabled={false}
            stroke={typeof stroke === "string" ? stroke || undefined : undefined}
            strokePaint={strokeIsImage ? undefined : stroke}
            strokeImage={strokeIsImage ? image ?? undefined : undefined}
            strokeImageFill={strokeImageFill}
            strokeWidth={strokeWidth}
            strokeAlign={strokeAlign}
            strokeJoin={strokeJoin}
            strokeEnabled={strokeEnabled !== false}
        />
    );
}

function BadgeLayerRenderer({
    groupRef,
    layer,
    commonProps,
}: {
    groupRef: React.RefObject<Konva.Group | null>;
    layer: BadgeLayer;
    commonProps: Record<string, unknown>;
}) {
    const radius = layer.shape === "pill"
        ? layer.height / 2
        : layer.shape === "circle"
            ? Math.min(layer.width, layer.height) / 2
            : 4;

    return (
        <Group
            ref={groupRef}
            {...commonProps}
        >
            <FlipLayerContent layer={layer}>
                <Rect
                    width={layer.width}
                    height={layer.height}
                    {...(layer.fillEnabled === false
                        ? { fill: "transparent", fillPriority: "color" }
                        : paintToKonvaProps(layer.fill, layer.width, layer.height))}
                    cornerRadius={radius}
                />
                <Text
                    width={layer.width}
                    height={layer.height}
                    text={layer.label}
                    fontSize={layer.fontSize}
                    fontFamily="Inter"
                    fontStyle="600"
                    fill={layer.textColor}
                    align="center"
                    verticalAlign="middle"
                />
            </FlipLayerContent>
        </Group>
    );
}

function FrameLayerRenderer({
    groupRef,
    layer,
    commonProps,
    isSelected,
    onSelect,
    onDragStart,
    onDragMove,
    onDragEnd,
    onTransformEnd,
    onDblClickText,
    isEditing,
    onHover,
}: {
    groupRef: React.RefObject<Konva.Group | null>;
    layer: FrameLayer;
    commonProps: Record<string, unknown>;
    isSelected: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSelect: (e: Konva.KonvaEventObject<any>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onDragStart: (e: Konva.KonvaEventObject<any>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onDragMove: (e: Konva.KonvaEventObject<any>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onDragEnd: (e: Konva.KonvaEventObject<any>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onTransformEnd: (e: Konva.KonvaEventObject<any>) => void;
    onDblClickText: (layer: LayerType & { type: "text" }, node: Konva.Text) => void;
    isEditing: boolean;
    onHover?: (layerId: string | null) => void;
}) {
    // Subscribe only to this frame's children (shallow-compared) instead of the
    // whole `layers` array, so unrelated layer edits elsewhere in the document
    // don't re-render every frame.
    const childLayers = useCanvasStore(
        useShallow((s) => layer.childIds
            .map((id) => s.layers.find((l) => l.id === id))
            .filter(Boolean) as LayerType[])
    );
    // The frame's own absolute store position (the `layer` prop may carry
    // frame-local coords for nested frames).
    const frameStorePos = useCanvasStore(
        useShallow((s) => {
            const f = s.layers.find((l) => l.id === layer.id);
            return { x: f?.x ?? layer.x, y: f?.y ?? layer.y };
        })
    );
    const selectedLayerIds = useCanvasStore((s) => s.selectedLayerIds);
    const updateLayer = useCanvasStore((s) => s.updateLayer);
    const highlightedFrameId = useCanvasStore((s) => s.highlightedFrameId);
    const isEditingText = useCanvasStore((s) => s.isEditingText);
    const editingLayerId = useCanvasStore((s) => s.editingLayerId);
    const clipGroupRef = useRef<Konva.Group>(null);

    const isHighlighted = highlightedFrameId === layer.id;

    // Determine which children are currently selected
    const selectedChildIds = layer.childIds.filter((id) => selectedLayerIds.includes(id));

    // Handle transform end for children inside this frame.
    // For auto-layout children: only pass size changes, let auto-layout engine compute position.
    // For non-auto-layout children: convert frame-local coords to absolute scene coords.
    const handleChildTransformEnd = useCallback((e: Konva.KonvaEventObject<Event>) => {
        const node = e.target;
        const id = node.id();
        const allLayers = useCanvasStore.getState().layers;
        const childLayer = allLayers.find(l => l.id === id);

        let scaleX = node.scaleX();
        let scaleY = node.scaleY();
        const rotation = node.rotation();

        if (childLayer) {
            enforceLockedAspectOnNode(node, childLayer);
            scaleX = node.scaleX();
            scaleY = node.scaleY();
        }

        // Reset scale and apply to width/height
        node.scaleX(1);
        node.scaleY(1);

        const textBase = childLayer?.type === "text"
            ? getTextTransformBaseSize(node, childLayer as TextLayer)
            : null;
        const baseWidth = textBase?.width ?? node.width();
        const baseHeight = textBase?.height ?? node.height();
        const sized = childLayer
            ? lockedAspectDimensions(childLayer, scaleX, scaleY, baseWidth, baseHeight)
            : { width: baseWidth * scaleX, height: baseHeight * scaleY };
        let width = sized.width;
        let height = sized.height;

        if (childLayer?.type === "text") {
            const synced = syncTextTransformNodes(node, childLayer as TextLayer, width, height);
            width = synced.width;
            height = synced.height;
        }

        const isAutoLayout = layer.layoutMode && layer.layoutMode !== "none" && childLayer && !childLayer.isAbsolutePositioned;

        // Get absolute frame position from store (layer.x prop may be relative for nested frames)
        const storeFrame = allLayers.find(l => l.id === layer.id);
        const frameAbsX = storeFrame?.x ?? layer.x;
        const frameAbsY = storeFrame?.y ?? layer.y;

        // Build extra props for auto-sizing overrides.
        // NOTE: For text nodes, onTransform already resets scale to 1 during
        // the live transform, so scaleX/Y are 1 here. We detect resize by
        // comparing final dimensions to the store's original values instead.
        let extraProps: Record<string, unknown> = {};
        if (childLayer) {
            const hasSizedX = Math.abs(width - childLayer.width) > 0.5;
            const hasSizedY = Math.abs(height - childLayer.height) > 0.5;

            if (hasSizedX || hasSizedY) {
                // Switch auto-layout sizing to fixed on manual resize
                if (hasSizedX && (childLayer.layoutSizingWidth === "fill" || childLayer.layoutSizingWidth === "hug")) {
                    extraProps.layoutSizingWidth = "fixed";
                }
                if (hasSizedY && (childLayer.layoutSizingHeight === "fill" || childLayer.layoutSizingHeight === "hug")) {
                    extraProps.layoutSizingHeight = "fixed";
                }

            }
        }

        if (isAutoLayout && childLayer) {
            // Auto-layout children: update size, then reset node position
            // to the store's local coords so React can reconcile properly.
            updateLayer(id, { width, height, rotation, ...extraProps });
            // Force node back to store position (frame-local coords)
            node.x(childLayer.x - frameAbsX);
            node.y(childLayer.y - frameAbsY);
        } else {
            // Non-auto-layout: convert frame-local coords to absolute scene coords.
            const newX = node.x() + frameAbsX;
            const newY = node.y() + frameAbsY;
            updateLayer(id, { x: newX, y: newY, width, height, rotation, ...extraProps });
        }
    }, [updateLayer, layer.x, layer.y, layer.layoutMode, layer.id]);

    return (
        <Group
            ref={groupRef}
            {...commonProps}
        >
            <Rect
                x={0}
                y={0}
                width={layer.width}
                height={layer.height}
                fill="rgba(0,0,0,0.001)"
                listening={commonProps.listening as boolean}
                perfectDrawEnabled={false}
            />
            <Group
                ref={clipGroupRef}
                clipX={layer.clipContent ? 0 : undefined}
                clipY={layer.clipContent ? 0 : undefined}
                clipWidth={layer.clipContent ? layer.width : undefined}
                clipHeight={layer.clipContent ? layer.height : undefined}
            >
                <Group
                    clipFunc={layer.clipContent ? roundedRectClipFunc(layer.width, layer.height, resolveCornerRadius(layer.cornerRadius, layer.cornerRadii)) : undefined}
                >
                    <FlipLayerContent layer={layer}>
                        <StyledBoxFill
                            width={layer.width}
                            height={layer.height}
                            cornerRadius={resolveCornerRadius(layer.cornerRadius, layer.cornerRadii)}
                            fill={layer.fill}
                            fillMode={layer.fillMode}
                            fillEnabled={layer.fillEnabled}
                            imageFill={layer.imageFill}
                        />
                    </FlipLayerContent>
                    {childLayers.map((child) => {
                        // Use STORE's absolute position for the frame, not the prop
                        // (prop may be relative for nested frames).
                        const frameAbsX = frameStorePos.x;
                        const frameAbsY = frameStorePos.y;
                        return (
                            <CanvasLayer
                                key={child.id}
                                layer={{ ...child, x: child.x - frameAbsX, y: child.y - frameAbsY }}
                                isSelected={selectedLayerIds.includes(child.id)}
                                onSelect={onSelect}
                                onDragStart={onDragStart}
                                onDragMove={onDragMove}
                                onDragEnd={onDragEnd}
                                onTransformEnd={handleChildTransformEnd}
                                onDblClickText={onDblClickText}
                                isEditing={isEditingText && editingLayerId === child.id}
                                isAutoLayoutChild={layer.layoutMode !== undefined && layer.layoutMode !== "none" && !child.isAbsolutePositioned}
                                onHover={onHover}
                            />
                        );
                    })}
                    <FlipLayerContent layer={layer}>
                        <StyledBoxStroke
                            width={layer.width}
                            height={layer.height}
                            cornerRadius={resolveCornerRadius(layer.cornerRadius, layer.cornerRadii)}
                            stroke={isHighlighted ? FRAME_HIGHLIGHT_STROKE : layer.stroke}
                            strokeMode={isHighlighted ? "paint" : layer.strokeMode}
                            strokeImageFill={isHighlighted ? undefined : layer.strokeImage}
                            strokeWidth={isHighlighted ? FRAME_HIGHLIGHT_WIDTH : layer.strokeWidth}
                            strokeAlign={layer.strokeAlign}
                            strokeJoin={layer.strokeJoin}
                            strokeEnabled={isHighlighted || layer.strokeEnabled !== false}
                        />
                    </FlipLayerContent>
                </Group>
            </Group>
            {/* Inner Transformer for selected children — operates in frame-local coords */}
            {selectedChildIds.length > 0 && (
                <FrameChildTransformer
                    selectedChildIds={selectedChildIds}
                    containerRef={clipGroupRef}
                />
            )}
        </Group>
    );
}

function GradientDirectionHandles({
    target,
    zoom,
    onDragStart,
    onDragEnd,
    onUpdateLayer,
    onUpdateArtboard,
}: {
    target:
        | { kind: "layer"; layer: Extract<LayerType, { type: "rectangle" | "badge" | "frame" | "image" }> }
        | { kind: "artboard"; fill: Paint; width: number; height: number };
    zoom: number;
    onDragStart: () => void;
    onDragEnd: () => void;
    onUpdateLayer: (id: string, updates: LayerUpdate) => void;
    onUpdateArtboard: (updates: { fill: Paint }) => void;
}) {
    const bounds = target.kind === "layer"
        ? { x: target.layer.x, y: target.layer.y, width: target.layer.width, height: target.layer.height }
        : { x: 0, y: 0, width: target.width, height: target.height };
    const fill = target.kind === "layer" ? target.layer.fill ?? "#FFFFFF" : target.fill;
    const paint = normalizePaint(fill);
    if (paint.kind !== "gradient") return null;

    const start = paint.start ?? { x: 0, y: 0.5 };
    const end = paint.end ?? { x: 1, y: 0.5 };
    const center = paint.center ?? { x: 0.5, y: 0.5 };
    const radius = paint.radius ?? 0.7;
    const startAbs = { x: bounds.x + start.x * bounds.width, y: bounds.y + start.y * bounds.height };
    const endAbs = paint.gradientType === "linear"
        ? { x: bounds.x + end.x * bounds.width, y: bounds.y + end.y * bounds.height }
        : {
            x: bounds.x + center.x * bounds.width + Math.cos((paint.angle * Math.PI) / 180) * Math.max(bounds.width, bounds.height) * radius,
            y: bounds.y + center.y * bounds.height + Math.sin((paint.angle * Math.PI) / 180) * Math.max(bounds.width, bounds.height) * radius,
        };
    const centerAbs = { x: bounds.x + center.x * bounds.width, y: bounds.y + center.y * bounds.height };
    const guideStartAbs = paint.gradientType === "linear" ? startAbs : centerAbs;
    const guideEndAbs = endAbs;
    const handleRadius = Math.max(4, 6 / zoom);
    const stopHandleRadius = Math.max(5, 7 / zoom);
    const strokeWidth = Math.max(1, 2 / zoom);

    const updateFill = (nextFill: typeof paint) => {
        if (target.kind === "layer") {
            onUpdateLayer(target.layer.id, { fill: nextFill });
        } else {
            onUpdateArtboard({ fill: nextFill });
        }
    };

    const pointFromNode = (node: Konva.Node) => ({
        x: Math.min(1, Math.max(0, (node.x() - bounds.x) / Math.max(1, bounds.width))),
        y: Math.min(1, Math.max(0, (node.y() - bounds.y) / Math.max(1, bounds.height))),
    });

    const updateLinearPoint = (which: "start" | "end", node: Konva.Node) => {
        const point = pointFromNode(node);
        updateFill(which === "start"
            ? setGradientEndpoints(paint, point, end)
            : setGradientEndpoints(paint, start, point));
    };

    const updateRadialPoint = (which: "center" | "edge", node: Konva.Node) => {
        const point = pointFromNode(node);
        if (which === "center") {
            updateFill({ ...paint, center: point });
            return;
        }
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        updateFill({
            ...paint,
            angle: (Math.atan2(dy * bounds.height, dx * bounds.width) * 180) / Math.PI,
            radius: Math.min(1, Math.max(0.05, Math.hypot(dx * bounds.width, dy * bounds.height) / Math.max(bounds.width, bounds.height, 1))),
        });
    };

    const projectPointToGuide = (point: { x: number; y: number }) => {
        const vx = guideEndAbs.x - guideStartAbs.x;
        const vy = guideEndAbs.y - guideStartAbs.y;
        const lengthSquared = Math.max(1, vx * vx + vy * vy);
        const rawOffset = ((point.x - guideStartAbs.x) * vx + (point.y - guideStartAbs.y) * vy) / lengthSquared;
        const offset = Math.min(1, Math.max(0, rawOffset));
        return {
            offset,
            x: guideStartAbs.x + vx * offset,
            y: guideStartAbs.y + vy * offset,
        };
    };

    const updateStopOffset = (stopId: string, node: Konva.Node) => {
        const projected = projectPointToGuide({ x: node.x(), y: node.y() });
        node.position({ x: projected.x, y: projected.y });
        updateFill({
            ...paint,
            stops: paint.stops
                .map((stop) => stop.id === stopId ? { ...stop, offset: projected.offset } : stop)
                .sort((a, b) => a.offset - b.offset),
        });
    };

    return (
        <Group listening name="gradient-control">
            <Line
                points={paint.gradientType === "linear"
                    ? [startAbs.x, startAbs.y, endAbs.x, endAbs.y]
                    : [centerAbs.x, centerAbs.y, endAbs.x, endAbs.y]}
                stroke="#2563EB"
                strokeWidth={strokeWidth}
                dash={[6 / zoom, 4 / zoom]}
                name="gradient-control"
                listening={false}
            />
            <Circle
                x={paint.gradientType === "linear" ? startAbs.x : centerAbs.x}
                y={paint.gradientType === "linear" ? startAbs.y : centerAbs.y}
                radius={handleRadius}
                fill="#FFFFFF"
                stroke="#2563EB"
                strokeWidth={strokeWidth}
                name="gradient-control"
                draggable
                onDragMove={(e) => paint.gradientType === "linear"
                    ? updateLinearPoint("start", e.target)
                    : updateRadialPoint("center", e.target)}
                onDragStart={(e) => { e.cancelBubble = true; onDragStart(); }}
                onDragEnd={(e) => { e.cancelBubble = true; onDragEnd(); }}
                onMouseDown={(e) => { e.cancelBubble = true; }}
                onTouchStart={(e) => { e.cancelBubble = true; }}
                onClick={(e) => { e.cancelBubble = true; }}
            />
            <Circle
                x={endAbs.x}
                y={endAbs.y}
                radius={handleRadius}
                fill="#2563EB"
                stroke="#FFFFFF"
                strokeWidth={strokeWidth}
                name="gradient-control"
                draggable
                onDragMove={(e) => paint.gradientType === "linear"
                    ? updateLinearPoint("end", e.target)
                    : updateRadialPoint("edge", e.target)}
                onDragStart={(e) => { e.cancelBubble = true; onDragStart(); }}
                onDragEnd={(e) => { e.cancelBubble = true; onDragEnd(); }}
                onMouseDown={(e) => { e.cancelBubble = true; }}
                onTouchStart={(e) => { e.cancelBubble = true; }}
                onClick={(e) => { e.cancelBubble = true; }}
            />
            {paint.stops.map((stop) => {
                const position = projectPointToGuide({
                    x: guideStartAbs.x + (guideEndAbs.x - guideStartAbs.x) * stop.offset,
                    y: guideStartAbs.y + (guideEndAbs.y - guideStartAbs.y) * stop.offset,
                });
                return (
                    <Circle
                        key={stop.id}
                        x={position.x}
                        y={position.y}
                        radius={stopHandleRadius}
                        fill={stop.color}
                        opacity={Math.max(0.35, stop.opacity)}
                        stroke="#FFFFFF"
                        strokeWidth={strokeWidth}
                        name="gradient-control"
                        shadowColor="#0F172A"
                        shadowOpacity={0.18}
                        shadowBlur={4 / zoom}
                        listening={stop.offset > 0.02 && stop.offset < 0.98}
                        draggable={stop.offset > 0.02 && stop.offset < 0.98}
                        onDragMove={(e) => updateStopOffset(stop.id, e.target)}
                        onDragStart={(e) => { e.cancelBubble = true; onDragStart(); }}
                        onDragEnd={(e) => { e.cancelBubble = true; updateStopOffset(stop.id, e.target); onDragEnd(); }}
                        onMouseDown={(e) => { e.cancelBubble = true; }}
                        onTouchStart={(e) => { e.cancelBubble = true; }}
                        onClick={(e) => { e.cancelBubble = true; }}
                    />
                );
            })}
        </Group>
    );
}

const EXPAND_CONTROL_NAME = "expand-control";

function isExpandControlNode(target: Konva.Node): boolean {
    const stage = target.getStage();
    let ancestor: Konva.Node | null = target;
    while (ancestor && ancestor !== stage) {
        const name = ancestor.name();
        if (name?.split(" ").includes(EXPAND_CONTROL_NAME)) return true;
        ancestor = ancestor.getParent();
    }
    return false;
}

function resetStageContainerCursor(stage: Konva.Stage | null | undefined) {
    if (!stage) return;
    (stage.container() as HTMLElement).style.cursor = "default";
}

/* ─── Main Canvas component ───────────────────────── */

interface CanvasProps {
    stageRef: React.RefObject<Konva.Stage | null>;
    /**
     * Banner project id. Used by the drag-and-drop upload path to register
     * dropped files in the project's asset library (alongside placing them
     * on the canvas). Leave unset for template-editor mode.
     */
    projectId?: string;
}

export function Canvas({ stageRef, projectId }: CanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });
    const searchParams = useSearchParams();
    const isTemplateMode = searchParams.get("source") === "template";

    const artboardGroupRef = useRef<Konva.Group | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;
        const ro = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
                setContainerDimensions({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height,
                });
            }
        });
        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);

    const [stageDraggable, setStageDraggable] = useState(true);
    const [isDraggingFile, setIsDraggingFile] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; layerIds: string[] } | null>(null);

    // Marquee State
    const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number; startX: number; startY: number } | null>(null);

    // Snap Guides State
    const [snapLines, setSnapLines] = useState<SnapResult['guides']>([]);
    const [distanceMeasurements, setDistanceMeasurements] = useState<DistanceMeasurement[]>([]);
    const [spacingGuides, setSpacingGuides] = useState<SpacingGuide[]>([]);
    const isAltPressed = useRef(false);
    const [isAltHovering, setIsAltHovering] = useState(false);
    const isDragging = useRef(false);
    const [isDraggingLayers, setIsDraggingLayers] = useState(false);
    const isTransforming = useRef(false);
    const clipBlocked = useRef(false);  // set when a mouseDown is blocked by clip bounds
    const frameHoverCandidate = useRef<{ frameId: string | null; since: number }>({ frameId: null, since: 0 });

    // Track start positions for multi-drag
    const dragStartLocs = useRef<Record<string, { x: number; y: number }>>({});

    // Drawing mode refs
    const drawingStartPoint = useRef<{ x: number; y: number } | null>(null);

    // Pen tool draft (artboard-local coordinates)
    const [penPoints, setPenPoints] = useState<PenDraftAnchor[]>([]);
    const [penCursor, setPenCursor] = useState<{ x: number; y: number } | null>(null);
    const penDragging = useRef(false);

    const {
        layers,
        selectedLayerIds,
        selectLayer,
        toggleSelection,
        addToSelection,
        updateLayer,
        batchUpdateLayers,
        addImageLayer,
        addTextLayer,
        addRectangleLayer,
        addFrameLayer,
        addVectorLayer,
        addSliceLayer,
        removeLayer,
        duplicateLayer,
        bringToFront,
        sendToBack,
        toggleLayerVisibility,
        toggleLayerLock,
        zoom,
        setZoom,
        stageX,
        stageY,
        setStagePosition,
        canvasWidth,
        canvasHeight,
        activeResizeId,
        activeTool,
        setActiveTool,
        drawingBox,
        setDrawingBox,
        isEditingText,
        editingLayerId,
        activeGradientEditorTarget,
        startTextEditing,
        stopTextEditing,
        artboardProps,
        updateArtboardProps,
        setHighlightedFrameId,
        hoveredLayerId,
        setHoveredLayerId,
        getFrameAtPoint,
        moveLayerToFrame,
        removeLayerFromFrame,
        wrapInAutoLayoutFrame,
        vectorEditLayerId,
        setVectorEditLayerId,
        resizes,
        setActiveResize,
        viewMode,
        setViewMode,
        overviewZoom,
        overviewX,
        overviewY,
        setOverviewZoom,
        setOverviewPosition,
    } = useCanvasStore(useShallow((s) => ({
        layers: s.layers,
        selectedLayerIds: s.selectedLayerIds,
        selectLayer: s.selectLayer,
        toggleSelection: s.toggleSelection,
        addToSelection: s.addToSelection,
        updateLayer: s.updateLayer,
        batchUpdateLayers: s.batchUpdateLayers,
        addImageLayer: s.addImageLayer,
        addTextLayer: s.addTextLayer,
        addRectangleLayer: s.addRectangleLayer,
        addFrameLayer: s.addFrameLayer,
        addVectorLayer: s.addVectorLayer,
        addSliceLayer: s.addSliceLayer,
        removeLayer: s.removeLayer,
        duplicateLayer: s.duplicateLayer,
        bringToFront: s.bringToFront,
        sendToBack: s.sendToBack,
        toggleLayerVisibility: s.toggleLayerVisibility,
        toggleLayerLock: s.toggleLayerLock,
        zoom: s.zoom,
        setZoom: s.setZoom,
        stageX: s.stageX,
        stageY: s.stageY,
        setStagePosition: s.setStagePosition,
        canvasWidth: s.canvasWidth,
        canvasHeight: s.canvasHeight,
        activeResizeId: s.activeResizeId,
        activeTool: s.activeTool,
        setActiveTool: s.setActiveTool,
        drawingBox: s.drawingBox,
        setDrawingBox: s.setDrawingBox,
        isEditingText: s.isEditingText,
        editingLayerId: s.editingLayerId,
        activeGradientEditorTarget: s.activeGradientEditorTarget,
        startTextEditing: s.startTextEditing,
        stopTextEditing: s.stopTextEditing,
        artboardProps: s.artboardProps,
        updateArtboardProps: s.updateArtboardProps,
        setHighlightedFrameId: s.setHighlightedFrameId,
        hoveredLayerId: s.hoveredLayerId,
        setHoveredLayerId: s.setHoveredLayerId,
        getFrameAtPoint: s.getFrameAtPoint,
        moveLayerToFrame: s.moveLayerToFrame,
        removeLayerFromFrame: s.removeLayerFromFrame,
        wrapInAutoLayoutFrame: s.wrapInAutoLayoutFrame,
        vectorEditLayerId: s.vectorEditLayerId,
        setVectorEditLayerId: s.setVectorEditLayerId,
        resizes: s.resizes,
        setActiveResize: s.setActiveResize,
        viewMode: s.viewMode,
        setViewMode: s.setViewMode,
        overviewZoom: s.overviewZoom,
        overviewX: s.overviewX,
        overviewY: s.overviewY,
        setOverviewZoom: s.setOverviewZoom,
        setOverviewPosition: s.setOverviewPosition,
    })));

    const isOverview = viewMode === "overview";

    // Active tile is the world offset where the editable artboard renders.
    // In single view this collapses to {0,0} so all artboard-local math is
    // unchanged from the pre-overview pipeline.
    const overviewLayout = useMemo(
        () =>
            computeOverviewLayout(
                resizes.map((r) => ({ id: r.id, width: r.width, height: r.height })),
                {
                    gap: OVERVIEW_TILE_GAP,
                    rowWidth: OVERVIEW_ROW_WIDTH,
                    labelHeight: OVERVIEW_LABEL_HEIGHT,
                },
            ),
        [resizes],
    );
    const activeResizeIndex = resizes.findIndex((r) => r.id === activeResizeId);
    const activeOverviewTile = overviewLayout.tiles[activeResizeIndex] ?? { x: 0, y: 0 };

    // Hover ring target for sibling tiles in overview. Single-view never sets
    // this, so the chrome stays inert.
    const [hoveredOverviewId, setHoveredOverviewId] = useState<string | null>(null);
    const overviewDraggingRef = useRef(false);

    // Single-view studio is the degenerate tile {0,0}; overview supplies the
    // active artboard's world offset. The offset Group + the pointer/commit
    // bridge therefore reuse the existing editor handlers unchanged.
    const tileOffset = useMemo<{ x: number; y: number }>(
        () => (isOverview ? { x: activeOverviewTile.x, y: activeOverviewTile.y } : { x: 0, y: 0 }),
        [isOverview, activeOverviewTile.x, activeOverviewTile.y],
    );

    // Viewport for DOM overlays (InlineTextEditor, etc.) — picks the correct
    // stage transform without re-encoding the screen-space formula at each
    // call site. Identical to {zoom, stageX, stageY} when not in overview.
    const overlayViewport = useMemo(
        () =>
            isOverview
                ? { zoom: overviewZoom, x: overviewX, y: overviewY }
                : { zoom, x: stageX, y: stageY },
        [isOverview, overviewZoom, overviewX, overviewY, zoom, stageX, stageY],
    );

    // Expand mode state
    const expandMode = useCanvasStore((s) => s.expandMode);
    const expandTargetLayerId = useCanvasStore((s) => s.expandTargetLayerId);
    const exitCanvasEditModes = useCanvasStore((s) => s.exitCanvasEditModes);

    // Layout grids (safe zones) — overlay + snap targets for the active format
    const layoutGridsVisible = useCanvasStore((s) => s.layoutGridsVisible);
    const activeLayoutGrids = useCanvasStore(useShallow(selectActiveLayoutGrids));
    const gridSnapLines = useMemo(
        () => (layoutGridsVisible
            ? getLayoutGridSnapLines(activeLayoutGrids, { width: canvasWidth, height: canvasHeight })
            : { vertical: [], horizontal: [] }),
        [layoutGridsVisible, activeLayoutGrids, canvasWidth, canvasHeight],
    );

    // Inpaint mode state — the slice carries only the UI flag + target id,
    // brush strokes live in the InpaintProvider hook (see InpaintContext).
    // useOptionalSharedInpaintMask returns null when the editor was mounted
    // outside the provider (template mode), so the overlay simply won't render.
    const inpaintMode = useCanvasStore((s) => s.inpaintMode);
    const inpaintTargetLayerId = useCanvasStore((s) => s.inpaintTargetLayerId);
    const sharedInpaintMask = useOptionalSharedInpaintMask();

    const isDrawingTool = activeTool === "text" || activeTool === "rectangle" || activeTool === "frame" || activeTool === "pen" || activeTool === "slice";
    const artboardStrokeImage = useImage(artboardProps.strokeMode === "image" ? artboardProps.strokeImage?.src ?? "" : "");

    // Prevent stage pan from competing with expand handles or inpaint brush.
    useEffect(() => {
        if (expandMode || inpaintMode) {
            setStageDraggable(false);
        } else if (!isEditingText) {
            setStageDraggable(true);
        }
    }, [expandMode, inpaintMode, isEditingText]);

    // Expand handles set the stage container cursor on hover; reset when mode ends.
    useEffect(() => {
        if (!expandMode && !inpaintMode) {
            resetStageContainerCursor(stageRef.current);
        }
    }, [expandMode, inpaintMode, stageRef]);

    // Reset drawingStartPoint when leaving drawing mode (e.g. via Escape)
    useEffect(() => {
        if (!isDrawingTool) {
            drawingStartPoint.current = null;
        }
    }, [isDrawingTool]);

    useEffect(() => {
        if (activeTool !== "rectangle" && activeTool !== "frame" && activeTool !== "slice") {
            drawingStartPoint.current = null;
        }
    }, [activeTool]);

    // Clear the pen draft whenever the pen tool is deactivated.
    useEffect(() => {
        if (activeTool !== "pen") {
            penDragging.current = false;
            setPenPoints([]);
            setPenCursor(null);
        }
    }, [activeTool]);

    // Exit vector point-editing if the layer is deselected or tool changes.
    useEffect(() => {
        if (!vectorEditLayerId) return;
        const stillValid = activeTool === "select" && selectedLayerIds.includes(vectorEditLayerId);
        if (!stillValid) setVectorEditLayerId(null);
    }, [vectorEditLayerId, selectedLayerIds, activeTool, setVectorEditLayerId]);

    // Register stageRef in store (for Copy as PNG from keyboard shortcuts)
    const setStageRef = useCanvasStore((s) => s.setStageRef);
    useEffect(() => {
        setStageRef(stageRef);
    }, [stageRef, setStageRef]);

    const getPointerScenePosition = useCallback((stage: Konva.Stage) => {
        return getPointerArtboardPosition(stage, tileOffset);
    }, [tileOffset]);

    const resolveFrameHoverTarget = useCallback((stage: Konva.Stage, draggedLayerId: string) => {
        const pointerScene = getPointerScenePosition(stage);
        if (!pointerScene) return null;
        return getFrameAtPoint(pointerScene.x, pointerScene.y, draggedLayerId);
    }, [getFrameAtPoint, getPointerScenePosition]);

    const updateFrameHoverHighlight = useCallback((stage: Konva.Stage, draggedLayerId: string) => {
        const hoveredFrame = resolveFrameHoverTarget(stage, draggedLayerId);
        const draggedLayer = layers.find((l) => l.id === draggedLayerId);
        const droppableFrame =
            hoveredFrame && draggedLayer && canLayerFitInFrame(draggedLayer, hoveredFrame)
                ? hoveredFrame
                : null;
        const hoveredFrameId = droppableFrame?.id ?? null;
        const now = Date.now();

        if (hoveredFrameId !== frameHoverCandidate.current.frameId) {
            frameHoverCandidate.current = { frameId: hoveredFrameId, since: now };
            setHighlightedFrameId(null);
            return null;
        }

        if (!hoveredFrameId) {
            setHighlightedFrameId(null);
            return null;
        }

        if (now - frameHoverCandidate.current.since >= 220) {
            setHighlightedFrameId(hoveredFrameId);
            return droppableFrame;
        }

        setHighlightedFrameId(null);
        return null;
    }, [resolveFrameHoverTarget, setHighlightedFrameId, layers]);

    // Collect all IDs that are children of any frame (to exclude from top-level SelectionTransformer)
    const frameChildIds = useMemo(() => {
        const ids = new Set<string>();
        layers.forEach((l) => {
            if (l.type === "frame") {
                (l as FrameLayer).childIds.forEach((cid) => ids.add(cid));
            }
        });
        return ids;
    }, [layers]);

    // Auto-center artboard on first render when container dimensions are known
    const hasCentered = useRef(false);
    useEffect(() => {
        if (hasCentered.current) return;
        if (containerDimensions.width === 0 || containerDimensions.height === 0) return;

        const padding = 60; // px padding around the artboard
        const availW = containerDimensions.width - padding * 2;
        const availH = containerDimensions.height - padding * 2;

        // Fit artboard in viewport
        const fitZoom = Math.min(availW / canvasWidth, availH / canvasHeight, 1);

        // Center the artboard
        const centerX = (containerDimensions.width - canvasWidth * fitZoom) / 2;
        const centerY = (containerDimensions.height - canvasHeight * fitZoom) / 2;

        setZoom(fitZoom);
        setStagePosition(centerX, centerY);
        hasCentered.current = true;
    }, [containerDimensions, canvasWidth, canvasHeight, setZoom, setStagePosition]);

    // Overview auto-fit: fit on first entry and whenever the set of formats
    // changes; re-arm when leaving overview so a re-entry refits the new layout.
    const overviewAutoFittedRef = useRef(false);
    const overviewLastFitCountRef = useRef(0);
    useEffect(() => {
        if (!isOverview) {
            overviewAutoFittedRef.current = false;
            return;
        }
        // Never refit while the user is mid-pan: window resize or a
        // resizes.length change would otherwise snap the viewport out from
        // under their drag. Re-arm logic below stays intact — the next
        // qualifying trigger after the drag ends will refit cleanly.
        if (overviewDraggingRef.current) return;
        if (containerDimensions.width === 0 || containerDimensions.height === 0) return;
        if (resizes.length === 0) return;
        if (overviewLayout.totalWidth === 0 || overviewLayout.totalHeight === 0) return;
        const countChanged = overviewLastFitCountRef.current !== resizes.length;
        if (overviewAutoFittedRef.current && !countChanged) return;

        const availableW = Math.max(1, containerDimensions.width - OVERVIEW_AUTO_FIT_PADDING * 2);
        const availableH = Math.max(1, containerDimensions.height - OVERVIEW_AUTO_FIT_PADDING * 2);
        const fitScale = Math.min(
            availableW / overviewLayout.totalWidth,
            availableH / overviewLayout.totalHeight,
            1,
        );
        const clamped = Math.min(Math.max(fitScale, OVERVIEW_ZOOM_MIN), OVERVIEW_ZOOM_MAX);
        const cx = (containerDimensions.width - overviewLayout.totalWidth * clamped) / 2;
        const cy = (containerDimensions.height - overviewLayout.totalHeight * clamped) / 2;
        setOverviewZoom(clamped);
        setOverviewPosition(cx, cy);
        overviewAutoFittedRef.current = true;
        overviewLastFitCountRef.current = resizes.length;
    }, [
        isOverview,
        containerDimensions.width,
        containerDimensions.height,
        overviewLayout.totalWidth,
        overviewLayout.totalHeight,
        resizes.length,
        setOverviewPosition,
        setOverviewZoom,
    ]);

    /* ─── Layer Interactions ──────────────────────────── */

    /**
     * Check if a layer click should be ignored because it's outside
     * a clipped parent (frame or artboard) bounds.
     *
     * Uses the STORE data (not Konva DOM) to reliably determine
     * whether the pointer in canvas-space falls inside the clipping container.
     */
    const isClickOutsideClipBounds = useCallback((layerId: string, stage: Konva.Stage | null): boolean => {
        if (!stage) return false;
        // Resolve the live pointer in artboard-local coords via the tile-aware
        // bridge — matches the legacy `(p - stage.x())/stage.scaleX()` math at
        // tile {0,0}, and stays correct once the overview supplies a real tile.
        const artboardPoint = getPointerArtboardPosition(stage, tileOffset);
        if (!artboardPoint) return false;
        const canvasX = artboardPoint.x;
        const canvasY = artboardPoint.y;

        // 1. Check ARTBOARD clip
        if (artboardProps.clipContent) {
            if (canvasX < 0 || canvasX > canvasWidth || canvasY < 0 || canvasY > canvasHeight) {
                return true;
            }
        }

        // 2. Check if the layer is a child of a FRAME with clipContent
        const parentFrame = useCanvasStore.getState().layers.find(
            l => l.type === 'frame' && (l as FrameLayer).childIds.includes(layerId)
        ) as FrameLayer | undefined;

        if (parentFrame && parentFrame.clipContent) {
            if (
                canvasX < parentFrame.x ||
                canvasX > parentFrame.x + parentFrame.width ||
                canvasY < parentFrame.y ||
                canvasY > parentFrame.y + parentFrame.height
            ) {
                return true;
            }
        }

        return false;
    }, [artboardProps.clipContent, canvasWidth, canvasHeight, tileOffset]);

    const handleLayerSelect = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        // Ignore right clicks for selection to preserve multi-selection for context menus
        if (e.evt?.button === 2) {
            return;
        }

        const { activeTool } = useCanvasStore.getState();
        if (activeTool !== "select") {
            e.cancelBubble = true;
            return;
        }

        // If this click was already blocked by clip bounds in mouseDown, skip
        if (clipBlocked.current) {
            clipBlocked.current = false;
            return;
        }

        let id = resolveKonvaLayerId(e.target);
        if (!id) return;

        // Stop propagation so stage click doesn't deselect
        e.cancelBubble = true;

        const isMulti = e.evt?.shiftKey;
        const isDeepSelect = e.evt?.metaKey || e.evt?.ctrlKey || (e.evt as any)?._isDeepSelect;

        const layers = useCanvasStore.getState().layers;

        // "Deep select" logic: if it's nested in a frame, we select the frame
        // UNLESS the user holds Cmd/Ctrl (isDeepSelect)
        if (!isDeepSelect) {
            const parentFrame = layers.find(l => l.type === "frame" && (l as FrameLayer).childIds.includes(id));
            if (parentFrame) {
                id = parentFrame.id; // redirect selection to parent frame
            }
        }

        if (isMulti) {
            toggleSelection(id);
        } else {
            // If already selected, do nothing (dragging might start), 
            // UNLESS it's the only one, in which case we select just it (no-op).
            // But if we have multiple selected and click one WITHOUT shift,
            // we usually expect to select JUST that one...
            // UNLESS we are about to drag.
            // Standard behavior: MouseDown on selected -> keep selection. MouseUp -> select just that one (if no drag).
            // But here we are in onClick/onTap which corresponds to MouseUp without drag.
            // So if we click safely, yes, select just this one.
            selectLayer(id);
        }
    }, [toggleSelection, selectLayer, isClickOutsideClipBounds]);

    const handleLayerDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
        const { activeTool, expandMode: isExpand, inpaintMode: isInpaint } = useCanvasStore.getState();
        if (activeTool !== "select") {
            e.target.stopDrag();
            e.cancelBubble = true;
            return;
        }

        if (isExpand || isInpaint) {
            e.target.stopDrag();
            e.cancelBubble = true;
            return;
        }

        // Konva `dragstart` bubbles. The frame Group's onDragStart receives
        // bubbled events from any draggable descendant — including
        // Konva.Transformer anchor handles which have no id. Without this
        // guard, `resolveKonvaLayerId` would walk up to the frame Group and
        // we'd register the frame in `dragStartLocs`, making the frame ride
        // along with anchor `dragmove` events (visible as the parent frame
        // following the child during resize). Real layer drags always start
        // on a CanvasLayer Group whose id is set; if it's empty, this is a
        // bubbled event from a non-layer node and we must ignore it.
        if (!e.target.id()) {
            return;
        }

        setStageDraggable(false);
        isDragging.current = true;
        setIsDraggingLayers(true);
        setHoveredLayerId(null); // Clear hover during drag
        let id = resolveKonvaLayerId(e.target);
        const { layers, selectedLayerIds: currentSelectedLayerIds } = useCanvasStore.getState();

        // Block drag if the grab point is outside a clipped parent's bounds
        // EXCEPTION: allow if the layer is already selected (Figma-like behavior)
        if (!currentSelectedLayerIds.includes(id)) {
            const stage = e.target.getStage();
            if (isClickOutsideClipBounds(id, stage ?? null)) {
                e.target.stopDrag();
                selectLayer(null);
                return;
            }
        }

        const isDeepSelect = e.evt?.metaKey || e.evt?.ctrlKey;

        // "Deep select" drag logic: if it's nested in a frame, and not deep-selected,
        // and not already selected, redirect drag to the parent frame
        if (!isDeepSelect && !currentSelectedLayerIds.includes(id)) {
            const parentFrame = layers.find(l => l.type === "frame" && (l as FrameLayer).childIds.includes(id));
            if (parentFrame) {
                e.target.stopDrag();
                const frameNode = e.target.getStage()?.findOne("#" + parentFrame.id);
                if (frameNode) {
                    // Delegating drag to the frame
                    frameNode.startDrag(e.evt as any);
                    id = parentFrame.id;
                }
            }
        }

        // If dragging an item that is NOT selected, select it (exclusive)
        if (!currentSelectedLayerIds.includes(id)) {
            selectLayer(id);
        }

        // Snapshot positions of ALL selected layers (including the one being dragged if it is selected)
        // Note: selectedLayerIds from closure might be stale if we just called selectLayer?
        // Actually selectLayer triggers re-render, but this function closure 'selectedLayerIds' is from render start.
        // So if we just selected it, 'selectedLayerIds' here does NOT contain it yet.
        // We can solve this by checking if id is in selectedLayerIds.
        // If not, we form a temporary list [id].

        const effectiveSelection = currentSelectedLayerIds.includes(id)
            ? currentSelectedLayerIds
            : [id];

        // Figma-like: when the user grabs a layer that is nested in a frame,
        // the frame (and any further ancestor frames) must NOT be moved even
        // if it is also selected. Children render with coordinates local to
        // their parent frame, so dragging the frame would visually duplicate
        // the cursor delta on top of the child's own movement and pull the
        // frame along. We therefore drop ancestor frames of `id` from the
        // effective drag set. We do NOT drop other selected siblings — multi-
        // dragging two selected children of the same frame still works.
        const ancestorFrameIds = collectAncestorFrameIds(id, layers);
        const filteredSelection = effectiveSelection.filter(sid => !ancestorFrameIds.has(sid));

        const locs: Record<string, { x: number; y: number }> = {};
        filteredSelection.forEach(sid => {
            const l = layers.find(lay => lay.id === sid);
            if (l) locs[sid] = { x: l.x, y: l.y };
        });
        dragStartLocs.current = locs;

    }, [selectLayer, isClickOutsideClipBounds, setHoveredLayerId]);

    // Alt key tracking for distance measurement (both drag and hover)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Alt') {
                e.preventDefault();
                isAltPressed.current = true;
                setIsAltHovering(true);

                // If a layer is selected and we're not dragging/transforming,
                // show distances from selected layer to all nearby objects + artboard
                if (!isDragging.current && !isTransforming.current && selectedLayerIds.length > 0) {
                    const selectedLayer = layers.find(l => l.id === selectedLayerIds[0]);
                    if (selectedLayer) {
                        const selectedBounds: NodeBounds = {
                            id: selectedLayer.id, x: selectedLayer.x, y: selectedLayer.y,
                            width: selectedLayer.width, height: selectedLayer.height, rotation: selectedLayer.rotation,
                        };
                        // Measure to artboard edges by default on Alt press
                        const artboardBounds: NodeBounds = {
                            id: '__artboard__', x: 0, y: 0,
                            width: canvasWidth, height: canvasHeight, rotation: 0,
                        };
                        const dists = computeHoverDistances(selectedBounds, artboardBounds);
                        setDistanceMeasurements(dists);
                    }
                }
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Alt') {
                isAltPressed.current = false;
                setIsAltHovering(false);
                // Clear hover measurements (but not if dragging — drag handler manages its own)
                if (!isDragging.current && !isTransforming.current) {
                    setDistanceMeasurements([]);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [selectedLayerIds, layers, canvasWidth, canvasHeight]);

    const handleLayerDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
        const id = resolveKonvaLayerId(e.target);
        const startLoc = dragStartLocs.current[id];
        if (!startLoc) return;

        const stage = e.target.getStage();
        if (!stage) return;

        const { snapConfig, layers, selectedLayerIds: currentSelectedLayerIds } = useCanvasStore.getState();
        const dragIds = Object.keys(dragStartLocs.current);
        const isMultiDrag = dragIds.length >= 2;

        const absPos = e.target.getAbsolutePosition();
        const worldX = (absPos.x - stage.x()) / stage.scaleX();
        const worldY = (absPos.y - stage.y()) / stage.scaleY();
        const artboardPos = worldToArtboard({ x: worldX, y: worldY }, tileOffset);
        const currentSceneX = artboardPos.x;
        const currentSceneY = artboardPos.y;

        let dx = currentSceneX - startLoc.x;
        let dy = currentSceneY - startLoc.y;

        const otherNodes = layers
            .filter((l) => !dragIds.includes(l.id) && l.visible && !l.locked)
            .map((l) => ({
                id: l.id,
                x: l.x,
                y: l.y,
                width: l.width,
                height: l.height,
                rotation: l.rotation,
            }));

        if (isMultiDrag) {
            const startUnion = computeUnionBBoxFromDrag(layers, dragStartLocs.current, 0, 0);
            const proposedUnion = computeUnionBBoxFromDrag(layers, dragStartLocs.current, dx, dy);
            if (startUnion && proposedUnion) {
                const snapResult = computeSnap(
                    {
                        id: MULTI_TRANSFORM_PROXY_ID,
                        x: proposedUnion.x,
                        y: proposedUnion.y,
                        width: proposedUnion.width,
                        height: proposedUnion.height,
                        rotation: 0,
                    },
                    otherNodes,
                    snapConfig,
                    { width: canvasWidth, height: canvasHeight },
                    isAltPressed.current,
                    undefined,
                    gridSnapLines,
                );
                setSnapLines(snapResult.guides);
                setDistanceMeasurements(snapResult.distances);
                setSpacingGuides(snapResult.spacingGuides);
                if (snapResult.x !== null) dx = snapResult.x - startUnion.x;
                if (snapResult.y !== null) dy = snapResult.y - startUnion.y;
            }
        } else {
            const primaryLayer = layers.find((l) => l.id === id);
            if (primaryLayer) {
                const snapResult = computeSnap(
                    {
                        id: primaryLayer.id,
                        x: startLoc.x + dx,
                        y: startLoc.y + dy,
                        width: primaryLayer.width,
                        height: primaryLayer.height,
                        rotation: primaryLayer.rotation,
                    },
                    otherNodes,
                    snapConfig,
                    { width: canvasWidth, height: canvasHeight },
                    isAltPressed.current,
                    undefined,
                    gridSnapLines,
                );
                setSnapLines(snapResult.guides);
                setDistanceMeasurements(snapResult.distances);
                setSpacingGuides(snapResult.spacingGuides);
                if (snapResult.x !== null) dx = snapResult.x - startLoc.x;
                if (snapResult.y !== null) dy = snapResult.y - startLoc.y;
            } else {
                setSnapLines([]);
                setDistanceMeasurements([]);
                setSpacingGuides([]);
            }
        }

        dragIds.forEach((sid) => {
            const node = stage.findOne(`#${sid}`);
            if (!node) return;
            const sLoc = dragStartLocs.current[sid];
            const targetSceneX = sLoc.x + dx;
            const targetSceneY = sLoc.y + dy;
            const targetWorld = artboardToWorld({ x: targetSceneX, y: targetSceneY }, tileOffset);
            node.setAbsolutePosition({
                x: targetWorld.x * stage.scaleX() + stage.x(),
                y: targetWorld.y * stage.scaleY() + stage.y(),
            });
        });

        if (isMultiDrag) {
            const proxy = stage.findOne(`#${MULTI_TRANSFORM_PROXY_ID}`) as Konva.Rect | undefined;
            const bbox = computeUnionBBoxFromDrag(layers, dragStartLocs.current, dx, dy);
            if (proxy && bbox) {
                applyBBoxToProxy(proxy, bbox);
            }
            frameHoverCandidate.current = { frameId: null, since: 0 };
            setHighlightedFrameId(null);
        } else if (dragIds.length === 1) {
            updateFrameHoverHighlight(stage, id);
        }
    }, [setHighlightedFrameId, canvasWidth, canvasHeight, updateFrameHoverHighlight, gridSnapLines, tileOffset]);

    const handleLayerDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
        const id = resolveKonvaLayerId(e.target);
        const startLoc = dragStartLocs.current[id];
        const stage = e.target.getStage();

        // Konva `dragend` bubbles up the parent chain. When a child layer is
        // dragged inside a frame, the frame Group's onDragEnd ALSO receives
        // bubbled `dragend` events from its own descendants — including
        // Konva.Transformer anchor handles, which have no id. Without this
        // guard, `resolveKonvaLayerId` would walk up to the frame Group and
        // we'd `updateLayer(frame.id, { x, y })` with the rogue node's
        // absolute position, dragging the frame along visually. We never
        // started a drag for that id (no startLoc), so the only safe action
        // is to ignore the bubbled tail event entirely — the primary
        // dragend already cleaned up state for the layer that really moved.
        if (!startLoc || !stage) {
            return;
        }

        setSnapLines([]);
        setDistanceMeasurements([]);
        setSpacingGuides([]);
        setStageDraggable(true);
        isDragging.current = false;
        setIsDraggingLayers(false);

        const absPos = e.target.getAbsolutePosition();
        const worldX = (absPos.x - stage.x()) / stage.scaleX();
        const worldY = (absPos.y - stage.y()) / stage.scaleY();
        const artboardPos = worldToArtboard({ x: worldX, y: worldY }, tileOffset);
        const currentSceneX = artboardPos.x;
        const currentSceneY = artboardPos.y;

        const dx = currentSceneX - startLoc.x;
        const dy = currentSceneY - startLoc.y;
        const layers = useCanvasStore.getState().layers;

        const dragUpdates = Object.keys(dragStartLocs.current).map((sid) => {
            const sLoc = dragStartLocs.current[sid];
            if (sid === id) {
                return { id: sid, changes: { x: currentSceneX, y: currentSceneY } };
            }
            return { id: sid, changes: { x: sLoc.x + dx, y: sLoc.y + dy } };
        });
        if (dragUpdates.length > 1) {
            batchUpdateLayers(dragUpdates);
        } else if (dragUpdates.length === 1) {
            updateLayer(dragUpdates[0].id, dragUpdates[0].changes);
        }

        const draggedLayerType = layers.find((l) => l.id === id)?.type;
        // Slices are export regions — never parent them into frames on drop.
        if (Object.keys(dragStartLocs.current).length === 1 && draggedLayerType !== "slice") {
            const sceneWidth = e.target.width() * e.target.scaleX();
            const sceneHeight = e.target.height() * e.target.scaleY();
            const centerX = currentSceneX + sceneWidth / 2;
            const centerY = currentSceneY + sceneHeight / 2;
            const frame = updateFrameHoverHighlight(stage, id);
            if (frame) {
                if (frame.layoutMode && frame.layoutMode !== "none") {
                    const siblings = frame.childIds.filter(cId => cId !== id).map(cId => layers.find(l => l.id === cId)).filter(Boolean) as LayerType[];
                    let dropIndex = siblings.length;
                    for (let i = 0; i < siblings.length; i++) {
                        const sib = siblings[i];
                        if (frame.layoutMode === "horizontal") {
                            if (centerX < sib.x + sib.width / 2) {
                                dropIndex = i;
                                break;
                            }
                        } else {
                            if (centerY < sib.y + sib.height / 2) {
                                dropIndex = i;
                                break;
                            }
                        }
                    }
                    moveLayerToFrame(id, frame.id, dropIndex);
                } else {
                    moveLayerToFrame(id, frame.id);
                }
            } else {
                // Dropped completely outside of any frame
                removeLayerFromFrame(id);
            }
            frameHoverCandidate.current = { frameId: null, since: 0 };
            setHighlightedFrameId(null);
        }

        dragStartLocs.current = {};
    }, [updateLayer, batchUpdateLayers, moveLayerToFrame, removeLayerFromFrame, setHighlightedFrameId, updateFrameHoverHighlight, tileOffset]);

    const handleTransformEnd = useCallback((e: Konva.KonvaEventObject<Event>) => {
        isTransforming.current = false;
        setSnapLines([]);
        setDistanceMeasurements([]);
        setSpacingGuides([]);

        const node = e.target;
        const id = node.id();
        const layers = useCanvasStore.getState().layers;

        // Block transform commit for locked layers
        const lockedLayer = layers.find(l => l.id === id);
        if (lockedLayer?.locked) {
            // Reset Konva node to store values
            node.x(lockedLayer.x);
            node.y(lockedLayer.y);
            node.width(lockedLayer.width);
            node.height(lockedLayer.height);
            node.scaleX(1);
            node.scaleY(1);
            node.rotation(lockedLayer.rotation);
            return;
        }

        const stage = node.getStage();

        let scaleX = node.scaleX();
        let scaleY = node.scaleY();
        const rotation = node.rotation();

        const layer = layers.find(l => l.id === id);
        if (layer) {
            enforceLockedAspectOnNode(node, layer);
            scaleX = node.scaleX();
            scaleY = node.scaleY();
        }

        // Reset scale and apply to width/height to avoid compounding scale
        node.scaleX(1);
        node.scaleY(1);

        const textBase = layer?.type === "text"
            ? getTextTransformBaseSize(node, layer as TextLayer)
            : null;
        const baseWidth = textBase?.width ?? node.width();
        const baseHeight = textBase?.height ?? node.height();
        const sized = layer
            ? lockedAspectDimensions(layer, scaleX, scaleY, baseWidth, baseHeight)
            : { width: baseWidth * scaleX, height: baseHeight * scaleY, scaleX, scaleY };
        let width = sized.width;
        let height = sized.height;

        let extraProps: any = {};
        if (layer) {
            if (layer.type === "text") {
                const synced = syncTextTransformNodes(node, layer as TextLayer, width, height);
                width = synced.width;
                height = synced.height;
            }

            // NOTE: For text nodes, handleTransform already resets scale to 1
            // during the live transform. Compare dimensions instead of scale.
            const hasSizedX = Math.abs(width - layer.width) > 0.5;
            const hasSizedY = Math.abs(height - layer.height) > 0.5;

            // Non-text: a manual drag-resize pins the dragged axis to fixed.
            // Text routes through normalizeTextLayer (updateLayer) instead — the
            // width/height in the update make it derive textAdjust=fixed — so we
            // must NOT add a second, competing sync here.
            if ((hasSizedX || hasSizedY) && layer.type !== "text") {
                if (hasSizedX && (layer.layoutSizingWidth === "fill" || layer.layoutSizingWidth === "hug")) extraProps.layoutSizingWidth = "fixed";
                if (hasSizedY && (layer.layoutSizingHeight === "fill" || layer.layoutSizingHeight === "hug")) extraProps.layoutSizingHeight = "fixed";
            }
        }

        // Convert to absolute scene coordinates (handles frame-nested children)
        // node.x()/y() returns coords relative to parent Group, which is wrong
        // for children inside frames. Use getAbsolutePosition() instead,
        // matching the pattern in handleLayerDragEnd.
        let newX: number, newY: number;
        if (stage) {
            const absPos = node.getAbsolutePosition();
            const worldX = (absPos.x - stage.x()) / stage.scaleX();
            const worldY = (absPos.y - stage.y()) / stage.scaleY();
            const artboardPos = worldToArtboard({ x: worldX, y: worldY }, tileOffset);
            newX = artboardPos.x;
            newY = artboardPos.y;
        } else {
            newX = node.x();
            newY = node.y();
        }

        updateLayer(id, { x: newX, y: newY, width, height, rotation, ...extraProps });

    }, [updateLayer, tileOffset]);

    // ─── Live Resize Snapping ────────────────────────────
    const handleTransform = useCallback((e: Konva.KonvaEventObject<Event>) => {
        isTransforming.current = true;
        const node = e.target;
        const id = node.id();
        const stage = node.getStage();
        if (!stage) return;

        const layers = useCanvasStore.getState().layers;

        // Block live transform for locked layers
        const lockedCheck = layers.find(l => l.id === id);
        if (lockedCheck?.locked) return;

        // For TEXT nodes: reset scale immediately and apply width/height.
        // This prevents the visual "stretching" effect — text re-wraps in real-time.
        const { snapConfig, selectedLayerIds: currentSelection } = useCanvasStore.getState();

        const layer = layers.find(l => l.id === id);
        if (layer?.type === "text") {
            normalizeLiveTextTransform(node, layer as TextLayer);
        } else if (layer && currentSelection.length === 1) {
            enforceLockedAspectOnNode(node, layer);
        }

        // Multi-select uses a group proxy transformer — per-node resize snap causes chaos.
        if (currentSelection.length > 1) return;
        if (!snapConfig.objectSnap && !snapConfig.artboardSnap) return;

        const textBase = layer?.type === "text"
            ? getTextTransformBaseSize(node, layer as TextLayer)
            : null;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        const currentWidth = (textBase?.width ?? node.width()) * scaleX;
        const currentHeight = (textBase?.height ?? node.height()) * scaleY;

        // Get scene position
        const absPos = node.getAbsolutePosition();
        const worldX = (absPos.x - stage.x()) / stage.scaleX();
        const worldY = (absPos.y - stage.y()) / stage.scaleY();
        const artboardPos = worldToArtboard({ x: worldX, y: worldY }, tileOffset);
        const currentX = artboardPos.x;
        const currentY = artboardPos.y;

        // Determine which edges are active based on the transformer's active anchor
        // We need to get the transformer reference
        const transformer = stage.findOne('Transformer') as Konva.Transformer | null;
        const anchorName = transformer?.getActiveAnchor?.() || '';

        const activeEdges: ActiveEdge[] = [];
        if (anchorName.includes('top')) activeEdges.push('top');
        if (anchorName.includes('bottom')) activeEdges.push('bottom');
        if (anchorName.includes('left')) activeEdges.push('left');
        if (anchorName.includes('right')) activeEdges.push('right');
        // Middle handles
        if (anchorName === 'middle-left') { activeEdges.length = 0; activeEdges.push('left'); }
        if (anchorName === 'middle-right') { activeEdges.length = 0; activeEdges.push('right'); }
        if (anchorName === 'top-center') { activeEdges.length = 0; activeEdges.push('top'); }
        if (anchorName === 'bottom-center') { activeEdges.length = 0; activeEdges.push('bottom'); }

        if (activeEdges.length === 0) return;

        const otherNodes = layers
            .filter(l => l.id !== id && l.visible && !l.locked)
            .map(l => ({
                id: l.id, x: l.x, y: l.y,
                width: l.width, height: l.height, rotation: l.rotation,
            }));

        const snapResult = computeResizeSnap(
            { id, x: currentX, y: currentY, width: currentWidth, height: currentHeight, rotation: node.rotation() },
            otherNodes,
            activeEdges,
            { width: canvasWidth, height: canvasHeight },
            undefined,
            gridSnapLines,
        );

        setSnapLines(snapResult.guides);

        // Apply snapped dimensions back to the Konva node
        if (snapResult.guides.length > 0) {
            if (layer?.type === "text") {
                node.scaleX(1);
                node.scaleY(1);
                syncTextTransformNodes(node, layer as TextLayer, snapResult.width, snapResult.height, { fixedPreview: true });
            } else {
                const newScaleX = snapResult.width / node.width();
                const newScaleY = snapResult.height / node.height();
                node.scaleX(newScaleX);
                node.scaleY(newScaleY);
            }

            // Update position if left or top edges were snapped
            if (activeEdges.includes('left') || activeEdges.includes('top')) {
                const snappedWorld = artboardToWorld({ x: snapResult.x, y: snapResult.y }, tileOffset);
                const newAbsX = snappedWorld.x * stage.scaleX() + stage.x();
                const newAbsY = snappedWorld.y * stage.scaleY() + stage.y();
                node.setAbsolutePosition({ x: newAbsX, y: newAbsY });
            }
        }
    }, [canvasWidth, canvasHeight, gridSnapLines, tileOffset]);

    const { isPanning, setIsPanning, handleWheel: handleSingleWheel } = usePanZoom({
        stageRef,
        containerRef,
        zoom,
        stageX,
        stageY,
        setZoom,
        setStagePosition,
        isEditingText,
        setStageDraggable,
    });

    // Overview wheel: zoom-to-cursor on Ctrl/Cmd, otherwise pan.
    const handleOverviewWheel = useCallback(
        (e: Konva.KonvaEventObject<WheelEvent>) => {
            e.evt.preventDefault();
            const stage = stageRef.current;
            if (!stage) return;

            if (e.evt.ctrlKey || e.evt.metaKey) {
                const pointer = stage.getPointerPosition();
                if (!pointer) return;
                const oldScale = overviewZoom;
                const newScale =
                    e.evt.deltaY < 0 ? oldScale * OVERVIEW_ZOOM_STEP : oldScale / OVERVIEW_ZOOM_STEP;
                const clamped = Math.min(Math.max(newScale, OVERVIEW_ZOOM_MIN), OVERVIEW_ZOOM_MAX);
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
        [overviewX, overviewY, overviewZoom, setOverviewPosition, setOverviewZoom, stageRef],
    );

    const handleWheel = isOverview ? handleOverviewWheel : handleSingleWheel;

    /* ─── Stage Interaction ───────────────────────────── */

    const cancelPenPath = useCallback(() => {
        penDragging.current = false;
        setPenPoints([]);
        setPenCursor(null);
    }, []);

    const finalizePenPath = useCallback((closed: boolean) => {
        penDragging.current = false;
        const points = penPoints;
        setPenPoints([]);
        setPenCursor(null);
        if (points.length < 2) return;

        const abs = [{ points: points.map((p) => ({ ...p })), closed }];
        const bounds = computeAbsBounds(abs);
        const { subpaths, width, height } = normalizeAbsSubpaths(abs);
        addVectorLayer({
            name: "Path",
            x: bounds.minX,
            y: bounds.minY,
            width: Math.max(1, Math.round(width)),
            height: Math.max(1, Math.round(height)),
            subpaths,
            // Pen-drawn paths default to a visible outline; fill can be toggled on.
            fillEnabled: closed,
            fill: "#111827",
            stroke: PEN_STROKE,
            strokeEnabled: !closed,
            strokeWidth: !closed ? 2 : 0,
        });
        setActiveTool("select");
    }, [penPoints, addVectorLayer, setActiveTool]);

    // Pen keyboard: Enter/double = finish open path, Escape = cancel.
    useEffect(() => {
        if (activeTool !== "pen") return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Enter") {
                e.preventDefault();
                finalizePenPath(false);
            } else if (e.key === "Escape") {
                e.preventDefault();
                cancelPenPath();
                setActiveTool("select");
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [activeTool, finalizePenPath, cancelPenPath, setActiveTool]);

    const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        // If panning, let Konva handle drag (stage is draggable)
        if (isPanning) {
            if (containerRef.current) containerRef.current.style.cursor = "grabbing";
            return;
        }

        const isGradientOverlayNode = (() => {
            const stage = e.target.getStage();
            let ancestor: Konva.Node | null = e.target;
            while (ancestor && ancestor !== stage) {
                if (ancestor.name()?.split(" ").includes("gradient-control")) return true;
                ancestor = ancestor.getParent();
            }
            return false;
        })();
        if (isGradientOverlayNode) {
            e.cancelBubble = true;
            return;
        }

        const isNearActiveGradientGuide = (() => {
            // Gradient editing is out of Phase 2 overview scope: the guide
            // proximity test and the handle overlay below both use store
            // `zoom` and assume single-view artboard math.
            if (isOverview) return false;
            if (!activeGradientEditorTarget || activeGradientEditorTarget === "artboard") return false;
            if (!selectedLayerIds.includes(activeGradientEditorTarget)) return false;
            const stage = e.target.getStage();
            if (!stage) return false;
            const scenePoint = getPointerArtboardPosition(stage, tileOffset);
            if (!scenePoint) return false;
            const layer = layers.find((l) => l.id === activeGradientEditorTarget);
            if (!layer || !(layer.type === "rectangle" || layer.type === "badge" || layer.type === "frame" || layer.type === "image")) return false;
            const paint = normalizePaint(layer.type === "image" ? layer.fill ?? "#FFFFFF" : layer.fill);
            if (paint.kind !== "gradient") return false;
            const center = paint.center ?? { x: 0.5, y: 0.5 };
            const radius = paint.radius ?? 0.7;
            const start = paint.gradientType === "linear"
                ? paint.start ?? { x: 0, y: 0.5 }
                : center;
            const startAbs = {
                x: layer.x + start.x * layer.width,
                y: layer.y + start.y * layer.height,
            };
            const endAbs = paint.gradientType === "linear"
                ? {
                    x: layer.x + (paint.end?.x ?? 1) * layer.width,
                    y: layer.y + (paint.end?.y ?? 0.5) * layer.height,
                }
                : {
                    x: layer.x + center.x * layer.width + Math.cos((paint.angle * Math.PI) / 180) * Math.max(layer.width, layer.height) * radius,
                    y: layer.y + center.y * layer.height + Math.sin((paint.angle * Math.PI) / 180) * Math.max(layer.width, layer.height) * radius,
                };
            const vx = endAbs.x - startAbs.x;
            const vy = endAbs.y - startAbs.y;
            const lengthSquared = Math.max(1, vx * vx + vy * vy);
            const offset = Math.min(1, Math.max(0, ((scenePoint.x - startAbs.x) * vx + (scenePoint.y - startAbs.y) * vy) / lengthSquared));
            const projected = { x: startAbs.x + vx * offset, y: startAbs.y + vy * offset };
            const distance = Math.hypot(scenePoint.x - projected.x, scenePoint.y - projected.y);
            return distance <= Math.max(10 / zoom, 4);
        })();
        if (isNearActiveGradientGuide) {
            e.cancelBubble = true;
            return;
        }

        if (isExpandControlNode(e.target)) {
            e.cancelBubble = true;
            return;
        }

        // ── Pen tool interception ──
        // Overview is a select-only surface (Phase 2 scope): swallow creation
        // tools so the stage falls through to pan/drag instead of starting a
        // pen path on whichever tile happens to sit under the cursor.
        if (activeTool === "pen") {
            if (isOverview) return;
            const stage = e.target.getStage();
            if (!stage) return;
            const scene = getPointerArtboardPosition(stage, tileOffset);
            if (!scene) return;
            const sceneX = scene.x;
            const sceneY = scene.y;

            e.cancelBubble = true;
            setContextMenu(null);
            if (isEditingText) stopTextEditing();

            // Close path if clicking near the first anchor.
            if (penPoints.length >= 2) {
                const first = penPoints[0];
                const closeDist = Math.hypot(sceneX - first.x, sceneY - first.y);
                if (closeDist <= Math.max(8 / zoom, 4)) {
                    finalizePenPath(true);
                    return;
                }
            }

            setPenPoints((prev) => [...prev, { x: sceneX, y: sceneY }]);
            penDragging.current = true;
            return;
        }

        // ── Drawing tool interception ──
        if (activeTool === "text" || activeTool === "rectangle" || activeTool === "frame" || activeTool === "slice") {
            if (isOverview) return;
            const stage = e.target.getStage();
            if (!stage) return;
            const scene = getPointerArtboardPosition(stage, tileOffset);
            if (!scene) return;
            const sceneX = scene.x;
            const sceneY = scene.y;

            if (activeTool === "text") {
                addTextLayer({ x: sceneX, y: sceneY });
                const newTextId = useCanvasStore.getState().selectedLayerIds[0];
                if (newTextId) {
                    setTimeout(() => startTextEditing(newTextId), 50);
                }
                return;
            }

            // rectangle or frame: start drag-drawing
            drawingStartPoint.current = { x: sceneX, y: sceneY };
            setDrawingBox({ startX: sceneX, startY: sceneY, currentX: sceneX, currentY: sceneY });
            setStageDraggable(false);
            selectLayer(null);
            setContextMenu(null);
            if (isEditingText) stopTextEditing();
            return;
        }

        // ── Clip-bounds interception ──
        // If the click targets a shape (not the stage background), check whether
        // the pointer falls outside the clip bounds of any clipped parent.
        // This MUST happen here because Konva fires shape-level onClick/onDragStart
        // AFTER mousedown, and we can't reliably block them.
        //
        // EXCEPTION (Figma-like): If the target is already selected, allow interaction
        // even outside clip bounds — this lets users drag/transform objects whose
        // handles or body extend beyond the parent's clip area.
        const target = e.target;
        const stage = target.getStage();
        if (stage && target !== stage) {
            const scenePoint = getPointerArtboardPosition(stage, tileOffset);
            if (scenePoint) {
                const canvasX = scenePoint.x;
                const canvasY = scenePoint.y;
                const targetId = resolveKonvaLayerId(target);

                // Skip clip-bounds check if:
                // 1. The target layer is already selected (drag from outside clip)
                // 2. The target is part of a Transformer (resize handles outside clip)
                const isAlreadySelected = targetId && selectedLayerIds.includes(targetId);

                // Walk up the parent chain to detect Transformer anchors
                let isTransformerHandle = false;
                let ancestor: Konva.Node | null = target;
                while (ancestor && ancestor !== stage) {
                    if (ancestor.getClassName() === 'Transformer') {
                        isTransformerHandle = true;
                        break;
                    }
                    ancestor = ancestor.getParent();
                }

                if (!isAlreadySelected && !isTransformerHandle) {
                    let shouldBlock = false;

                    // Check ARTBOARD clip
                    if (artboardProps.clipContent) {
                        if (canvasX < 0 || canvasX > canvasWidth || canvasY < 0 || canvasY > canvasHeight) {
                            shouldBlock = true;
                        }
                    }

                    // Check FRAME clip (if target is a frame child)
                    if (!shouldBlock && targetId) {
                        const parentFrame = layers.find(
                            l => l.type === 'frame' && (l as FrameLayer).childIds.includes(targetId)
                        ) as FrameLayer | undefined;
                        if (parentFrame && parentFrame.clipContent) {
                            if (
                                canvasX < parentFrame.x ||
                                canvasX > parentFrame.x + parentFrame.width ||
                                canvasY < parentFrame.y ||
                                canvasY > parentFrame.y + parentFrame.height
                            ) {
                                shouldBlock = true;
                            }
                        }
                    }

                    if (shouldBlock && !expandMode && !inpaintMode) {
                        // Prevent the shape from receiving any further events
                        // by stopping the event and deselecting
                        target.stopDrag();
                        e.cancelBubble = true;
                        clipBlocked.current = true;  // flag so onClick handler skips
                        selectLayer(null);
                        return;
                    }
                }
            }
        }

        // If clicked on stage (background)
        if (e.target === e.target.getStage()) {
            // Right-click on background: don't clear selection or start marquee
            // (the contextmenu handler will decide what to show)
            if (e.evt.button === 2) return;

            if (!stage) return;
            const start = getPointerArtboardPosition(stage, tileOffset);
            if (!start) return;

            // Convert to Scene Coordinates for starting point
            const startSceneX = start.x;
            const startSceneY = start.y;

            // Exit exclusive edit modes on empty-canvas click with full UI reset.
            if (expandMode || inpaintMode) {
                exitCanvasEditModes();
                sharedInpaintMask?.clear();
                resetStageContainerCursor(stage);
                if (!e.evt.shiftKey && !e.evt.metaKey && !e.evt.ctrlKey) {
                    selectLayer(null);
                }
                setContextMenu(null);
                if (isEditingText) stopTextEditing();
                return;
            }

            // Figma-like: if clicking on the overflow area of a SELECTED layer
            // (outside clip bounds but inside the layer's bounding box),
            // keep the selection and initiate a drag instead of deselecting.
            // This happens because Konva's clip Group blocks hit detection on
            // overflow portions, making clicks there register as stage clicks.
            if (selectedLayerIds.length > 0) {
                for (const selId of selectedLayerIds) {
                    const selLayer = layers.find(l => l.id === selId);
                    if (selLayer) {
                        // Use the layer's absolute position and dimensions
                        const lx = selLayer.x;
                        const ly = selLayer.y;
                        const lw = selLayer.width;
                        const lh = selLayer.height;
                        if (
                            startSceneX >= lx && startSceneX <= lx + lw &&
                            startSceneY >= ly && startSceneY <= ly + lh
                        ) {
                            // Pointer is inside this selected layer's bounding box
                            // Find the Konva node and start drag
                            const node = stage.findOne("#" + selId);
                            if (node) {
                                node.startDrag(e.evt);
                                isDragging.current = true;
                                setIsDraggingLayers(true);
                                setStageDraggable(false);

                                // Snapshot drag start positions
                                const locs: Record<string, { x: number; y: number }> = {};
                                selectedLayerIds.forEach(sid => {
                                    const l = layers.find(lay => lay.id === sid);
                                    if (l) locs[sid] = { x: l.x, y: l.y };
                                });
                                dragStartLocs.current = locs;
                                return; // Don't deselect
                            }
                        }
                    }
                }
            }

            // Overview: deselect + close menus, but let the draggable stage
            // own the pan gesture. Skipping the marquee here is what makes
            // dragging empty mat pan-instead-of-marquee in overview.
            if (isOverview) {
                if (!e.evt.shiftKey && !e.evt.metaKey && !e.evt.ctrlKey) {
                    selectLayer(null);
                }
                setContextMenu(null);
                if (isEditingText) stopTextEditing();
                return;
            }

            setSelectionBox({
                x: startSceneX,
                y: startSceneY,
                width: 0,
                height: 0,
                startX: startSceneX,
                startY: startSceneY,
            });

            // Disable dragging if we are selecting
            setStageDraggable(false);

            // Clear selection if not Shift
            if (!e.evt.shiftKey && !e.evt.metaKey && !e.evt.ctrlKey) {
                selectLayer(null);
            }

            setContextMenu(null);
            if (isEditingText) {
                stopTextEditing();
            }
        }
    }, [selectLayer, isEditingText, stopTextEditing, isPanning, activeGradientEditorTarget, selectedLayerIds, layers, zoom, artboardProps.clipContent, canvasWidth, canvasHeight, activeTool, addTextLayer, setActiveTool, setDrawingBox, startTextEditing, expandMode, inpaintMode, exitCanvasEditModes, sharedInpaintMask, penPoints, finalizePenPath, tileOffset, isOverview]);

    const handleStageMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        const stage = e.target.getStage();
        if (!stage) return;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        const scenePoint = getPointerArtboardPosition(stage, tileOffset);
        if (!scenePoint) return;

        const currentSceneX = scenePoint.x;
        const currentSceneY = scenePoint.y;

        // Pen tool: drag to add bezier handles, hover for rubber-band preview
        if (activeTool === "pen") {
            if (isOverview) return;
            if (penDragging.current && penPoints.length > 0) {
                setPenPoints((prev) => {
                    if (prev.length === 0) return prev;
                    const next = [...prev];
                    const last = { ...next[next.length - 1] };
                    last.outX = currentSceneX;
                    last.outY = currentSceneY;
                    // Mirror handle for a smooth point.
                    last.inX = last.x - (currentSceneX - last.x);
                    last.inY = last.y - (currentSceneY - last.y);
                    next[next.length - 1] = last;
                    return next;
                });
            } else {
                setPenCursor({ x: currentSceneX, y: currentSceneY });
            }
            return;
        }

        // Alt-hover distance measurement
        if (isAltPressed.current && !isDragging.current && !isTransforming.current && selectedLayerIds.length > 0) {
            const selectedLayer = layers.find(l => l.id === selectedLayerIds[0]);
            if (selectedLayer) {
                const selectedBounds: NodeBounds = {
                    id: selectedLayer.id, x: selectedLayer.x, y: selectedLayer.y,
                    width: selectedLayer.width, height: selectedLayer.height, rotation: selectedLayer.rotation,
                };

                // Find what the cursor is hovering over
                const hoveredNode = stage.getIntersection(pointer);
                let hoveredLayerId: string | null = null;

                if (hoveredNode) {
                    // Walk up the parent chain to find a layer node
                    let current: Konva.Node | null = hoveredNode;
                    while (current && current !== stage) {
                        const nodeId = current.id();
                        if (nodeId) {
                            const found = layers.find(l => l.id === nodeId);
                            if (found && found.id !== selectedLayer.id) {
                                hoveredLayerId = found.id;
                                break;
                            }
                        }
                        current = current.parent;
                    }
                }

                if (hoveredLayerId) {
                    // Measure to hovered object
                    const hoveredLayer = layers.find(l => l.id === hoveredLayerId);
                    if (hoveredLayer) {
                        const targetBounds: NodeBounds = {
                            id: hoveredLayer.id, x: hoveredLayer.x, y: hoveredLayer.y,
                            width: hoveredLayer.width, height: hoveredLayer.height, rotation: hoveredLayer.rotation,
                        };
                        setDistanceMeasurements(computeHoverDistances(selectedBounds, targetBounds));
                    }
                } else {
                    // Measure to artboard edges
                    const artboardBounds: NodeBounds = {
                        id: '__artboard__', x: 0, y: 0,
                        width: canvasWidth, height: canvasHeight, rotation: 0,
                    };
                    setDistanceMeasurements(computeHoverDistances(selectedBounds, artboardBounds));
                }
            }
            // Don't process selection box while Alt-hovering
            return;
        }

        // Drawing box rubber-banding (rectangle/frame/slice drawing mode)
        if (drawingStartPoint.current && (activeTool === "rectangle" || activeTool === "frame" || activeTool === "slice")) {
            if (isOverview) return;
            const start = drawingStartPoint.current;
            let drawX = currentSceneX;
            let drawY = currentSceneY;

            // Shift constraint: square
            if (e.evt.shiftKey) {
                const dx = currentSceneX - start.x;
                const dy = currentSceneY - start.y;
                const size = Math.max(Math.abs(dx), Math.abs(dy));
                drawX = start.x + size * Math.sign(dx || 1);
                drawY = start.y + size * Math.sign(dy || 1);
            }

            setDrawingBox({ startX: start.x, startY: start.y, currentX: drawX, currentY: drawY });
            return;
        }

        // Selection box rubber-banding
        if (!selectionBox) return;

        setSelectionBox(prev => {
            if (!prev) return null;
            return {
                ...prev,
                x: Math.min(prev.startX, currentSceneX),
                y: Math.min(prev.startY, currentSceneY),
                width: Math.abs(currentSceneX - prev.startX),
                height: Math.abs(currentSceneY - prev.startY),
            };
        });
    }, [selectionBox, selectedLayerIds, layers, canvasWidth, canvasHeight, setDrawingBox, activeTool, penPoints, tileOffset, isOverview]);

    const handleStageMouseUp = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        if (isPanning) {
            if (containerRef.current) containerRef.current.style.cursor = "grab";
            setStageDraggable(true);
            return;
        }

        // ── Pen tool: end of a click/drag adds-handle cycle ──
        if (activeTool === "pen") {
            if (isOverview) return;
            penDragging.current = false;
            return;
        }

        // ── Drawing tool completion ──
        if (drawingStartPoint.current && (activeTool === "rectangle" || activeTool === "frame" || activeTool === "slice")) {
            if (isOverview) return;
            const start = drawingStartPoint.current;
            const stage = e.target.getStage();
            if (stage) {
                const endScene = getPointerArtboardPosition(stage, tileOffset);
                if (endScene) {
                    let endX = endScene.x;
                    let endY = endScene.y;

                    if (e.evt.shiftKey) {
                        const dx = endX - start.x;
                        const dy = endY - start.y;
                        const size = Math.max(Math.abs(dx), Math.abs(dy));
                        endX = start.x + size * Math.sign(dx || 1);
                        endY = start.y + size * Math.sign(dy || 1);
                    }

                    const x = Math.min(start.x, endX);
                    const y = Math.min(start.y, endY);
                    const w = Math.abs(endX - start.x);
                    const h = Math.abs(endY - start.y);

                    const MIN_DRAG_SIZE = 3;
                    if (w < MIN_DRAG_SIZE && h < MIN_DRAG_SIZE) {
                        // Click without drag — create with default size at click point
                        if (activeTool === "rectangle") {
                            addRectangleLayer({ x: start.x, y: start.y });
                        } else if (activeTool === "slice") {
                            addSliceLayer({ x: start.x, y: start.y });
                        } else {
                            addFrameLayer({ x: start.x, y: start.y });
                        }
                    } else {
                        if (activeTool === "rectangle") {
                            addRectangleLayer({ x, y, width: w, height: h });
                        } else if (activeTool === "slice") {
                            addSliceLayer({ x, y, width: w, height: h });
                        } else {
                            // Frame: auto-parent layers that are fully contained
                            const containedChildIds = layers
                                .filter(l => {
                                    if (!l.visible || l.locked || l.type === "slice") return false;
                                    // Only top-level layers (not already in a frame)
                                    const isChild = layers.some(
                                        p => p.type === "frame" && (p as FrameLayer).childIds.includes(l.id)
                                    );
                                    if (isChild) return false;
                                    return (
                                        l.x >= x && l.y >= y &&
                                        l.x + l.width <= x + w &&
                                        l.y + l.height <= y + h
                                    );
                                })
                                .map(l => l.id);
                            addFrameLayer({ x, y, width: w, height: h, childIds: containedChildIds });
                        }
                    }
                }
            }
            drawingStartPoint.current = null;
            setDrawingBox(null);
            setActiveTool("select");
            setStageDraggable(true);
            return;
        }

        setStageDraggable(true);
        if (selectionBox) {
            // Calculate intersection
            const box = selectionBox;
            // Filter layers that intersect
            const intersectedIds = layers.filter(l => {
                if (!l.visible || l.locked) return false;

                // ── Clip-bounds filtering ──
                // Determine the effective clip rect for this layer's parent
                let clipRect: { x: number; y: number; width: number; height: number } | null = null;

                const parentFrame = layers.find(
                    p => p.type === 'frame' && (p as FrameLayer).childIds.includes(l.id)
                ) as FrameLayer | undefined;

                if (parentFrame?.clipContent) {
                    // Child of a clipped frame — restrict to frame bounds
                    clipRect = { x: parentFrame.x, y: parentFrame.y, width: parentFrame.width, height: parentFrame.height };
                } else if (artboardProps.clipContent && !parentFrame) {
                    // Top-level layer on a clipped artboard — restrict to artboard bounds
                    clipRect = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
                }

                // If a clip rect exists, ensure the selection box overlaps with the clip region
                if (clipRect) {
                    if (
                        box.x >= clipRect.x + clipRect.width ||
                        box.x + box.width <= clipRect.x ||
                        box.y >= clipRect.y + clipRect.height ||
                        box.y + box.height <= clipRect.y
                    ) {
                        return false; // selection box is entirely outside clip bounds
                    }
                }

                // Simple AABB intersection with the layer itself
                return (
                    box.x < l.x + l.width &&
                    box.x + box.width > l.x &&
                    box.y < l.y + l.height &&
                    box.y + box.height > l.y
                );
            }).map(l => l.id);

            if (intersectedIds.length > 0) {
                if (e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey) {
                    intersectedIds.forEach(id => addToSelection(id));
                } else {
                    intersectedIds.forEach(id => addToSelection(id));
                }
            }
            setSelectionBox(null);
        }
    }, [selectionBox, layers, addToSelection, isPanning, artboardProps.clipContent, canvasWidth, canvasHeight, activeTool, addRectangleLayer, addFrameLayer, addSliceLayer, setDrawingBox, setActiveTool, tileOffset, isOverview]);

    const handleContextMenu = useCallback(
        (e: Konva.KonvaEventObject<MouseEvent>) => {
            e.evt.preventDefault();
            e.evt.stopPropagation();
            const stage = stageRef.current;
            if (!stage) return;
            const target = e.target;

            // Check if right-click is inside the bounding box of an existing multi-selection
            if (selectedLayerIds.length > 1) {
                const scene = getPointerArtboardPosition(stage, tileOffset);
                if (scene) {
                    const sceneX = scene.x;
                    const sceneY = scene.y;

                    const selectedLayers = layers.filter(l => selectedLayerIds.includes(l.id));
                    if (selectedLayers.length > 0) {
                        // Compute union bounding box of all selected layers
                        const PAD = 10; // Extra padding so it's easier to hit
                        const minX = Math.min(...selectedLayers.map(l => l.x)) - PAD;
                        const minY = Math.min(...selectedLayers.map(l => l.y)) - PAD;
                        const maxX = Math.max(...selectedLayers.map(l => l.x + l.width)) + PAD;
                        const maxY = Math.max(...selectedLayers.map(l => l.y + l.height)) + PAD;

                        if (sceneX >= minX && sceneX <= maxX && sceneY >= minY && sceneY <= maxY) {
                            // Click is inside selection area — show multi-selection menu
                            setContextMenu({
                                x: e.evt.clientX,
                                y: e.evt.clientY,
                                layerIds: [...selectedLayerIds],
                            });
                            return;
                        }
                    }
                }
            }

            if (target === stage) {
                setContextMenu(null);
                return;
            }

            let matchedLayer: LayerType | undefined;
            let current: Konva.Node | null = target;
            while (current && current !== stage) {
                const nodeId = current.id();
                if (nodeId) {
                    const found = layers.find((l) => l.id === nodeId);
                    if (found) { matchedLayer = found; break; }
                }
                current = current.parent;
            }
            if (!matchedLayer) {
                setContextMenu(null);
                return;
            }

            // If right-clicked layer is part of multi-selection, keep all selected
            // Otherwise, select only the right-clicked layer
            let targetIds: string[];
            if (selectedLayerIds.includes(matchedLayer.id) && selectedLayerIds.length > 1) {
                targetIds = [...selectedLayerIds];
            } else {
                if (!selectedLayerIds.includes(matchedLayer.id)) {
                    selectLayer(matchedLayer.id);
                }
                targetIds = [matchedLayer.id];
            }

            setContextMenu({
                x: e.evt.clientX,
                y: e.evt.clientY,
                layerIds: targetIds,
            });
        },
        [layers, selectLayer, stageRef, selectedLayerIds, tileOffset]
    );

    const handleDblClickText = useCallback(
        (layer: LayerType & { type: "text" }, _node: Konva.Text) => {
            selectLayer(layer.id);
            startTextEditing(layer.id);
        },
        [selectLayer, startTextEditing]
    );

    const handleTextEditCommit = useCallback(
        (text: string) => {
            if (editingLayerId) {
                updateLayer(editingLayerId, { text });
            }
            stopTextEditing();
        },
        [editingLayerId, updateLayer, stopTextEditing]
    );

    // Real-time text update during inline editing (every keystroke)
    const handleTextEditUpdate = useCallback(
        (text: string) => {
            if (editingLayerId) {
                updateLayer(editingLayerId, { text });
            }
        },
        [editingLayerId, updateLayer]
    );

    // Sync CSS-measured dimensions from InlineTextEditor back to the layer.
    // This ensures auto-layout uses the actual visual height during editing,
    // bridging the CSS/Canvas text measurement gap at line-wrap boundaries.
    const handleTextEditDimensionsChange = useCallback(
        (dims: { width?: number; height?: number }) => {
            if (editingLayerId) {
                updateLayer(editingLayerId, dims);
            }
        },
        [editingLayerId, updateLayer]
    );

    /* ─── File Drag & Drop ────────────────────────────── */
    // File drop is out of Phase 2 overview scope: the positioning math
    // assumes single-view artboard space, and which tile a drop should
    // target is a design question we haven't answered yet. Suppress the
    // drag overlay and the drop handler entirely while in overview.
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (isOverview) return;
        if (e.dataTransfer.types.includes("Files")) {
            setIsDraggingFile(true);
        }
    }, [isOverview]);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (isOverview) return;
        setIsDraggingFile(false);
    }, [isOverview]);

    const { registerFile } = useProjectLibrary();
        const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (isOverview) return;
            setIsDraggingFile(false);

            // Resolve the drop point in scene (artboard-local) coordinates.
            const getDropScenePos = (): { x: number; y: number } => {
                const stage = stageRef.current;
                if (stage) {
                    stage.setPointersPositions(e.nativeEvent);
                    const rel = stage.getRelativePointerPosition();
                    if (rel) return worldPointToArtboard(stage, rel, tileOffset);
                }
                return { x: 100, y: 100 };
            };

            const allFiles = Array.from(e.dataTransfer.files);

            // SVG files -> native editable vector layers.
            const svgFiles = allFiles.filter(
                (f) => f.type === "image/svg+xml" || /\.svg$/i.test(f.name),
            );
            for (const file of svgFiles) {
                void file.text().then((text) => {
                    const pos = getDropScenePos();
                    const overrides = svgTextToVectorOverrides(text, {
                        x: pos.x,
                        y: pos.y,
                        name: file.name.replace(/\.svg$/i, "") || "Vector",
                    });
                    if (overrides) addVectorLayer(overrides);
                });
            }

            const files = allFiles.filter(
                (f) => f.type.startsWith("image/") && f.type !== "image/svg+xml",
            );
            for (const file of files) {
                // Show the dropped image instantly with an ObjectURL, then
                // upload + register in the background. When the permanent S3
                // url returns, swap the layer's src so save/export use the
                // non-blob url.
                const localPreview = URL.createObjectURL(file);
                const img = new window.Image();
                img.onload = () => {
                    const maxSize = 500;
                    const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                    const width = img.width * scale;
                    const height = img.height * scale;
                    const layerId = addImageLayer(localPreview, width, height);

                    if (!projectId) return;
                    
                    void registerFile({ projectId, file, source: "upload" }).then(
                        (permanentUrl) => {
                            if (!permanentUrl || !layerId) return;
                            useCanvasStore
                                .getState()
                                .updateLayer(layerId, { src: permanentUrl });
                            URL.revokeObjectURL(localPreview);
                        },
                    );
                };
                img.src = localPreview;
            }
        },
        [addImageLayer, addVectorLayer, projectId, registerFile, tileOffset, isOverview]
    );

    /* ─── Export Layers Utility ────────────────────────── */
    const exportLayers = useCallback(async (layerIds: string[]) => {
        const stage = stageRef.current;
        if (!stage) return;

        const targetLayers = layers.filter(l => layerIds.includes(l.id));
        if (targetLayers.length === 0) return;

        // Helper: export a single layer as a blob
        const exportSingleLayer = async (layer: LayerType): Promise<{ name: string; blob: Blob }> => {
            const safeName = (layer.name || layer.type || "layer").replace(/[^a-zA-Zа-яА-Я0-9_-]/g, "_");

            // For image layers with an HTTP src, download the original directly
            if (layer.type === "image" && (layer as ImageLayer).src) {
                const src = (layer as ImageLayer).src;
                if (src.startsWith("http")) {
                    try {
                        const res = await fetch(src);
                        const blob = await res.blob();
                        const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "png";
                        return { name: `${safeName}.${ext}`, blob };
                    } catch {
                        // Fall through to Konva rendering
                    }
                }
            }

            // Render via Konva node
            // Find the Konva node by ID
            const node = stage.findOne(`#${layer.id}`);
            if (node) {
                const oldScale = stage.scaleX();
                const oldPos = stage.position();
                stage.scale({ x: 1, y: 1 });
                stage.position({ x: 0, y: 0 });

                const dataURL = node.toDataURL({
                    pixelRatio: 2,
                    mimeType: "image/png",
                });

                stage.scale({ x: oldScale, y: oldScale });
                stage.position(oldPos);
                stage.batchDraw();

                const res = await fetch(dataURL);
                const blob = await res.blob();
                return { name: `${safeName}.png`, blob };
            }

            // Fallback: render the layer bounds from the stage
            const oldScale = stage.scaleX();
            const oldPos = stage.position();
            stage.scale({ x: 1, y: 1 });
            stage.position({ x: 0, y: 0 });

            const dataURL = stage.toDataURL({
                x: layer.x + tileOffset.x,
                y: layer.y + tileOffset.y,
                width: layer.width,
                height: layer.height,
                pixelRatio: 2,
                mimeType: "image/png",
            });

            stage.scale({ x: oldScale, y: oldScale });
            stage.position(oldPos);
            stage.batchDraw();

            const res = await fetch(dataURL);
            const blob = await res.blob();
            return { name: `${safeName}.png`, blob };
        };

        await withSliceOverlaysHidden(stage, async () => {
            if (targetLayers.length === 1) {
                // Single layer → direct download
                const { name, blob } = await exportSingleLayer(targetLayers[0]);
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.download = name;
                link.href = url;
                link.click();
                URL.revokeObjectURL(url);
            } else {
                // Multiple layers → ZIP
                const JSZip = (await import("jszip")).default;
                const { saveAs } = await import("file-saver");
                const zip = new JSZip();

                // Deduplicate filenames to prevent overwrites in ZIP
                const usedNames = new Set<string>();
                for (const layer of targetLayers) {
                    let { name, blob } = await exportSingleLayer(layer);

                    // Ensure unique filename
                    if (usedNames.has(name)) {
                        const ext = name.lastIndexOf(".") > 0 ? name.slice(name.lastIndexOf(".")) : ".png";
                        const base = name.slice(0, name.lastIndexOf(".") > 0 ? name.lastIndexOf(".") : name.length);
                        let counter = 2;
                        while (usedNames.has(`${base}_${counter}${ext}`)) counter++;
                        name = `${base}_${counter}${ext}`;
                    }
                    usedNames.add(name);

                    zip.file(name, blob);
                }

                const content = await zip.generateAsync({ type: "blob" });
                saveAs(content, `export-${targetLayers.length}-layers.zip`);
            }
        });
    }, [layers, stageRef, tileOffset]);

    const editingLayer = useMemo(() => {
        if (!isEditingText || !editingLayerId) return undefined;
        return layers.find((l) => l.id === editingLayerId) as TextLayer | undefined;
    }, [isEditingText, editingLayerId, layers]);

    // Pre-compute top-level layers (those not inside any frame) — avoids O(n²) in render
    const topLevelLayers = useMemo(() => {
        return layers.filter((l) => !frameChildIds.has(l.id));
    }, [layers, frameChildIds]);

    const gradientHandleTarget = useMemo(() => {
        if (!activeGradientEditorTarget) return null;
        if (selectedLayerIds.length === 1) {
            const selected = layers.find((l) => l.id === selectedLayerIds[0]);
            const selectedFillMode = selected?.type === "image"
                ? selected.fillMode ?? "image"
                : selected?.type === "rectangle" || selected?.type === "frame"
                    ? selected.fillMode ?? "paint"
                    : "paint";
            if (
                selected
                && activeGradientEditorTarget === selected.id
                && (selected.type === "rectangle" || selected.type === "badge" || selected.type === "frame" || selected.type === "image")
                && selected.fillEnabled !== false
                && selectedFillMode === "paint"
                && normalizePaint(selected.type === "image" ? selected.fill ?? "#FFFFFF" : selected.fill).kind === "gradient"
            ) {
                return { kind: "layer" as const, layer: selected };
            }
        }
        if (activeGradientEditorTarget === "artboard" && selectedLayerIds.length === 0 && artboardProps.fillEnabled !== false && normalizePaint(artboardProps.fill).kind === "gradient") {
            return { kind: "artboard" as const, fill: artboardProps.fill, width: canvasWidth, height: canvasHeight };
        }
        return null;
    }, [activeGradientEditorTarget, selectedLayerIds, layers, artboardProps.fill, canvasWidth, canvasHeight]);

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 overflow-hidden bg-bg-canvas"
            style={{
                backgroundImage:
                    "radial-gradient(circle, var(--border-primary) 1px, transparent 1px)",
                backgroundSize: `${20 * overlayViewport.zoom}px ${20 * overlayViewport.zoom}px`,
                backgroundPosition: `${overlayViewport.x}px ${overlayViewport.y}px`,
                cursor: isDrawingTool && !isOverview ? "crosshair" : undefined,
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onContextMenu={(e) => e.preventDefault()}
        >
            <Stage
                ref={stageRef}
                width={containerDimensions.width || 1200}
                height={containerDimensions.height || 800}
                scaleX={overlayViewport.zoom}
                scaleY={overlayViewport.zoom}
                x={overlayViewport.x}
                y={overlayViewport.y}
                onWheel={handleWheel}
                onMouseDown={handleStageMouseDown}
                onMouseMove={handleStageMouseMove}
                onMouseUp={handleStageMouseUp}
                onContextMenu={handleContextMenu}
                draggable={stageDraggable && !isEditingText && activeTool !== "pen"}
                onDragStart={(e) => {
                    if (!isOverview) return;
                    if (e.target !== e.target.getStage()) return;
                    overviewDraggingRef.current = true;
                }}
                onDragMove={(e) => {
                    // Overview pans the world via a controlled Stage; without a
                    // mid-drag store sync, any re-render (auto-fit, hover) would
                    // snap stage back to its pre-drag position.
                    if (!isOverview) return;
                    if (e.target !== e.target.getStage()) return;
                    const stage = stageRef.current;
                    if (!stage) return;
                    setOverviewPosition(stage.x(), stage.y());
                }}
                onDragEnd={(e) => {
                    if (e.target !== e.target.getStage()) return;
                    if (isOverview) {
                        overviewDraggingRef.current = false;
                        const stage = stageRef.current;
                        if (!stage) return;
                        setOverviewPosition(stage.x(), stage.y());
                    } else {
                        setStagePosition(e.target.x(), e.target.y());
                    }
                }}
            >
                <Layer>
                    {/* Artboard-local coordinate frame. In single view this is
                        a visual no-op (tileOffset = {0,0}); in overview the
                        Group is positioned at the active tile so every child
                        — background, layers, snap guides, transformers, pen
                        preview — keeps its artboard-local math unchanged.

                        This editable group is rendered BEFORE the read-only
                        sibling tiles below so DFS-based lookups like
                        stage.findOne('#'+id) (used by drag/transform/hover
                        handlers, the transformer attach effect, and the
                        export pipeline) resolve to the active artboard's
                        node first, even if a sibling snapshot happens to
                        share an id with the active format. Tiles never
                        spatially overlap, so paint order is visually
                        irrelevant. */}
                    <Group ref={artboardGroupRef} name={EXPORT_ARTBOARD_FRAME_NAME} x={tileOffset.x} y={tileOffset.y}>
                    {/* Artboard background */}
                    {artboardProps.clipContent ? (
                        <Group
                            clipX={0} clipY={0} clipWidth={canvasWidth} clipHeight={canvasHeight}
                        >
                            <Group
                                clipFunc={roundedRectClipFunc(canvasWidth, canvasHeight, resolveCornerRadius(artboardProps.cornerRadius, artboardProps.cornerRadii))}
                            >
                                <AlignedStrokeRect
                                    id="__artboard_fill"
                                    name="export-artboard-fill"
                                    width={canvasWidth}
                                    height={canvasHeight}
                                    {...paintToKonvaProps(artboardProps.fill, canvasWidth, canvasHeight)}
                                    fillEnabled={artboardProps.fillEnabled !== false}
                                    stroke={typeof artboardProps.stroke === "string" ? artboardProps.stroke || undefined : undefined}
                                    strokePaint={artboardProps.strokeMode === "image" ? undefined : artboardProps.stroke}
                                    strokeImage={artboardProps.strokeMode === "image" ? artboardStrokeImage ?? undefined : undefined}
                                    strokeImageFill={artboardProps.strokeImage}
                                    strokeWidth={artboardProps.strokeWidth}
                                    strokeAlign={artboardProps.strokeAlign}
                                    strokeEnabled={!!artboardProps.strokeWidth && (!!artboardProps.stroke || !!artboardProps.strokeImage?.src)}
                                    cornerRadius={resolveCornerRadius(artboardProps.cornerRadius, artboardProps.cornerRadii)}
                                    shadowColor="rgba(0,0,0,0.1)"
                                    shadowBlur={20}
                                    listening={false}
                                />
                                {artboardProps.fillEnabled !== false && <ArtboardBackgroundRenderer />}
                                {topLevelLayers.map(layer => (
                                    <CanvasLayer
                                        key={layer.id}
                                        layer={layer}
                                        isSelected={selectedLayerIds.includes(layer.id)}
                                        onSelect={handleLayerSelect}
                                        onDragStart={handleLayerDragStart}
                                        onDragMove={handleLayerDragMove}
                                        onDragEnd={handleLayerDragEnd}
                                        onTransformEnd={handleTransformEnd}
                                        onTransform={handleTransform}
                                        onDblClickText={handleDblClickText}
                                        isEditing={isEditingText && editingLayerId === layer.id}
                                        onHover={setHoveredLayerId}
                                    />
                                ))}
                            </Group>
                        </Group>
                    ) : (
                        <>
                            <AlignedStrokeRect
                                id="__artboard_fill"
                                name="export-artboard-fill"
                                width={canvasWidth}
                                height={canvasHeight}
                                {...paintToKonvaProps(artboardProps.fill, canvasWidth, canvasHeight)}
                                fillEnabled={artboardProps.fillEnabled !== false}
                                stroke={typeof artboardProps.stroke === "string" ? artboardProps.stroke || undefined : undefined}
                                strokePaint={artboardProps.strokeMode === "image" ? undefined : artboardProps.stroke}
                                strokeImage={artboardProps.strokeMode === "image" ? artboardStrokeImage ?? undefined : undefined}
                                strokeImageFill={artboardProps.strokeImage}
                                strokeWidth={artboardProps.strokeWidth}
                                strokeAlign={artboardProps.strokeAlign}
                                strokeEnabled={!!artboardProps.strokeWidth && (!!artboardProps.stroke || !!artboardProps.strokeImage?.src)}
                                cornerRadius={resolveCornerRadius(artboardProps.cornerRadius, artboardProps.cornerRadii)}
                                shadowColor="rgba(0,0,0,0.1)"
                                shadowBlur={20}
                                listening={false}
                            />
                            {artboardProps.fillEnabled !== false && <ArtboardBackgroundRenderer />}
                            {topLevelLayers.map(layer => (
                                <CanvasLayer
                                    key={layer.id}
                                    layer={layer}
                                    isSelected={selectedLayerIds.includes(layer.id)}
                                    onSelect={handleLayerSelect}
                                    onDragStart={handleLayerDragStart}
                                    onDragMove={handleLayerDragMove}
                                    onDragEnd={handleLayerDragEnd}
                                    onTransformEnd={handleTransformEnd}
                                    onTransform={handleTransform}
                                    onDblClickText={handleDblClickText}
                                    isEditing={isEditingText && editingLayerId === layer.id}
                                    onHover={setHoveredLayerId}
                                />
                            ))}
                        </>
                    )}

                    {/* Layout grids (safe zones) — overlay above content, hidden on export.
                        Hairlines must stay 1px on screen regardless of overview zoom,
                        so we feed the effective stage scale. In single view this
                        equals store `zoom` (overlayViewport.zoom === zoom). */}
                    {layoutGridsVisible && (
                        <LayoutGridLayer
                            grids={activeLayoutGrids}
                            width={canvasWidth}
                            height={canvasHeight}
                            zoom={overlayViewport.zoom}
                            name={EDITOR_CHROME_NAME}
                        />
                    )}

                    {/* Snap Guides, Distance Measurements, Spacing Guides, Selection Box */}
                    <SnapGuides
                        snapLines={snapLines}
                        distanceMeasurements={distanceMeasurements}
                        spacingGuides={spacingGuides}
                        selectionBox={selectionBox}
                        drawingBox={drawingBox}
                        activeTool={activeTool}
                    />

                    {/* Pen tool live preview */}
                    {activeTool === "pen" && penPoints.length > 0 && (
                        <PenPreview points={penPoints} cursor={penCursor} zoom={zoom} />
                    )}

                    {/* Gradient handles are gated off in overview: they read store
                        `zoom` and assume single-view artboard math. */}
                    {!isOverview && gradientHandleTarget && (
                        <GradientDirectionHandles
                            target={gradientHandleTarget}
                            zoom={zoom}
                            onDragStart={() => setStageDraggable(false)}
                            onDragEnd={() => setStageDraggable(true)}
                            onUpdateLayer={updateLayer}
                            onUpdateArtboard={updateArtboardProps}
                        />
                    )}

                    {/* Hover Outline (Figma-like) */}
                    {hoveredLayerId && !selectedLayerIds.includes(hoveredLayerId) && (() => {
                        const hLayer = layers.find(l => l.id === hoveredLayerId);
                        if (!hLayer) return null;

                        // Try to get real bounds from Konva node (handles auto-sized text etc.)
                        let hx = hLayer.x;
                        let hy = hLayer.y;
                        let hw = hLayer.width;
                        let hh = hLayer.height;
                        let hr = hLayer.rotation || 0;

                        const node = stageRef.current?.findOne("#" + hoveredLayerId);
                        if (node) {
                            const rect = node.getClientRect({ skipTransform: false, relativeTo: artboardGroupRef.current ?? undefined });
                            if (rect && rect.width > 0 && rect.height > 0) {
                                hx = rect.x;
                                hy = rect.y;
                                hw = rect.width;
                                hh = rect.height;
                                hr = 0; // getClientRect returns axis-aligned bounds, rotation already applied
                            }
                        }

                        return (
                            <Rect
                                x={hx}
                                y={hy}
                                width={hw}
                                height={hh}
                                rotation={hr}
                                stroke="#6366F1"
                                // Hairline must remain 1.5 screen px in both views; in
                                // single view overlayViewport.zoom === zoom (no-op).
                                strokeWidth={1.5 / overlayViewport.zoom}
                                cornerRadius={(hLayer.type === 'rectangle' || hLayer.type === 'frame') ? resolveCornerRadius((hLayer as any).cornerRadius || 0, (hLayer as any).cornerRadii) : 0}
                                listening={false}
                                perfectDrawEnabled={false}
                            />
                        );
                    })()}

                    {/* Selection Transformer — hidden when dedicated edit overlays own the handles. */}
                    {!expandMode && !inpaintMode && !gradientHandleTarget && !vectorEditLayerId && (() => {
                        const topLevelIds = selectedLayerIds.filter((id) => !frameChildIds.has(id));
                        const unlockedTopLevel = topLevelIds.filter((id) => {
                            const l = layers.find((x) => x.id === id);
                            return l && !l.locked && l.id !== editingLayerId;
                        });
                        if (unlockedTopLevel.length > 1) {
                            return (
                                <GroupSelectionTransformer
                                    selectedLayerIds={selectedLayerIds}
                                    stageRef={stageRef}
                                    excludeIds={frameChildIds}
                                    pauseProxySync={isDraggingLayers}
                                    canvasWidth={canvasWidth}
                                    canvasHeight={canvasHeight}
                                    onSnapGuides={setSnapLines}
                                    onTransformActiveChange={(active) => {
                                        isTransforming.current = active;
                                        if (!active) {
                                            setSnapLines([]);
                                            setDistanceMeasurements([]);
                                            setSpacingGuides([]);
                                        }
                                    }}
                                />
                            );
                        }
                        if (unlockedTopLevel.length === 1) {
                            return (
                                <SelectionTransformer
                                    selectedLayerIds={selectedLayerIds}
                                    stageRef={stageRef}
                                    excludeIds={frameChildIds}
                                />
                            );
                        }
                        return null;
                    })()}

                    {/* Vector point-editing overlay — out of scope for overview. */}
                    {!isOverview && vectorEditLayerId && (() => {
                        const editLayer = layers.find((l) => l.id === vectorEditLayerId && l.type === "vector") as VectorLayer | undefined;
                        if (!editLayer) return null;
                        return <VectorEditOverlay layer={editLayer} zoom={zoom} onChange={updateLayer} />;
                    })()}

                    {/* Expand Overlay — drag handles for generative expand.
                        Out of scope for overview; the overlay positions DOM
                        elements from store transform and isn't tile-aware. */}
                    {!isOverview && expandMode && expandTargetLayerId && (
                        <ExpandOverlay layerId={expandTargetLayerId} />
                    )}

                    {/* Active artboard label + selection ring in overview.
                        Rendered INSIDE the editable group so it shares the
                        active tile offset; uses the same metrics as siblings
                        for visual parity. */}
                    {isOverview && (() => {
                        const activeFormat = resizes.find((r) => r.id === activeResizeId);
                        if (!activeFormat) return null;
                        const ringStrokeWidth = 4 / Math.max(overviewZoom, OVERVIEW_ZOOM_MIN);
                        const labelY = canvasHeight + OVERVIEW_LABEL_TOP_PADDING;
                        const subLabelY = labelY + OVERVIEW_LABEL_FONT_SIZE + OVERVIEW_LABEL_LINE_SPACING;
                        const sizeLabel = `${activeFormat.width} × ${activeFormat.height}`;
                        const subLabelText = activeFormat.isMaster
                            ? `${sizeLabel}  •  Мастер`
                            : sizeLabel;
                        return (
                            <Group name={EDITOR_CHROME_NAME} listening={false}>
                                <Rect
                                    x={-ringStrokeWidth / 2}
                                    y={-ringStrokeWidth / 2}
                                    width={canvasWidth + ringStrokeWidth}
                                    height={canvasHeight + ringStrokeWidth}
                                    stroke={OVERVIEW_ACCENT_SELECTED}
                                    strokeWidth={ringStrokeWidth}
                                    cornerRadius={Math.max(4, artboardProps.cornerRadius)}
                                    listening={false}
                                />
                                <Text
                                    x={0}
                                    y={labelY}
                                    width={canvasWidth}
                                    text={activeFormat.name}
                                    fontSize={OVERVIEW_LABEL_FONT_SIZE}
                                    fontFamily={OVERVIEW_LABEL_FONT_FAMILY}
                                    fontStyle="600"
                                    fill="#111827"
                                    align="left"
                                    listening={false}
                                />
                                <Text
                                    x={0}
                                    y={subLabelY}
                                    width={canvasWidth}
                                    text={subLabelText}
                                    fontSize={OVERVIEW_LABEL_SUB_FONT_SIZE}
                                    fontFamily={OVERVIEW_LABEL_FONT_FAMILY}
                                    fill="#6B7280"
                                    align="left"
                                    listening={false}
                                />
                            </Group>
                        );
                    })()}

                    </Group>

                    {/* Read-only sibling tiles for the overview. Active format
                        is intentionally skipped here — the editable Group
                        above already rendered the live artboard at the same
                        world offset. Emitted AFTER the editable group so
                        DFS-based stage.findOne('#'+id) lookups resolve to
                        the active artboard's node first; tiles never
                        spatially overlap, so paint order is visually
                        irrelevant. */}
                    {isOverview && resizes.map((format, index) => {
                        if (format.id === activeResizeId) return null;
                        const tile = overviewLayout.tiles[index];
                        if (!tile) return null;
                        const isHovered = hoveredOverviewId === format.id;
                        const screenStroke = isHovered ? 2 : 0;
                        const ringStrokeWidth =
                            screenStroke > 0
                                ? screenStroke / Math.max(overviewZoom, OVERVIEW_ZOOM_MIN)
                                : 0;
                        const labelY = format.height + OVERVIEW_LABEL_TOP_PADDING;
                        const subLabelY = labelY + OVERVIEW_LABEL_FONT_SIZE + OVERVIEW_LABEL_LINE_SPACING;
                        const sizeLabel = `${format.width} × ${format.height}`;
                        const subLabelText = format.isMaster
                            ? `${sizeLabel}  •  Мастер`
                            : sizeLabel;
                        return (
                            <Group key={format.id} x={tile.x} y={tile.y}>
                                <ArtboardGroup
                                    layers={format.layerSnapshot ?? []}
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
                                        stroke={OVERVIEW_ACCENT_HOVER}
                                        strokeWidth={ringStrokeWidth}
                                        cornerRadius={Math.max(4, artboardProps.cornerRadius)}
                                        listening={false}
                                    />
                                )}
                                <Text
                                    x={0}
                                    y={labelY}
                                    width={format.width}
                                    text={format.name}
                                    fontSize={OVERVIEW_LABEL_FONT_SIZE}
                                    fontFamily={OVERVIEW_LABEL_FONT_FAMILY}
                                    fontStyle="500"
                                    fill="#9CA3AF"
                                    align="left"
                                    listening={false}
                                />
                                <Text
                                    x={0}
                                    y={subLabelY}
                                    width={format.width}
                                    text={subLabelText}
                                    fontSize={OVERVIEW_LABEL_SUB_FONT_SIZE}
                                    fontFamily={OVERVIEW_LABEL_FONT_FAMILY}
                                    fill="#6B7280"
                                    align="left"
                                    listening={false}
                                />
                                {/* Transparent hit area: click activates, dblclick
                                    enters single view. Sibling layer nodes have
                                    listening=false so this is the only pointer
                                    target on the tile. */}
                                <Rect
                                    x={0}
                                    y={0}
                                    width={format.width}
                                    height={format.height}
                                    fill="transparent"
                                    onClick={() => setActiveResize(format.id)}
                                    onTap={() => setActiveResize(format.id)}
                                    onDblClick={() => {
                                        setActiveResize(format.id);
                                        setViewMode("single");
                                    }}
                                    onDblTap={() => {
                                        setActiveResize(format.id);
                                        setViewMode("single");
                                    }}
                                    onMouseEnter={() => {
                                        if (overviewDraggingRef.current) return;
                                        setHoveredOverviewId(format.id);
                                    }}
                                    onMouseLeave={() => {
                                        if (overviewDraggingRef.current) return;
                                        setHoveredOverviewId((cur) => (cur === format.id ? null : cur));
                                    }}
                                />
                            </Group>
                        );
                    })}
                </Layer>
            </Stage>

            {/* Overlays */}
            {/* Inpaint Mask Overlay — DOM canvas painted on top of the
                selected image layer. Skipped for rotated layers (MVP — proper
                rotation support requires unrotating the stroke buffer at
                export time which we leave for a follow-up). Out of scope for
                overview: the DOM positioning math is single-view-only and
                the inpaint tool itself is gated to single editing. */}
            {!isOverview && inpaintMode && inpaintTargetLayerId && sharedInpaintMask && (() => {
                const target = layers.find((l) => l.id === inpaintTargetLayerId);
                if (!target || target.type !== "image") return null;
                const rotation = target.rotation || 0;
                if (Math.abs(rotation) > 0.01) {
                    // Render a small banner instead of the overlay so the user
                    // knows why the brush isn't appearing.
                    return (
                        <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full bg-amber-500/15 border border-amber-500/30 px-3 py-1 text-[11px] text-amber-600 backdrop-blur-md">
                            Сбросьте поворот слоя, чтобы рисовать inpaint-маску
                        </div>
                    );
                }
                const bboxLeft = target.x * zoom + stageX;
                const bboxTop = target.y * zoom + stageY;
                const bboxWidth = target.width * zoom;
                const bboxHeight = target.height * zoom;
                return (
                    <InpaintMaskOverlay
                        bbox={{ left: bboxLeft, top: bboxTop, width: bboxWidth, height: bboxHeight }}
                        mask={sharedInpaintMask}
                    />
                );
            })()}

            {editingLayer && (
                <InlineTextEditor
                    layer={editingLayer}
                    stageRef={stageRef}
                    viewport={overlayViewport}
                    tileOffset={tileOffset}
                    onCommit={handleTextEditCommit}
                    onUpdate={handleTextEditUpdate}
                    onDimensionsChange={handleTextEditDimensionsChange}
                />
            )}

            <div className="absolute bottom-4 right-4 flex items-center gap-2">
                {activeResizeId !== "master" && (
                    <div className="bg-accent-primary/10 border border-accent-primary/30 rounded-[var(--radius-md)] px-3 py-1.5 shadow-[var(--shadow-sm)]">
                        <span className="text-xs font-medium text-accent-primary">
                            {canvasWidth}×{canvasHeight}
                        </span>
                    </div>
                )}
                <div className="bg-bg-surface border border-border-primary rounded-[var(--radius-md)] px-3 py-1.5 shadow-[var(--shadow-sm)]">
                    <span className="text-xs font-medium text-text-secondary">
                        {Math.round(zoom * 100)}%
                    </span>
                </div>
            </div>

            {isDraggingFile && (
                <div className="absolute inset-4 border-2 border-dashed border-accent-primary rounded-2xl bg-accent-primary/5 flex items-center justify-center z-40 pointer-events-none">
                    <div className="flex flex-col items-center gap-2 text-accent-primary">
                        <ImageIcon size={32} />
                        <span className="text-sm font-medium">Перетащите изображение сюда</span>
                    </div>
                </div>
            )}

            {contextMenu && (() => {
                const menuLayerIds = contextMenu.layerIds;
                const menuLayers = layers.filter(l => menuLayerIds.includes(l.id));
                if (menuLayers.length === 0) return null;

                // Shared clipboard actions
                const clipboardActions = {
                    copyLayers: () => {
                        import("@/utils/clipboardUtils").then(({ copyLayersToClipboard }) => {
                            copyLayersToClipboard(menuLayerIds, layers);
                        });
                    },
                    cutLayers: () => {
                        import("@/utils/clipboardUtils").then(({ copyLayersToClipboard }) => {
                            copyLayersToClipboard(menuLayerIds, layers).then(() => {
                                menuLayerIds.forEach(id => removeLayer(id));
                            });
                        });
                    },
                    pasteLayers: () => {
                        import("@/utils/clipboardUtils").then(({ pasteLayersFromClipboard }) => {
                            pasteLayersFromClipboard().then(data => {
                                if (data && data.layers.length > 0) {
                                    useCanvasStore.getState().pasteLayers(data.layers);
                                }
                            });
                        });
                    },
                };

                // Multi-selection menu
                if (menuLayers.length > 1) {
                    return (
                        <ContextMenu
                            x={contextMenu.x}
                            y={contextMenu.y}
                            onClose={() => setContextMenu(null)}
                            items={buildMultiSelectionContextMenuItems(
                                menuLayers.length,
                                {
                                    duplicateAll: () => menuLayerIds.forEach(id => duplicateLayer(id)),
                                    removeAll: () => menuLayerIds.forEach(id => removeLayer(id)),
                                    exportAll: () => exportLayers(menuLayerIds),
                                    ...clipboardActions,
                                    wrapInAutoLayout: () => wrapInAutoLayoutFrame(),
                                }
                            )}
                        />
                    );
                }

                // Single-layer menu
                const layer = menuLayers[0];
                return (
                    <ContextMenu
                        x={contextMenu.x}
                        y={contextMenu.y}
                        onClose={() => setContextMenu(null)}
                        items={buildLayerContextMenuItems(
                            layer.id,
                            layer.name,
                            layer.visible,
                            layer.locked,
                            {
                                duplicate: () => duplicateLayer(layer.id),
                                remove: () => removeLayer(layer.id),
                                bringToFront: () => bringToFront(layer.id),
                                sendToBack: () => sendToBack(layer.id),
                                toggleVisibility: () => toggleLayerVisibility(layer.id),
                                toggleLock: () => toggleLayerLock(layer.id),
                                exportLayer: () => exportLayers([layer.id]),
                                ...clipboardActions,
                                copyAsPng: () => {
                                    if (stageRef.current) {
                                        import("@/utils/clipboardUtils").then(({ copyLayerAsPng }) => {
                                            copyLayerAsPng(stageRef.current!, [layer.id], layers);
                                        });
                                    }
                                },
                                copyAsSvg: () => {
                                    import("@/utils/clipboardUtils").then(({ copyLayersAsSvg }) => {
                                        void copyLayersAsSvg([layer.id], layers, stageRef.current);
                                    });
                                },
                                wrapInAutoLayout: () => wrapInAutoLayoutFrame(),
                                toggleFixedAsset: isTemplateMode && (layer.type === "image" || layer.type === "vector")
                                    ? () => updateLayer(layer.id, { isFixedAsset: !layer.isFixedAsset })
                                    : undefined,
                                createSwatchFromFill: (layer.type === "text" || layer.type === "rectangle" || layer.type === "badge" || layer.type === "frame" || layer.type === "vector")
                                    ? () => useCanvasStore.getState().createSwatchFromLayerFill(layer.id)
                                    : undefined,
                            },
                            {
                                isImageLayer: layer.type === "image",
                                isVectorLayer: layer.type === "vector",
                                isFixedAsset: !!layer.isFixedAsset,
                                isTemplateMode,
                            }
                        )}
                    />
                );
            })()}

        </div>
    );
}
