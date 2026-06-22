"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    ALargeSmall,
    AlignCenter,
    AlignLeft,
    AlignRight,
    Anchor,
    AlignVerticalSpaceAround,
    ArrowDown,
    ArrowRight,
    BetweenHorizontalStart,
    BetweenVerticalStart,
    Eye,
    EyeOff,
    FlipHorizontal,
    FlipVertical,
    Grid3X3,
    LayoutDashboard,
    Link,
    Link2,
    Maximize2,
    Move,
    MoveHorizontal,
    MoveVertical,
    Paintbrush,
    PenTool,
    PanelBottom,
    PanelLeft,
    PanelRight,
    PanelTop,
    Plus,
    RotateCw,
    Scissors,
    Slice,
    SlidersHorizontal,
    Square,
    Type,
    UnfoldHorizontal,
    UnfoldVertical,
    Unlink,
    Upload,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Select } from "@/components/ui/Select";
import { SmartNumberInput, useNumberScrub } from "@/components/ui/SmartNumberInput";
import { useCanvasStore } from "@/store/canvasStore";
import { requestOpenExportModal } from "@/components/editor/exportEvents";
import { enterVectorEditMode } from "@/utils/vectorEdit";
import type {
    BadgeLayer,
    ConstraintH,
    ConstraintV,
    CornerRadii,
    FrameLayer,
    ImageLayer,
    ImageFitMode,
    Layer,
    LayerImageFill,
    LayerResponsiveBehavior,
    LayerResponsiveSettings,
    RectangleLayer,
    SliceAlignH,
    SliceAlignMode,
    SliceAlignScope,
    SliceAlignSettings,
    SliceAlignV,
    TemplateSlotRole,
    TextLayer,
    VectorLayer,
} from "@/types";
import { DEFAULT_CONSTRAINTS, DEFAULT_SLICE_ALIGN, IMAGE_FIT_MODE_LABELS } from "@/types";
import { describeSliceAlignment } from "@/utils/sliceAlignment";
import { cn } from "@/lib/cn";
import { PREINSTALLED_FONTS, getUserFonts, normalizeFontFamilyName, saveUserFont } from "@/lib/customFonts";
import {
    autoLayoutAxesToScreenAlign,
    screenAlignToAutoLayoutAxes,
    swapAlignmentsForDirectionChange,
    type ScreenHAlign,
    type ScreenVAlign,
} from "@/utils/autoLayoutAlignGrid";
import { clearTextMeasureCache } from "@/utils/layoutEngine";
import { weightLabel } from "@/utils/fontWeight";
import { getAvailableFontFamiliesSync } from "@/utils/fontUtils";
import { uploadForAI } from "@/utils/imageUpload";
import { normalizePaint } from "@/utils/paint";
import { useAssetList, useAssetUpload } from "@/hooks/useAssetUpload";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { ArtboardBackgroundControls } from "./ArtboardBackgroundControls";
import { ColorInput } from "./ColorInput";
import { PaintInput } from "./PaintInput";
import { LayoutGridsSection } from "./LayoutGridsSection";
import { StrokeControls, type StrokeControlsValue } from "./StrokeControls";

const SYSTEM_FONTS = [
    "Inter",
    "Roboto",
    "Open Sans",
    "Montserrat",
    "PT Sans",
    "Outfit",
    "Arial",
    "Georgia",
];

const FIELD_CLASS = "w-full h-8 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary pl-7 pr-2 text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus";
const RESPONSIVE_CONTROLS_STORAGE_KEY = "studio-responsive-controls-open";
type SizeModeOption = { value: string; label: string };
type LayerSizeModeConfig = {
    value: string;
    options: SizeModeOption[];
    toUpdates: (value: string) => Partial<Layer>;
};

export function PropertiesPanel() {
    const {
        layers,
        selectedLayerIds,
        updateLayer,
        activeResizeId,
        resizes,
        artboardProps,
        updateArtboardProps,
        alignSelectedLayers,
        canvasWidth,
        canvasHeight,
        setCanvasSize,
        palette,
        applyBackgroundSwatchToArtboard,
        createSwatchFromArtboardBackground,
    } = useCanvasStore(useShallow((s) => ({
        layers: s.layers,
        selectedLayerIds: s.selectedLayerIds,
        updateLayer: s.updateLayer,
        activeResizeId: s.activeResizeId,
        resizes: s.resizes,
        artboardProps: s.artboardProps,
        updateArtboardProps: s.updateArtboardProps,
        alignSelectedLayers: s.alignSelectedLayers,
        canvasWidth: s.canvasWidth,
        canvasHeight: s.canvasHeight,
        setCanvasSize: s.setCanvasSize,
        palette: s.palette,
        applyBackgroundSwatchToArtboard: s.applyBackgroundSwatchToArtboard,
        createSwatchFromArtboardBackground: s.createSwatchFromArtboardBackground,
    })));

    const selectedLayer = selectedLayerIds.length === 1
        ? layers.find((layer) => layer.id === selectedLayerIds[0]) ?? null
        : null;
    const isMultiSelection = selectedLayerIds.length > 1;
    const selectedIsInsideAutoLayout = selectedLayerIds.some((id) => {
        const parent = findParentFrame(layers, id);
        return parent?.layoutMode && parent.layoutMode !== "none";
    });

    const handleBgFilePick = async (file: File) => {
        try {
            const base64: string = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });
            const url = await uploadForAI(base64, "artboard-bg");
            updateArtboardProps({
                backgroundImage: {
                    src: url,
                    fit: artboardProps.backgroundImage?.fit ?? "cover",
                    opacity: artboardProps.backgroundImage?.opacity ?? 1,
                    focusX: 0.5,
                    focusY: 0.5,
                },
            });
        } catch (err) {
            console.error("[PropertiesPanel] Background upload failed:", err);
        }
    };

    const activeFormat = resizes.find((resize) => resize.id === activeResizeId);
    const [artboardFillTab, setArtboardFillTab] = useState<"paint" | "image">("paint");
    const artboardFillImageActive = artboardFillTab === "image" || !!artboardProps.backgroundImage;
    const [responsiveControlsOpen, setResponsiveControlsOpen] = useState(() => {
        if (typeof window === "undefined") return false;
        return window.localStorage.getItem(RESPONSIVE_CONTROLS_STORAGE_KEY) === "1";
    });

    useEffect(() => {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(RESPONSIVE_CONTROLS_STORAGE_KEY, responsiveControlsOpen ? "1" : "0");
    }, [responsiveControlsOpen]);

    const handleArtboardStrokeChange = useCallback((updates: Partial<StrokeControlsValue>) => {
        const next: Partial<typeof artboardProps> = {};

        if (updates.stroke !== undefined) next.stroke = updates.stroke;
        if (updates.strokeMode !== undefined) next.strokeMode = updates.strokeMode;
        if (updates.strokeImage !== undefined) next.strokeImage = updates.strokeImage;
        if (updates.strokeWidth !== undefined) next.strokeWidth = updates.strokeWidth;
        if (updates.strokeAlign !== undefined) next.strokeAlign = updates.strokeAlign;
        if (updates.strokeJoin !== undefined) next.strokeJoin = updates.strokeJoin;

        if (updates.strokeEnabled !== undefined) {
            next.strokeWidth = updates.strokeEnabled
                ? Math.max(1, updates.strokeWidth ?? artboardProps.strokeWidth)
                : 0;
            if (updates.strokeEnabled && !updates.stroke && !artboardProps.stroke) {
                next.stroke = "#000000";
            }
        } else if (
            (updates.stroke !== undefined || updates.strokeMode !== undefined || updates.strokeImage !== undefined)
            && (updates.strokeWidth ?? artboardProps.strokeWidth) <= 0
        ) {
            next.strokeWidth = 1;
        }

        updateArtboardProps(next);
    }, [artboardProps, updateArtboardProps]);

    return (
        <aside className="h-full w-full border border-border-primary rounded-[var(--radius-2xl)] shadow-[var(--shadow-md)] flex flex-col overflow-hidden backdrop-blur-xl bg-bg-surface/85">
            <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
                <div>
                    <h3 className="text-[11px] font-medium text-text-tertiary uppercase tracking-widest">
                        Свойства
                    </h3>
                    <p className="mt-0.5 text-[10px] text-text-tertiary">
                        {isMultiSelection
                            ? `${selectedLayerIds.length} объектов`
                            : selectedLayer
                                ? selectedLayer.name
                                : "Артборд"}
                    </p>
                </div>
                {selectedLayer?.masterId && (
                    <MasterPill isMaster={activeFormat?.isMaster === true || activeResizeId === "master"} />
                )}
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3">
                {isMultiSelection ? (
                    <div className="space-y-3">
                        <InspectorSection title="Выделение" icon={<Move size={13} />}>
                            <div className="flex items-center justify-between rounded-[var(--radius-md)] bg-bg-secondary px-3 py-2">
                                <span className="text-[11px] text-text-primary">Выбрано объектов</span>
                                <span className="text-[10px] text-text-tertiary px-1.5 py-0.5 bg-bg-tertiary rounded-full">
                                    {selectedLayerIds.length}
                                </span>
                            </div>
                        </InspectorSection>
                        <AlignmentSection
                            disabled={!!selectedIsInsideAutoLayout}
                            onAlign={alignSelectedLayers}
                        />
                    </div>
                ) : selectedLayer ? (
                    <LayerInspector
                        layer={selectedLayer}
                        layers={layers}
                        activeResizeId={activeResizeId}
                        responsiveControlsOpen={responsiveControlsOpen}
                        onResponsiveControlsOpenChange={setResponsiveControlsOpen}
                        onChange={(updates) => updateLayer(selectedLayer.id, updates)}
                        onAlign={alignSelectedLayers}
                    />
                ) : (
                    <div className="space-y-3">
                        <InspectorSection title="Размер" icon={<Maximize2 size={13} />}>
                            <TwoColumn>
                                <NumberField label="W" value={canvasWidth} min={1} onChange={(value) => setCanvasSize(Math.max(1, value), canvasHeight)} />
                                <NumberField label="H" value={canvasHeight} min={1} onChange={(value) => setCanvasSize(canvasWidth, Math.max(1, value))} />
                            </TwoColumn>
                        </InspectorSection>
                        <InspectorSection title="Стиль артборда" icon={<Paintbrush size={13} />}>
                            <PaintRow
                                label="Заливка"
                                value={artboardProps.fill}
                                gradientTargetId="artboard"
                                onChange={(fill) => updateArtboardProps({ fill })}
                                enabled={artboardProps.fillEnabled !== false}
                                onToggleEnabled={() => updateArtboardProps({ fillEnabled: !(artboardProps.fillEnabled !== false) })}
                                imagePanel={(
                                    <ArtboardBackgroundControls
                                        artboardProps={artboardProps}
                                        onUpdate={updateArtboardProps}
                                        paletteBackgrounds={palette.backgrounds}
                                        onApplyBackgroundSwatch={applyBackgroundSwatchToArtboard}
                                        onCreateSwatchFromBackground={createSwatchFromArtboardBackground}
                                        onUploadFile={handleBgFilePick}
                                        variant="sidebar"
                                    />
                                )}
                                imageActive={artboardFillImageActive}
                                imagePreviewSrc={artboardProps.backgroundImage?.src}
                                onPaintTab={() => {
                                    setArtboardFillTab("paint");
                                    updateArtboardProps({ backgroundImage: undefined });
                                }}
                                onImageTab={() => setArtboardFillTab("image")}
                                opacity={artboardProps.backgroundImage?.opacity}
                                onOpacityChange={(opacity) => artboardProps.backgroundImage
                                    ? updateArtboardProps({ backgroundImage: { ...artboardProps.backgroundImage, opacity } })
                                    : undefined}
                            />
                            <StrokeControls
                                value={{
                                    stroke: artboardProps.stroke || "#000000",
                                    strokeEnabled: !!artboardProps.strokeWidth && (!!artboardProps.stroke || !!artboardProps.strokeImage?.src),
                                    strokeMode: artboardProps.strokeMode,
                                    strokeImage: artboardProps.strokeImage,
                                    strokeWidth: artboardProps.strokeWidth,
                                    strokeAlign: artboardProps.strokeAlign,
                                    strokeJoin: artboardProps.strokeJoin,
                                }}
                                onChange={handleArtboardStrokeChange}
                                imagePanel={(
                                    <LayerImageFillPanel
                                        imageFill={artboardProps.strokeImage}
                                        onChange={(strokeImage) => updateArtboardProps(strokeImage
                                            ? { strokeImage, strokeMode: "image" }
                                            : { strokeImage: undefined, strokeMode: "paint" })}
                                    />
                                )}
                            />
                        </InspectorSection>
                        <CornerRadiusSection
                            cornerRadius={artboardProps.cornerRadius}
                            cornerRadii={artboardProps.cornerRadii}
                            onChange={updateArtboardProps}
                            clipContent={artboardProps.clipContent}
                            onClipChange={(clipContent) => updateArtboardProps({ clipContent })}
                        />
                        <LayoutGridsSection />
                    </div>
                )}
            </div>
        </aside>
    );
}

