"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect, Text, Image as KonvaImage, Group } from "react-konva";
import type { FrameLayer, ImageLayer, Layer as LayerType } from "@/types";
import { computeImageFitProps } from "@/utils/imageFitUtils";
import { paintToKonvaProps } from "@/utils/paint";
import Konva from "konva";

type ImageLoadStatus = "loading" | "loaded" | "error";

interface PreviewLayerProps {
    layer: LayerType;
    allLayers: LayerType[];
    loadedImages: Map<string, HTMLImageElement>;
    imageStatuses: Record<string, ImageLoadStatus>;
    renderX?: number;
    renderY?: number;
}

function PreviewLayer({ layer, allLayers, loadedImages, imageStatuses, renderX, renderY }: PreviewLayerProps) {
    if (layer.visible === false) return null;

    const commonProps = {
        id: layer.id,
        x: renderX ?? layer.x,
        y: renderY ?? layer.y,
        width: layer.width,
        height: layer.height,
        rotation: layer.rotation,
        opacity: layer.opacity ?? 1,
        name: layer.id, // For easy finding
    };

    switch (layer.type) {
        case "rectangle":
            return (
                <Rect
                    {...commonProps}
                    {...(layer.fillEnabled === false
                        ? { fill: "transparent", fillPriority: "color" }
                        : paintToKonvaProps(layer.fill, layer.width, layer.height))}
                    stroke={layer.strokeEnabled === false ? undefined : (layer.stroke || undefined)}
                    strokeWidth={layer.strokeEnabled === false ? 0 : layer.strokeWidth}
                    cornerRadius={layer.cornerRadius}
                />
            );
        case "text":
            return (
                <Text
                    {...commonProps}
                    width={layer.textAdjust === "auto_width" ? undefined : layer.width}
                    height={layer.textAdjust === "auto_width" || layer.textAdjust === "auto_height" ? undefined : layer.height}
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
                    ellipsis={layer.textAdjust === "fixed" ? (layer.truncateText || false) : false}
                />
            );
        case "image":
            const img = loadedImages.get(layer.src);
            const imageStatus = imageStatuses[layer.src] ?? "loading";

            if (!img) {
                return (
                    <Group {...commonProps}>
                        <Rect
                            width={layer.width}
                            height={layer.height}
                            fill={imageStatus === "error" ? "#FEE2E2" : "#F3F4F6"}
                            stroke={imageStatus === "error" ? "#EF4444" : "#D1D5DB"}
                            dash={[6, 4]}
                            cornerRadius={8}
                        />
                        <Text
                            width={layer.width}
                            height={layer.height}
                            text={imageStatus === "error" ? "Ошибка загрузки" : "Изображение загружается"}
                            fontSize={Math.max(12, Math.min(layer.width / 10, 18))}
                            fontFamily="Inter"
                            fill={imageStatus === "error" ? "#B91C1C" : "#6B7280"}
                            align="center"
                            verticalAlign="middle"
                        />
                    </Group>
                );
            }

            const fitMode = layer.objectFit || "cover";
            const nw = img.naturalWidth || img.width;
            const nh = img.naturalHeight || img.height;
            const fit = computeImageFitProps(fitMode, nw, nh, layer.width, layer.height, {
                focusX: layer.focusX,
                focusY: layer.focusY,
            });

            if (fitMode === "contain" || fitMode === "crop") {
                return (
                    <Group
                        {...commonProps}
                        clipFunc={(ctx) => {
                            ctx.rect(0, 0, layer.width, layer.height);
                        }}
                    >
                        <KonvaImage
                            image={img}
                            x={fit.drawX}
                            y={fit.drawY}
                            width={fit.drawWidth}
                            height={fit.drawHeight}
                            crop={{ x: fit.cropX, y: fit.cropY, width: fit.cropWidth, height: fit.cropHeight }}
                        />
                    </Group>
                );
            }

            return (
                <KonvaImage
                    {...commonProps}
                    image={img}
                    crop={{ x: fit.cropX, y: fit.cropY, width: fit.cropWidth, height: fit.cropHeight }}
                />
            );
        case "badge":
            return (
                <Group {...commonProps}>
                    <Rect
                        width={layer.width}
                        height={layer.height}
                        {...(layer.fillEnabled === false
                            ? { fill: "transparent", fillPriority: "color" }
                            : paintToKonvaProps(layer.fill, layer.width, layer.height))}
                        cornerRadius={layer.shape === "pill" ? layer.height / 2 : layer.shape === "circle" ? layer.width / 2 : 4}
                    />
                    <Text
                        width={layer.width}
                        height={layer.height}
                        text={layer.label}
                        fontSize={layer.fontSize}
                        fontFamily="Inter"
                        fill={layer.textColor}
                        align="center"
                        verticalAlign="middle"
                    />
                </Group>
            );
        case "frame":
            const frameLayer = layer as FrameLayer;
            const childIds = Array.isArray(frameLayer.childIds) ? frameLayer.childIds : [];
            const childLayers = childIds
                .map((id) => allLayers.find((candidate) => candidate.id === id))
                .filter(Boolean) as LayerType[];

            return (
                <Group
                    {...commonProps}
                    clipX={layer.clipContent ? 0 : undefined}
                    clipY={layer.clipContent ? 0 : undefined}
                    clipWidth={layer.clipContent ? layer.width : undefined}
                    clipHeight={layer.clipContent ? layer.height : undefined}
                >
                    <Rect
                        width={layer.width}
                        height={layer.height}
                        {...(layer.fillEnabled === false
                            ? { fill: undefined, fillPriority: "color" }
                            : paintToKonvaProps(layer.fill, layer.width, layer.height))}
                        stroke={layer.strokeEnabled === false ? undefined : (layer.stroke || undefined)}
                        strokeWidth={layer.strokeEnabled === false ? 0 : layer.strokeWidth}
                        cornerRadius={layer.cornerRadius}
                    />
                    {childLayers.map((child) => (
                        <PreviewLayer
                            key={child.id}
                            layer={child}
                            allLayers={allLayers}
                            loadedImages={loadedImages}
                            imageStatuses={imageStatuses}
                            renderX={child.x - frameLayer.x}
                            renderY={child.y - frameLayer.y}
                        />
                    ))}
                </Group>
            );
        default:
            return null;
    }
}

