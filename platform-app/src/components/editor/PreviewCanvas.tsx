"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { Stage, Layer, Rect, Text, Image as KonvaImage, Group, Path } from "react-konva";
import type {
    ArtboardBackgroundImage,
    CornerRadii,
    FrameLayer,
    ImageFitMode,
    ImageLayer,
    LayerImageFill,
    Layer as LayerType,
    LayoutGrid,
    Paint,
} from "@/types";
import { LayoutGridLayer } from "@/components/editor/canvas/LayoutGridLayer";
import type { CornerRadiusValue } from "@/utils/strokeGeometry";
import { computeImageFitProps } from "@/utils/imageFitUtils";
import { getTextTrimMetrics, isTextTrimActive } from "@/utils/layoutEngine";
import { getEffectiveTextRenderHeight, shouldUseTextEllipsis } from "@/utils/textContainerLimits";
import { normalizePaint, paintToKonvaProps } from "@/utils/paint";
import { subpathsToPathData, hasRenderableGeometry } from "@/utils/vectorGeometry";
import { AlignedStrokeRect } from "@/components/editor/canvas/AlignedStrokeRect";
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
                <Group {...commonProps}>
                    <FlipLayerContent layer={layer}>
                        <StyledBoxFill
                            width={layer.width}
                            height={layer.height}
                            cornerRadius={resolveCornerRadius(layer.cornerRadius, layer.cornerRadii)}
                            fill={layer.fill}
                            fillMode={layer.fillMode}
                            fillEnabled={layer.fillEnabled}
                            imageFill={layer.imageFill}
                            loadedImages={loadedImages}
                        />
                        <StyledBoxStroke
                            width={layer.width}
                            height={layer.height}
                            cornerRadius={resolveCornerRadius(layer.cornerRadius, layer.cornerRadii)}
                            stroke={layer.stroke}
                            strokeMode={layer.strokeMode}
                            strokeImageFill={layer.strokeImage}
                            loadedImages={loadedImages}
                            strokeWidth={layer.strokeWidth}
                            strokeAlign={layer.strokeAlign}
                            strokeJoin={layer.strokeJoin}
                            strokeEnabled={layer.strokeEnabled}
                        />
                    </FlipLayerContent>
                </Group>
            );
        case "text":
            return (
                <Group {...commonProps}>
                    <FlipLayerContent layer={layer}>
                        <Text
                            width={layer.textAdjust === "auto_width" ? undefined : layer.width}
                            height={layer.textAdjust === "auto_width" || layer.textAdjust === "auto_height"
                                ? undefined
                                : getEffectiveTextRenderHeight(layer)}
                            offsetY={isTextTrimActive(layer) ? getTextTrimMetrics(layer).top : 0}
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
                        />
                    </FlipLayerContent>
                </Group>
            );
        case "image":
            const img = loadedImages.get(layer.src);
            const imageStatus = imageStatuses[layer.src] ?? "loading";
            const imageFillMode = layer.fillMode ?? "image";

            if (imageFillMode === "image" && !img) {
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

            return (
                <Group {...commonProps}>
                    <FlipLayerContent layer={layer}>
                        {imageFillMode === "paint" ? (
                            <StyledBoxFill
                                width={layer.width}
                                height={layer.height}
                                cornerRadius={resolveCornerRadius(layer.cornerRadius ?? 0, layer.cornerRadii)}
                                fill={layer.fill ?? "#FFFFFF"}
                                fillMode="paint"
                                fillEnabled={layer.fillEnabled}
                                loadedImages={loadedImages}
                            />
                        ) : img ? (
                            <ImageFillContent
                                image={img}
                                width={layer.width}
                                height={layer.height}
                                cornerRadius={resolveCornerRadius(layer.cornerRadius ?? 0, layer.cornerRadii)}
                                fitMode={layer.objectFit || "cover"}
                                opacity={layer.fillEnabled === false ? 0 : 1}
                                focusX={layer.focusX}
                                focusY={layer.focusY}
                            />
                        ) : null}
                        <StyledBoxStroke
                            width={layer.width}
                            height={layer.height}
                            cornerRadius={resolveCornerRadius(layer.cornerRadius ?? 0, layer.cornerRadii)}
                            stroke={layer.stroke}
                            strokeMode={layer.strokeMode}
                            strokeImageFill={layer.strokeImage}
                            loadedImages={loadedImages}
                            strokeWidth={layer.strokeWidth ?? 0}
                            strokeAlign={layer.strokeAlign}
                            strokeJoin={layer.strokeJoin}
                            strokeEnabled={layer.strokeEnabled}
                        />
                    </FlipLayerContent>
                </Group>
            );
        case "vector": {
            const useSubpaths = hasRenderableGeometry(layer.subpaths);
            const pathData = useSubpaths
                ? subpathsToPathData(layer.subpaths, layer.width, layer.height)
                : layer.rawSvgPath ?? "";
            const rawScaleX = !useSubpaths && layer.viewBoxWidth ? layer.width / layer.viewBoxWidth : 1;
            const rawScaleY = !useSubpaths && layer.viewBoxHeight ? layer.height / layer.viewBoxHeight : 1;
            const strokeColor = layer.strokeEnabled
                ? (() => {
                    if (layer.stroke === undefined || layer.stroke === "") return undefined;
                    const np = normalizePaint(layer.stroke);
                    return np.kind === "solid" ? np.color : np.stops[0]?.color;
                })()
                : undefined;
            return (
                <Group {...commonProps}>
                    <FlipLayerContent layer={layer}>
                        <Path
                            data={pathData}
                            scaleX={rawScaleX}
                            scaleY={rawScaleY}
                            {...(layer.fillEnabled === false
                                ? { fillEnabled: false }
                                : paintToKonvaProps(layer.fill, layer.width, layer.height))}
                            fillRule={layer.fillRule ?? "nonzero"}
                            stroke={strokeColor}
                            strokeWidth={strokeColor ? layer.strokeWidth ?? 0 : 0}
                            lineJoin={layer.strokeJoin ?? "miter"}
                            strokeScaleEnabled={false}
                        />
                    </FlipLayerContent>
                </Group>
            );
        }
        case "badge":
            return (
                <Group {...commonProps}>
                    <FlipLayerContent layer={layer}>
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
                    </FlipLayerContent>
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
                    <FlipLayerContent layer={layer}>
                        <StyledBoxFill
                            width={layer.width}
                            height={layer.height}
                            cornerRadius={resolveCornerRadius(layer.cornerRadius, layer.cornerRadii)}
                            fill={layer.fill}
                            fillMode={layer.fillMode}
                            fillEnabled={layer.fillEnabled}
                            imageFill={layer.imageFill}
                            loadedImages={loadedImages}
                        />
                    </FlipLayerContent>
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
                    <FlipLayerContent layer={layer}>
                        <StyledBoxStroke
                            width={layer.width}
                            height={layer.height}
                            cornerRadius={resolveCornerRadius(layer.cornerRadius, layer.cornerRadii)}
                            stroke={layer.stroke}
                            strokeMode={layer.strokeMode}
                            strokeImageFill={layer.strokeImage}
                            loadedImages={loadedImages}
                            strokeWidth={layer.strokeWidth}
                            strokeAlign={layer.strokeAlign}
                            strokeJoin={layer.strokeJoin}
                            strokeEnabled={layer.strokeEnabled}
                        />
                    </FlipLayerContent>
                </Group>
            );
        default:
            return null;
    }
}