function LayerInspector({
    layer,
    layers,
    activeResizeId,
    responsiveControlsOpen,
    onResponsiveControlsOpenChange,
    onChange,
    onAlign,
}: {
    layer: Layer;
    layers: Layer[];
    activeResizeId: string;
    responsiveControlsOpen: boolean;
    onResponsiveControlsOpenChange: (open: boolean) => void;
    onChange: (updates: Partial<Layer>) => void;
    onAlign: (alignment: "left" | "center" | "right" | "top" | "middle" | "bottom") => void;
}) {
    const parentFrame = findParentFrame(layers, layer.id);
    const isInsideAutoLayout = !!parentFrame?.layoutMode && parentFrame.layoutMode !== "none";
    const widthModeConfig = getLayerSizeModeConfig(layer, "width", isInsideAutoLayout);
    const heightModeConfig = getLayerSizeModeConfig(layer, "height", isInsideAutoLayout);

    const lockAspectRatio = !!layer.lockAspectRatio;
    const aspect = layer.height !== 0 ? layer.width / layer.height : 1;

    // Slices are export regions — only position, size and export action apply.
    if (layer.type === "slice") {
        return (
            <div className="space-y-3">
                <InspectorSection title="Позиция" icon={<Move size={13} />}>
                    <TwoColumn>
                        <NumberField label="X" value={Math.round(layer.x)} onChange={(x) => onChange({ x } as Partial<Layer>)} />
                        <NumberField label="Y" value={Math.round(layer.y)} onChange={(y) => onChange({ y } as Partial<Layer>)} />
                    </TwoColumn>
                </InspectorSection>
                <InspectorSection title="Размер" icon={<Maximize2 size={13} />}>
                    <TwoColumn>
                        <NumberField label="W" value={Math.round(layer.width)} min={1} onChange={(width) => onChange({ width: Math.max(1, width) } as Partial<Layer>)} />
                        <NumberField label="H" value={Math.round(layer.height)} min={1} onChange={(height) => onChange({ height: Math.max(1, height) } as Partial<Layer>)} />
                    </TwoColumn>
                </InspectorSection>
                <InspectorSection title="Слайс" icon={<Slice size={13} />}>
                    <p className="text-[10px] text-text-tertiary leading-relaxed">
                        Область экспорта: слайс не попадает в результат, а вырезает участок макета в отдельный файл (PNG / SVG / EPS).
                    </p>
                    <button
                        type="button"
                        onClick={() => requestOpenExportModal(layer.id)}
                        className="w-full h-8 flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-border-primary text-xs text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
                    >
                        <Upload size={12} />
                        Экспортировать слайс
                    </button>
                </InspectorSection>
            </div>
        );
    }

    const handleSizeChange = (axis: "width" | "height", value: number) => {
        const base = resolveManualSizeUpdate(layer, axis, value, axis === "width" ? widthModeConfig : heightModeConfig);
        if (lockAspectRatio && aspect > 0) {
            const otherAxis = axis === "width" ? "height" : "width";
            const otherValue = axis === "width"
                ? Math.max(1, Math.round(value / aspect))
                : Math.max(1, Math.round(value * aspect));
            Object.assign(base, resolveManualSizeUpdate(layer, otherAxis, otherValue, otherAxis === "width" ? widthModeConfig : heightModeConfig));
            (base as Record<string, number>)[axis] = value;
            (base as Record<string, number>)[otherAxis] = otherValue;
        }
        onChange(base as Partial<Layer>);
    };

    return (
        <div className="space-y-3">
            <AlignmentSection disabled={isInsideAutoLayout} onAlign={onAlign} />
            <InspectorSection title="Позиция" icon={<Move size={13} />}>
                <TwoColumn>
                    <NumberField label="X" value={Math.round(layer.x)} onChange={(x) => onChange({ x } as Partial<Layer>)} />
                    <NumberField label="Y" value={Math.round(layer.y)} onChange={(y) => onChange({ y } as Partial<Layer>)} />
                </TwoColumn>
                <NumberField
                    label="Поворот"
                    value={Math.round(layer.rotation)}
                    icon={<RotateCw size={11} />}
                    onChange={(rotation) => onChange({ rotation } as Partial<Layer>)}
                />
                <div className="grid grid-cols-3 overflow-hidden rounded-[var(--radius-md)] border border-border-primary">
                    <IconButton title="Повернуть на 90 градусов вправо" onClick={() => onChange({ rotation: ((layer.rotation || 0) + 90) % 360 } as Partial<Layer>)}>
                        <RotateCw size={13} />
                    </IconButton>
                    <IconButton title="Отразить по горизонтали" active={!!layer.flipX} onClick={() => onChange({ flipX: !layer.flipX } as Partial<Layer>)}>
                        <FlipHorizontal size={13} />
                    </IconButton>
                    <IconButton title="Отразить по вертикали" active={!!layer.flipY} onClick={() => onChange({ flipY: !layer.flipY } as Partial<Layer>)}>
                        <FlipVertical size={13} />
                    </IconButton>
                </div>
            </InspectorSection>
            <InspectorSection title="Размер" icon={<Maximize2 size={13} />}>
                <div className="flex items-start gap-1.5">
                    <div className="grid flex-1 grid-cols-2 gap-2">
                        <SizeField
                            label="W"
                            value={Math.round(layer.width)}
                            min={1}
                            modeConfig={widthModeConfig}
                            onModeChange={(mode) => widthModeConfig && onChange(widthModeConfig.toUpdates(mode))}
                            onChange={(width) => handleSizeChange("width", width)}
                        />
                        <SizeField
                            label="H"
                            value={Math.round(layer.height)}
                            min={1}
                            modeConfig={heightModeConfig}
                            onModeChange={(mode) => heightModeConfig && onChange(heightModeConfig.toUpdates(mode))}
                            onChange={(height) => handleSizeChange("height", height)}
                        />
                    </div>
                    <button
                        type="button"
                        title={lockAspectRatio ? "Пропорции зафиксированы" : "Зафиксировать пропорции"}
                        onClick={() => onChange({ lockAspectRatio: !lockAspectRatio } as Partial<Layer>)}
                        className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border transition-colors cursor-pointer",
                            lockAspectRatio
                                ? "border-accent-primary/30 bg-accent-primary/10 text-accent-primary"
                                : "border-border-primary text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary",
                        )}
                    >
                        {lockAspectRatio ? <Link size={13} /> : <Unlink size={13} />}
                    </button>
                </div>
                {activeResizeId !== "master" && layer.masterId && layer.type === "image" && (
                    <IconToggle
                        active={!layer.detachedSizeSync}
                        label={!layer.detachedSizeSync ? "Размер синхронизируется" : "Размер отвязан"}
                        icon={!layer.detachedSizeSync ? <Link size={12} /> : <Unlink size={12} />}
                        onClick={() => onChange({ detachedSizeSync: !layer.detachedSizeSync } as Partial<Layer>)}
                    />
                )}
            </InspectorSection>
            {isInsideAutoLayout && (
                <AutoLayoutChildSection layer={layer} onChange={onChange} />
            )}
            <ConstraintsSection layer={layer} onChange={onChange} />
            <SliceAlignSection layer={layer} layers={layers} onChange={onChange} />
            <ResponsiveInspectorSection
                layer={layer}
                enabled={responsiveControlsOpen}
                onEnabledChange={onResponsiveControlsOpenChange}
                onChange={onChange}
            />
            {layer.type === "text" && <TextInspectorSection layer={layer} onChange={(updates) => onChange(updates as Partial<Layer>)} />}
            {layer.type === "image" && <ImageInspectorSection layer={layer} onChange={(updates) => onChange(updates as Partial<Layer>)} />}
            {layer.type === "rectangle" && <ShapeStyleSection layer={layer} onChange={(updates) => onChange(updates as Partial<Layer>)} />}
            {layer.type === "vector" && <VectorStyleSection layer={layer} onChange={(updates) => onChange(updates as Partial<Layer>)} />}
            {layer.type === "badge" && <BadgeInspectorSection layer={layer} onChange={(updates) => onChange(updates as Partial<Layer>)} />}
            {layer.type === "frame" && (
                <>
                    <FrameLayoutSection layer={layer} onChange={(updates) => onChange(updates as Partial<Layer>)} />
                    <ShapeStyleSection layer={layer} onChange={(updates) => onChange(updates as Partial<Layer>)} showClip />
                </>
            )}
        </div>
    );
}

