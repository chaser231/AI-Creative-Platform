"use client";

import { useRef, useCallback, useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { Stage, Layer, Rect, Text, Image as KonvaImage, Transformer, Group, Line } from "react-konva";
import { useCanvasStore, computeConstrainedPosition } from "@/store/canvasStore";
import type { Layer as LayerType, TextLayer, BadgeLayer, FrameLayer } from "@/types";
import { ContextMenu, buildLayerContextMenuItems } from "./ContextMenu";
import { getSnapLines, SnapResult } from "@/services/snapService";
import Konva from "konva";

/* ─── Constants ───────────────────────────────────── */
const FRAME_HIGHLIGHT_STROKE = "#6366F1";
const FRAME_HIGHLIGHT_WIDTH = 2;

function useImage(src: string): HTMLImageElement | undefined {
    const [loadedImg, setLoadedImg] = useState<HTMLImageElement | undefined>(undefined);
    useEffect(() => {
        if (!src) return;
        const img = new window.Image();
        img.crossOrigin = "anonymous";
        img.src = src;
        img.onload = () => {
            setLoadedImg(img);
        };
    }, [src]);
    return loadedImg;
}

/* ─── Selection Transformer ───────────────────────── */
interface SelectionTransformerProps {
    selectedLayerIds: string[];
    stageRef: React.RefObject<Konva.Stage | null>;
}

function SelectionTransformer({ selectedLayerIds, stageRef }: SelectionTransformerProps) {
    const trRef = useRef<Konva.Transformer>(null);

    useEffect(() => {
        if (!trRef.current || !stageRef.current) return;

        // Find all selected nodes
        const nodes = selectedLayerIds
            .map((id) => stageRef.current?.findOne("#" + id))
            .filter((node): node is Konva.Node => !!node);

        trRef.current.nodes(nodes);
        trRef.current.getLayer()?.batchDraw();
    }, [selectedLayerIds, stageRef]);

    return (
        <Transformer
            ref={trRef}
            boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 5 || newBox.height < 5) return oldBox;
                return newBox;
            }}
            borderStroke="#6366F1"
            anchorStroke="#6366F1"
            anchorFill="#FFFFFF"
            anchorSize={8}
            anchorCornerRadius={2}
        />
    );
}

/* ─── Canvas Layer ────────────────────────────────── */
interface CanvasLayerProps {
    layer: LayerType;
    isSelected: boolean;
    onSelect: (e: Konva.KonvaEventObject<any>) => void;
    onDragStart: (e: Konva.KonvaEventObject<any>) => void;
    onDragMove: (e: Konva.KonvaEventObject<any>) => void;
    onDragEnd: (e: Konva.KonvaEventObject<any>) => void;
    onTransformEnd: (e: Konva.KonvaEventObject<any>) => void;
    onDblClickText: (layer: LayerType & { type: "text" }, node: Konva.Text) => void;
    isEditing: boolean;
}