function FlipLayerContent({ layer, children }: { layer: Pick<LayerType, "width" | "height" | "flipX" | "flipY">; children: ReactNode }) {
    if (!layer.flipX && !layer.flipY) return <>{children}</>;
    return (
        <Group
            x={layer.flipX ? layer.width : 0}
            y={layer.flipY ? layer.height : 0}
            scaleX={layer.flipX ? -1 : 1}
            scaleY={layer.flipY ? -1 : 1}
        >
            {children}
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
    fitMode: ImageFitMode;
    opacity?: number;
    focusX?: number;
    focusY?: number;
}) {
    const nw = image.naturalWidth || image.width;
    const nh = image.naturalHeight || image.height;
    const fit = computeImageFitProps(fitMode, nw, nh, width, height, {
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

function StyledBoxFill({
    width,
    height,
    cornerRadius,
    fill,
    fillMode,
    fillEnabled,
    imageFill,
    loadedImages,
}: {
    width: number;
    height: number;
    cornerRadius?: CornerRadiusValue;
    fill: Paint;
    fillMode?: "paint" | "image";
    fillEnabled?: boolean;
    imageFill?: LayerImageFill;
    loadedImages: Map<string, HTMLImageElement>;
}) {
    if (fillEnabled === false) return null;
    if (fillMode === "image" && imageFill?.src) {
        const image = loadedImages.get(imageFill.src);
        if (!image) return null;
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
    loadedImages,
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
    loadedImages: Map<string, HTMLImageElement>;
    strokeWidth?: number;
    strokeAlign?: ImageLayer["strokeAlign"];
    strokeJoin?: ImageLayer["strokeJoin"];
    strokeEnabled?: boolean;
}) {
    const image = strokeMode === "image" && strokeImageFill?.src ? loadedImages.get(strokeImageFill.src) : undefined;
    return (
        <AlignedStrokeRect
            width={width}
            height={height}
            cornerRadius={cornerRadius}
            fillEnabled={false}
            stroke={typeof stroke === "string" ? stroke || undefined : undefined}
            strokePaint={strokeMode === "image" ? undefined : stroke}
            strokeImage={image}
            strokeImageFill={strokeImageFill}
            strokeWidth={strokeWidth}
            strokeAlign={strokeAlign}
            strokeJoin={strokeJoin}
            strokeEnabled={strokeEnabled !== false}
        />
    );
}

function artboardClipFunc(width: number, height: number, cornerRadius: number) {
    if (cornerRadius <= 0) return undefined;
    const r = Math.min(cornerRadius, Math.min(width, height) / 2);
    return (ctx: Konva.Context) => {
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.arcTo(width, 0, width, height, r);
        ctx.arcTo(width, height, 0, height, r);
        ctx.arcTo(0, height, 0, 0, r);
        ctx.arcTo(0, 0, width, 0, r);
        ctx.closePath();
    };
}

function PreviewArtboardBackground({
    width,
    height,
    fill,
    fillEnabled = true,
    backgroundImage,
    cornerRadius = 0,
    stroke,
    strokeMode,
    strokeImageFill,
    strokeWidth = 0,
    strokeAlign,
    strokeJoin,
    loadedImages,
}: {
    width: number;
    height: number;
    fill?: Paint;
    fillEnabled?: boolean;
    backgroundImage?: ArtboardBackgroundImage;
    cornerRadius?: number;
    stroke?: Paint;
    strokeMode?: "paint" | "image";
    strokeImageFill?: LayerImageFill;
    strokeWidth?: number;
    strokeAlign?: ImageLayer["strokeAlign"];
    strokeJoin?: ImageLayer["strokeJoin"];
    loadedImages: Map<string, HTMLImageElement>;
}) {
    const fillProps = paintToKonvaProps(fill ?? normalizePaint(undefined), width, height);
    const clipFunc = artboardClipFunc(width, height, cornerRadius);
    const bgSrc = backgroundImage?.src;
    const bgImg = bgSrc ? loadedImages.get(bgSrc) : undefined;
    const strokeImage = strokeMode === "image" && strokeImageFill?.src ? loadedImages.get(strokeImageFill.src) : undefined;

    const fillRect = (
        <AlignedStrokeRect
            name="export-artboard-fill"
            width={width}
            height={height}
            cornerRadius={cornerRadius}
            listening={false}
            stroke={typeof stroke === "string" ? stroke || undefined : undefined}
            strokePaint={strokeMode === "image" ? undefined : stroke}
            strokeImage={strokeImage}
            strokeImageFill={strokeImageFill}
            strokeWidth={strokeWidth}
            strokeAlign={strokeAlign}
            strokeJoin={strokeJoin}
            strokeEnabled={!!strokeWidth && (!!stroke || !!strokeImageFill?.src)}
            fillEnabled={fillEnabled}
            {...fillProps}
        />
    );

    let bgNode: ReactNode = null;
    if (fillEnabled && bgImg && backgroundImage) {
        const fit = (backgroundImage.fit ?? "cover") as ImageFitMode;
        const nw = bgImg.naturalWidth || bgImg.width;
        const nh = bgImg.naturalHeight || bgImg.height;
        const fitProps = computeImageFitProps(fit, nw, nh, width, height, {
            focusX: backgroundImage.focusX,
            focusY: backgroundImage.focusY,
        });
        const image = (
            <KonvaImage
                name="export-artboard-background"
                image={bgImg}
                x={fitProps.drawX}
                y={fitProps.drawY}
                width={fitProps.drawWidth}
                height={fitProps.drawHeight}
                crop={{
                    x: fitProps.cropX,
                    y: fitProps.cropY,
                    width: fitProps.cropWidth,
                    height: fitProps.cropHeight,
                }}
                opacity={backgroundImage.opacity ?? 1}
                listening={false}
            />
        );
        bgNode = clipFunc ? (
            <Group name="export-artboard-background" listening={false} clipFunc={clipFunc}>
                {image}
            </Group>
        ) : image;
    }

    if (clipFunc) {
        return (
            <Group listening={false} clipFunc={clipFunc}>
                {fillRect}
                {bgNode}
            </Group>
        );
    }

    return (
        <>
            {fillRect}
            {bgNode}
        </>
    );
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
    artboardFill?: Paint;
    artboardFillEnabled?: boolean;
    artboardBackgroundImage?: ArtboardBackgroundImage;
    artboardCornerRadius?: number;
    artboardStroke?: Paint;
    artboardStrokeMode?: "paint" | "image";
    artboardStrokeImage?: LayerImageFill;
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
    const [loadedImages, setLoadedImages] = useState<Map<string, HTMLImageElement>>(new Map());
    const [failedImageSources, setFailedImageSources] = useState<Set<string>>(new Set());
    const imageSources = useMemo(() => {
        const sources = layers
            .filter((layer): layer is ImageLayer => (
                layer.type === "image"
                && layer.visible !== false
                && (layer.fillMode ?? "image") === "image"
                && !!layer.src
            ))
            .map((layer) => layer.src);
        layers.forEach((layer) => {
            if (
                (layer.type === "rectangle" || layer.type === "frame")
                && layer.visible !== false
                && layer.fillMode === "image"
                && layer.imageFill?.src
            ) {
                sources.push(layer.imageFill.src);
            }
            if (
                (layer.type === "rectangle" || layer.type === "frame" || layer.type === "image")
                && layer.visible !== false
                && layer.strokeMode === "image"
                && layer.strokeImage?.src
            ) {
                sources.push(layer.strokeImage.src);
            }
        });
        if (artboardBackgroundImage?.src) sources.push(artboardBackgroundImage.src);
        if (artboardStrokeMode === "image" && artboardStrokeImage?.src) sources.push(artboardStrokeImage.src);
        return Array.from(new Set(sources));
    }, [artboardBackgroundImage, artboardStrokeImage, artboardStrokeMode, layers]);

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
                        <PreviewArtboardBackground
                            width={artboardWidth}
                            height={artboardHeight}
                            fill={artboardFill}
                            fillEnabled={artboardFillEnabled}
                            backgroundImage={artboardBackgroundImage}
                            cornerRadius={artboardCornerRadius}
                            stroke={artboardStroke}
                            strokeMode={artboardStrokeMode}
                            strokeImageFill={artboardStrokeImage}
                            strokeWidth={artboardStrokeWidth}
                            strokeAlign={artboardStrokeAlign}
                            strokeJoin={artboardStrokeJoin}
                            loadedImages={activeLoadedImages}
                        />
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
                        <PreviewArtboardBackground
                            width={artboardWidth}
                            height={artboardHeight}
                            fill={artboardFill}
                            fillEnabled={artboardFillEnabled}
                            backgroundImage={artboardBackgroundImage}
                            cornerRadius={artboardCornerRadius}
                            stroke={artboardStroke}
                            strokeMode={artboardStrokeMode}
                            strokeImageFill={artboardStrokeImage}
                            strokeWidth={artboardStrokeWidth}
                            strokeAlign={artboardStrokeAlign}
                            strokeJoin={artboardStrokeJoin}
                            loadedImages={activeLoadedImages}
                        />
                        {topLevelLayers.map((layer) => (
                            <PreviewLayer
                                key={layer.id}
                                layer={layer}
                                allLayers={layers}
                                loadedImages={activeLoadedImages}
                                imageStatuses={activeImageStatuses}
                            />
                        ))}
                        {showLayoutGrids && (
                            <LayoutGridLayer
                                grids={layoutGrids}
                                width={artboardWidth}
                                height={artboardHeight}
                                zoom={scale}
                            />
                        )}
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
