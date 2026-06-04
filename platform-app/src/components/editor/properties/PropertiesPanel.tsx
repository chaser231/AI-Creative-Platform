"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    Anchor,
    ArrowDown,
    ArrowRight,
    Eye,
    EyeOff,
    FlipHorizontal,
    FlipVertical,
    Grid3X3,
    ImageIcon,
    LayoutDashboard,
    Link,
    Link2,
    Maximize2,
    Move,
    Paintbrush,
    Plus,
    RotateCw,
    Scissors,
    Type,
    Unlink,
    Upload,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Select } from "@/components/ui/Select";
import { SmartNumberInput } from "@/components/ui/SmartNumberInput";
import { useCanvasStore } from "@/store/canvasStore";
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
    RectangleLayer,
    TemplateSlotRole,
    TextLayer,
} from "@/types";
import { DEFAULT_CONSTRAINTS, IMAGE_FIT_MODE_LABELS } from "@/types";
import { cn } from "@/lib/cn";
import { PREINSTALLED_FONTS, getUserFonts, normalizeFontFamilyName, saveUserFont } from "@/lib/customFonts";
import { getAvailableFontFamiliesSync } from "@/utils/fontUtils";
import { uploadForAI } from "@/utils/imageUpload";
import { normalizePaint } from "@/utils/paint";
import { useAssetList, useAssetUpload } from "@/hooks/useAssetUpload";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { ArtboardBackgroundControls } from "./ArtboardBackgroundControls";
import { ColorInput } from "./ColorInput";
import { PaintInput } from "./PaintInput";
import { StrokeControls } from "./StrokeControls";

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
                                label="Фон"
                                value={artboardProps.fill}
                                gradientTargetId="artboard"
                                onChange={(fill) => updateArtboardProps({ fill })}
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
                                imageActive={!!artboardProps.backgroundImage}
                                onPaintTab={() => updateArtboardProps({ backgroundImage: undefined })}
                                onImageTab={() => undefined}
                                opacity={artboardProps.backgroundImage?.opacity}
                                onOpacityChange={(opacity) => artboardProps.backgroundImage
                                    ? updateArtboardProps({ backgroundImage: { ...artboardProps.backgroundImage, opacity } })
                                    : undefined}
                            />
                            <StrokeControls
                                value={{
                                    stroke: artboardProps.stroke || "#000000",
                                    strokeEnabled: !!artboardProps.strokeWidth && !!artboardProps.stroke,
                                    strokeWidth: artboardProps.strokeWidth,
                                    strokeAlign: artboardProps.strokeAlign,
                                    strokeJoin: artboardProps.strokeJoin,
                                }}
                                onChange={updateArtboardProps}
                            />
                        </InspectorSection>
                        <CornerRadiusSection
                            cornerRadius={artboardProps.cornerRadius}
                            cornerRadii={artboardProps.cornerRadii}
                            onChange={updateArtboardProps}
                        />
                        <InspectorSection title="Экспорт">
                            <ToggleButton
                                active={artboardProps.clipContent}
                                icon={<Scissors size={12} />}
                                label="Clip content"
                                onClick={() => updateArtboardProps({ clipContent: !artboardProps.clipContent })}
                            />
                        </InspectorSection>
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
    onChange,
    onAlign,
}: {
    layer: Layer;
    layers: Layer[];
    activeResizeId: string;
    onChange: (updates: Partial<Layer>) => void;
    onAlign: (alignment: "left" | "center" | "right" | "top" | "middle" | "bottom") => void;
}) {
    const parentFrame = findParentFrame(layers, layer.id);
    const isInsideAutoLayout = !!parentFrame?.layoutMode && parentFrame.layoutMode !== "none";

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
                <TwoColumn>
                    <NumberField label="W" value={Math.round(layer.width)} min={1} onChange={(width) => onChange({ width } as Partial<Layer>)} />
                    <NumberField label="H" value={Math.round(layer.height)} min={1} onChange={(height) => onChange({ height } as Partial<Layer>)} />
                </TwoColumn>
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
            {layer.type === "text" && <TextInspectorSection layer={layer} onChange={(updates) => onChange(updates as Partial<Layer>)} />}
            {layer.type === "image" && <ImageInspectorSection layer={layer} onChange={(updates) => onChange(updates as Partial<Layer>)} />}
            {layer.type === "rectangle" && <ShapeStyleSection layer={layer} onChange={(updates) => onChange(updates as Partial<Layer>)} />}
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
                <IconButton title="Left" onClick={() => onAlign("left")}><AlignLeft size={13} /></IconButton>
                <IconButton title="Center" onClick={() => onAlign("center")}><AlignCenter size={13} /></IconButton>
                <IconButton title="Right" onClick={() => onAlign("right")}><AlignRight size={13} /></IconButton>
                <IconButton title="Top" onClick={() => onAlign("top")}><AlignLeft size={13} className="-rotate-90" /></IconButton>
                <IconButton title="Middle" onClick={() => onAlign("middle")}><AlignCenter size={13} className="rotate-90" /></IconButton>
                <IconButton title="Bottom" onClick={() => onAlign("bottom")}><AlignRight size={13} className="-rotate-90" /></IconButton>
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
        <InspectorSection title="Constraints" icon={<Anchor size={13} />}>
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
                            { value: "left", label: "Left" },
                            { value: "right", label: "Right" },
                            { value: "center", label: "Center" },
                            { value: "stretch", label: "Stretch" },
                            { value: "scale", label: "Scale" },
                        ]}
                    />
                    <Select
                        size="xs"
                        value={constraints.vertical}
                        onChange={(value) => onChange({ constraints: { ...constraints, vertical: value as ConstraintV } } as Partial<Layer>)}
                        options={[
                            { value: "top", label: "Top" },
                            { value: "bottom", label: "Bottom" },
                            { value: "center", label: "Center" },
                            { value: "stretch", label: "Stretch" },
                            { value: "scale", label: "Scale" },
                        ]}
                    />
                </div>
            </div>
            <Select
                size="xs"
                value={layer.slotId || "none"}
                onChange={(value) => onChange({ slotId: value as TemplateSlotRole } as Partial<Layer>)}
                options={[
                    { value: "none", label: "No slot" },
                    { value: "headline", label: "Headline" },
                    { value: "subhead", label: "Subhead" },
                    { value: "cta", label: "CTA" },
                    { value: "background", label: "Background" },
                    { value: "image-primary", label: "Main image" },
                    { value: "logo", label: "Logo" },
                ]}
            />
            {layer.type === "frame" && (
                <input
                    value={(layer as FrameLayer).groupSlotId || ""}
                    onChange={(event) => onChange({ groupSlotId: event.target.value || undefined } as Partial<Layer>)}
                    placeholder="Group slot ID"
                    className="w-full h-7 px-2 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus placeholder:text-text-tertiary"
                />
            )}
        </InspectorSection>
    );
}

