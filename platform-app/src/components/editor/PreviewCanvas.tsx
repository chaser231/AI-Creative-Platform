"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect, Text, Image as KonvaImage, Group } from "react-konva";
import type { Layer as LayerType } from "@/types";
import { computeImageFitProps } from "@/utils/imageFitUtils";
import Konva from "konva";

type ImageLoadStatus = "loading" | "loaded" | "error";

interface PreviewLayerProps {
    layer: LayerType;
    loadedImages: Map<string, HTMLImageElement>;
    imageStatuses: Record<string, ImageLoadStatus>;
}

function PreviewLayer({ layer, loadedImages, imageStatuses }: PreviewLayerProps) {
    if (!layer.visible) return null;

    const commonProps = {
        id: layer.id,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        rotation: layer.rotation,
        name: layer.id, // For easy finding
    };

    switch (layer.type) {
        case "rectangle":
            return (
                <Rect
                    {...commonProps}
                    fill={layer.fill}
                    stroke={layer.stroke}
                    strokeWidth={layer.strokeWidth}
                    cornerRadius={layer.cornerRadius}
                />
            );
        case "text":
            return (
                <Text
                    {...commonProps}
                    text={layer.text}
                    fontSize={layer.fontSize}
                    fontFamily={layer.fontFamily}
                    fontStyle={layer.fontWeight}
                    fill={layer.fill}
                    align={layer.align}
                    verticalAlign="middle"
                    letterSpacing={layer.letterSpacing}
                    lineHeight={layer.lineHeight}
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
                        fill={layer.fill}
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
                        fill={layer.fill}
                        stroke={layer.stroke}
                        strokeWidth={layer.strokeWidth}
                        cornerRadius={layer.cornerRadius}
                    />
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
}

export function PreviewCanvas({ layers, artboardWidth, artboardHeight, containerWidth, containerHeight }: PreviewCanvasProps) {
    const stageRef = useRef<Konva.Stage>(null);
    const [loadedImages, setLoadedImages] = useState<Map<string, HTMLImageElement>>(new Map());
    const [failedImageSources, setFailedImageSources] = useState<Set<string>>(new Set());
    const imageSources = useMemo(
        () => Array.from(new Set(layers.filter((layer) => layer.type === "image" && layer.visible && layer.src).map((layer) => layer.src))),
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

    // Calculate scale to fit artboard within container (with 40px padding)
    const padding = 40;
    const availableWidth = Math.max(1, containerWidth - padding * 2);
    const availableHeight = Math.max(1, containerHeight - padding * 2);
    
    let scale = Math.min(
        availableWidth / artboardWidth,
        availableHeight / artboardHeight
    );
    if (scale > 1) scale = 1; // Don't up-scale beyond 100%

    // Calculate centering offsets
    const stageX = (containerWidth - artboardWidth * scale) / 2;
    const stageY = (containerHeight - artboardHeight * scale) / 2;

    const pendingImages = imageSources.filter((src) => activeImageStatuses[src] === "loading").length;
    const failedImages = imageSources.filter((src) => activeImageStatuses[src] === "error").length;
    const showPreviewStatus = pendingImages > 0 || failedImages > 0;

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
                    fill="#FAFAFA"
                    shadowColor="#000"
                    shadowBlur={10}
                    shadowOpacity={0.05}
                    shadowOffsetY={4}
                />
                
                {/* Scaled Artboard Group */}
                <Group x={stageX} y={stageY} scaleX={scale} scaleY={scale}>
                    {/* Artboard clip bounds */}
                    <Group clipX={0} clipY={0} clipWidth={artboardWidth} clipHeight={artboardHeight}>
                        {layers.map((layer) => (
                            <PreviewLayer
                                key={layer.id}
                                layer={layer}
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
}