function AlignmentSection({
    disabled,
    onAlign,
}: {
    disabled: boolean;
    onAlign: (alignment: "left" | "center" | "right" | "top" | "middle" | "bottom") => void;
}) {
    return (
        <InspectorSection title="Выравнивание" icon={<AlignCenter size={13} />}>
            <div className={cn("grid grid-cols-6 rounded-[var(--radius-md)] border border-border-primary overflow-hidden", disabled && "opacity-40 pointer-events-none")}>
                <IconButton title="По левому краю" onClick={() => onAlign("left")}><AlignLeft size={13} /></IconButton>
                <IconButton title="По центру" onClick={() => onAlign("center")}><AlignCenter size={13} /></IconButton>
                <IconButton title="По правому краю" onClick={() => onAlign("right")}><AlignRight size={13} /></IconButton>
                <IconButton title="По верхнему краю" onClick={() => onAlign("top")}><AlignLeft size={13} className="-rotate-90" /></IconButton>
                <IconButton title="По середине" onClick={() => onAlign("middle")}><AlignCenter size={13} className="rotate-90" /></IconButton>
                <IconButton title="По нижнему краю" onClick={() => onAlign("bottom")}><AlignRight size={13} className="-rotate-90" /></IconButton>
            </div>
        </InspectorSection>
    );
}

function ConstraintsSection({
    layer,
    onChange,
}: {
    layer: Layer;
    onChange: (updates: Partial<Layer>) => void;
}) {
    const constraints = layer.constraints ?? DEFAULT_CONSTRAINTS;
    return (
        <InspectorSection title="Привязка" icon={<Anchor size={13} />}>
            <div className="grid grid-cols-[72px_1fr] gap-2">
                <ConstraintsAnchorGrid
                    constraints={constraints}
                    onChange={(next) => onChange({ constraints: next } as Partial<Layer>)}
                />
                <div className="space-y-1.5">
                    <Select
                        size="xs"
                        value={constraints.horizontal}
                        onChange={(value) => onChange({ constraints: { ...constraints, horizontal: value as ConstraintH } } as Partial<Layer>)}
                        options={[
                            { value: "left", label: "Слева" },
                            { value: "right", label: "Справа" },
                            { value: "center", label: "По центру" },
                            { value: "stretch", label: "Растянуть" },
                            { value: "scale", label: "Масштаб" },
                        ]}
                    />
                    <Select
                        size="xs"
                        value={constraints.vertical}
                        onChange={(value) => onChange({ constraints: { ...constraints, vertical: value as ConstraintV } } as Partial<Layer>)}
                        options={[
                            { value: "top", label: "Сверху" },
                            { value: "bottom", label: "Снизу" },
                            { value: "center", label: "По центру" },
                            { value: "stretch", label: "Растянуть" },
                            { value: "scale", label: "Масштаб" },
                        ]}
                    />
                </div>
            </div>
            <Select
                size="xs"
                value={layer.slotId || "none"}
                onChange={(value) => onChange({ slotId: value as TemplateSlotRole } as Partial<Layer>)}
                options={[
                    { value: "none", label: "Без слота" },
                    { value: "headline", label: "Заголовок" },
                    { value: "subhead", label: "Подзаголовок" },
                    { value: "cta", label: "Кнопка" },
                    { value: "background", label: "Фон" },
                    { value: "image-primary", label: "Главное изображение" },
                    { value: "logo", label: "Логотип" },
                ]}
            />
            {layer.type === "frame" && (
                <input
                    value={(layer as FrameLayer).groupSlotId || ""}
                    onChange={(event) => onChange({ groupSlotId: event.target.value || undefined } as Partial<Layer>)}
                    placeholder="ID группового слота"
                    className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus placeholder:text-text-tertiary"
                />
            )}
        </InspectorSection>
    );
}

function SliceAlignSection({
    layer,
    layers,
    onChange,
}: {
    layer: Layer;
    layers: Layer[];
    onChange: (updates: Partial<Layer>) => void;
}) {
    const sliceAlign = layer.sliceAlign ?? DEFAULT_SLICE_ALIGN;
    const mode = sliceAlign.mode;
    const scope = sliceAlign.scope;
    const alignH = sliceAlign.alignH ?? "center";
    const alignV = sliceAlign.alignV ?? "center";
    const avoidOverlap = sliceAlign.avoidOverlap ?? false;
    const info = useMemo(() => describeSliceAlignment(layer, layers), [layer, layers]);

    const axisLabel = info.axes.x && info.axes.y
        ? "по обеим осям"
        : info.axes.x
            ? "по горизонтали"
            : info.axes.y
                ? "по вертикали"
                : "";

    const patch = (updates: Partial<SliceAlignSettings>) =>
        onChange({ sliceAlign: { ...sliceAlign, ...updates } } as Partial<Layer>);

    const setMode = (value: SliceAlignMode) => {
        if (value === "none") {
            onChange({ sliceAlign: undefined } as Partial<Layer>);
        } else {
            patch({ mode: value });
        }
    };

    return (
        <InspectorSection title="Привязка к слайсу" icon={<Slice size={13} />}>
            <Select
                size="xs"
                value={mode}
                onChange={(value) => setMode(value as SliceAlignMode)}
                options={[
                    { value: "none", label: "Нет" },
                    { value: "avoid_cut", label: "Не резать" },
                    { value: "fit", label: "Вписать по слайсу" },
                ]}
            />
            {mode !== "none" && (
                <>
                    <Select
                        size="xs"
                        value={scope}
                        onChange={(value) => patch({ scope: value as SliceAlignScope })}
                        options={[
                            { value: "frame", label: "Двигать фрейм" },
                            { value: "layer", label: "Двигать слой" },
                        ]}
                    />
                    {mode === "fit" && (
                        <>
                            <LabeledControl label="По горизонтали">
                                <Select
                                    size="xs"
                                    value={alignH}
                                    onChange={(value) => patch({ alignH: value as SliceAlignH })}
                                    options={[
                                        { value: "left", label: "Слева" },
                                        { value: "center", label: "По центру" },
                                        { value: "right", label: "Справа" },
                                    ]}
                                />
                            </LabeledControl>
                            <LabeledControl label="По вертикали">
                                <Select
                                    size="xs"
                                    value={alignV}
                                    onChange={(value) => patch({ alignV: value as SliceAlignV })}
                                    options={[
                                        { value: "top", label: "По верху" },
                                        { value: "center", label: "По центру" },
                                        { value: "bottom", label: "По низу" },
                                    ]}
                                />
                            </LabeledControl>
                        </>
                    )}
                    {mode === "avoid_cut" && (
                        <ToggleButton
                            active={avoidOverlap}
                            label="Не перекрывать слои"
                            onClick={() => patch({ avoidOverlap: !avoidOverlap })}
                        />
                    )}
                    {!info.hasGrid ? (
                        <p className="text-[10px] text-text-tertiary leading-relaxed">
                            Нет активной сетки слайсов. Создайте слайсы (≥2 по оси), чтобы появились линии реза.
                        </p>
                    ) : (
                        <>
                            <p className="text-[10px] text-text-tertiary leading-relaxed">
                                {mode === "avoid_cut"
                                    ? `Слой сдвигается ${axisLabel}, чтобы не попадать на линию реза.${avoidOverlap ? " Сдвиг ограничен так, чтобы не наезжать на другие слои." : ""}`
                                    : `Объект масштабируется под ячейку слайса ${axisLabel} и выравнивается по выбранным краям.`}
                                {scope === "layer" && " Слой будет откреплён от auto-layout."}
                            </p>
                            {mode === "avoid_cut" && !info.avoidCutFeasible && (
                                <p className="text-[10px] text-amber-500 leading-relaxed">
                                    Слой больше слайса по активной оси — сдвиг невозможен. Используйте «Вписать по слайсу».
                                </p>
                            )}
                        </>
                    )}
                </>
            )}
        </InspectorSection>
    );
}

function ResponsiveInspectorSection({
    layer,
    enabled,
    onEnabledChange,
    onChange,
}: {
    layer: Layer;
    enabled: boolean;
    onEnabledChange: (enabled: boolean) => void;
    onChange: (updates: Partial<Layer>) => void;
}) {
    const responsive = layer.responsive ?? {};
    const supportsFontLimits = layer.type === "text" || layer.type === "badge";

    const updateResponsive = (updates: Partial<LayerResponsiveSettings>) => {
        onChange({ responsive: compactResponsiveSettings({ ...responsive, ...updates }) } as Partial<Layer>);
    };

    return (
        <InspectorSection title="Адаптация" icon={<SlidersHorizontal size={13} />}>
            <ToggleButton
                active={enabled}
                icon={<SlidersHorizontal size={12} />}
                label="Расширенные"
                onClick={() => onEnabledChange(!enabled)}
            />
            {enabled && (
                <>
                    <LabeledControl label="Роль">
                        <input
                            value={responsive.role ?? ""}
                            onChange={(event) => updateResponsive({ role: event.target.value })}
                            placeholder={layer.slotId && layer.slotId !== "none" ? layer.slotId : layer.name}
                            className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus placeholder:text-text-tertiary"
                        />
                    </LabeledControl>
                    <Select
                        size="xs"
                        value={responsive.behavior ?? "auto"}
                        onChange={(behavior) => updateResponsive({ behavior: behavior as LayerResponsiveBehavior })}
                        options={[
                            { value: "auto", label: "Авто" },
                            { value: "fixed", label: "Фикс." },
                            { value: "fluid", label: "Гибкая" },
                            { value: "background", label: "Фон" },
                        ]}
                    />
                    <ToggleButton
                        active={!!responsive.canHide}
                        label="Скрывать"
                        title="Скрывать слой, если он не влезает в новый формат после адаптации."
                        icon={responsive.canHide ? <EyeOff size={12} /> : <Eye size={12} />}
                        onClick={() => updateResponsive({ canHide: !responsive.canHide })}
                    />
                    {supportsFontLimits && (
                        <>
                            <ToggleButton
                                active={responsive.textFit === "shrink"}
                                label="Уменьшать шрифт"
                                title="Уменьшать кегль, если текст не влезает в фиксированный блок при адаптации."
                                icon={<ALargeSmall size={12} />}
                                onClick={() => updateResponsive({
                                    textFit: responsive.textFit === "shrink" ? undefined : "shrink",
                                })}
                            />
                            <NumberField
                                label="Строк макс."
                                value={responsive.maxLines ?? 0}
                                min={0}
                                onChange={(maxLines) => updateResponsive({
                                    maxLines: maxLines > 0 ? Math.round(maxLines) : undefined,
                                })}
                            />
                            <TwoColumn>
                                <NumberField
                                    label="Min"
                                    value={responsive.minFontSize ?? 8}
                                    min={1}
                                    onChange={(minFontSize) => updateResponsive({ minFontSize })}
                                />
                                <NumberField
                                    label="Max"
                                    value={responsive.maxFontSize ?? 0}
                                    min={0}
                                    onChange={(maxFontSize) => updateResponsive({ maxFontSize: maxFontSize > 0 ? maxFontSize : undefined })}
                                />
                            </TwoColumn>
                            <TwoColumn>
                                <NumberField
                                    label="Min W"
                                    value={responsive.minWidth ?? 0}
                                    min={0}
                                    onChange={(minWidth) => updateResponsive({
                                        minWidth: minWidth > 0 ? minWidth : undefined,
                                    })}
                                />
                                <NumberField
                                    label="Max W"
                                    value={responsive.maxWidth ?? 0}
                                    min={0}
                                    onChange={(maxWidth) => updateResponsive({
                                        maxWidth: maxWidth > 0 ? maxWidth : undefined,
                                    })}
                                />
                            </TwoColumn>
                            <TwoColumn>
                                <NumberField
                                    label="Min H"
                                    value={responsive.minHeight ?? 0}
                                    min={0}
                                    onChange={(minHeight) => updateResponsive({
                                        minHeight: minHeight > 0 ? minHeight : undefined,
                                    })}
                                />
                                <NumberField
                                    label="Max H"
                                    value={responsive.maxHeight ?? 0}
                                    min={0}
                                    onChange={(maxHeight) => updateResponsive({
                                        maxHeight: maxHeight > 0 ? maxHeight : undefined,
                                    })}
                                />
                            </TwoColumn>
                        </>
                    )}
                </>
            )}
        </InspectorSection>
    );
}