function AutoLayoutChildSection({ layer, onChange }: { layer: Layer; onChange: (updates: Partial<Layer>) => void }) {
    return (
        <InspectorSection title="Размер в Auto Layout" icon={<LayoutDashboard size={13} />}>
            <SizeModePair
                widthMode={layer.layoutSizingWidth || "fixed"}
                heightMode={layer.layoutSizingHeight || "fixed"}
                widthOptions={layoutSizingOptions(layer)}
                heightOptions={layoutSizingOptions(layer)}
                onWidthChange={(value) => onChange(resolveLayoutSizingUpdate(layer, "width", value))}
                onHeightChange={(value) => onChange(resolveLayoutSizingUpdate(layer, "height", value))}
            />
            <ToggleButton
                active={!!layer.isAbsolutePositioned}
                label="Absolute position"
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
        <InspectorSection title="Auto Layout" icon={<LayoutDashboard size={13} />}>
            <div className="grid grid-cols-3 overflow-hidden rounded-[var(--radius-md)] border border-border-primary">
                {(["none", "horizontal", "vertical"] as const).map((mode) => (
                    <button
                        key={mode}
                        onClick={() => onChange({ layoutMode: mode })}
                        className={cn(
                            "flex h-8 items-center justify-center border-r border-border-primary text-[10px] transition-colors last:border-r-0 cursor-pointer",
                            (layer.layoutMode || "none") === mode
                                ? "bg-accent-primary/10 text-accent-primary"
                                : "text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary",
                        )}
                        title={mode === "none" ? "Auto Layout off" : mode}
                    >
                        {mode === "none" ? <Grid3X3 size={13} /> : mode === "horizontal" ? <ArrowRight size={14} /> : <ArrowDown size={14} />}
                    </button>
                ))}
            </div>
            {enabled && (
                <>
                    <AutoLayoutAlignmentGrid
                        primary={layer.primaryAxisAlignItems || "flex-start"}
                        counter={layer.counterAxisAlignItems || "flex-start"}
                        onChange={(updates) => onChange(updates)}
                    />
                    <div className="grid grid-cols-[1fr_28px] gap-2">
                        <div className="grid grid-cols-2 gap-2">
                            <CompactNumberField
                                label="X"
                                value={horizontalPadding}
                                min={0}
                                onChange={(value) => onChange({ paddingLeft: value, paddingRight: value })}
                            />
                            <CompactNumberField
                                label="Y"
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
                            title="Individual padding"
                        >
                            <Plus size={13} />
                        </button>
                    </div>
                    {individualPaddingOpen && (
                        <TwoColumn>
                            <CompactNumberField label="T" value={layer.paddingTop || 0} min={0} onChange={(paddingTop) => onChange({ paddingTop })} />
                            <CompactNumberField label="R" value={layer.paddingRight || 0} min={0} onChange={(paddingRight) => onChange({ paddingRight })} />
                            <CompactNumberField label="B" value={layer.paddingBottom || 0} min={0} onChange={(paddingBottom) => onChange({ paddingBottom })} />
                            <CompactNumberField label="L" value={layer.paddingLeft || 0} min={0} onChange={(paddingLeft) => onChange({ paddingLeft })} />
                        </TwoColumn>
                    )}
                    <CompactNumberField label="Gap" value={layer.spacing || 0} min={0} onChange={(spacing) => onChange({ spacing })} />
                    <SizeModePair
                        widthMode={layer.layoutMode === "horizontal"
                            ? (layer.primaryAxisSizingMode === "auto" ? "hug" : "fixed")
                            : (layer.counterAxisSizingMode === "auto" ? "hug" : "fixed")}
                        heightMode={layer.layoutMode === "horizontal"
                            ? (layer.counterAxisSizingMode === "auto" ? "hug" : "fixed")
                            : (layer.primaryAxisSizingMode === "auto" ? "hug" : "fixed")}
                        widthOptions={[
                            { value: "fixed", label: "Fixed" },
                            { value: "hug", label: "Hug" },
                        ]}
                        heightOptions={[
                            { value: "fixed", label: "Fixed" },
                            { value: "hug", label: "Hug" },
                        ]}
                        onWidthChange={(value) => onChange(layer.layoutMode === "horizontal"
                            ? { primaryAxisSizingMode: value === "hug" ? "auto" : "fixed" }
                            : { counterAxisSizingMode: value === "hug" ? "auto" : "fixed" })}
                        onHeightChange={(value) => onChange(layer.layoutMode === "horizontal"
                            ? { counterAxisSizingMode: value === "hug" ? "auto" : "fixed" }
                            : { primaryAxisSizingMode: value === "hug" ? "auto" : "fixed" })}
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

    return (
        <InspectorSection title="Typography" icon={<Type size={13} />}>
            {isFontMissing && (
                <div className="rounded-[var(--radius-md)] border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-500">
                    Шрифт «{layer.fontFamily}» не установлен
                </div>
            )}
            <Select
                size="xs"
                value={layer.fontFamily}
                onChange={(fontFamily) => onChange({ fontFamily })}
                options={availableFonts.map((font) => ({ value: font, label: font }))}
            />
            <TwoColumn>
                <Select
                    size="xs"
                    value={layer.fontWeight}
                    onChange={(fontWeight) => onChange({ fontWeight })}
                    options={availableWeights.map((weight) => ({ value: weight, label: weight }))}
                />
                <NumberField label="Size" value={layer.fontSize} min={1} onChange={(fontSize) => onChange({ fontSize })} />
                <NumberField label="Line" value={Math.round((layer.lineHeight || 1.2) * 100)} min={1} onChange={(lineHeight) => onChange({ lineHeight: lineHeight / 100 })} />
                <NumberField label="Track" value={layer.letterSpacing} step={0.1} onChange={(letterSpacing) => onChange({ letterSpacing })} />
            </TwoColumn>
            <TwoColumn>
                <Select
                    size="xs"
                    value={layer.textAdjust || "auto_width"}
                    onChange={(value) => {
                        const updates: Partial<TextLayer> = { textAdjust: value as TextLayer["textAdjust"] };
                        if (value === "auto_width" && layer.layoutSizingWidth === "fill") updates.layoutSizingWidth = "fixed";
                        if (value === "auto_height" && layer.layoutSizingHeight === "fill") updates.layoutSizingHeight = "fixed";
                        onChange(updates);
                    }}
                    options={[
                        { value: "auto_width", label: "Auto W" },
                        { value: "auto_height", label: "Auto H" },
                        { value: "fixed", label: "Fixed" },
                    ]}
                />
                <Select
                    size="xs"
                    value={layer.textTransform || "none"}
                    onChange={(textTransform) => onChange({ textTransform: textTransform as TextLayer["textTransform"] })}
                    options={[
                        { value: "none", label: "Default" },
                        { value: "uppercase", label: "Upper" },
                        { value: "lowercase", label: "Lower" },
                    ]}
                />
            </TwoColumn>
            <div className="grid grid-cols-3 rounded-[var(--radius-md)] border border-border-primary overflow-hidden">
                <IconButton title="Left" active={layer.align === "left"} onClick={() => onChange({ align: "left" })}><AlignLeft size={13} /></IconButton>
                <IconButton title="Center" active={layer.align === "center"} onClick={() => onChange({ align: "center" })}><AlignCenter size={13} /></IconButton>
                <IconButton title="Right" active={layer.align === "right"} onClick={() => onChange({ align: "right" })}><AlignRight size={13} /></IconButton>
            </div>
            <div className="grid grid-cols-3 rounded-[var(--radius-md)] border border-border-primary overflow-hidden">
                {(["top", "middle", "bottom"] as const).map((align) => (
                    <IconButton key={align} title={align} active={(layer.verticalAlign || "top") === align} onClick={() => onChange({ verticalAlign: align })}>
                        <VerticalAlignGlyph align={align} />
                    </IconButton>
                ))}
            </div>
            <TwoColumn>
                <ToggleButton active={!!layer.verticalTrim} label="Vertical trim" onClick={() => onChange({ verticalTrim: !layer.verticalTrim })} />
                <ToggleButton active={!!layer.truncateText} label="Truncate" onClick={() => onChange({ truncateText: !layer.truncateText })} />
            </TwoColumn>
            <PaintRow
                label="Fill"
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
            <InspectorSection title="Изображение" icon={<ImageIcon size={13} />}>
                <button
                    onClick={() => fileRef.current?.click()}
                    disabled={isUploading}
                    className="flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-border-primary text-[11px] text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-50 cursor-pointer"
                >
                    <Upload size={12} />
                    {isUploading ? "Загрузка..." : "Заменить source"}
                </button>
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
            </InspectorSection>
            <InspectorSection title="Стиль" icon={<Paintbrush size={13} />}>
                <OpacityControl value={layer.opacity ?? 1} onChange={(opacity) => onChange({ opacity })} />
                <PaintRow
                    label="Fill"
                    value={layer.fill ?? "#FFFFFF"}
                    gradientTargetId={layer.id}
                    enabled={layer.fillEnabled !== false}
                    onToggleEnabled={() => onChange({ fillEnabled: !(layer.fillEnabled !== false) })}
                    onChange={(fill) => onChange({ fill, fillMode: "paint" })}
                    imageActive={(layer.fillMode ?? "image") === "image"}
                    onPaintTab={() => onChange({ fillMode: "paint", fill: layer.fill ?? "#FFFFFF" })}
                    onImageTab={() => onChange({ fillMode: "image" })}
                    opacity={(layer.fillMode ?? "image") === "image"
                        ? undefined
                        : solidPaintOpacity(layer.fill ?? "#FFFFFF")}
                    imagePanel={(
                        <ImageSourceStylePanel
                            fitModes={fitModes}
                            fit={layer.objectFit || "cover"}
                            focusX={layer.focusX}
                            focusY={layer.focusY}
                            onFitChange={(objectFit) => onChange({ objectFit })}
                            onFocusChange={(updates) => onChange(updates)}
                        />
                    )}
                />
                <StrokeControls
                    value={{
                        stroke: layer.stroke || "#000000",
                        strokeEnabled: layer.strokeEnabled ?? false,
                        strokeWidth: layer.strokeWidth ?? 0,
                        strokeAlign: layer.strokeAlign,
                        strokeJoin: layer.strokeJoin,
                    }}
                    onChange={onChange}
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
                    onPaintTab={() => onChange({ fillMode: "paint" })}
                    onImageTab={() => onChange({ fillMode: "image" })}
                opacity={fillMode === "image" ? layer.imageFill?.opacity : solidPaintOpacity(layer.fill)}
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
                        strokeWidth: layer.strokeWidth,
                        strokeAlign: layer.strokeAlign,
                        strokeJoin: layer.strokeJoin,
                    }}
                    onChange={onChange}
                />
                {showClip && layer.type === "frame" && (
                    <ToggleButton
                        active={layer.clipContent}
                        icon={<Scissors size={12} />}
                        label="Clip content"
                        onClick={() => onChange({ clipContent: !layer.clipContent })}
                    />
                )}
            </InspectorSection>
            <CornerRadiusSection
                cornerRadius={layer.cornerRadius}
                cornerRadii={layer.cornerRadii}
                onChange={onChange}
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
                    { value: "pill", label: "Pill" },
                    { value: "rectangle", label: "Rect" },
                    { value: "circle", label: "Circle" },
                ]}
            />
            <OpacityControl value={layer.opacity ?? 1} onChange={(opacity) => onChange({ opacity })} />
            <PaintRow
                label="Фон"
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

function CornerRadiusSection({
    cornerRadius,
    cornerRadii,
    onChange,
}: {
    cornerRadius: number;
    cornerRadii?: CornerRadii;
    onChange: (updates: { cornerRadius?: number; cornerRadii?: CornerRadii }) => void;
}) {
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
            <TwoColumn>
                <NumberField
                    label="R"
                    value={cornerRadius}
                    min={0}
                    onChange={updateAll}
                    icon={<CornerGlyph corner="all" />}
                />
                <div className="flex h-8 items-center justify-center rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[10px] text-text-tertiary">
                    {allEqual ? "All corners" : "Mixed"}
                </div>
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
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    icon?: ReactNode;
}) {
    return (
        <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 flex -translate-y-1/2 items-center text-[11px] font-medium text-text-tertiary">
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
        </div>
    );
}

