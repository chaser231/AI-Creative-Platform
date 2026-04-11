"use client";

import { useRef, useCallback, useEffect, useState, useMemo, Fragment } from "react";
import { ImageIcon } from "lucide-react";
import { Stage, Layer, Rect, Text, Image as KonvaImage, Transformer, Group, Line } from "react-konva";
import { useCanvasStore, computeConstrainedPosition } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import type { Layer as LayerType, TextLayer, BadgeLayer, FrameLayer, ImageLayer } from "@/types";
import { computeImageFitProps } from "@/utils/imageFitUtils";
import { ContextMenu, buildLayerContextMenuItems, buildMultiSelectionContextMenuItems } from "../ContextMenu";
import { computeSnap, computeHoverDistances, computeResizeSnap, SnapResult, DistanceMeasurement, SpacingGuide } from "@/services/snapService";
import type { ActiveEdge, NodeBounds } from "@/services/snapService";
import { isFocusedOnInput } from "@/utils/keyboard";
import Konva from "konva";
import { useImage } from "./useImage";
import { SelectionTransformer, FrameChildTransformer } from "./transformers";
import { InlineTextEditor } from "./InlineTextEditor";
import { SnapGuides } from "./SnapGuides";
import { usePanZoom } from "./usePanZoom";
/* ─── Constants ───────────────────────────────────── */
const FRAME_HIGHLIGHT_STROKE = "#6366F1";
const FRAME_HIGHLIGHT_WIDTH = 2;



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
}

function CanvasLayer({
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
}: CanvasLayerProps) {
    const shapeRef = useRef<Konva.Shape>(null);
    const groupRef = useRef<Konva.Group>(null);

    if (!layer.visible) return null;

    const commonProps = {
        id: layer.id,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        rotation: layer.rotation,
        opacity: layer.opacity ?? 1,
        draggable: !layer.locked && !isEditing && !isAutoLayoutChild,
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
        }
    };

    return (
        <>
            {layer.type === "rectangle" && (
                <Rect
                    ref={shapeRef as React.RefObject<Konva.Rect | null>}
                    {...commonProps}
                    fill={layer.fillEnabled === false ? "transparent" : layer.fill}
                    stroke={layer.strokeEnabled === false ? undefined : (layer.stroke || undefined)}
                    strokeWidth={layer.strokeEnabled === false ? 0 : layer.strokeWidth}
                    cornerRadius={layer.cornerRadius}
                />
            )}
            {layer.type === "text" && !isEditing && (
                <Text
                    ref={shapeRef as React.RefObject<Konva.Text | null>}
                    {...commonProps}
                    width={layer.textAdjust === "auto_width" ? undefined : layer.width}
                    height={layer.textAdjust === "auto_width" || layer.textAdjust === "auto_height" ? undefined : layer.height}
                    text={layer.textTransform === "uppercase" ? layer.text.toUpperCase() : layer.textTransform === "lowercase" ? layer.text.toLowerCase() : layer.text}
                    fontSize={layer.fontSize}
                    fontFamily={layer.fontFamily}
                    fontStyle={layer.fontWeight || "normal"}
                    fill={layer.fillEnabled === false ? "transparent" : layer.fill}
                    align={layer.align}
                    letterSpacing={layer.letterSpacing}
                    lineHeight={layer.lineHeight}
                    wrap={layer.textAdjust === "auto_width" ? "none" : "word"}
                    ellipsis={layer.textAdjust === "fixed" ? (layer.truncateText || false) : false}
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
            )}
            {layer.type === "image" && (
                <ImageLayerRenderer
                    shapeRef={shapeRef}
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
                />
            )}
        </>
    );
}