function compactResponsiveSettings(settings: LayerResponsiveSettings): LayerResponsiveSettings | undefined {
    const next: LayerResponsiveSettings = { ...settings };
    if (!next.role?.trim()) delete next.role;
    else next.role = next.role.trim();
    if (!next.behavior || next.behavior === "auto") delete next.behavior;
    if (!next.canHide) delete next.canHide;
    if (!next.textFit) delete next.textFit;
    if (!next.maxLines || next.maxLines <= 0) delete next.maxLines;
    if (!next.minWidth || next.minWidth <= 0) delete next.minWidth;
    if (!next.maxWidth || next.maxWidth <= 0) delete next.maxWidth;
    if (!next.minHeight || next.minHeight <= 0) delete next.minHeight;
    if (!next.maxHeight || next.maxHeight <= 0) delete next.maxHeight;
    if (next.minFontSize === undefined || next.minFontSize === 8) delete next.minFontSize;
    if (next.maxFontSize === undefined || next.maxFontSize <= 0) delete next.maxFontSize;
    return Object.keys(next).length > 0 ? next : undefined;
}

function AutoLayoutChildSection({ layer, onChange }: { layer: Layer; onChange: (updates: Partial<Layer>) => void }) {
    return (
        <InspectorSection title="Авто-лейаут" icon={<LayoutDashboard size={13} />}>
            <ToggleButton
                active={!!layer.isAbsolutePositioned}
                label="Абсолютная позиция"
                onClick={() => onChange({ isAbsolutePositioned: !layer.isAbsolutePositioned } as Partial<Layer>)}
            />
        </InspectorSection>
    );
}

function FrameLayoutSection({ layer, onChange }: { layer: FrameLayer; onChange: (updates: Partial<FrameLayer>) => void }) {
    const enabled = layer.layoutMode && layer.layoutMode !== "none";
    const [individualPaddingOpen, setIndividualPaddingOpen] = useState(false);
    const horizontalPadding = layer.paddingLeft ?? layer.paddingRight ?? 0;
    const verticalPadding = layer.paddingTop ?? layer.paddingBottom ?? 0;
    return (
        <InspectorSection title="Авто-лейаут" icon={<LayoutDashboard size={13} />}>
            <div className="grid grid-cols-3 overflow-hidden rounded-[var(--radius-md)] border border-border-primary">
                {(["none", "horizontal", "vertical"] as const).map((mode) => (
                    <button
                        key={mode}
                        onClick={() => {
                            const prev = layer.layoutMode || "none";
                            if (
                                prev !== mode
                                && prev !== "none"
                                && mode !== "none"
                                && (prev === "horizontal" || prev === "vertical")
                                && (mode === "horizontal" || mode === "vertical")
                            ) {
                                const swapped = swapAlignmentsForDirectionChange(
                                    layer.primaryAxisAlignItems || "flex-start",
                                    layer.counterAxisAlignItems || "flex-start",
                                );
                                onChange({ layoutMode: mode, ...swapped });
                                return;
                            }
                            onChange({ layoutMode: mode });
                        }}
                        className={cn(
                            "flex h-8 items-center justify-center border-r border-border-primary text-[10px] transition-colors last:border-r-0 cursor-pointer",
                            (layer.layoutMode || "none") === mode
                                ? "bg-accent-primary/10 text-accent-primary"
                                : "text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary",
                        )}
                        title={mode === "none" ? "Авто-лейаут выключен" : mode === "horizontal" ? "Горизонтально" : "Вертикально"}
                    >
                        {mode === "none" ? <Grid3X3 size={13} /> : mode === "horizontal" ? <ArrowRight size={14} /> : <ArrowDown size={14} />}
                    </button>
                ))}
            </div>
            {enabled && (
                <>
                    <AutoLayoutAlignmentGrid
                        layoutMode={layer.layoutMode === "vertical" ? "vertical" : "horizontal"}
                        primary={layer.primaryAxisAlignItems || "flex-start"}
                        counter={layer.counterAxisAlignItems || "flex-start"}
                        onChange={(updates) => onChange(updates)}
                    />
                    <div className="grid grid-cols-[1fr_28px] gap-2">
                        <div className="grid grid-cols-2 gap-2">
                            <CompactNumberField
                                label="Горизонтальные отступы"
                                icon={<MoveHorizontal size={12} />}
                                value={horizontalPadding}
                                min={0}
                                onChange={(value) => onChange({ paddingLeft: value, paddingRight: value })}
                            />
                            <CompactNumberField
                                label="Вертикальные отступы"
                                icon={<MoveVertical size={12} />}
                                value={verticalPadding}
                                min={0}
                                onChange={(value) => onChange({ paddingTop: value, paddingBottom: value })}
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setIndividualPaddingOpen((open) => !open)}
                            className={cn(
                                "flex h-8 items-center justify-center rounded-[var(--radius-md)] border border-border-primary text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary",
                                individualPaddingOpen && "bg-accent-primary/10 text-accent-primary",
                            )}
                            title="Индивидуальные отступы"
                        >
                            <Plus size={13} />
                        </button>
                    </div>
                    {individualPaddingOpen && (
                        <TwoColumn>
                            <CompactNumberField label="Отступ сверху" icon={<PanelTop size={12} />} value={layer.paddingTop || 0} min={0} onChange={(paddingTop) => onChange({ paddingTop })} />
                            <CompactNumberField label="Отступ справа" icon={<PanelRight size={12} />} value={layer.paddingRight || 0} min={0} onChange={(paddingRight) => onChange({ paddingRight })} />
                            <CompactNumberField label="Отступ снизу" icon={<PanelBottom size={12} />} value={layer.paddingBottom || 0} min={0} onChange={(paddingBottom) => onChange({ paddingBottom })} />
                            <CompactNumberField label="Отступ слева" icon={<PanelLeft size={12} />} value={layer.paddingLeft || 0} min={0} onChange={(paddingLeft) => onChange({ paddingLeft })} />
                        </TwoColumn>
                    )}
                    <CompactNumberField
                        label="Интервал"
                        icon={layer.layoutMode === "horizontal" ? <BetweenHorizontalStart size={12} /> : <BetweenVerticalStart size={12} />}
                        value={layer.spacing || 0}
                        min={0}
                        onChange={(spacing) => onChange({ spacing })}
                    />
                </>
            )}
        </InspectorSection>
    );
}

