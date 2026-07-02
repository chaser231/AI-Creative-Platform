"use client";

import { useMemo, type ReactNode } from "react";
import { Rect, Text, Image as KonvaImage, Group, Path } from "react-konva";
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
import { getTextRenderOffsetY } from "@/utils/layoutEngine";
import { getEffectiveTextRenderHeight, shouldUseTextEllipsis } from "@/utils/textContainerLimits";
import { normalizePaint, paintToKonvaProps } from "@/utils/paint";
import { subpathsToPathData } from "@/utils/vectorGeometry";
import { AlignedStrokeRect } from "@/components/editor/canvas/AlignedStrokeRect";
import { InlineSvgVectorImage } from "@/components/editor/canvas/InlineSvgVectorImage";
import { resolveReadOnlyVectorRenderMode } from "@/components/editor/canvas/vectorRenderMode";
import { useArtboardImages, type ImageLoadStatus } from "./artboardImages";
import Konva from "konva";

export type { ImageLoadStatus };

// ─── Layer renderer (read-only) ─────────────────────────

interface ArtboardLayerProps {
    layer: LayerType;
    allLayers: LayerType[];
    loadedImages: Map<string, HTMLImageElement>;
    imageStatuses: Record<string, ImageLoadStatus>;
    renderX?: number;
    renderY?: number;
}

/**
 * Read-only Konva renderer for a single layer. Shared by `PreviewCanvas` and the
 * world-space `ArtboardGroup` overview tiles. Does not listen to pointer events
 * or own selection/transform chrome — that remains the studio `Canvas`'s job.
 */
