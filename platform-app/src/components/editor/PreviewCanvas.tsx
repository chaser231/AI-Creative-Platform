"use client";

import { useEffect, useState, useRef } from "react";
import { Stage, Layer, Rect, Text, Image as KonvaImage, Group } from "react-konva";
import type { Layer as LayerType, TextLayer, BadgeLayer, FrameLayer, ImageLayer } from "@/types";
import { computeImageFitProps } from "@/utils/imageFitUtils";
import Konva from "konva";

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

interface PreviewLayerProps {
    layer: LayerType;
}

function PreviewLayer({ layer }: PreviewLayerProps) {
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
            // eslint-disable-next-line react-hooks/rules-of-hooks
            const img = useImage(layer.src);
            if (!img) return null;
            const fitMode = layer.objectFit || "cover";
            const nw = img.naturalWidth || img.width;
            const nh = img.naturalHeight || img.height;
            const fit = computeImageFitProps(fitMode, nw, nh, layer.width, layer.height);

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

    // Separate background (frames) and standard layers if needed, 
    // or just render them in z-index order. 
    // We assume the stores layers are already sorted by z-index properly.

    // Handle nested frame children. Wait, flat layers in store are flat, z-index determines rendering.
    // If a frame has children, we need to nest them in Konva? 
    // Wait, the main Canvas.tsx handles nesting frames carefully. Let's look at it.

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
                    fill="#FFFFFF"
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
                            <PreviewLayer key={layer.id} layer={layer} />
                        ))}
                    </Group>
                </Group>
            </Layer>
        </Stage>
    );
}