function TextInspectorSection({ layer, onChange }: { layer: TextLayer; onChange: (updates: Partial<TextLayer>) => void }) {
    const [availableFonts, setAvailableFonts] = useState<string[]>(SYSTEM_FONTS);
    const [isUploadingFont, setIsUploadingFont] = useState(false);
    const { currentWorkspace } = useWorkspace();
    const { assets: workspaceFontAssets } = useAssetList("FONT");
    const { uploadFile } = useAssetUpload();
    const workspaceFontNames = useMemo(
        () => workspaceFontAssets.map((asset) => {
            const metadata = asset.metadata;
            const family = metadata && typeof metadata === "object" && !Array.isArray(metadata) && "family" in metadata
                ? (metadata as { family?: unknown }).family
                : undefined;
            return String(family || normalizeFontFamilyName(asset.filename));
        }),
        [workspaceFontAssets],
    );
    const availableWeights = useMemo(() => {
        if (typeof document === "undefined") return ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
        const weights = new Set<string>();
        let isVariable = false;
        document.fonts.forEach((font) => {
            const familyName = font.family.replace(/['"]/g, "");
            if (familyName !== layer.fontFamily) return;
            if (font.weight.includes(" ")) {
                isVariable = true;
            } else {
                weights.add(font.weight === "normal" ? "400" : font.weight === "bold" ? "700" : font.weight);
            }
        });
        return isVariable || weights.size === 0
            ? ["100", "200", "300", "400", "500", "600", "700", "800", "900"]
            : Array.from(weights).sort();
    }, [layer.fontFamily]);
    const isFontMissing = useMemo(() => {
        const known = [...getAvailableFontFamiliesSync(), ...workspaceFontNames];
        return !!layer.fontFamily && !known.some((font) => font.toLowerCase() === layer.fontFamily.toLowerCase());
    }, [layer.fontFamily, workspaceFontNames]);

    useEffect(() => {
        void getUserFonts().then((userFonts) => {
            setAvailableFonts(Array.from(new Set([
                ...SYSTEM_FONTS,
                ...PREINSTALLED_FONTS.map((font) => font.name),
                ...userFonts.map((font) => font.name),
                ...workspaceFontNames,
            ])).sort());
        }).catch((err) => {
            console.error("Failed to load custom fonts:", err);
        });
    }, [workspaceFontNames]);

    // Wait for the font (family + weight) to actually load before applying it,
    // then drop stale fallback measurements so the text box sizes to the real
    // glyphs on the first click instead of needing a re-select.
    const ensureFontLoaded = async (family: string, weight?: string | number) => {
        if (typeof document !== "undefined" && "fonts" in document) {
            try {
                await document.fonts.load(`${weight ?? layer.fontWeight ?? 400} 16px "${family}"`);
            } catch {
                /* ignore — fall back to whatever is available */
            }
        }
        clearTextMeasureCache();
    };

    return (
        <InspectorSection title="Текст" icon={<Type size={13} />}>
            {isFontMissing && (
                <div className="rounded-[var(--radius-md)] border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-500">
                    Шрифт «{layer.fontFamily}» не установлен
                </div>
            )}
            <Select
                size="xs"
                value={layer.fontFamily}
                onChange={async (fontFamily) => {
                    await ensureFontLoaded(fontFamily);
                    onChange({ fontFamily });
                }}
                options={availableFonts.map((font) => ({ value: font, label: font }))}
            />
            <TwoColumn>
                <Select
                    size="xs"
                    value={layer.fontWeight}
                    onChange={async (fontWeight) => {
                        await ensureFontLoaded(layer.fontFamily, fontWeight);
                        onChange({ fontWeight });
                    }}
                    options={availableWeights.map((weight) => ({ value: weight, label: weightLabel(weight) }))}
                />
                <NumberField label="Размер" icon={<ALargeSmall size={13} />} value={layer.fontSize} min={1} onChange={(fontSize) => onChange({ fontSize })} />
                <NumberField label="Интерлиньяж" icon={<AlignVerticalSpaceAround size={13} />} suffix="%" value={Math.round((layer.lineHeight || 1.2) * 100)} min={1} onChange={(lineHeight) => onChange({ lineHeight: lineHeight / 100 })} />
                <NumberField label="Трекинг" icon={<MoveHorizontal size={13} />} value={layer.letterSpacing} step={0.1} onChange={(letterSpacing) => onChange({ letterSpacing })} />
            </TwoColumn>
            <TwoColumn>
                <TextAdjustSwitcher
                    value={layer.textAdjust || "auto_width"}
                    onChange={(value) => {
                        const updates: Partial<TextLayer> = { textAdjust: value as TextLayer["textAdjust"] };
                        if (value === "auto_width" && layer.layoutSizingWidth === "fill") updates.layoutSizingWidth = "fixed";
                        if (value === "auto_height" && layer.layoutSizingHeight === "fill") updates.layoutSizingHeight = "fixed";
                        onChange(updates);
                    }}
                />
                <Select
                    size="xs"
                    value={layer.textTransform || "none"}
                    onChange={(textTransform) => onChange({ textTransform: textTransform as TextLayer["textTransform"] })}
                    options={[
                        { value: "none", label: "Без изменений" },
                        { value: "uppercase", label: "Верхний" },
                        { value: "lowercase", label: "Нижний" },
                    ]}
                />
            </TwoColumn>
            <div className="grid grid-cols-3 rounded-[var(--radius-md)] border border-border-primary overflow-hidden">
                <IconButton title="По левому краю" active={layer.align === "left"} onClick={() => onChange({ align: "left" })}><AlignLeft size={13} /></IconButton>
                <IconButton title="По центру" active={layer.align === "center"} onClick={() => onChange({ align: "center" })}><AlignCenter size={13} /></IconButton>
                <IconButton title="По правому краю" active={layer.align === "right"} onClick={() => onChange({ align: "right" })}><AlignRight size={13} /></IconButton>
            </div>
            <div className="grid grid-cols-3 rounded-[var(--radius-md)] border border-border-primary overflow-hidden">
                {(["top", "middle", "bottom"] as const).map((align) => (
                    <IconButton key={align} title={align === "top" ? "По верхнему краю" : align === "middle" ? "По середине" : "По нижнему краю"} active={(layer.verticalAlign || "top") === align} onClick={() => onChange({ verticalAlign: align })}>
                        <VerticalAlignGlyph align={align} />
                    </IconButton>
                ))}
            </div>
            <TwoColumn>
                <ToggleButton active={!!layer.verticalTrim} label="Vertical trim" onClick={() => onChange({ verticalTrim: !layer.verticalTrim, baselineTrim: false })} />
                <ToggleButton active={!!layer.baselineTrim} label="Baseline trim" onClick={() => onChange({ baselineTrim: !layer.baselineTrim, verticalTrim: false })} />
            </TwoColumn>
            <div className="grid grid-cols-1">
                <ToggleButton active={!!layer.truncateText} label="Truncate text" onClick={() => onChange({ truncateText: !layer.truncateText })} />
            </div>
            <PaintRow
                label="Заливка"
                value={layer.fill}
                allowGradient={false}
                enabled={layer.fillEnabled !== false}
                onToggleEnabled={() => onChange({ fillEnabled: !(layer.fillEnabled !== false) })}
                onChange={(fill) => {
                    const solid = normalizePaint(fill);
                    if (solid.kind === "solid") onChange({ fill: solid.color });
                }}
            />
            <OpacityControl value={layer.opacity ?? 1} onChange={(opacity) => onChange({ opacity })} />
            <label className="flex items-center justify-center gap-1.5 h-8 rounded-[var(--radius-md)] border border-dashed border-border-focus text-[10px] text-text-secondary hover:bg-bg-tertiary cursor-pointer transition-colors">
                <Upload size={12} />
                {isUploadingFont ? "Загрузка..." : "Загрузить шрифт"}
                <input
                    type="file"
                    accept=".ttf,.otf,.woff,.woff2"
                    className="hidden"
                    disabled={isUploadingFont}
                    onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        const fontName = normalizeFontFamilyName(file.name);
                        if (!fontName) return;
                        setIsUploadingFont(true);
                        try {
                            const buffer = await file.arrayBuffer();
                            const face = new FontFace(fontName, buffer);
                            const loaded = await face.load();
                            document.fonts.add(loaded);
                            await saveUserFont(fontName, buffer);
                            if (currentWorkspace?.id) {
                                await uploadFile(file, {
                                    type: "FONT",
                                    workspaceId: currentWorkspace.id,
                                    metadata: { family: fontName },
                                });
                            }
                            setAvailableFonts((prev) => Array.from(new Set([...prev, fontName])).sort());
                            clearTextMeasureCache();
                            onChange({ fontFamily: fontName });
                        } catch (err) {
                            console.error("Failed to install font:", err);
                        } finally {
                            setIsUploadingFont(false);
                            event.target.value = "";
                        }
                    }}
                />
            </label>
        </InspectorSection>
    );
}

function ImageInspectorSection({ layer, onChange }: { layer: ImageLayer; onChange: (updates: Partial<ImageLayer>) => void }) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const fitModes: ImageFitMode[] = ["cover", "contain", "fill", "crop"];

    return (
        <>
            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    setIsUploading(true);
                    import("@/utils/imageUpload").then(({ compressImageFile, uploadForAI: uploadImage }) => {
                        compressImageFile(file).then((compressedBase64) => {
                            onChange({ src: compressedBase64, fillMode: "image" });
                            return uploadImage(compressedBase64, "tmp");
                        }).then((src) => {
                            if (src) onChange({ src, fillMode: "image" });
                        }).finally(() => setIsUploading(false));
                    }).catch(() => setIsUploading(false));
                }}
            />
            <InspectorSection title="Стиль" icon={<Paintbrush size={13} />}>
                <OpacityControl value={layer.opacity ?? 1} onChange={(opacity) => onChange({ opacity })} />
                <PaintRow
                    label="Заливка"
                    value={layer.fill ?? "#FFFFFF"}
                    gradientTargetId={layer.id}
                    enabled={layer.fillEnabled !== false}
                    onToggleEnabled={() => onChange({ fillEnabled: !(layer.fillEnabled !== false) })}
                    onChange={(fill) => onChange({ fill, fillMode: "paint" })}
                    imageActive={(layer.fillMode ?? "image") === "image"}
                    onPaintTab={() => onChange({ fillMode: "paint", fill: layer.fill ?? "#FFFFFF" })}
                    onImageTab={() => onChange({ fillMode: "image" })}
                    imagePreviewSrc={layer.src}
                    opacity={(layer.fillMode ?? "image") === "image"
                        ? undefined
                        : paintOpacity(layer.fill ?? "#FFFFFF")}
                    imagePanel={(
                        <ImageSourceStylePanel
                            fitModes={fitModes}
                            fit={layer.objectFit || "cover"}
                            focusX={layer.focusX}
                            focusY={layer.focusY}
                            onFitChange={(objectFit) => onChange({ objectFit })}
                            onFocusChange={(updates) => onChange(updates)}
                            onReplaceImage={() => fileRef.current?.click()}
                            isReplacingImage={isUploading}
                            replaceImageLabel={isUploading ? "Загрузка..." : "Заменить изображение"}
                        />
                    )}
                />
                <StrokeControls
                    value={{
                        stroke: layer.stroke || "#000000",
                        strokeEnabled: layer.strokeEnabled ?? false,
                        strokeMode: layer.strokeMode,
                        strokeImage: layer.strokeImage,
                        strokeWidth: layer.strokeWidth ?? 0,
                        strokeAlign: layer.strokeAlign,
                        strokeJoin: layer.strokeJoin,
                    }}
                    onChange={onChange}
                    imagePanel={(
                        <LayerImageFillPanel
                            imageFill={layer.strokeImage}
                            onChange={(strokeImage) => onChange(strokeImage
                                ? { strokeImage, strokeMode: "image" }
                                : { strokeImage: undefined, strokeMode: "paint" })}
                        />
                    )}
                />
            </InspectorSection>
            <CornerRadiusSection
                cornerRadius={layer.cornerRadius ?? 0}
                cornerRadii={layer.cornerRadii}
                onChange={onChange}
            />
        </>
    );
}

function ShapeStyleSection({
    layer,
    onChange,
    showClip = false,
}: {
    layer: RectangleLayer | FrameLayer;
    onChange: (updates: Partial<RectangleLayer | FrameLayer>) => void;
    showClip?: boolean;
}) {
    const fillEnabled = layer.fillEnabled !== false;
    const fillMode = layer.fillMode ?? "paint";
    return (
        <>
            <InspectorSection title="Стиль" icon={<Paintbrush size={13} />}>
                <OpacityControl value={layer.opacity ?? 1} onChange={(opacity) => onChange({ opacity })} />
                <PaintRow
                    label="Заливка"
                    value={layer.fill}
                    gradientTargetId={layer.id}
                    enabled={fillEnabled}
                    onToggleEnabled={() => onChange({ fillEnabled: !fillEnabled })}
                    onChange={(fill) => onChange({ fill, fillMode: "paint" })}
                    imageActive={fillMode === "image"}
                    imagePreviewSrc={layer.imageFill?.src}
                    onPaintTab={() => onChange({ fillMode: "paint" })}
                    onImageTab={() => onChange({ fillMode: "image" })}
                    opacity={fillMode === "image" ? layer.imageFill?.opacity : paintOpacity(layer.fill)}
                    onOpacityChange={(opacity) => fillMode === "image" && layer.imageFill
                        ? onChange({ imageFill: { ...layer.imageFill, opacity } })
                        : undefined}
                    imagePanel={(
                        <LayerImageFillPanel
                            imageFill={layer.imageFill}
                            onChange={(imageFill) => onChange(imageFill
                                ? { imageFill, fillMode: "image" }
                                : { imageFill: undefined, fillMode: "paint" })}
                        />
                    )}
                />
                <StrokeControls
                    value={{
                        stroke: layer.stroke || "#000000",
                        strokeEnabled: layer.strokeEnabled,
                        strokeMode: layer.strokeMode,
                        strokeImage: layer.strokeImage,
                        strokeWidth: layer.strokeWidth,
                        strokeAlign: layer.strokeAlign,
                        strokeJoin: layer.strokeJoin,
                    }}
                    onChange={onChange}
                    imagePanel={(
                        <LayerImageFillPanel
                            imageFill={layer.strokeImage}
                            onChange={(strokeImage) => onChange(strokeImage
                                ? { strokeImage, strokeMode: "image" }
                                : { strokeImage: undefined, strokeMode: "paint" })}
                        />
                    )}
                />
            </InspectorSection>
            <CornerRadiusSection
                cornerRadius={layer.cornerRadius}
                cornerRadii={layer.cornerRadii}
                onChange={onChange}
                clipContent={showClip && layer.type === "frame" ? layer.clipContent : undefined}
                onClipChange={showClip && layer.type === "frame"
                    ? (clipContent) => onChange({ clipContent })
                    : undefined}
            />
        </>
    );
}

