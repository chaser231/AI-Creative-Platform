"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Stage, Layer, Rect, Text, Group } from "react-konva";
import type {
    ArtboardBackgroundImage,
    ImageLayer,
    Layer as LayerType,
    LayoutGrid,
    Paint,
} from "@/types";
import { ArtboardContent, type ArtboardSurfaceProps } from "@/components/editor/canvas/ArtboardContent";
import { useArtboardImages } from "@/components/editor/canvas/artboardImages";
import Konva from "konva";

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
    artboardFill?: Paint;
    artboardFillEnabled?: boolean;
    artboardBackgroundImage?: ArtboardBackgroundImage;
    artboardCornerRadius?: number;
    artboardStroke?: Paint;
    artboardStrokeMode?: "paint" | "image";
    artboardStrokeImage?: ImageLayer["strokeImage"];
    artboardStrokeWidth?: number;
    artboardStrokeAlign?: ImageLayer["strokeAlign"];
    artboardStrokeJoin?: ImageLayer["strokeJoin"];
    /** Layout grids (safe zones) for the active format; rendered as a read-only overlay. */
    layoutGrids?: LayoutGrid[];
    /** Toggle the layout grid overlay (never shown in `artboard`/export mode). */
    showLayoutGrids?: boolean;
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
    artboardFill,
    artboardFillEnabled = true,
    artboardBackgroundImage,
    artboardCornerRadius = 0,
    artboardStroke,
    artboardStrokeMode,
    artboardStrokeImage,
    artboardStrokeWidth = 0,
    artboardStrokeAlign,
    artboardStrokeJoin,
    layoutGrids,
    showLayoutGrids = true,
    onImagesReadyChange,
    onImageLoadStateChange,
}, forwardedRef) {
    const stageRef = useRef<Konva.Stage>(null);

    const {
        loadedImages,
        imageStatuses,
        pending: pendingImages,
        failed: failedImages,
    } = useArtboardImages(layers, {
        backgroundImage: artboardBackgroundImage,
        strokeMode: artboardStrokeMode,
        strokeImage: artboardStrokeImage,
    });

    const surface: ArtboardSurfaceProps = {
        fill: artboardFill,
        fillEnabled: artboardFillEnabled,
        backgroundImage: artboardBackgroundImage,
        cornerRadius: artboardCornerRadius,
        stroke: artboardStroke,
        strokeMode: artboardStrokeMode,
        strokeImage: artboardStrokeImage,
        strokeWidth: artboardStrokeWidth,
        strokeAlign: artboardStrokeAlign,
        strokeJoin: artboardStrokeJoin,
    };

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
                    <ArtboardContent
                        layers={layers}
                        width={artboardWidth}
                        height={artboardHeight}
                        loadedImages={loadedImages}
                        imageStatuses={imageStatuses}
                        showLayoutGrids={false}
                        {...surface}
                    />
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
                {/* Mat behind artboard */}
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
                    <ArtboardContent
                        layers={layers}
                        width={artboardWidth}
                        height={artboardHeight}
                        loadedImages={loadedImages}
                        imageStatuses={imageStatuses}
                        layoutGrids={layoutGrids}
                        showLayoutGrids={showLayoutGrids}
                        layoutGridZoom={scale}
                        {...surface}
                    />
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