interface PreviewCanvasProps {
    layers: LayerType[];
    artboardWidth: number;
    artboardHeight: number;
    containerWidth: number;
    containerHeight: number;
    zoom?: number;
    /** Matches editor canvas chrome — light mat vs dark elevated artboard plate */
    appearance?: "light" | "dark";
    /** `artboard` renders a clean 1:1 stage for PNG export. */
    renderMode?: "preview" | "artboard";
    onImagesReadyChange?: (ready: boolean) => void;
    onImageLoadStateChange?: (state: { pending: number; failed: number }) => void;
}

export const PreviewCanvas = forwardRef<Konva.Stage, PreviewCanvasProps>(function PreviewCanvas({
    layers,
    artboardWidth,
    artboardHeight,
    containerWidth,
    containerHeight,
    zoom = 1,
    appearance = "light",
    renderMode = "preview",
    onImagesReadyChange,
    onImageLoadStateChange,
}, forwardedRef) {
    const stageRef = useRef<Konva.Stage>(null);
    const [loadedImages, setLoadedImages] = useState<Map<string, HTMLImageElement>>(new Map());
    const [failedImageSources, setFailedImageSources] = useState<Set<string>>(new Set());
    const imageSources = useMemo(
        () => Array.from(new Set(layers.filter((layer): layer is ImageLayer => layer.type === "image" && layer.visible !== false && !!layer.src).map((layer) => layer.src))),
        [layers]
    );

    useEffect(() => {
        let disposed = false;

        imageSources.forEach((src) => {
            const img = new window.Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                if (disposed) return;
                setLoadedImages((prev) => {
                    const next = new Map(prev);
                    next.set(src, img);
                    return next;
                });
                setFailedImageSources((prev) => {
                    if (!prev.has(src)) return prev;
                    const next = new Set(prev);
                    next.delete(src);
                    return next;
                });
            };
            img.onerror = () => {
                if (disposed) return;
                setFailedImageSources((prev) => {
                    if (prev.has(src)) return prev;
                    const next = new Set(prev);
                    next.add(src);
                    return next;
                });
            };
            img.src = src;
        });

        return () => {
            disposed = true;
        };
    }, [imageSources]);

    const activeLoadedImages = useMemo(() => {
        const next = new Map<string, HTMLImageElement>();
        imageSources.forEach((src) => {
            const image = loadedImages.get(src);
            if (image) next.set(src, image);
        });
        return next;
    }, [imageSources, loadedImages]);

    const activeImageStatuses = useMemo(() => {
        const next: Record<string, ImageLoadStatus> = {};
        imageSources.forEach((src) => {
            if (activeLoadedImages.has(src)) {
                next[src] = "loaded";
            } else if (failedImageSources.has(src)) {
                next[src] = "error";
            } else {
                next[src] = "loading";
            }
        });
        return next;
    }, [imageSources, activeLoadedImages, failedImageSources]);

    const frameChildIds = useMemo(() => {
        const ids = new Set<string>();
        layers.forEach((layer) => {
            if (layer.type === "frame") {
                const childIds = (layer as FrameLayer).childIds;
                if (Array.isArray(childIds)) {
                    childIds.forEach((childId) => ids.add(childId));
                }
            }
        });
        return ids;
    }, [layers]);

    const topLevelLayers = useMemo(
        () => layers.filter((layer) => !frameChildIds.has(layer.id)),
        [layers, frameChildIds],
    );

    const matFill = appearance === "dark" ? "#18191E" : "#FAFAFA";
    const matShadowOpacity = appearance === "dark" ? 0.35 : 0.05;

    // Calculate scale to fit artboard within container (with padding)
    const padding = appearance === "dark" ? 32 : 40;
    const availableWidth = Math.max(1, containerWidth - padding * 2);
    const availableHeight = Math.max(1, containerHeight - padding * 2);
    
    let scale = Math.min(
        availableWidth / artboardWidth,
        availableHeight / artboardHeight
    );
    if (scale > 1) scale = 1; // Don't up-scale beyond 100% unless explicit preview zoom is requested.
    scale *= zoom;

    // Calculate centering offsets
    const stageX = (containerWidth - artboardWidth * scale) / 2;
    const stageY = (containerHeight - artboardHeight * scale) / 2;

    const pendingImages = imageSources.filter((src) => activeImageStatuses[src] === "loading").length;
    const failedImages = imageSources.filter((src) => activeImageStatuses[src] === "error").length;
    const showPreviewStatus = pendingImages > 0 || failedImages > 0;

    useImperativeHandle(forwardedRef, () => stageRef.current as Konva.Stage);

    useEffect(() => {
        onImagesReadyChange?.(pendingImages === 0 && failedImages === 0);
        onImageLoadStateChange?.({ pending: pendingImages, failed: failedImages });
    }, [failedImages, onImageLoadStateChange, onImagesReadyChange, pendingImages]);

    if (renderMode === "artboard") {
        return (
            <Stage
                width={artboardWidth}
                height={artboardHeight}
                ref={stageRef}
                scaleX={1}
                scaleY={1}
            >
                <Layer>
                    <Group clipX={0} clipY={0} clipWidth={artboardWidth} clipHeight={artboardHeight}>
                        {topLevelLayers.map((layer) => (
                            <PreviewLayer
                                key={layer.id}
                                layer={layer}
                                allLayers={layers}
                                loadedImages={activeLoadedImages}
                                imageStatuses={activeImageStatuses}
                            />
                        ))}
                    </Group>
                </Layer>
            </Stage>
        );
    }

    return (
        <Stage
            width={containerWidth}
            height={containerHeight}
            ref={stageRef}
            scaleX={1}
            scaleY={1}
        >
            <Layer>
                {/* Artboard Background */}
                <Rect
                    x={stageX}
                    y={stageY}
                    width={artboardWidth * scale}
                    height={artboardHeight * scale}
                    fill={matFill}
                    shadowColor="#000"
                    shadowBlur={10}
                    shadowOpacity={matShadowOpacity}
                    shadowOffsetY={4}
                />
                
                {/* Scaled Artboard Group */}
                <Group x={stageX} y={stageY} scaleX={scale} scaleY={scale}>
                    {/* Artboard clip bounds */}
                    <Group clipX={0} clipY={0} clipWidth={artboardWidth} clipHeight={artboardHeight}>
                        {topLevelLayers.map((layer) => (
                            <PreviewLayer
                                key={layer.id}
                                layer={layer}
                                allLayers={layers}
                                loadedImages={activeLoadedImages}
                                imageStatuses={activeImageStatuses}
                            />
                        ))}
                    </Group>
                </Group>
                {showPreviewStatus && (
                    <Group x={stageX + 16} y={stageY + 16}>
                        <Rect
                            width={failedImages > 0 ? 230 : 210}
                            height={44}
                            fill="rgba(17, 24, 39, 0.78)"
                            cornerRadius={12}
                        />
                        <Text
                            x={12}
                            y={10}
                            width={failedImages > 0 ? 206 : 186}
                            text={
                                failedImages > 0
                                    ? "Часть изображений не загрузилась в превью"
                                    : "Подгружаю изображения для превью"
                            }
                            fontSize={13}
                            fontFamily="Inter"
                            fill="#FFFFFF"
                        />
                    </Group>
                )}
            </Layer>
        </Stage>
    );
});