function BadgeInspectorSection({ layer, onChange }: { layer: BadgeLayer; onChange: (updates: Partial<BadgeLayer>) => void }) {
    const fillEnabled = layer.fillEnabled !== false;
    return (
        <InspectorSection title="Бейдж" icon={<Paintbrush size={13} />}>
            <input
                value={layer.label}
                onChange={(event) => onChange({ label: event.target.value })}
                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
            <Select
                size="xs"
                value={layer.shape}
                onChange={(shape) => onChange({ shape: shape as BadgeLayer["shape"] })}
                options={[
                    { value: "pill", label: "Плашка" },
                    { value: "rectangle", label: "Прямоугольник" },
                    { value: "circle", label: "Круг" },
                ]}
            />
            <OpacityControl value={layer.opacity ?? 1} onChange={(opacity) => onChange({ opacity })} />
            <PaintRow
                label="Заливка"
                value={layer.fill}
                gradientTargetId={layer.id}
                enabled={fillEnabled}
                onToggleEnabled={() => onChange({ fillEnabled: !fillEnabled })}
                onChange={(fill) => onChange({ fill })}
            />
            <LabeledControl label="Цвет текста">
                <ColorInput value={layer.textColor} onChange={(textColor) => onChange({ textColor })} />
            </LabeledControl>
        </InspectorSection>
    );
}

function VectorStyleSection({
    layer,
    onChange,
}: {
    layer: VectorLayer;
    onChange: (updates: Partial<VectorLayer>) => void;
}) {
    const fillEnabled = layer.fillEnabled !== false;
    const vectorEditLayerId = useCanvasStore((s) => s.vectorEditLayerId);
    const setVectorEditLayerId = useCanvasStore((s) => s.setVectorEditLayerId);
    const updateLayer = useCanvasStore((s) => s.updateLayer);
    const isEditing = vectorEditLayerId === layer.id;
    return (
        <InspectorSection title="Стиль" icon={<Paintbrush size={13} />}>
            <IconToggle
                active={isEditing}
                label={isEditing ? "Завершить редактирование точек" : "Редактировать точки"}
                icon={<PenTool size={12} />}
                onClick={() => {
                    if (isEditing) {
                        setVectorEditLayerId(null);
                        return;
                    }
                    enterVectorEditMode(layer, updateLayer, setVectorEditLayerId);
                }}
            />
            <OpacityControl value={layer.opacity ?? 1} onChange={(opacity) => onChange({ opacity })} />
            <PaintRow
                label="Заливка"
                value={layer.fill}
                gradientTargetId={layer.id}
                enabled={fillEnabled}
                onToggleEnabled={() => onChange({ fillEnabled: !fillEnabled })}
                onChange={(fill) => onChange({ fill })}
            />
            <StrokeControls
                value={{
                    stroke: layer.stroke || "#000000",
                    strokeEnabled: layer.strokeEnabled,
                    strokeWidth: layer.strokeWidth ?? 0,
                    strokeAlign: layer.strokeAlign,
                    strokeJoin: layer.strokeJoin,
                }}
                onChange={(updates) => onChange(updates as Partial<VectorLayer>)}
            />
        </InspectorSection>
    );
}

function CornerRadiusSection({
    cornerRadius,
    cornerRadii,
    onChange,
    clipContent,
    onClipChange,
}: {
    cornerRadius: number;
    cornerRadii?: CornerRadii;
    onChange: (updates: { cornerRadius?: number; cornerRadii?: CornerRadii }) => void;
    clipContent?: boolean;
    onClipChange?: (clipContent: boolean) => void;
}) {
    const [individualCornersOpen, setIndividualCornersOpen] = useState(false);
    const topLeft = cornerRadii?.topLeft ?? cornerRadius;
    const topRight = cornerRadii?.topRight ?? cornerRadius;
    const bottomRight = cornerRadii?.bottomRight ?? cornerRadius;
    const bottomLeft = cornerRadii?.bottomLeft ?? cornerRadius;
    const allEqual = topLeft === topRight && topRight === bottomRight && bottomRight === bottomLeft;

    const updateAll = (value: number) => {
        const next = Math.max(0, value);
        onChange({
            cornerRadius: next,
            cornerRadii: allEqual ? undefined : {
                topLeft: next,
                topRight: next,
                bottomRight: next,
                bottomLeft: next,
            },
        });
    };

    const updateCorner = (corner: keyof CornerRadii, value: number) => {
        const nextRadii = {
            topLeft,
            topRight,
            bottomRight,
            bottomLeft,
            [corner]: Math.max(0, value),
        };
        const values = [nextRadii.topLeft, nextRadii.topRight, nextRadii.bottomRight, nextRadii.bottomLeft];
        const nextAllEqual = values.every((radius) => radius === values[0]);
        onChange({
            cornerRadius: nextAllEqual ? values[0] : cornerRadius,
            cornerRadii: nextAllEqual ? undefined : nextRadii,
        });
    };

    return (
        <InspectorSection title="Скругления">
            <div className="grid grid-cols-[1fr_28px] gap-2">
                <NumberField
                    label="R"
                    value={cornerRadius}
                    min={0}
                    onChange={updateAll}
                    icon={<CornerGlyph corner="all" />}
                />
                <button
                    type="button"
                    onClick={() => setIndividualCornersOpen((open) => !open)}
                    className={cn(
                        "flex h-8 items-center justify-center rounded-[var(--radius-md)] border border-border-primary text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary",
                        individualCornersOpen && "bg-accent-primary/10 text-accent-primary",
                        !allEqual && "border-accent-primary/30 text-accent-primary",
                    )}
                    title={allEqual ? "Отдельные скругления" : "Разные скругления"}
                >
                    <Grid3X3 size={13} />
                </button>
            </div>
            {individualCornersOpen && (
                <TwoColumn>
                    <NumberField
                        label="TL"
                        value={topLeft}
                        min={0}
                        onChange={(value) => updateCorner("topLeft", value)}
                        icon={<CornerGlyph corner="topLeft" />}
                    />
                    <NumberField
                        label="TR"
                        value={topRight}
                        min={0}
                        onChange={(value) => updateCorner("topRight", value)}
                        icon={<CornerGlyph corner="topRight" />}
                    />
                    <NumberField
                        label="BL"
                        value={bottomLeft}
                        min={0}
                        onChange={(value) => updateCorner("bottomLeft", value)}
                        icon={<CornerGlyph corner="bottomLeft" />}
                    />
                    <NumberField
                        label="BR"
                        value={bottomRight}
                        min={0}
                        onChange={(value) => updateCorner("bottomRight", value)}
                        icon={<CornerGlyph corner="bottomRight" />}
                    />
                </TwoColumn>
            )}
            {onClipChange && clipContent !== undefined && (
                <ToggleButton
                    active={clipContent}
                    icon={<Scissors size={12} />}
                    label="Обрезать содержимое"
                    onClick={() => onClipChange(!clipContent)}
                />
            )}
        </InspectorSection>
    );
}

function InspectorSection({ title, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
    return (
        <section className="border-b border-border-primary pb-3 last:border-b-0 last:pb-0">
            <div className="mb-2 text-[12px] font-semibold text-text-primary">
                {title}
            </div>
            <div className="space-y-2">{children}</div>
        </section>
    );
}

function CornerGlyph({ corner }: { corner: "all" | keyof CornerRadii }) {
    const borderClasses = {
        all: "rounded-[4px]",
        topLeft: "rounded-tl-[5px]",
        topRight: "rounded-tr-[5px]",
        bottomRight: "rounded-br-[5px]",
        bottomLeft: "rounded-bl-[5px]",
    }[corner];
    return <span className={cn("block h-3.5 w-3.5 border border-current", borderClasses)} />;
}

function LabeledControl({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1 block text-[9px] uppercase tracking-wider text-text-tertiary">{label}</span>
            {children}
        </label>
    );
}

function NumberField({
    label,
    value,
    onChange,
    min,
    max,
    step,
    icon,
    suffix,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    icon?: ReactNode;
    suffix?: string;
}) {
    const scrub = useNumberScrub({ value, onChange, min, max, step });
    return (
        <div className="relative">
            <span
                {...scrub}
                className="absolute left-2 top-1/2 z-10 flex -translate-y-1/2 cursor-ew-resize items-center text-[11px] font-medium text-text-tertiary hover:text-text-primary"
                title="Изменить значение"
            >
                {icon ?? label}
            </span>
            <SmartNumberInput
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={onChange}
                className={FIELD_CLASS}
            />
            {suffix && (
                <span className="pointer-events-none absolute right-2 top-1/2 z-10 -translate-y-1/2 text-[11px] font-medium text-text-tertiary">
                    {suffix}
                </span>
            )}
        </div>
    );
}

function SizeField({
    label,
    value,
    onChange,
    onModeChange,
    modeConfig,
    min,
    max,
    step,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    onModeChange?: (value: string) => void;
    modeConfig?: LayerSizeModeConfig;
    min?: number;
    max?: number;
    step?: number;
}) {
    const scrub = useNumberScrub({ value, onChange, min, max, step });
    if (!modeConfig) {
        return <NumberField label={label} value={value} min={min} max={max} step={step} onChange={onChange} />;
    }

    return (
        <div className="grid grid-cols-[28px_minmax(42px,1fr)_62px] overflow-hidden rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary">
            <span
                {...scrub}
                className="flex h-8 cursor-ew-resize select-none items-center justify-center border-r border-border-primary text-[11px] font-medium text-text-tertiary hover:text-text-primary"
                title="Изменить значение"
            >
                {label}
            </span>
            <SmartNumberInput
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={onChange}
                className={cn(
                    "h-8 min-w-0 border-0 bg-transparent px-1 text-center text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus",
                    modeConfig.value !== "fixed" && "text-text-secondary",
                )}
            />
            <Select
                size="xs"
                value={modeConfig.value}
                onChange={onModeChange ?? (() => undefined)}
                options={modeConfig.options}
                triggerClassName="h-8 rounded-none border-0 border-l border-border-primary bg-bg-secondary px-1.5 text-[10px]"
            />
        </div>
    );
}

function TwoColumn({ children }: { children: ReactNode }) {
    return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function TextAdjustSwitcher({
    value,
    onChange,
}: {
    value: NonNullable<TextLayer["textAdjust"]>;
    onChange: (value: NonNullable<TextLayer["textAdjust"]>) => void;
}) {
    const options: Array<{ value: NonNullable<TextLayer["textAdjust"]>; title: string; icon: ReactNode }> = [
        { value: "auto_width", title: "Автоширина", icon: <UnfoldHorizontal size={13} /> },
        { value: "auto_height", title: "Автовысота", icon: <UnfoldVertical size={13} /> },
        { value: "fixed", title: "Фиксированный размер", icon: <Square size={13} /> },
    ];

    return (
        <div className="grid grid-cols-3 overflow-hidden rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary">
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    title={option.title}
                    aria-label={option.title}
                    onClick={() => onChange(option.value)}
                    className={cn(
                        "flex h-8 items-center justify-center border-r border-border-primary text-text-tertiary transition-colors last:border-r-0 hover:bg-bg-tertiary hover:text-text-primary",
                        value === option.value && "bg-accent-primary/10 text-accent-primary",
                    )}
                >
                    {option.icon}
                </button>
            ))}
        </div>
    );
}