export function ArtboardLayer({ layer, allLayers, loadedImages, imageStatuses, renderX, renderY }: ArtboardLayerProps) {
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
                        />
                    </FlipLayerContent>
                </Group>
            );
        case "image": {
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
        }
        case "vector": {
            // Mirror the studio active-path non-editing render priority: complex
            // Figma boolean/even-odd vectors keep their geometry in `inlineSvg`
            // (subpaths empty), so a Konva <Path> would paint nothing/garbage.
            // Prefer the faithful SVG raster when present, otherwise fall back to
            // subpath/raw-path geometry. Keeps overview sibling tiles + PreviewCanvas
            // consistent with the active artboard.
            const renderMode = resolveReadOnlyVectorRenderMode(layer);
            const useSubpaths = renderMode.kind === "path" && renderMode.source === "subpaths";
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
                        {renderMode.kind === "inline" ? (
                            <InlineSvgVectorImage inlineSvg={layer.inlineSvg!} width={layer.width} height={layer.height} />
                        ) : (
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
                        )}
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
        case "frame": {
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
                        <ArtboardLayer
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
        }
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

export function resolveCornerRadius(cornerRadius = 0, cornerRadii?: CornerRadii): CornerRadiusValue {
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

// ─── Artboard background (read-only) ────────────────────

export interface ArtboardSurfaceProps {
    fill?: Paint;
    fillEnabled?: boolean;
    backgroundImage?: ArtboardBackgroundImage;
    cornerRadius?: number;
    stroke?: Paint;
    strokeMode?: "paint" | "image";
    strokeImage?: LayerImageFill;
    strokeWidth?: number;
    strokeAlign?: ImageLayer["strokeAlign"];
    strokeJoin?: ImageLayer["strokeJoin"];
}

export function ArtboardBackground({
    width,
    height,
    fill,
    fillEnabled = true,
    backgroundImage,
    cornerRadius = 0,
    stroke,
    strokeMode,
    strokeImage,
    strokeWidth = 0,
    strokeAlign,
    strokeJoin,
    loadedImages,
}: ArtboardSurfaceProps & {
    width: number;
    height: number;
    loadedImages: Map<string, HTMLImageElement>;
}) {
    const fillProps = paintToKonvaProps(fill ?? normalizePaint(undefined), width, height);
    const clipFunc = artboardClipFunc(width, height, cornerRadius);
    const bgSrc = backgroundImage?.src;
    const bgImg = bgSrc ? loadedImages.get(bgSrc) : undefined;
    const strokeImageEl = strokeMode === "image" && strokeImage?.src ? loadedImages.get(strokeImage.src) : undefined;

    const fillRect = (
        <AlignedStrokeRect
            name="export-artboard-fill"
            width={width}
            height={height}
            cornerRadius={cornerRadius}
            listening={false}
            stroke={typeof stroke === "string" ? stroke || undefined : undefined}
            strokePaint={strokeMode === "image" ? undefined : stroke}
            strokeImage={strokeImageEl}
            strokeImageFill={strokeImage}
            strokeWidth={strokeWidth}
            strokeAlign={strokeAlign}
            strokeJoin={strokeJoin}
            strokeEnabled={!!strokeWidth && (!!stroke || !!strokeImage?.src)}
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

// ─── Composed artboard content (background + layers) ────

export interface ArtboardContentProps extends ArtboardSurfaceProps {
    layers: LayerType[];
    width: number;
    height: number;
    loadedImages: Map<string, HTMLImageElement>;
    imageStatuses: Record<string, ImageLoadStatus>;
    /** Clip layers to the artboard bounds (default true). */
    clip?: boolean;
    layoutGrids?: LayoutGrid[];
    showLayoutGrids?: boolean;
    /** On-screen scale of the artboard — keeps grid lines hairline-thin. */
    layoutGridZoom?: number;
}

/**
 * Renders an artboard's background + top-level layers (frames recurse internally)
 * in artboard-local coordinates, optionally clipped to the artboard bounds. Pure:
 * images must be supplied by the caller (via `useArtboardImages`).
 */
export function ArtboardContent({
    layers,
    width,
    height,
    loadedImages,
    imageStatuses,
    clip = true,
    layoutGrids,
    showLayoutGrids = false,
    layoutGridZoom = 1,
    ...surface
}: ArtboardContentProps) {
    const frameChildIds = useMemo(() => {
        const ids = new Set<string>();
        layers.forEach((layer) => {
            if (layer.type === "frame") {
                const childIds = (layer as FrameLayer).childIds;
                if (Array.isArray(childIds)) childIds.forEach((childId) => ids.add(childId));
            }
        });
        return ids;
    }, [layers]);

    const topLevelLayers = useMemo(
        () => layers.filter((layer) => !frameChildIds.has(layer.id)),
        [layers, frameChildIds],
    );

    const body = (
        <>
            <ArtboardBackground width={width} height={height} loadedImages={loadedImages} {...surface} />
            {topLevelLayers.map((layer) => (
                <ArtboardLayer
                    key={layer.id}
                    layer={layer}
                    allLayers={layers}
                    loadedImages={loadedImages}
                    imageStatuses={imageStatuses}
                />
            ))}
            {showLayoutGrids && (
                <LayoutGridLayer grids={layoutGrids} width={width} height={height} zoom={layoutGridZoom} />
            )}
        </>
    );

    if (!clip) return body;

    return (
        <Group clipX={0} clipY={0} clipWidth={width} clipHeight={height}>
            {body}
        </Group>
    );
}

// ─── World-space group (self-loading) ───────────────────

export interface ArtboardGroupProps extends ArtboardSurfaceProps {
    layers: LayerType[];
    width: number;
    height: number;
    /** World position of the artboard's top-left corner. */
    offsetX?: number;
    offsetY?: number;
    /** Uniform scale applied to the whole artboard group. */
    scale?: number;
    /** Konva node name for the wrapping group (e.g. to tag/select a tile). */
    name?: string;
    /** Whether the group listens to pointer events (default false; read-only). */
    listening?: boolean;
    clip?: boolean;
    layoutGrids?: LayoutGrid[];
    showLayoutGrids?: boolean;
    onClick?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
    onDblClick?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
    onTap?: (e: Konva.KonvaEventObject<Event>) => void;
    onDblTap?: (e: Konva.KonvaEventObject<Event>) => void;
}

/**
 * A single artboard placed in world space, self-loading its own images. This is
 * the reusable building block for the overview canvas: render one `ArtboardGroup`
 * per format at a client-computed `(offsetX, offsetY)`. Read-only in Phase 1;
 * Phase 2 lights up interactive editing on the active artboard.
 */
export function ArtboardGroup({
    layers,
    width,
    height,
    offsetX = 0,
    offsetY = 0,
    scale = 1,
    name,
    listening = false,
    clip = true,
    layoutGrids,
    showLayoutGrids = false,
    onClick,
    onDblClick,
    onTap,
    onDblTap,
    ...surface
}: ArtboardGroupProps) {
    const { loadedImages, imageStatuses } = useArtboardImages(layers, {
        backgroundImage: surface.backgroundImage,
        strokeMode: surface.strokeMode,
        strokeImage: surface.strokeImage,
    });

    return (
        <Group
            x={offsetX}
            y={offsetY}
            scaleX={scale}
            scaleY={scale}
            name={name}
            listening={listening}
            onClick={onClick}
            onDblClick={onDblClick}
            onTap={onTap}
            onDblTap={onDblTap}
        >
            <ArtboardContent
                layers={layers}
                width={width}
                height={height}
                loadedImages={loadedImages}
                imageStatuses={imageStatuses}
                clip={clip}
                layoutGrids={layoutGrids}
                showLayoutGrids={showLayoutGrids}
                layoutGridZoom={scale}
                {...surface}
            />
        </Group>
    );
}