function CanvasLayer({
    layer,
    isSelected,
    onSelect,
    onDragStart,
    onDragMove,
    onDragEnd,
    onTransformEnd,
    onDblClickText,
    isEditing,
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
        draggable: !layer.locked && !isEditing,
        onClick: onSelect,
        onTap: onSelect,
        onDragStart,
        onDragMove,
        onDragEnd,
        onTransformEnd,
    };

    return (
        <>
            {layer.type === "rectangle" && (
                <Rect
                    ref={shapeRef as React.RefObject<Konva.Rect | null>}
                    {...commonProps}
                    fill={layer.fill}
                    stroke={layer.stroke || undefined}
                    strokeWidth={layer.strokeWidth}
                    cornerRadius={layer.cornerRadius}
                />
            )}
            {layer.type === "text" && !isEditing && (
                <Text
                    ref={shapeRef as React.RefObject<Konva.Text | null>}
                    {...commonProps}
                    text={layer.text}
                    fontSize={layer.fontSize}
                    fontFamily={layer.fontFamily}
                    fontStyle={layer.fontWeight === "700" || layer.fontWeight === "bold" ? "bold" : layer.fontWeight === "600" ? "600" : "normal"}
                    fill={layer.fill}
                    align={layer.align}
                    letterSpacing={layer.letterSpacing}
                    lineHeight={layer.lineHeight}
                    wrap="word"
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
    return (
        <KonvaImage
            ref={shapeRef as React.RefObject<Konva.Image | null>}
            {...commonProps}
            image={image}
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
                fill={layer.fill}
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
    onSelect: (e: Konva.KonvaEventObject<any>) => void;
    onDragStart: (e: Konva.KonvaEventObject<any>) => void;
    onDragMove: (e: Konva.KonvaEventObject<any>) => void;
    onDragEnd: (e: Konva.KonvaEventObject<any>) => void;
    onTransformEnd: (e: Konva.KonvaEventObject<any>) => void;
    onDblClickText: (layer: LayerType & { type: "text" }, node: Konva.Text) => void;
    isEditing: boolean;
}) {
    const layers = useCanvasStore((s) => s.layers);
    const selectedLayerIds = useCanvasStore((s) => s.selectedLayerIds);
    const highlightedFrameId = useCanvasStore((s) => s.highlightedFrameId);
    const childLayers = layer.childIds
        .map((id) => layers.find((l) => l.id === id))
        .filter(Boolean) as LayerType[];

    const isHighlighted = highlightedFrameId === layer.id;

    return (
        <Group
            ref={groupRef}
            {...commonProps}
        >
            <Group
                clipFunc={layer.clipContent ? (ctx) => {
                    if (layer.cornerRadius > 0) {
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
                    } else {
                        ctx.rect(0, 0, layer.width, layer.height);
                    }
                } : undefined}
            >
                <Rect
                    id={layer.id}
                    width={layer.width}
                    height={layer.height}
                    fill={layer.fill || undefined}
                    stroke={isHighlighted ? FRAME_HIGHLIGHT_STROKE : (layer.stroke || undefined)}
                    strokeWidth={isHighlighted ? FRAME_HIGHLIGHT_WIDTH : layer.strokeWidth}
                    cornerRadius={layer.cornerRadius}
                />
                {childLayers.map((child) => (
                    <CanvasLayer
                        key={child.id}
                        layer={{ ...child, x: child.x - layer.x, y: child.y - layer.y }}
                        isSelected={selectedLayerIds.includes(child.id)}
                        onSelect={onSelect}
                        onDragStart={onDragStart}
                        onDragMove={onDragMove}
                        onDragEnd={onDragEnd}
                        onTransformEnd={onTransformEnd}
                        onDblClickText={onDblClickText}
                        isEditing={false}
                    />
                ))}
            </Group>
        </Group>
    );
}
// Skip InlineTextEditor...

/* ─── Inline text editing overlay ──────────────────── */
function InlineTextEditor({
    layer,
    stageRef,
    zoom,
    stageX,
    stageY,
    onCommit,
}: {
    layer: TextLayer;
    stageRef: React.RefObject<Konva.Stage | null>;
    zoom: number;
    stageX: number;
    stageY: number;
    onCommit: (text: string) => void;
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [value, setValue] = useState(layer.text);

    // Calculate the screen position of the text layer
    const screenX = layer.x * zoom + stageX;
    const screenY = layer.y * zoom + stageY;
    const screenW = layer.width * zoom;
    const screenH = Math.max(layer.height * zoom, 40);

    useEffect(() => {
        const ta = textareaRef.current;
        if (ta) {
            ta.focus();
            ta.select();
        }
    }, []);

    const handleCommit = () => {
        onCommit(value);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            onCommit(layer.text);
        }
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleCommit();
        }
    };

    const fontSizeScaled = layer.fontSize * zoom;

    return (
        <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleCommit}
            onKeyDown={handleKeyDown}
            style={{
                position: "absolute",
                left: screenX,
                top: screenY,
                width: screenW,
                minHeight: screenH,
                fontSize: fontSizeScaled,
                fontFamily: layer.fontFamily,
                fontWeight: layer.fontWeight,
                color: layer.fill,
                textAlign: layer.align,
                letterSpacing: layer.letterSpacing * zoom,
                lineHeight: layer.lineHeight,
                border: "2px solid var(--accent-primary)",
                borderRadius: "var(--radius-sm)",
                background: "rgba(255,255,255,0.95)",
                padding: "2px 4px",
                margin: 0,
                outline: "none",
                resize: "none",
                overflow: "hidden",
                zIndex: 50,
                transformOrigin: "top left",
                transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
                boxShadow: "0 0 0 3px rgba(99, 102, 241, 0.2)",
            }}
        />
    );
}
/* ─── Main Canvas component ───────────────────────── */

interface CanvasProps {
    stageRef: React.RefObject<Konva.Stage | null>;
}

export function Canvas({ stageRef }: CanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [stageDraggable, setStageDraggable] = useState(true);
    const [isDraggingFile, setIsDraggingFile] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; layerId: string } | null>(null);

    // Marquee State
    const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number; startX: number; startY: number } | null>(null);

    // Snap Guides State
    const [snapLines, setSnapLines] = useState<SnapResult['guides']>([]);

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
    } = useCanvasStore();

    /* ─── Layer Interactions ──────────────────────────── */

    const handleLayerSelect = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        // Stop propagation so stage click doesn't deselect
        e.cancelBubble = true;

        const id = e.target.id();
        if (!id) return;

        const isMulti = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;

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
    }, [toggleSelection, selectLayer]);

    const handleLayerDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
        setStageDraggable(false);
        const id = e.target.id();

        // If dragging an item that is NOT selected, select it (exclusive)
        if (!selectedLayerIds.includes(id)) {
            selectLayer(id);
            // And update ref immediately? The store update might be async or ref access safe?
            // Store update triggers re-render. But drag continues.
            // We'll assume for this drag session, we only move THIS layer if it wasn't selected.
            // But simpler: just force select it. 
            // Ideally we want to move it. Konva allows dragging unselected nodes.
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

    const handleLayerDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
        const id = e.target.id();
        const startLoc = dragStartLocs.current[id];
        if (!startLoc) return;

        const stage = e.target.getStage();
        if (!stage) return;

        // Convert Absolute (Screen) Position to Scene Coordinates
        const absPos = e.target.getAbsolutePosition();
        const currentSceneX = (absPos.x - stage.x()) / stage.scaleX();
        const currentSceneY = (absPos.y - stage.y()) / stage.scaleY();

        let dx = currentSceneX - startLoc.x;
        let dy = currentSceneY - startLoc.y;

        // Snap Logic (only for single selection drag for now for simplicity, or primary node)
        // We snap the node that is being dragged (e.target).
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

            const snapResult = getSnapLines(
                {
                    id: primaryLayer.id,
                    x: proposedX,
                    y: proposedY,
                    width: primaryLayer.width,
                    height: primaryLayer.height,
                    rotation: primaryLayer.rotation
                },
                otherNodes
            );

            setSnapLines(snapResult.guides);

            if (snapResult.x !== null) {
                dx = snapResult.x - startLoc.x;
            }
            if (snapResult.y !== null) {
                dy = snapResult.y - startLoc.y;
            }
        } else {
            setSnapLines([]);
        }

        // Move other selected nodes (and self)
        Object.keys(dragStartLocs.current).forEach(sid => {
            const node = stage.findOne("#" + sid);
            if (node) {
                const sLoc = dragStartLocs.current[sid];
                // Calculate target Scene Position
                const targetSceneX = sLoc.x + dx;
                const targetSceneY = sLoc.y + dy;

                // Convert back to Absolute for Konva update
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
    }, [layers, selectedLayerIds, getFrameAtPoint, setHighlightedFrameId]);

    const handleLayerDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
        setSnapLines([]);
        setStageDraggable(true);
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
                    moveLayerToFrame(id, frame.id);
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
    }, [updateLayer, getFrameAtPoint, moveLayerToFrame, setHighlightedFrameId]);

    const handleTransformEnd = useCallback((e: Konva.KonvaEventObject<Event>) => {
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

        // Read new props
        const newX = node.x();
        const newY = node.y();
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        const rotation = node.rotation();

        // Reset scale and apply to width/height to avoid compounding scale
        node.scaleX(1);
        node.scaleY(1);

        const width = node.width() * scaleX;
        const height = node.height() * scaleY;

        updateLayer(id, { x: newX, y: newY, width, height, rotation });

        // Handle constrained position for children if it's a frame
        // (Similar to previous implementation)
        const layer = layers.find(l => l.id === id);
        if (layer?.type === "frame") {
            const frame = layer as FrameLayer;
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

    }, [updateLayer, layers]);

    /* ─── Stage Interaction ───────────────────────────── */

    const handleWheel = useCallback(
        (e: Konva.KonvaEventObject<WheelEvent>) => {
            e.evt.preventDefault();
            const stage = stageRef.current;
            if (!stage) return;

            const oldScale = zoom;
            const pointer = stage.getPointerPosition();
            if (!pointer) return;

            const scaleBy = 1.05;
            const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
            const clampedScale = Math.min(Math.max(newScale, 0.1), 3);

            const mousePointTo = {
                x: (pointer.x - stageX) / oldScale,
                y: (pointer.y - stageY) / oldScale,
            };

            setZoom(clampedScale);
            setStagePosition(
                pointer.x - mousePointTo.x * clampedScale,
                pointer.y - mousePointTo.y * clampedScale
            );
        },
        [zoom, stageX, stageY, setZoom, setStagePosition, stageRef]
    );

    const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        // If clicked on stage (background)
        if (e.target === e.target.getStage()) {
            const stage = e.target.getStage();
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
    }, [selectLayer, isEditingText, stopTextEditing]);

    const handleStageMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        if (!selectionBox) return;

        const stage = e.target.getStage();
        if (!stage) return;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;

        const currentSceneX = (pointer.x - stage.x()) / stage.scaleX();
        const currentSceneY = (pointer.y - stage.y()) / stage.scaleY();

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
    }, [selectionBox]);

    const handleStageMouseUp = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        setStageDraggable(true);
        if (selectionBox) {
            // Calculate intersection
            const box = selectionBox;
            // Filter layers that intersect
            const intersectedIds = layers.filter(l => {
                if (!l.visible || l.locked) return false;
                // Simple AABB intersection
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
    }, [selectionBox, layers, addToSelection]);

    const handleContextMenu = useCallback(
        (e: Konva.KonvaEventObject<MouseEvent>) => {
            e.evt.preventDefault();
            e.evt.stopPropagation();
            const stage = stageRef.current;
            if (!stage) return;
            const target = e.target;

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

            // Should we select the right-clicked layer?
            // If it's not already in selection, yes.
            // If it IS in selection, keep selection?
            if (!selectedLayerIds.includes(matchedLayer.id)) {
                selectLayer(matchedLayer.id);
            }

            setContextMenu({
                x: e.evt.clientX,
                y: e.evt.clientY,
                layerId: matchedLayer.id,
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
                const reader = new FileReader();
                reader.onload = () => {
                    const img = new window.Image();
                    img.onload = () => {
                        const maxSize = 500;
                        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                        addImageLayer(reader.result as string, img.width * scale, img.height * scale);
                    };
                    img.src = reader.result as string;
                };
                reader.readAsDataURL(file);
            }
        },
        [addImageLayer]
    );

    const editingLayer = isEditingText && editingLayerId
        ? (layers.find((l) => l.id === editingLayerId) as TextLayer | undefined)
        : undefined;

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
                width={containerRef.current?.clientWidth || 1200}
                height={containerRef.current?.clientHeight || 800}
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
                        <Group clipFunc={(ctx) => {
                            if (artboardProps.cornerRadius > 0) {
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
                            } else {
                                ctx.rect(0, 0, canvasWidth, canvasHeight);
                            }
                        }}>
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
                            {layers.filter(l => !layers.some(p => p.type === 'frame' && (p as FrameLayer).childIds.includes(l.id))).map(layer => (
                                <CanvasLayer
                                    key={layer.id}
                                    layer={layer}
                                    isSelected={selectedLayerIds.includes(layer.id)}
                                    onSelect={handleLayerSelect}
                                    onDragStart={handleLayerDragStart}
                                    onDragMove={handleLayerDragMove}
                                    onDragEnd={handleLayerDragEnd}
                                    onTransformEnd={handleTransformEnd}
                                    onDblClickText={handleDblClickText}
                                    isEditing={isEditingText && editingLayerId === layer.id}
                                />
                            ))}
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
                            {layers.filter(l => !layers.some(p => p.type === 'frame' && (p as FrameLayer).childIds.includes(l.id))).map(layer => (
                                <CanvasLayer
                                    key={layer.id}
                                    layer={layer}
                                    isSelected={selectedLayerIds.includes(layer.id)}
                                    onSelect={handleLayerSelect}
                                    onDragStart={handleLayerDragStart}
                                    onDragMove={handleLayerDragMove}
                                    onDragEnd={handleLayerDragEnd}
                                    onTransformEnd={handleTransformEnd}
                                    onDblClickText={handleDblClickText}
                                    isEditing={isEditingText && editingLayerId === layer.id}
                                />
                            ))}
                        </>
                    )}

                    {/* Snap Guides */}
                    {snapLines.map((guide, i) => (
                        <Line
                            key={i}
                            points={
                                guide.orientation === 'vertical'
                                    ? [guide.position, guide.start, guide.position, guide.end]
                                    : [guide.start, guide.position, guide.end, guide.position]
                            }
                            stroke="#ff0000"
                            strokeWidth={1}
                            dash={[4, 4]}
                            listening={false}
                        />
                    ))}

                    {/* Selection Box */}
                    {selectionBox && (
                        <Rect
                            x={selectionBox.x}
                            y={selectionBox.y}
                            width={selectionBox.width}
                            height={selectionBox.height}
                            fill="rgba(99, 102, 241, 0.2)"
                            stroke="#6366F1"
                            strokeWidth={1}
                            listening={false}
                        />
                    )}

                    {/* Selection Transformer */}
                    <SelectionTransformer selectedLayerIds={selectedLayerIds} stageRef={stageRef} />

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
                const layer = layers.find((l) => l.id === contextMenu.layerId);
                if (!layer) return null;
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
                            }
                        )}
                    />
                );
            })()}

        </div>
    );
}