function PaintRow({
    label,
    value,
    onChange,
    gradientTargetId,
    allowGradient = true,
    enabled = true,
    onToggleEnabled,
    imagePanel,
    imageActive = false,
    imagePreviewSrc,
    onPaintTab,
    onImageTab,
    opacity,
    onOpacityChange,
}: {
    label: string;
    value: Parameters<typeof PaintInput>[0]["value"];
    onChange: Parameters<typeof PaintInput>[0]["onChange"];
    gradientTargetId?: string;
    allowGradient?: boolean;
    enabled?: boolean;
    onToggleEnabled?: () => void;
    imagePanel?: ReactNode;
    imageActive?: boolean;
    imagePreviewSrc?: string;
    onPaintTab?: () => void;
    onImageTab?: () => void;
    opacity?: number;
    onOpacityChange?: (opacity: number) => void;
}) {
    const currentOpacity = opacity ?? paintOpacity(value);
    const handleOpacityChange = (nextOpacity: number) => {
        if (onOpacityChange) {
            onOpacityChange(nextOpacity);
            return;
        }
        onChange(applyPaintOpacity(value, nextOpacity));
    };

    return (
        <LabeledControl label={label}>
            <div className="flex items-center gap-1.5">
                <div className={cn("min-w-0", !enabled && "opacity-30 pointer-events-none")}>
                    <PaintInput
                        value={value}
                        gradientTargetId={gradientTargetId}
                        allowGradient={allowGradient}
                        onChange={onChange}
                        imagePanel={imagePanel}
                        imageActive={imageActive}
                        imagePreviewSrc={imagePreviewSrc}
                        onPaintTab={onPaintTab}
                        onImageTab={onImageTab}
                    />
                </div>
                <PercentField value={currentOpacity} onChange={handleOpacityChange} disabled={!enabled} />
                {onToggleEnabled && (
                    <button
                        type="button"
                        onClick={onToggleEnabled}
                        className="flex h-8 w-7 items-center justify-center rounded-[var(--radius-md)] text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary cursor-pointer"
                        title={enabled ? "Скрыть" : "Показать"}
                    >
                        {enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                )}
            </div>
        </LabeledControl>
    );
}

function ImageSourceStylePanel({
    fitModes,
    fit,
    focusX,
    focusY,
    onFitChange,
    onFocusChange,
    onReplaceImage,
    isReplacingImage = false,
    replaceImageLabel = "Заменить изображение",
}: {
    fitModes: ImageFitMode[];
    fit: ImageFitMode;
    focusX?: number;
    focusY?: number;
    onFitChange: (fit: ImageFitMode) => void;
    onFocusChange: (updates: Partial<ImageLayer>) => void;
    onReplaceImage?: () => void;
    isReplacingImage?: boolean;
    replaceImageLabel?: string;
}) {
    return (
        <div className="space-y-2">
            {onReplaceImage && (
                <button
                    type="button"
                    onClick={onReplaceImage}
                    disabled={isReplacingImage}
                    className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[10px] font-medium text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-50 cursor-pointer"
                >
                    <Upload size={12} />
                    {replaceImageLabel}
                </button>
            )}
            <div className="grid grid-cols-4 overflow-hidden rounded-[var(--radius-md)] border border-border-primary">
                {fitModes.map((mode) => (
                    <button
                        key={mode}
                        type="button"
                        onClick={() => onFitChange(mode)}
                        className={cn(
                            "h-8 border-r border-border-primary text-[9px] transition-colors last:border-r-0 cursor-pointer",
                            fit === mode
                                ? "bg-accent-primary/10 text-accent-primary"
                                : "text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary",
                        )}
                    >
                        {IMAGE_FIT_MODE_LABELS[mode]}
                    </button>
                ))}
            </div>
            <TwoColumn>
                <CompactNumberField
                    label="X"
                    value={Math.round((focusX ?? 0.5) * 100)}
                    min={0}
                    max={100}
                    onChange={(value) => onFocusChange({ focusX: value / 100 })}
                />
                <CompactNumberField
                    label="Y"
                    value={Math.round((focusY ?? 0.5) * 100)}
                    min={0}
                    max={100}
                    onChange={(value) => onFocusChange({ focusY: value / 100 })}
                />
            </TwoColumn>
        </div>
    );
}

function LayerImageFillPanel({
    imageFill,
    onChange,
}: {
    imageFill?: LayerImageFill;
    onChange: (imageFill?: LayerImageFill) => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const nextImageFill = (updates: Partial<LayerImageFill>): LayerImageFill => ({
        src: imageFill?.src ?? "",
        fit: imageFill?.fit ?? "cover",
        opacity: imageFill?.opacity ?? 1,
        focusX: imageFill?.focusX ?? 0.5,
        focusY: imageFill?.focusY ?? 0.5,
        ...updates,
    });

    return (
        <div className="space-y-2">
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    setIsUploading(true);
                    try {
                        const src = await uploadImageFile(file, "layer-fill");
                        onChange(nextImageFill({ src }));
                    } finally {
                        setIsUploading(false);
                    }
                }}
            />
            {imageFill?.src && (
                <div
                    className="h-20 w-full rounded-[var(--radius-md)] border border-border-primary bg-cover bg-center"
                    style={{ backgroundImage: `url(${imageFill.src})` }}
                />
            )}
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={isUploading}
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[10px] font-medium text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-50 cursor-pointer"
            >
                <Upload size={12} />
                {isUploading ? "Загрузка..." : imageFill?.src ? "Заменить изображение заливки" : "Загрузить изображение заливки"}
            </button>
            {imageFill?.src && (
                <>
                    <ImageSourceStylePanel
                        fitModes={["cover", "contain", "fill", "crop"]}
                        fit={imageFill.fit}
                        focusX={imageFill.focusX}
                        focusY={imageFill.focusY}
                        onFitChange={(fit) => onChange(nextImageFill({ fit }))}
                        onFocusChange={(updates) => onChange(nextImageFill(updates as Partial<LayerImageFill>))}
                    />
                    <button
                        type="button"
                        onClick={() => onChange(undefined)}
                        className="flex h-8 w-full items-center justify-center rounded-[var(--radius-md)] border border-border-primary text-[10px] text-text-tertiary transition-colors hover:bg-red-500/10 hover:text-red-500 cursor-pointer"
                    >
                        Убрать изображение заливки
                    </button>
                </>
            )}
        </div>
    );
}

async function uploadImageFile(file: File, tag: string) {
    const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
    return uploadForAI(base64, tag);
}

function paintOpacity(value: Parameters<typeof PaintInput>[0]["value"]) {
    const normalized = normalizePaint(value);
    if (normalized.kind === "solid") return normalized.opacity;
    const first = normalized.stops[0]?.opacity ?? 1;
    return normalized.stops.every((stop) => stop.opacity === first) ? first : 1;
}

function applyPaintOpacity(value: Parameters<typeof PaintInput>[0]["value"], opacity: number) {
    const normalized = normalizePaint(value);
    if (normalized.kind === "solid") return { ...normalized, opacity };
    return {
        ...normalized,
        stops: normalized.stops.map((stop) => ({ ...stop, opacity })),
    };
}

function CompactNumberField({
    label,
    icon,
    value,
    onChange,
    min,
    max,
}: {
    label: string;
    icon?: ReactNode;
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
}) {
    const scrub = useNumberScrub({
        value,
        onChange: (next) => {
            const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next));
            onChange(clamped);
        },
        min,
        max,
    });
    return (
        <div className="relative">
            <span
                {...scrub}
                className="absolute left-2 top-1/2 z-10 flex -translate-y-1/2 cursor-ew-resize items-center text-[10px] text-text-tertiary hover:text-text-primary"
                title={label}
            >
                {icon ?? label}
            </span>
            <SmartNumberInput
                value={value}
                min={min}
                max={max}
                onChange={(next) => {
                    const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next));
                    onChange(clamped);
                }}
                className="h-8 w-full rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary pl-7 pr-2 text-center text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
        </div>
    );
}

function PercentField({ value, onChange, disabled }: { value: number; onChange: (value: number) => void; disabled?: boolean }) {
    const percent = Math.round(value * 100);
    const scrub = useNumberScrub({
        value: percent,
        min: 0,
        max: 100,
        onChange: (next) => onChange(Math.max(0, Math.min(100, next)) / 100),
    });
    return (
        <div className={cn("relative w-[64px]", disabled && "opacity-40 pointer-events-none")}>
            <span
                {...scrub}
                className="absolute left-2 top-1/2 z-10 h-px w-2 -translate-y-1/2 cursor-ew-resize rounded-full bg-text-tertiary hover:bg-text-primary"
                title="Изменить непрозрачность"
            />
            <SmartNumberInput
                min={0}
                max={100}
                value={percent}
                onChange={(next) => onChange(Math.max(0, Math.min(100, next)) / 100)}
                className="h-8 w-full rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary pl-4 pr-5 text-center text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-tertiary">%</span>
        </div>
    );
}