function TwoColumn({ children }: { children: ReactNode }) {
    return <div className="grid grid-cols-2 gap-2">{children}</div>;
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
    onPaintTab?: () => void;
    onImageTab?: () => void;
    opacity?: number;
    onOpacityChange?: (opacity: number) => void;
}) {
    const normalized = normalizePaint(value);
    const currentOpacity = opacity ?? (normalized.kind === "solid" ? normalized.opacity : 1);
    const handleOpacityChange = (nextOpacity: number) => {
        if (onOpacityChange) {
            onOpacityChange(nextOpacity);
            return;
        }
        if (normalized.kind === "solid") {
            onChange({ ...normalized, opacity: nextOpacity });
        }
    };

    return (
        <LabeledControl label={label}>
            <div className="flex items-center gap-2">
                <div className={cn("min-w-0 flex-1", !enabled && "opacity-30 pointer-events-none")}>
                    <PaintInput
                        value={value}
                        gradientTargetId={gradientTargetId}
                        allowGradient={allowGradient}
                        onChange={onChange}
                        imagePanel={imagePanel}
                        imageActive={imageActive}
                        onPaintTab={onPaintTab}
                        onImageTab={onImageTab}
                    />
                </div>
                <PercentField value={currentOpacity} onChange={handleOpacityChange} disabled={!enabled} />
                {onToggleEnabled && (
                    <button
                        type="button"
                        onClick={onToggleEnabled}
                        className="flex h-8 w-7 items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary cursor-pointer"
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
}: {
    fitModes: ImageFitMode[];
    fit: ImageFitMode;
    focusX?: number;
    focusY?: number;
    onFitChange: (fit: ImageFitMode) => void;
    onFocusChange: (updates: Partial<ImageLayer>) => void;
}) {
    return (
        <div className="space-y-2">
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
                {isUploading ? "Загрузка..." : imageFill?.src ? "Заменить image fill" : "Загрузить image fill"}
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
                        Убрать image fill
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

function solidPaintOpacity(value: Parameters<typeof PaintInput>[0]["value"]) {
    const normalized = normalizePaint(value);
    return normalized.kind === "solid" ? normalized.opacity : 1;
}

function CompactNumberField({
    label,
    value,
    onChange,
    min,
    max,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
}) {
    return (
        <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-text-tertiary">
                {label}
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
    return (
        <div className={cn("relative w-[62px]", disabled && "opacity-40 pointer-events-none")}>
            <SmartNumberInput
                min={0}
                max={100}
                value={Math.round(value * 100)}
                onChange={(next) => onChange(Math.max(0, Math.min(100, next)) / 100)}
                className="h-8 w-full rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary pl-2 pr-5 text-center text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-tertiary">%</span>
        </div>
    );
}

function SizeModePair({
    widthMode,
    heightMode,
    widthOptions,
    heightOptions,
    onWidthChange,
    onHeightChange,
}: {
    widthMode: string;
    heightMode: string;
    widthOptions: Array<{ value: string; label: string }>;
    heightOptions: Array<{ value: string; label: string }>;
    onWidthChange: (value: string) => void;
    onHeightChange: (value: string) => void;
}) {
    return (
        <TwoColumn>
            <div className="grid grid-cols-[28px_1fr] overflow-hidden rounded-[var(--radius-md)] border border-border-primary">
                <div className="flex h-8 items-center justify-center border-r border-border-primary text-[10px] text-text-tertiary">W</div>
                <Select
                    size="xs"
                    value={widthMode}
                    onChange={onWidthChange}
                    options={widthOptions}
                    triggerClassName="h-8 border-0 rounded-none bg-bg-secondary"
                />
            </div>
            <div className="grid grid-cols-[28px_1fr] overflow-hidden rounded-[var(--radius-md)] border border-border-primary">
                <div className="flex h-8 items-center justify-center border-r border-border-primary text-[10px] text-text-tertiary">H</div>
                <Select
                    size="xs"
                    value={heightMode}
                    onChange={onHeightChange}
                    options={heightOptions}
                    triggerClassName="h-8 border-0 rounded-none bg-bg-secondary"
                />
            </div>
        </TwoColumn>
    );
}

function AutoLayoutAlignmentGrid({
    primary,
    counter,
    onChange,
}: {
    primary: NonNullable<FrameLayer["primaryAxisAlignItems"]>;
    counter: NonNullable<FrameLayer["counterAxisAlignItems"]>;
    onChange: (updates: Partial<FrameLayer>) => void;
}) {
    const rows: Array<NonNullable<FrameLayer["counterAxisAlignItems"]>> = ["flex-start", "center", "flex-end"];
    const cols: Array<Exclude<NonNullable<FrameLayer["primaryAxisAlignItems"]>, "space-between">> = ["flex-start", "center", "flex-end"];
    return (
        <div className="grid grid-cols-[72px_1fr] gap-2">
            <div className="grid h-[72px] grid-cols-3 grid-rows-3 gap-1 rounded-[var(--radius-md)] bg-bg-secondary p-2">
                {rows.map((row) => cols.map((col) => {
                    const active = counter === row && primary === col;
                    return (
                        <button
                            key={`${row}-${col}`}
                            type="button"
                            onClick={() => onChange({ primaryAxisAlignItems: col, counterAxisAlignItems: row })}
                            className={cn(
                                "rounded-[3px] border border-border-primary transition-colors",
                                active ? "border-accent-primary bg-accent-primary" : "bg-bg-tertiary hover:border-border-secondary",
                            )}
                            title={`${col} / ${row}`}
                        />
                    );
                }))}
            </div>
            <div className="space-y-1.5">
                <Select
                    size="xs"
                    value={primary}
                    onChange={(value) => onChange({ primaryAxisAlignItems: value as FrameLayer["primaryAxisAlignItems"] })}
                    options={[
                        { value: "flex-start", label: "Start" },
                        { value: "center", label: "Center" },
                        { value: "flex-end", label: "End" },
                        { value: "space-between", label: "Space" },
                    ]}
                />
                <Select
                    size="xs"
                    value={counter}
                    onChange={(value) => onChange({ counterAxisAlignItems: value as FrameLayer["counterAxisAlignItems"] })}
                    options={[
                        { value: "flex-start", label: "Start" },
                        { value: "center", label: "Center" },
                        { value: "flex-end", label: "End" },
                        { value: "stretch", label: "Stretch" },
                    ]}
                />
            </div>
        </div>
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
    return (
        <LabeledControl label="Opacity">
            <div className="flex items-center gap-2">
                <input
                    type="range"
                    min={0}
                    max={100}
                    value={percent}
                    onChange={(event) => onChange(Number(event.target.value) / 100)}
                    className="flex-1 h-1.5 accent-accent-primary cursor-pointer"
                />
                <SmartNumberInput
                    min={0}
                    max={100}
                    value={percent}
                    onChange={(next) => onChange(Math.max(0, Math.min(100, next)) / 100)}
                    className="w-12 h-7 px-1 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-[10px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
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

function ToggleButton({ active, label, icon, onClick }: { active: boolean; label: string; icon?: ReactNode; onClick: () => void }) {
    return (
        <button
            type="button"
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
        { value: "fixed", label: "Fixed" },
        { value: "fill", label: "Fill" },
        ...(layer.type === "frame" || layer.type === "text" ? [{ value: "hug", label: "Hug" }] : []),
    ];
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