// ... (renderers remain similar but need no changes if they use commonProps implicitly or we skip them in this block)
// Skipping Renderer definitions to save tokens - they are matched by context if I start higher?
// Actually I need to be careful with range.
// CanvasLayerProps is at line 67.
// I will just replace the CanvasLayerProps and CanvasLayer function definition up to line 180.

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
    if (!image) return null;

    const fitMode = (layer as ImageLayer).objectFit || "cover";
    const naturalW = image.naturalWidth || image.width;
    const naturalH = image.naturalHeight || image.height;
    const fit = computeImageFitProps(fitMode, naturalW, naturalH, layer.width, layer.height);

    // For contain/crop the image may be smaller than container, so we draw within a clipped Group
    if (fitMode === "contain" || fitMode === "crop") {
        return (
            <Group
                ref={shapeRef as React.RefObject<Konva.Group | null>}
                {...commonProps}
                clipFunc={(ctx) => {
                    ctx.rect(0, 0, layer.width, layer.height);
                }}
            >
                <KonvaImage
                    image={image}
                    x={fit.drawX}
                    y={fit.drawY}
                    width={fit.drawWidth}
                    height={fit.drawHeight}
                    crop={{ x: fit.cropX, y: fit.cropY, width: fit.cropWidth, height: fit.cropHeight }}
                />
            </Group>
        );
    }

    // For cover and fill — image fills the entire container
    return (
        <KonvaImage
            ref={shapeRef as React.RefObject<Konva.Image | null>}
            {...commonProps}
            image={image}
            crop={{ x: fit.cropX, y: fit.cropY, width: fit.cropWidth, height: fit.cropHeight }}
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
            <Rect
                width={layer.width}
                height={layer.height}
                fill={layer.fillEnabled === false ? "transparent" : layer.fill}
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
}) {
    const layers = useCanvasStore((s) => s.layers);
    const selectedLayerIds = useCanvasStore((s) => s.selectedLayerIds);
    const updateLayer = useCanvasStore((s) => s.updateLayer);
    const highlightedFrameId = useCanvasStore((s) => s.highlightedFrameId);
    const isEditingText = useCanvasStore((s) => s.isEditingText);
    const editingLayerId = useCanvasStore((s) => s.editingLayerId);
    const clipGroupRef = useRef<Konva.Group>(null);
    const childLayers = layer.childIds
        .map((id) => layers.find((l) => l.id === id))
        .filter(Boolean) as LayerType[];

    const isHighlighted = highlightedFrameId === layer.id;

    // Determine which children are currently selected
    const selectedChildIds = layer.childIds.filter((id) => selectedLayerIds.includes(id));

    // Handle transform end for children inside this frame.
    // For auto-layout children: only pass size changes, let auto-layout engine compute position.
    // For non-auto-layout children: convert frame-local coords to absolute scene coords.
    const handleChildTransformEnd = useCallback((e: Konva.KonvaEventObject<Event>) => {
        const node = e.target;
        const id = node.id();

        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        const rotation = node.rotation();

        // Reset scale and apply to width/height
        node.scaleX(1);
        node.scaleY(1);

        const width = node.width() * scaleX;
        const height = node.height() * scaleY;

        const childLayer = layers.find(l => l.id === id);
        const isAutoLayout = layer.layoutMode && layer.layoutMode !== "none" && childLayer && !childLayer.isAbsolutePositioned;

        // Get absolute frame position from store (layer.x prop may be relative for nested frames)
        const storeFrame = layers.find(l => l.id === layer.id);
        const frameAbsX = storeFrame?.x ?? layer.x;
        const frameAbsY = storeFrame?.y ?? layer.y;

        if (isAutoLayout && childLayer) {
            // Auto-layout children: update size, then reset node position
            // to the store's local coords so React can reconcile properly.
            updateLayer(id, { width, height, rotation });
            // Force node back to store position (frame-local coords)
            node.x(childLayer.x - frameAbsX);
            node.y(childLayer.y - frameAbsY);
        } else {
            // Non-auto-layout: convert frame-local coords to absolute scene coords.
            const newX = node.x() + frameAbsX;
            const newY = node.y() + frameAbsY;
            updateLayer(id, { x: newX, y: newY, width, height, rotation });
        }
    }, [updateLayer, layer.x, layer.y, layer.layoutMode, layer.id, layers]);

    // Force the bounding box of the frame to its own dimensions
    // ignoring any overflowing children.
    useEffect(() => {
        if (groupRef.current) {
            groupRef.current.getClientRect = (config?: { skipTransform?: boolean; skipShadow?: boolean; skipStroke?: boolean; relativeTo?: Konva.Container }) => {
                const node = groupRef.current!;

                // Base dimensions
                let x = 0;
                let y = 0;
                let width = layer.width;
                let height = layer.height;

                if (!config?.skipStroke && layer.strokeWidth) {
                    const sw = layer.strokeWidth;
                    x -= sw / 2;
                    y -= sw / 2;
                    width += sw;
                    height += sw;
                }

                const rect = { x, y, width, height };

                if (config?.skipTransform) {
                    return rect;
                }

                // Apply transforms
                const abosluteTransform = node.getAbsoluteTransform();
                const relativeToTransform = config?.relativeTo?.getAbsoluteTransform() ?? new Konva.Transform();

                // We want to transform 'rect' into the destination coordinate space.
                const relativeTransform = relativeToTransform.copy().invert().multiply(abosluteTransform);

                // Get transforming points
                const pts = [
                    { x: rect.x, y: rect.y },
                    { x: rect.x + rect.width, y: rect.y },
                    { x: rect.x + rect.width, y: rect.y + rect.height },
                    { x: rect.x, y: rect.y + rect.height }
                ].map(p => relativeTransform.point(p));

                const minX = Math.min(...pts.map(p => p.x));
                const minY = Math.min(...pts.map(p => p.y));
                const maxX = Math.max(...pts.map(p => p.x));
                const maxY = Math.max(...pts.map(p => p.y));

                return {
                    x: minX,
                    y: minY,
                    width: maxX - minX,
                    height: maxY - minY
                };
            };
        }
    }, [layer.width, layer.height, layer.strokeWidth, groupRef]);

    return (
        <Group
            ref={groupRef}
            {...commonProps}
        >
            <Group
                ref={clipGroupRef}
                clipX={layer.clipContent ? 0 : undefined}
                clipY={layer.clipContent ? 0 : undefined}
                clipWidth={layer.clipContent ? layer.width : undefined}
                clipHeight={layer.clipContent ? layer.height : undefined}
            >
               <Group
                   clipFunc={(layer.clipContent && layer.cornerRadius > 0) ? (ctx) => {
                        const r = layer.cornerRadius;
                        const w = layer.width;
                        const h = layer.height;
                        ctx.beginPath();
                        ctx.moveTo(r, 0);
                        ctx.arcTo(w, 0, w, h, r);
                        ctx.arcTo(w, h, 0, h, r);
                        ctx.arcTo(0, h, 0, 0, r);
                        ctx.arcTo(0, 0, w, 0, r);
                        ctx.closePath();
                    } : undefined}
               >
                <Rect
                    id={layer.id}
                    width={layer.width}
                    height={layer.height}
                    fill={layer.fillEnabled === false ? undefined : (layer.fill || undefined)}
                    stroke={isHighlighted ? FRAME_HIGHLIGHT_STROKE : (layer.strokeEnabled === false ? undefined : (layer.stroke || undefined))}
                    strokeWidth={isHighlighted ? FRAME_HIGHLIGHT_WIDTH : (layer.strokeEnabled === false ? 0 : layer.strokeWidth)}
                    cornerRadius={layer.cornerRadius}
                />
                {childLayers.map((child) => {
                    // Use STORE's absolute position for the frame, not the prop
                    // (prop may be relative for nested frames).
                    const storeFrame = layers.find(l => l.id === layer.id);
                    const frameAbsX = storeFrame?.x ?? layer.x;
                    const frameAbsY = storeFrame?.y ?? layer.y;
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
                    />
                    );
                })}
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

/* ─── Main Canvas component ───────────────────────── */

interface CanvasProps {
    stageRef: React.RefObject<Konva.Stage | null>;
}

export function Canvas({ stageRef }: CanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });

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
    const isTransforming = useRef(false);
    const clipBlocked = useRef(false);  // set when a mouseDown is blocked by clip bounds

    // Track start positions for multi-drag
    const dragStartLocs = useRef<Record<string, { x: number; y: number }>>({});

    const {
        layers,
        selectedLayerIds,
        selectLayer,
        toggleSelection,
        addToSelection,
        updateLayer,
        addImageLayer,
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
        isEditingText,
        editingLayerId,
        startTextEditing,
        stopTextEditing,
        artboardProps,
        setHighlightedFrameId,
        getFrameAtPoint,
        moveLayerToFrame,
        removeLayerFromFrame,
    } = useCanvasStore(useShallow((s) => ({
        layers: s.layers,
        selectedLayerIds: s.selectedLayerIds,
        selectLayer: s.selectLayer,
        toggleSelection: s.toggleSelection,
        addToSelection: s.addToSelection,
        updateLayer: s.updateLayer,
        addImageLayer: s.addImageLayer,
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
        isEditingText: s.isEditingText,
        editingLayerId: s.editingLayerId,
        startTextEditing: s.startTextEditing,
        stopTextEditing: s.stopTextEditing,
        artboardProps: s.artboardProps,
        setHighlightedFrameId: s.setHighlightedFrameId,
        getFrameAtPoint: s.getFrameAtPoint,
        moveLayerToFrame: s.moveLayerToFrame,
        removeLayerFromFrame: s.removeLayerFromFrame,
    })));

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

    /* ─── Layer Interactions ──────────────────────────── */

    /**
     * Check if a layer click should be ignored because it's outside
     * a clipped parent (frame or artboard) bounds.
     *
     * Uses the STORE data (not Konva DOM) to reliably determine
     * whether the pointer in canvas-space falls inside the clipping container.
     */
    const isClickOutsideClipBounds = useCallback((layerId: string, stagePointer: { x: number; y: number } | null): boolean => {
        if (!stagePointer) return false;

        // Convert screen pointer to canvas coordinates
        const canvasX = (stagePointer.x - stageX) / zoom;
        const canvasY = (stagePointer.y - stageY) / zoom;

        // 1. Check ARTBOARD clip
        if (artboardProps.clipContent) {
            if (canvasX < 0 || canvasX > canvasWidth || canvasY < 0 || canvasY > canvasHeight) {
                return true;
            }
        }

        // 2. Check if the layer is a child of a FRAME with clipContent
        const parentFrame = layers.find(
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
    }, [layers, artboardProps.clipContent, canvasWidth, canvasHeight, stageX, stageY, zoom]);

    const handleLayerSelect = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {

        // If this click was already blocked by clip bounds in mouseDown, skip
        if (clipBlocked.current) {
            clipBlocked.current = false;
            return;
        }

        let id = e.target.id();
        if (!id) return;

        // Stop propagation so stage click doesn't deselect
        e.cancelBubble = true;

        const isMulti = e.evt?.shiftKey;
        const isDeepSelect = e.evt?.metaKey || e.evt?.ctrlKey || (e.evt as any)?._isDeepSelect;

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
    }, [toggleSelection, selectLayer, layers, isClickOutsideClipBounds]);

    const handleLayerDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
        setStageDraggable(false);
        isDragging.current = true;
        let id = e.target.id();

        // Block drag if the grab point is outside a clipped parent's bounds
        // EXCEPTION: allow if the layer is already selected (Figma-like behavior)
        if (!selectedLayerIds.includes(id)) {
            const stage = e.target.getStage();
            const pointer = stage?.getPointerPosition() ?? null;
            if (isClickOutsideClipBounds(id, pointer)) {
                e.target.stopDrag();
                selectLayer(null);
                return;
            }
        }

        const isDeepSelect = e.evt?.metaKey || e.evt?.ctrlKey;

        // "Deep select" drag logic: if it's nested in a frame, and not deep-selected,
        // and not already selected, redirect drag to the parent frame
        if (!isDeepSelect && !selectedLayerIds.includes(id)) {
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
        if (!selectedLayerIds.includes(id)) {
            selectLayer(id);
        }

        // Snapshot positions of ALL selected layers (including the one being dragged if it is selected)
        // Note: selectedLayerIds from closure might be stale if we just called selectLayer?
        // Actually selectLayer triggers re-render, but this function closure 'selectedLayerIds' is from render start.
        // So if we just selected it, 'selectedLayerIds' here does NOT contain it yet.
        // We can solve this by checking if id is in selectedLayerIds. 
        // If not, we form a temporary list [id].

        const effectiveSelection = selectedLayerIds.includes(id)
            ? selectedLayerIds
            : [id];

        const locs: Record<string, { x: number; y: number }> = {};
        effectiveSelection.forEach(sid => {
            const l = layers.find(lay => lay.id === sid);
            if (l) locs[sid] = { x: l.x, y: l.y };
        });
        dragStartLocs.current = locs;

    }, [layers, selectedLayerIds, selectLayer]);

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
        const id = e.target.id();
        const startLoc = dragStartLocs.current[id];
        if (!startLoc) return;

        const stage = e.target.getStage();
        if (!stage) return;

        const { snapConfig } = useCanvasStore.getState();

        // Convert Absolute (Screen) Position to Scene Coordinates
        const absPos = e.target.getAbsolutePosition();
        const currentSceneX = (absPos.x - stage.x()) / stage.scaleX();
        const currentSceneY = (absPos.y - stage.y()) / stage.scaleY();

        let dx = currentSceneX - startLoc.x;
        let dy = currentSceneY - startLoc.y;

        // Snap Logic
        const primaryLayer = layers.find(l => l.id === id);
        if (primaryLayer) {
            const proposedX = startLoc.x + dx;
            const proposedY = startLoc.y + dy;

            const otherNodes = layers
                .filter(l => !selectedLayerIds.includes(l.id) && l.visible && !l.locked)
                .map(l => ({
                    id: l.id,
                    x: l.x,
                    y: l.y,
                    width: l.width,
                    height: l.height,
                    rotation: l.rotation
                }));

            const snapResult = computeSnap(
                {
                    id: primaryLayer.id,
                    x: proposedX,
                    y: proposedY,
                    width: primaryLayer.width,
                    height: primaryLayer.height,
                    rotation: primaryLayer.rotation
                },
                otherNodes,
                snapConfig,
                { width: canvasWidth, height: canvasHeight },
                isAltPressed.current
            );

            setSnapLines(snapResult.guides);
            setDistanceMeasurements(snapResult.distances);
            setSpacingGuides(snapResult.spacingGuides);

            if (snapResult.x !== null) {
                dx = snapResult.x - startLoc.x;
            }
            if (snapResult.y !== null) {
                dy = snapResult.y - startLoc.y;
            }
        } else {
            setSnapLines([]);
            setDistanceMeasurements([]);
            setSpacingGuides([]);
        }

        // Move other selected nodes (and self)
        Object.keys(dragStartLocs.current).forEach(sid => {
            const node = stage.findOne("#" + sid);
            if (node) {
                const sLoc = dragStartLocs.current[sid];
                const targetSceneX = sLoc.x + dx;
                const targetSceneY = sLoc.y + dy;

                const targetAbsX = targetSceneX * stage.scaleX() + stage.x();
                const targetAbsY = targetSceneY * stage.scaleY() + stage.y();

                node.setAbsolutePosition({
                    x: targetAbsX,
                    y: targetAbsY
                });
            }
        });

        const sceneWidth = e.target.width() * e.target.scaleX();
        const sceneHeight = e.target.height() * e.target.scaleY();
        const centerX = (startLoc.x + dx) + sceneWidth / 2;
        const centerY = (startLoc.y + dy) + sceneHeight / 2;

        if (Object.keys(dragStartLocs.current).length === 1) {
            const frame = getFrameAtPoint(centerX, centerY, id);
            setHighlightedFrameId(frame?.id || null);
        } else {
            setHighlightedFrameId(null);
        }
    }, [layers, selectedLayerIds, getFrameAtPoint, setHighlightedFrameId, canvasWidth, canvasHeight]);

    const handleLayerDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
        setSnapLines([]);
        setDistanceMeasurements([]);
        setSpacingGuides([]);
        setStageDraggable(true);
        isDragging.current = false;
        const id = e.target.id();
        const startLoc = dragStartLocs.current[id];
        const stage = e.target.getStage();

        if (startLoc && stage) {
            // Scene Coordinates
            const absPos = e.target.getAbsolutePosition();
            const currentSceneX = (absPos.x - stage.x()) / stage.scaleX();
            const currentSceneY = (absPos.y - stage.y()) / stage.scaleY();

            const dx = currentSceneX - startLoc.x;
            const dy = currentSceneY - startLoc.y;

            Object.keys(dragStartLocs.current).forEach(sid => {
                const sLoc = dragStartLocs.current[sid];
                if (sid === id) {
                    updateLayer(sid, { x: currentSceneX, y: currentSceneY });
                } else {
                    updateLayer(sid, { x: sLoc.x + dx, y: sLoc.y + dy });
                }
            });

            if (Object.keys(dragStartLocs.current).length === 1) {
                const sceneWidth = e.target.width() * e.target.scaleX();
                const sceneHeight = e.target.height() * e.target.scaleY();
                const centerX = currentSceneX + sceneWidth / 2;
                const centerY = currentSceneY + sceneHeight / 2;

                const frame = getFrameAtPoint(centerX, centerY, id);
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
                setHighlightedFrameId(null);
            }
        } else if (stage) {
            // Fallback
            const absPos = e.target.getAbsolutePosition();
            const currentSceneX = (absPos.x - stage.x()) / stage.scaleX();
            const currentSceneY = (absPos.y - stage.y()) / stage.scaleY();
            updateLayer(id, { x: currentSceneX, y: currentSceneY });
        }

        dragStartLocs.current = {};
    }, [updateLayer, getFrameAtPoint, moveLayerToFrame, removeLayerFromFrame, setHighlightedFrameId, layers]);

    const handleTransformEnd = useCallback((e: Konva.KonvaEventObject<Event>) => {
        isTransforming.current = false;
        setSnapLines([]);
        setDistanceMeasurements([]);
        setSpacingGuides([]);
        // Start handling multi-transform logic? 
        // Konva Transformer updates the nodes directly.
        // We just need to read their new props and update store.
        // The transformer usually fires 'transformend' on the transformer?
        // Or on the nodes? 
        // Actually, if we use Konva Transformer, it updates the nodes.
        // We need to iterate selected nodes and sync their generic props.

        // But we passed onTransformEnd to CanvasLayer.
        // Does CanvasLayer fire it?
        // 'onTransformEnd' prop on Node fires when that node is transformed.

        const node = e.target;
        const id = node.id();
        const stage = node.getStage();

        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        const rotation = node.rotation();

        // Reset scale and apply to width/height to avoid compounding scale
        node.scaleX(1);
        node.scaleY(1);

        const width = node.width() * scaleX;
        const height = node.height() * scaleY;

        let extraProps: any = {};
        const layer = layers.find(l => l.id === id);
        if (layer) {
            const hasScaledX = Math.abs(scaleX - 1) > 0.01;
            const hasScaledY = Math.abs(scaleY - 1) > 0.01;

            if (hasScaledX || hasScaledY) {
                if (layer.layoutSizingWidth === "fill" || layer.layoutSizingWidth === "hug") extraProps.layoutSizingWidth = "fixed";
                if (layer.layoutSizingHeight === "fill" || layer.layoutSizingHeight === "hug") extraProps.layoutSizingHeight = "fixed";
                
                if (layer.type === "text") {
                    const txt = layer as TextLayer;
                    if (txt.textAdjust === "auto_width") {
                         extraProps.textAdjust = "fixed";
                    } else if (txt.textAdjust === "auto_height") {
                         if (hasScaledY) extraProps.textAdjust = "fixed";
                    }
                }
            }
        }

        // Convert to absolute scene coordinates (handles frame-nested children)
        // node.x()/y() returns coords relative to parent Group, which is wrong
        // for children inside frames. Use getAbsolutePosition() instead,
        // matching the pattern in handleLayerDragEnd.
        let newX: number, newY: number;
        if (stage) {
            const absPos = node.getAbsolutePosition();
            newX = (absPos.x - stage.x()) / stage.scaleX();
            newY = (absPos.y - stage.y()) / stage.scaleY();
        } else {
            newX = node.x();
            newY = node.y();
        }

        updateLayer(id, { x: newX, y: newY, width, height, rotation, ...extraProps });

        // Handle constrained position for children if it's a non-auto-layout frame.
        // Auto-layout frames have their children positioned by applyAllAutoLayouts.
        if (layer?.type === "frame") {
            const frame = layer as FrameLayer;
            const isAutoLayout = frame.layoutMode && frame.layoutMode !== "none";
            if (!isAutoLayout) {
                const delta = {
                    oldX: layer.x, oldY: layer.y,
                    oldWidth: layer.width, oldHeight: layer.height,
                    newX, newY, newWidth: width, newHeight: height
                };
                frame.childIds.forEach(cid => {
                    const child = layers.find(l => l.id === cid);
                    if (child) {
                        const res = computeConstrainedPosition(child, delta);
                        updateLayer(cid, res);
                    }
                });
            }
        }

    }, [updateLayer, layers]);

    // ─── Live Resize Snapping ────────────────────────────
    const handleTransform = useCallback((e: Konva.KonvaEventObject<Event>) => {
        isTransforming.current = true;
        const node = e.target;
        const id = node.id();
        const stage = node.getStage();
        if (!stage) return;

        const { snapConfig } = useCanvasStore.getState();
        if (!snapConfig.objectSnap && !snapConfig.artboardSnap) return;

        // Read current transform state
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        const currentWidth = node.width() * scaleX;
        const currentHeight = node.height() * scaleY;

        // Get scene position
        const absPos = node.getAbsolutePosition();
        const currentX = (absPos.x - stage.x()) / stage.scaleX();
        const currentY = (absPos.y - stage.y()) / stage.scaleY();

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
        );

        setSnapLines(snapResult.guides);

        // Apply snapped dimensions back to the Konva node
        if (snapResult.guides.length > 0) {
            const newScaleX = snapResult.width / node.width();
            const newScaleY = snapResult.height / node.height();
            node.scaleX(newScaleX);
            node.scaleY(newScaleY);

            // Update position if left or top edges were snapped
            if (activeEdges.includes('left') || activeEdges.includes('top')) {
                const newAbsX = snapResult.x * stage.scaleX() + stage.x();
                const newAbsY = snapResult.y * stage.scaleY() + stage.y();
                node.setAbsolutePosition({ x: newAbsX, y: newAbsY });
            }
        }
    }, [layers, canvasWidth, canvasHeight]);

    const { isPanning, setIsPanning, handleWheel } = usePanZoom({
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

    /* ─── Stage Interaction ───────────────────────────── */

    const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        // If panning, let Konva handle drag (stage is draggable)
        if (isPanning) {
            if (containerRef.current) containerRef.current.style.cursor = "grabbing";
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
            const pointer = stage.getPointerPosition();
            if (pointer) {
                const canvasX = (pointer.x - stage.x()) / stage.scaleX();
                const canvasY = (pointer.y - stage.y()) / stage.scaleY();
                const targetId = target.id();

                // Skip clip-bounds check if the target is already selected
                const isAlreadySelected = targetId && selectedLayerIds.includes(targetId);

                if (!isAlreadySelected) {
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

                    if (shouldBlock) {
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
            const pointer = stage.getPointerPosition();
            if (!pointer) return;

            // Convert to Scene Coordinates for starting point
            const startSceneX = (pointer.x - stage.x()) / stage.scaleX();
            const startSceneY = (pointer.y - stage.y()) / stage.scaleY();

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
    }, [selectLayer, isEditingText, stopTextEditing, isPanning, artboardProps.clipContent, canvasWidth, canvasHeight, layers, selectedLayerIds]);

    const handleStageMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        const stage = e.target.getStage();
        if (!stage) return;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;

        const currentSceneX = (pointer.x - stage.x()) / stage.scaleX();
        const currentSceneY = (pointer.y - stage.y()) / stage.scaleY();

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
    }, [selectionBox, selectedLayerIds, layers, canvasWidth, canvasHeight]);

    const handleStageMouseUp = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        if (isPanning) {
            if (containerRef.current) containerRef.current.style.cursor = "grab";
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
    }, [selectionBox, layers, addToSelection, isPanning, artboardProps.clipContent, canvasWidth, canvasHeight]);

    const handleContextMenu = useCallback(
        (e: Konva.KonvaEventObject<MouseEvent>) => {
            e.evt.preventDefault();
            e.evt.stopPropagation();
            const stage = stageRef.current;
            if (!stage) return;
            const target = e.target;

            if (target === stage) {
                // Right-click on background with active selection:
                // Check if click falls inside the bounding box of selected layers
                if (selectedLayerIds.length > 0) {
                    const pointer = stage.getPointerPosition();
                    if (pointer) {
                        const sceneX = (pointer.x - stage.x()) / stage.scaleX();
                        const sceneY = (pointer.y - stage.y()) / stage.scaleY();

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
        [layers, selectLayer, stageRef, selectedLayerIds]
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

    /* ─── File Drag & Drop ────────────────────────────── */
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.types.includes("Files")) {
            setIsDraggingFile(true);
        }
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingFile(false);
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingFile(false);

            const files = Array.from(e.dataTransfer.files).filter((f) =>
                f.type.startsWith("image/")
            );
            for (const file of files) {
                import("@/utils/imageUpload").then(({ compressImageFile }) => {
                    compressImageFile(file).then((compressedBase64) => {
                        const img = new window.Image();
                        img.onload = () => {
                            const maxSize = 500;
                            const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                            addImageLayer(compressedBase64, img.width * scale, img.height * scale);
                        };
                        img.src = compressedBase64;
                    });
                });
            }
        },
        [addImageLayer]
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
                x: layer.x,
                y: layer.y,
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
    }, [layers, stageRef]);

    const editingLayer = useMemo(() => {
        if (!isEditingText || !editingLayerId) return undefined;
        return layers.find((l) => l.id === editingLayerId) as TextLayer | undefined;
    }, [isEditingText, editingLayerId, layers]);

    // Pre-compute top-level layers (those not inside any frame) — avoids O(n²) in render
    const topLevelLayers = useMemo(() => {
        return layers.filter((l) => !frameChildIds.has(l.id));
    }, [layers, frameChildIds]);

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 overflow-hidden bg-bg-canvas"
            style={{
                backgroundImage:
                    "radial-gradient(circle, var(--border-primary) 1px, transparent 1px)",
                backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
                backgroundPosition: `${stageX}px ${stageY}px`,
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
                scaleX={zoom}
                scaleY={zoom}
                x={stageX}
                y={stageY}
                onWheel={handleWheel}
                onMouseDown={handleStageMouseDown}
                onMouseMove={handleStageMouseMove}
                onMouseUp={handleStageMouseUp}
                onContextMenu={handleContextMenu}
                draggable={stageDraggable && !isEditingText}
                onDragMove={(e) => {
                    // Stage drag
                    // We need to differentiate stage drag from shape drag?
                    // Konva 'draggable' on stage handles it, but verify if check needed
                }}
                onDragEnd={(e) => {
                    if (e.target === e.target.getStage()) {
                        setStagePosition(e.target.x(), e.target.y());
                    }
                }}
            >
                <Layer>
                    {/* Artboard background */}
                    {artboardProps.clipContent ? (
                        <Group
                            clipX={0} clipY={0} clipWidth={canvasWidth} clipHeight={canvasHeight}
                        >
                            <Group
                                clipFunc={artboardProps.cornerRadius > 0 ? (ctx) => {
                                const r = artboardProps.cornerRadius;
                                const w = canvasWidth;
                                const h = canvasHeight;
                                ctx.beginPath();
                                ctx.moveTo(r, 0);
                                ctx.arcTo(w, 0, w, h, r);
                                ctx.arcTo(w, h, 0, h, r);
                                ctx.arcTo(0, h, 0, 0, r);
                                ctx.arcTo(0, 0, w, 0, r);
                                ctx.closePath();
                            } : undefined}
                            >
                            <Rect
                                x={0} y={0} width={canvasWidth} height={canvasHeight}
                                fill={artboardProps.fill}
                                stroke={artboardProps.stroke || undefined}
                                strokeWidth={artboardProps.strokeWidth}
                                cornerRadius={artboardProps.cornerRadius}
                                shadowColor="rgba(0,0,0,0.1)"
                                shadowBlur={20}
                                listening={false}
                            />
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
                                />
                            ))}
                            </Group>
                        </Group>
                    ) : (
                        <>
                            <Rect
                                x={0} y={0} width={canvasWidth} height={canvasHeight}
                                fill={artboardProps.fill}
                                stroke={artboardProps.stroke || undefined}
                                strokeWidth={artboardProps.strokeWidth}
                                cornerRadius={artboardProps.cornerRadius}
                                shadowColor="rgba(0,0,0,0.1)"
                                shadowBlur={20}
                                listening={false}
                            />
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
                                />
                            ))}
                        </>
                    )}

                    {/* Snap Guides, Distance Measurements, Spacing Guides, Selection Box */}
                    <SnapGuides
                        snapLines={snapLines}
                        distanceMeasurements={distanceMeasurements}
                        spacingGuides={spacingGuides}
                        selectionBox={selectionBox}
                    />

                    {/* Selection Transformer */}
                    <SelectionTransformer selectedLayerIds={selectedLayerIds} stageRef={stageRef} excludeIds={frameChildIds} />

                </Layer>
            </Stage>

            {/* Overlays */}
            {editingLayer && (
                <InlineTextEditor
                    layer={editingLayer}
                    stageRef={stageRef}
                    zoom={zoom}
                    stageX={stageX}
                    stageY={stageY}
                    onCommit={handleTextEditCommit}
                    onUpdate={handleTextEditUpdate}
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
                            }
                        )}
                    />
                );
            })()}

        </div>
    );
}