function AutoLayoutAlignmentGrid({
    layoutMode,
    primary,
    counter,
    onChange,
}: {
    layoutMode: "horizontal" | "vertical";
    primary: NonNullable<FrameLayer["primaryAxisAlignItems"]>;
    counter: NonNullable<FrameLayer["counterAxisAlignItems"]>;
    onChange: (updates: Partial<FrameLayer>) => void;
}) {
    const screenRows: ScreenVAlign[] = ["top", "center", "bottom"];
    const screenCols: ScreenHAlign[] = ["left", "center", "right"];
    const activeScreen = autoLayoutAxesToScreenAlign(layoutMode, primary, counter);
    const primaryLabel = layoutMode === "horizontal" ? "По горизонтали" : "По вертикали";
    const counterLabel = layoutMode === "horizontal" ? "По вертикали" : "По горизонтали";

    return (
        <div className="grid grid-cols-[72px_1fr] gap-2">
            <div className="relative grid h-[72px] grid-cols-3 grid-rows-3 gap-1 rounded-[var(--radius-md)] bg-bg-secondary p-2">
                {screenRows.map((v) => screenCols.map((h) => {
                    const active = activeScreen?.h === h && activeScreen?.v === v;
                    return (
                        <button
                            key={`${v}-${h}`}
                            type="button"
                            onClick={() => onChange(screenAlignToAutoLayoutAxes(layoutMode, h, v))}
                            className={cn(
                                "relative rounded-[3px] border border-border-primary transition-colors",
                                active ? "border-accent-primary bg-accent-primary/15" : "bg-bg-tertiary hover:border-border-secondary",
                            )}
                            title={`${h} / ${v}`}
                        >
                            <AutoLayoutAlignCellIndicator
                                h={h}
                                v={v}
                                layoutMode={layoutMode}
                                active={active}
                            />
                        </button>
                    );
                }))}
            </div>
            <div className="space-y-1.5">
                <Select
                    size="xs"
                    value={primary}
                    onChange={(value) => onChange({ primaryAxisAlignItems: value as FrameLayer["primaryAxisAlignItems"] })}
                    aria-label={primaryLabel}
                    options={[
                        { value: "flex-start", label: "В начало" },
                        { value: "center", label: "По центру" },
                        { value: "flex-end", label: "В конец" },
                        { value: "space-between", label: "Между" },
                    ]}
                />
                <Select
                    size="xs"
                    value={counter}
                    onChange={(value) => onChange({ counterAxisAlignItems: value as FrameLayer["counterAxisAlignItems"] })}
                    aria-label={counterLabel}
                    options={[
                        { value: "flex-start", label: "В начало" },
                        { value: "center", label: "По центру" },
                        { value: "flex-end", label: "В конец" },
                        { value: "stretch", label: "Растянуть" },
                    ]}
                />
            </div>
        </div>
    );
}

function AutoLayoutAlignCellIndicator({
    h,
    v,
    layoutMode,
    active,
}: {
    h: ScreenHAlign;
    v: ScreenVAlign;
    layoutMode: "horizontal" | "vertical";
    active: boolean;
}) {
    const stroke = active ? "bg-accent-primary" : "bg-text-tertiary/60";
    const hPos = h === "left" ? "left-0.5" : h === "right" ? "right-0.5" : "left-1/2 -translate-x-1/2";
    const vPos = v === "top" ? "top-0.5" : v === "bottom" ? "bottom-0.5" : "top-1/2 -translate-y-1/2";
    const flowIsHorizontal = layoutMode === "horizontal";

    return (
        <span className="absolute inset-0">
            <span className={cn("absolute h-1 w-1 rounded-full", stroke, hPos, vPos)} />
            <span
                className={cn(
                    "absolute rounded-full",
                    stroke,
                    flowIsHorizontal
                        ? cn("top-1/2 h-px w-3 -translate-y-1/2", h === "left" ? "left-1" : h === "right" ? "right-1" : "left-1/2 -translate-x-1/2")
                        : cn("left-1/2 w-px h-3 -translate-x-1/2", v === "top" ? "top-1" : v === "bottom" ? "bottom-1" : "top-1/2 -translate-y-1/2"),
                )}
            />
        </span>
    );
}

function ConstraintsAnchorGrid({
    constraints,
    onChange,
}: {
    constraints: { horizontal: ConstraintH; vertical: ConstraintV };
    onChange: (constraints: { horizontal: ConstraintH; vertical: ConstraintV }) => void;
}) {
    const rows: ConstraintV[] = ["top", "center", "bottom"];
    const cols: ConstraintH[] = ["left", "center", "right"];
    return (
        <div className="grid h-[72px] grid-cols-3 grid-rows-3 gap-1 rounded-[var(--radius-md)] bg-bg-secondary p-2">
            {rows.map((row) => cols.map((col) => {
                const active = constraints.horizontal === col && constraints.vertical === row;
                return (
                    <button
                        key={`${row}-${col}`}
                        type="button"
                        onClick={() => onChange({ horizontal: col, vertical: row })}
                        className={cn(
                            "rounded-[3px] border border-border-primary transition-colors",
                            active ? "border-accent-primary bg-accent-primary" : "bg-bg-tertiary hover:border-border-secondary",
                        )}
                        title={`${col} / ${row}`}
                    />
                );
            }))}
        </div>
    );
}

function OpacityControl({ value, onChange }: { value: number; onChange: (opacity: number) => void }) {
    const percent = Math.round(value * 100);
    const scrub = useNumberScrub({
        value: percent,
        min: 0,
        max: 100,
        onChange: (next) => onChange(Math.max(0, Math.min(100, next)) / 100),
    });
    return (
        <LabeledControl label="Непрозрачность">
            <div className="flex items-center gap-2">
                <input
                    type="range"
                    min={0}
                    max={100}
                    value={percent}
                    onChange={(event) => onChange(Number(event.target.value) / 100)}
                    className="flex-1 h-1.5 accent-accent-primary cursor-pointer"
                />
                <div className="relative w-[54px]">
                    <span
                        {...scrub}
                        className="absolute left-2 top-1/2 z-10 h-px w-2 -translate-y-1/2 cursor-ew-resize rounded-full bg-text-tertiary hover:bg-text-primary"
                        title="Изменить непрозрачность"
                    />
                    <SmartNumberInput
                        min={0}
                        max={100}
                        value={percent}
                        onChange={(next) => onChange(Math.max(0, Math.min(100, next)) / 100)}
                        className="h-8 w-full rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary pl-4 pr-1 text-center text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
                    />
                </div>
            </div>
        </LabeledControl>
    );
}

function IconButton({ children, title, onClick, active }: { children: ReactNode; title: string; onClick: () => void; active?: boolean }) {
    return (
        <button
            type="button"
            title={title}
            onClick={onClick}
            className={cn(
                "h-8 flex items-center justify-center border-r border-border-primary last:border-r-0 text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer",
                active && "bg-accent-primary/10 text-accent-primary",
            )}
        >
            {children}
        </button>
    );
}

function ToggleButton({ active, label, icon, title, onClick }: { active: boolean; label: string; icon?: ReactNode; title?: string; onClick: () => void }) {
    return (
        <button
            type="button"
            title={title}
            onClick={onClick}
            className={cn(
                "flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border px-3 text-[10px] transition-colors cursor-pointer",
                active
                    ? "border-accent-primary/30 bg-accent-primary/10 text-accent-primary"
                    : "border-border-primary text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary",
            )}
        >
            {icon}
            {label}
        </button>
    );
}

function IconToggle({ active, label, icon, onClick }: { active: boolean; label: string; icon: ReactNode; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "flex h-8 items-center justify-between rounded-[var(--radius-md)] border px-2 text-[10px] transition-colors cursor-pointer",
                active
                    ? "border-accent-primary/30 bg-accent-primary/10 text-accent-primary"
                    : "border-border-primary text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary",
            )}
        >
            <span>{label}</span>
            {icon}
        </button>
    );
}

function MasterPill({ isMaster }: { isMaster: boolean }) {
    return (
        <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-full)] text-[10px] font-semibold text-white", isMaster ? "bg-green-600 dark:bg-green-700" : "bg-blue-600 dark:bg-blue-700")}>
            <Link2 size={10} />
            {isMaster ? "Мастер" : "Инстанс"}
        </div>
    );
}

function VerticalAlignGlyph({ align }: { align: "top" | "middle" | "bottom" }) {
    return (
        <span className="relative block h-4 w-4 text-current">
            <span className={cn("absolute left-0 right-0 h-px bg-current", align === "top" ? "top-0" : align === "middle" ? "top-1/2" : "bottom-0")} />
            <span className={cn("absolute left-1/2 h-2 w-1.5 -translate-x-1/2 rounded-[1px] border border-current", align === "top" ? "top-1" : align === "middle" ? "top-1/2 -translate-y-1/2" : "bottom-1")} />
        </span>
    );
}

function findParentFrame(layers: Layer[], layerId: string) {
    return layers.find((candidate) =>
        candidate.type === "frame" && (candidate as FrameLayer).childIds.includes(layerId)
    ) as FrameLayer | undefined;
}

function layoutSizingOptions(layer: Layer) {
    return [
        { value: "fixed", label: "Фикс." },
        { value: "fill", label: "Заполн." },
        ...(layer.type === "frame" || layer.type === "text" ? [{ value: "hug", label: "По содерж." }] : []),
    ];
}

function getLayerSizeModeConfig(layer: Layer, axis: "width" | "height", isInsideAutoLayout: boolean): LayerSizeModeConfig | undefined {
    if (isInsideAutoLayout) {
        return {
            value: axis === "width" ? layer.layoutSizingWidth || "fixed" : layer.layoutSizingHeight || "fixed",
            options: layoutSizingOptions(layer),
            toUpdates: (value) => resolveLayoutSizingUpdate(layer, axis, value),
        };
    }

    if (layer.type !== "frame" || !layer.layoutMode || layer.layoutMode === "none") {
        return undefined;
    }

    const axisUsesPrimarySizing = axis === "width"
        ? layer.layoutMode === "horizontal"
        : layer.layoutMode === "vertical";
    const mode = axisUsesPrimarySizing ? layer.primaryAxisSizingMode : layer.counterAxisSizingMode;

    return {
        value: mode === "auto" ? "hug" : "fixed",
        options: [
            { value: "fixed", label: "Фикс." },
            { value: "hug", label: "По содерж." },
        ],
        toUpdates: (value) => (axisUsesPrimarySizing
            ? { primaryAxisSizingMode: value === "hug" ? "auto" : "fixed" }
            : { counterAxisSizingMode: value === "hug" ? "auto" : "fixed" }) as Partial<Layer>,
    };
}

function resolveManualSizeUpdate(
    layer: Layer,
    axis: "width" | "height",
    value: number,
    modeConfig?: LayerSizeModeConfig,
): Partial<Layer> {
    const updates: Partial<Layer> = axis === "width" ? { width: value } : { height: value };

    if (modeConfig && modeConfig.value !== "fixed") {
        Object.assign(updates, modeConfig.toUpdates("fixed"));
    }

    if (layer.type === "text" && layer.textAdjust !== "fixed") {
        (updates as Partial<TextLayer>).textAdjust = "fixed";
    }

    return updates;
}

function resolveLayoutSizingUpdate(layer: Layer, axis: "width" | "height", value: string): Partial<Layer> {
    const updates: Partial<Layer> = axis === "width"
        ? { layoutSizingWidth: value as Layer["layoutSizingWidth"] }
        : { layoutSizingHeight: value as Layer["layoutSizingHeight"] };

    if (layer.type === "text") {
        const textUpdates = updates as Partial<TextLayer>;
        if (axis === "width" && value === "fill" && layer.textAdjust === "auto_width") {
            textUpdates.textAdjust = "auto_height";
        }
        if (axis === "height" && value === "fill" && layer.textAdjust === "auto_height") {
            textUpdates.textAdjust = "fixed";
        }
        if (axis === "height" && value === "hug" && layer.textAdjust === "fixed") {
            textUpdates.textAdjust = "auto_height";
        }
    }

    return updates;
}
