"use client";

import { useRef, useCallback, useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { Stage, Layer, Rect, Text, Image as KonvaImage, Transformer, Group } from "react-konva";
import { useCanvasStore, computeConstrainedPosition } from "@/store/canvasStore";
import type { Layer as LayerType, TextLayer, BadgeLayer, FrameLayer } from "@/types";
import { ContextMenu, buildLayerContextMenuItems } from "./ContextMenu";
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

interface CanvasLayerProps {
    layer: LayerType;
    isSelected: boolean;
    onSelect: () => void;
    onChange: (updates: Partial<LayerType>) => void;
    onDragStateChange: (dragging: boolean) => void;
    onDblClickText: (layer: LayerType & { type: "text" }, node: Konva.Text) => void;
    isEditing: boolean;
}

function CanvasLayer({ layer, isSelected, onSelect, onChange, onDragStateChange, onDblClickText, isEditing }: CanvasLayerProps) {
    const shapeRef = useRef<Konva.Shape>(null);
    const groupRef = useRef<Konva.Group>(null);
    const transformerRef = useRef<Konva.Transformer>(null);

    useEffect(() => {
        if (isSelected && !isEditing && transformerRef.current) {
            const targetNode = (layer.type === "badge" || layer.type === "frame") ? groupRef.current : shapeRef.current;
            if (targetNode) {
                transformerRef.current.nodes([targetNode]);
                transformerRef.current.getLayer()?.batchDraw();
            }
        }
    }, [isSelected, layer.type, isEditing]);

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
        onDragStart: () => {
            onDragStateChange(true);
        },
        onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
            onDragStateChange(false);
            const newX = e.target.x();
            const newY = e.target.y();

            // If this is a frame, move all children by the same delta
            if (layer.type === "frame") {
                const dx = newX - layer.x;
                const dy = newY - layer.y;
                const frame = layer as FrameLayer;
                const store = useCanvasStore.getState();
                frame.childIds.forEach((childId) => {
                    const child = store.layers.find((l) => l.id === childId);
                    if (child) store.updateLayer(childId, { x: child.x + dx, y: child.y + dy });
                });
            }

            onChange({ x: newX, y: newY });

            // Drag-to-frame: check if this layer landed on a frame
            // Skip for layers already inside a frame — they use local coords
            // so hit-testing would produce wrong results. Use layers panel to un-nest.
            if (layer.type !== "frame") {
                const store = useCanvasStore.getState();
                const isChildOfFrame = store.layers.some(
                    (l) => l.type === "frame" && (l as FrameLayer).childIds.includes(layer.id)
                );
                if (!isChildOfFrame) {
                    const centerX = newX + layer.width / 2;
                    const centerY = newY + layer.height / 2;
                    const targetFrame = store.getFrameAtPoint(centerX, centerY, layer.id);

                    if (targetFrame) {
                        store.moveLayerToFrame(layer.id, targetFrame.id);
                    }
                    store.setHighlightedFrameId(null);
                }
            }
        },
        onTransformEnd: () => {
            const node = (layer.type === "badge" || layer.type === "frame") ? groupRef.current : shapeRef.current;
            if (!node) return;
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            node.scaleX(1);
            node.scaleY(1);

            const newX = node.x();
            const newY = node.y();
            const newWidth = Math.max(5, node.width() * scaleX);
            const newHeight = Math.max(5, node.height() * scaleY);

            // If this is a frame, apply constraints to children
            if (layer.type === "frame") {
                const frame = layer as FrameLayer;
                const store = useCanvasStore.getState();
                const delta = {
                    oldX: layer.x, oldY: layer.y,
                    oldWidth: layer.width, oldHeight: layer.height,
                    newX, newY, newWidth, newHeight,
                };
                frame.childIds.forEach((childId) => {
                    const child = store.layers.find((l) => l.id === childId);
                    if (child) {
                        const result = computeConstrainedPosition(child, delta);
                        store.updateLayer(childId, result);
                    }
                });
            }

            onChange({ x: newX, y: newY, width: newWidth, height: newHeight, rotation: node.rotation() });
        },
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
                    onChange={onChange}
                    onDragStateChange={onDragStateChange}
                    onDblClickText={onDblClickText}
                    isEditing={isEditing}
                />
            )}
            {isSelected && !isEditing && (
                <Transformer
                    ref={transformerRef as React.RefObject<Konva.Transformer | null>}
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
            )}
        </>
    );
}

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
            x={layer.x}
            y={layer.y}
            width={layer.width}
            height={layer.height}
            rotation={layer.rotation}
            draggable={!layer.locked}
            onClick={commonProps.onClick as () => void}
            onTap={commonProps.onTap as () => void}
            onDragStart={commonProps.onDragStart as () => void}
            onDragEnd={commonProps.onDragEnd as (e: Konva.KonvaEventObject<DragEvent>) => void}
            onTransformEnd={commonProps.onTransformEnd as () => void}
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
    onChange,
    onDragStateChange,
    onDblClickText,
    isEditing,
}: {
    groupRef: React.RefObject<Konva.Group | null>;
    layer: FrameLayer;
    commonProps: Record<string, unknown>;
    isSelected: boolean;
    onSelect: () => void;
    onChange: (updates: Partial<LayerType>) => void;
    onDragStateChange: (dragging: boolean) => void;
    onDblClickText: (layer: LayerType & { type: "text" }, node: Konva.Text) => void;
    isEditing: boolean;
}) {
    const layers = useCanvasStore((s) => s.layers);
    const selectedLayerId = useCanvasStore((s) => s.selectedLayerId);
    const highlightedFrameId = useCanvasStore((s) => s.highlightedFrameId);
    const childLayers = layer.childIds
        .map((id) => layers.find((l) => l.id === id))
        .filter(Boolean) as LayerType[];

    const isHighlighted = highlightedFrameId === layer.id;

    return (
        <Group
            ref={groupRef}
            x={layer.x}
            y={layer.y}
            width={layer.width}
            height={layer.height}
            rotation={layer.rotation}
            draggable={!layer.locked && !isEditing}
            onClick={commonProps.onClick as () => void}
            onTap={commonProps.onTap as () => void}
            onDragStart={(e: Konva.KonvaEventObject<DragEvent>) => {
                // Guard: ignore events bubbled from children
                if (e.target !== groupRef.current) return;
                (commonProps.onDragStart as () => void)();
            }}
            onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                // Guard: ignore events bubbled from children
                if (e.target !== groupRef.current) return;
                (commonProps.onDragEnd as (e: Konva.KonvaEventObject<DragEvent>) => void)(e);
            }}
            onTransformEnd={(e: Konva.KonvaEventObject<Event>) => {
                // Guard: ignore events bubbled from children
                if (e.target !== groupRef.current) return;
                (commonProps.onTransformEnd as () => void)();
            }}
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
            {/* Frame background */}
            <Rect
                width={layer.width}
                height={layer.height}
                fill={layer.fill || undefined}
                stroke={isHighlighted ? FRAME_HIGHLIGHT_STROKE : (layer.stroke || undefined)}
                strokeWidth={isHighlighted ? FRAME_HIGHLIGHT_WIDTH : layer.strokeWidth}
                cornerRadius={layer.cornerRadius}
            />
            {/* Child layers — rendered relative to frame */}
            {childLayers.map((child) => (
                <CanvasLayer
                    key={child.id}
                    layer={{ ...child, x: child.x - layer.x, y: child.y - layer.y }}
                    isSelected={selectedLayerId === child.id}
                    onSelect={() => useCanvasStore.getState().selectLayer(child.id)}
                    onChange={(updates) => {
                        // Convert local (frame-relative) coordinates back to absolute
                        const absoluteUpdates = { ...updates };
                        if ('x' in updates && typeof updates.x === 'number') {
                            absoluteUpdates.x = updates.x + layer.x;
                        }
                        if ('y' in updates && typeof updates.y === 'number') {
                            absoluteUpdates.y = updates.y + layer.y;
                        }
                        useCanvasStore.getState().updateLayer(child.id, absoluteUpdates);
                    }}
                    onDragStateChange={onDragStateChange}
                    onDblClickText={onDblClickText}
                    isEditing={false}
                />
            ))}
        </Group>
    );
}

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
        // Focus & select all on mount
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
            onCommit(layer.text); // Revert on escape
        }
        // Enter without shift = commit
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
    const {
        layers,
        selectedLayerId,
        selectLayer,
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
    } = useCanvasStore();

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

    const handleStageClick = useCallback(
        (e: Konva.KonvaEventObject<MouseEvent>) => {
            if (e.target === e.target.getStage()) {
                selectLayer(null);
                setContextMenu(null);
                if (isEditingText) {
                    stopTextEditing();
                }
            }
        },
        [selectLayer, isEditingText, stopTextEditing]
    );

    /* ─── Context menu handler ────────────────────────── */
    const handleContextMenu = useCallback(
        (e: Konva.KonvaEventObject<MouseEvent>) => {
            e.evt.preventDefault();
            e.evt.stopPropagation();
            const stage = stageRef.current;
            if (!stage) return;
            const target = e.target;
            // If right-clicking on stage background, close menu
            if (target === stage) {
                setContextMenu(null);
                return;
            }
            // Walk up the node tree to find a matching layer by id
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
            selectLayer(matchedLayer.id);
            setContextMenu({
                x: e.evt.clientX,
                y: e.evt.clientY,
                layerId: matchedLayer.id,
            });
        },
        [layers, selectLayer, stageRef]
    );

    const handleStageTap = useCallback(
        (e: Konva.KonvaEventObject<TouchEvent>) => {
            if (e.target === e.target.getStage()) {
                selectLayer(null);
                if (isEditingText) {
                    stopTextEditing();
                }
            }
        },
        [selectLayer, isEditingText, stopTextEditing]
    );

    const handleShapeDragStateChange = useCallback((dragging: boolean) => {
        setStageDraggable(!dragging);
    }, []);

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

    /* ─── Drag-move frame highlight ───────────────────── */
    const handleDragMove = useCallback(
        (e: Konva.KonvaEventObject<DragEvent>) => {
            const target = e.target;
            // Only highlight for non-frame layers being dragged at top level
            const stage = target.getStage();
            if (!stage || target === stage) return;

            // Find the layer being dragged
            const draggedLayer = layers.find((l) => {
                // Match by position — Konva node id may not match our id
                return l.x === target.x() && l.y === target.y();
            });
            if (draggedLayer?.type === "frame") {
                setHighlightedFrameId(null);
                return;
            }

            // Skip highlight for layers already inside a frame (local coords)
            const isChildOfFrame = draggedLayer && layers.some(
                (l) => l.type === "frame" && (l as FrameLayer).childIds.includes(draggedLayer.id)
            );
            if (isChildOfFrame) {
                setHighlightedFrameId(null);
                return;
            }

            const centerX = target.x() + target.width() / 2;
            const centerY = target.y() + target.height() / 2;
            const frame = getFrameAtPoint(centerX, centerY, draggedLayer?.id);
            setHighlightedFrameId(frame?.id || null);
        },
        [layers, setHighlightedFrameId, getFrameAtPoint]
    );

    const editingLayer = isEditingText && editingLayerId
        ? (layers.find((l) => l.id === editingLayerId) as TextLayer | undefined)
        : undefined;

    /* ─── File drag-and-drop ─────────────────────────── */

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
                onClick={handleStageClick}
                onTap={handleStageTap}
                onContextMenu={handleContextMenu}
                draggable={stageDraggable && !isEditingText}
                onDragMove={handleDragMove}
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
                            clipFunc={(ctx) => {
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
                            }}
                        >
                            <Rect
                                x={0}
                                y={0}
                                width={canvasWidth}
                                height={canvasHeight}
                                fill={artboardProps.fill}
                                stroke={artboardProps.stroke || undefined}
                                strokeWidth={artboardProps.strokeWidth}
                                cornerRadius={artboardProps.cornerRadius}
                                shadowColor="rgba(0,0,0,0.1)"
                                shadowBlur={20}
                                shadowOffsetX={0}
                                shadowOffsetY={4}
                                listening={false}
                            />

                            {/* Layers — clipped to artboard */}
                            {layers
                                .filter((layer) => {
                                    return !layers.some(
                                        (l) => l.type === "frame" && (l as FrameLayer).childIds.includes(layer.id)
                                    );
                                })
                                .map((layer) => (
                                    <CanvasLayer
                                        key={layer.id}
                                        layer={layer}
                                        isSelected={selectedLayerId === layer.id}
                                        onSelect={() => selectLayer(layer.id)}
                                        onChange={(updates) => updateLayer(layer.id, updates)}
                                        onDragStateChange={handleShapeDragStateChange}
                                        onDblClickText={handleDblClickText}
                                        isEditing={isEditingText && editingLayerId === layer.id}
                                    />
                                ))}
                        </Group>
                    ) : (
                        <>
                            <Rect
                                x={0}
                                y={0}
                                width={canvasWidth}
                                height={canvasHeight}
                                fill={artboardProps.fill}
                                stroke={artboardProps.stroke || undefined}
                                strokeWidth={artboardProps.strokeWidth}
                                cornerRadius={artboardProps.cornerRadius}
                                shadowColor="rgba(0,0,0,0.1)"
                                shadowBlur={20}
                                shadowOffsetX={0}
                                shadowOffsetY={4}
                                listening={false}
                            />

                            {/* Layers — no clipping */}
                            {layers
                                .filter((layer) => {
                                    return !layers.some(
                                        (l) => l.type === "frame" && (l as FrameLayer).childIds.includes(layer.id)
                                    );
                                })
                                .map((layer) => (
                                    <CanvasLayer
                                        key={layer.id}
                                        layer={layer}
                                        isSelected={selectedLayerId === layer.id}
                                        onSelect={() => selectLayer(layer.id)}
                                        onChange={(updates) => updateLayer(layer.id, updates)}
                                        onDragStateChange={handleShapeDragStateChange}
                                        onDblClickText={handleDblClickText}
                                        isEditing={isEditingText && editingLayerId === layer.id}
                                    />
                                ))}
                        </>
                    )}
                </Layer>
            </Stage>

            {/* Inline text editor overlay */}
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

            {/* Zoom + format indicator */}
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
            {/* Drop zone overlay */}
            {isDraggingFile && (
                <div className="absolute inset-4 border-2 border-dashed border-accent-primary rounded-2xl bg-accent-primary/5 flex items-center justify-center z-40 pointer-events-none">
                    <div className="flex flex-col items-center gap-2 text-accent-primary">
                        <ImageIcon size={32} />
                        <span className="text-sm font-medium">Перетащите изображение сюда</span>
                    </div>
                </div>
            )}

            {/* Context menu */}
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
