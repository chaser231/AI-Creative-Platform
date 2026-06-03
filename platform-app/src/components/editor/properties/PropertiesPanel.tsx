"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    Anchor,
    Eye,
    EyeOff,
    ImageIcon,
    LayoutDashboard,
    Link,
    Link2,
    Maximize2,
    Move,
    Paintbrush,
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
    FrameLayer,
    ImageLayer,
    ImageFitMode,
    Layer,
    RectangleLayer,
    StrokeAlign,
    TemplateSlotRole,
    TextLayer,
} from "@/types";
import { DEFAULT_CONSTRAINTS, IMAGE_FIT_MODE_LABELS, STROKE_ALIGN_LABELS } from "@/types";
import { cn } from "@/lib/cn";
import { PREINSTALLED_FONTS, getUserFonts, normalizeFontFamilyName, saveUserFont } from "@/lib/customFonts";
import { getAvailableFontFamiliesSync } from "@/utils/fontUtils";
import { uploadForAI } from "@/utils/imageUpload";
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

const FIELD_CLASS = "w-full h-7 px-2 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus";

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
                            <PaintRow label="Фон" value={artboardProps.fill} gradientTargetId="artboard" onChange={(fill) => updateArtboardProps({ fill })} />
                            <TwoColumn>
                                <NumberField label="R" value={artboardProps.cornerRadius} min={0} onChange={(value) => updateArtboardProps({ cornerRadius: Math.max(0, value) })} />
                                <NumberField label="Stroke" value={artboardProps.strokeWidth} min={0} onChange={(value) => updateArtboardProps({ strokeWidth: Math.max(0, value) })} />
                            </TwoColumn>
                            <ColorInput value={artboardProps.stroke || "#000000"} onChange={(stroke) => updateArtboardProps({ stroke })} />
                            <Select
                                size="xs"
                                value={artboardProps.strokeAlign ?? "center"}
                                onChange={(value) => updateArtboardProps({ strokeAlign: value as StrokeAlign })}
                                options={(Object.entries(STROKE_ALIGN_LABELS) as [StrokeAlign, string][]).map(([value, label]) => ({ value, label }))}
                            />
                            <ToggleButton
                                active={artboardProps.clipContent}
                                icon={<Scissors size={12} />}
                                label="Clip content"
                                onClick={() => updateArtboardProps({ clipContent: !artboardProps.clipContent })}
                            />
                        </InspectorSection>
                        <InspectorSection title="Изображение фона" icon={<ImageIcon size={13} />}>
                            <ArtboardBackgroundControls
                                artboardProps={artboardProps}
                                onUpdate={updateArtboardProps}
                                paletteBackgrounds={palette.backgrounds}
                                onApplyBackgroundSwatch={applyBackgroundSwatchToArtboard}
                                onCreateSwatchFromBackground={createSwatchFromArtboardBackground}
                                onUploadFile={handleBgFilePick}
                                variant="sidebar"
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
            <TwoColumn>
                <LabeledControl label="Horizontal">
                    <div className="flex items-center gap-1.5">
                        <ConstraintGlyph axis="x" value={constraints.horizontal} />
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
                    </div>
                </LabeledControl>
                <LabeledControl label="Vertical">
                    <div className="flex items-center gap-1.5">
                        <ConstraintGlyph axis="y" value={constraints.vertical} />
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
                </LabeledControl>
            </TwoColumn>
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
            <TwoColumn>
                <Select
                    size="xs"
                    value={layer.layoutSizingWidth || "fixed"}
                    onChange={(value) => onChange(resolveLayoutSizingUpdate(layer, "width", value))}
                    options={layoutSizingOptions(layer)}
                />
                <Select
                    size="xs"
                    value={layer.layoutSizingHeight || "fixed"}
                    onChange={(value) => onChange(resolveLayoutSizingUpdate(layer, "height", value))}
                    options={layoutSizingOptions(layer)}
                />
            </TwoColumn>
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
    return (
        <InspectorSection title="Auto Layout" icon={<LayoutDashboard size={13} />}>
            <div className="grid grid-cols-3 rounded-[var(--radius-md)] border border-border-primary overflow-hidden">
                {(["none", "horizontal", "vertical"] as const).map((mode) => (
                    <button
                        key={mode}
                        onClick={() => onChange({ layoutMode: mode })}
                        className={cn(
                            "h-8 text-[10px] border-r border-border-primary last:border-r-0 transition-colors cursor-pointer",
                            (layer.layoutMode || "none") === mode
                                ? "bg-accent-primary/10 text-accent-primary"
                                : "text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary",
                        )}
                    >
                        {mode === "none" ? "Off" : mode === "horizontal" ? "H" : "V"}
                    </button>
                ))}
            </div>
            {enabled && (
                <>
                    <TwoColumn>
                        <NumberField label="Top" value={layer.paddingTop || 0} min={0} onChange={(paddingTop) => onChange({ paddingTop })} />
                        <NumberField label="Right" value={layer.paddingRight || 0} min={0} onChange={(paddingRight) => onChange({ paddingRight })} />
                        <NumberField label="Bottom" value={layer.paddingBottom || 0} min={0} onChange={(paddingBottom) => onChange({ paddingBottom })} />
                        <NumberField label="Left" value={layer.paddingLeft || 0} min={0} onChange={(paddingLeft) => onChange({ paddingLeft })} />
                    </TwoColumn>
                    <NumberField label="Spacing" value={layer.spacing || 0} min={0} onChange={(spacing) => onChange({ spacing })} />
                    <TwoColumn>
                        <Select
                            size="xs"
                            value={layer.primaryAxisAlignItems || "flex-start"}
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
                            value={layer.counterAxisAlignItems || "flex-start"}
                            onChange={(value) => onChange({ counterAxisAlignItems: value as FrameLayer["counterAxisAlignItems"] })}
                            options={[
                                { value: "flex-start", label: "Start" },
                                { value: "center", label: "Center" },
                                { value: "flex-end", label: "End" },
                                { value: "stretch", label: "Stretch" },
                            ]}
                        />
                        <Select
                            size="xs"
                            value={layer.primaryAxisSizingMode || "fixed"}
                            onChange={(value) => onChange({ primaryAxisSizingMode: value as FrameLayer["primaryAxisSizingMode"] })}
                            options={[
                                { value: "fixed", label: "Fixed" },
                                { value: "auto", label: "Hug" },
                            ]}
                        />
                        <Select
                            size="xs"
                            value={layer.counterAxisSizingMode || "fixed"}
                            onChange={(value) => onChange({ counterAxisSizingMode: value as FrameLayer["counterAxisSizingMode"] })}
                            options={[
                                { value: "fixed", label: "Fixed" },
                                { value: "auto", label: "Hug" },
                            ]}
                        />
                    </TwoColumn>
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
            <LabeledControl label="Text color">
                <div className="flex items-center gap-2">
                    <div className={cn("flex-1", layer.fillEnabled === false && "opacity-30 pointer-events-none")}>
                        <ColorInput value={layer.fill} onChange={(fill) => onChange({ fill })} />
                    </div>
                    <button
                        type="button"
                        onClick={() => onChange({ fillEnabled: !(layer.fillEnabled !== false) })}
                        className="p-1 rounded-[var(--radius-sm)] text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary cursor-pointer"
                        title={layer.fillEnabled !== false ? "Скрыть" : "Показать"}
                    >
                        {layer.fillEnabled !== false ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                </div>
            </LabeledControl>
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
        <InspectorSection title="Изображение" icon={<ImageIcon size={13} />}>
            <button
                onClick={() => fileRef.current?.click()}
                disabled={isUploading}
                className="flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-border-primary text-[11px] text-text-secondary hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-50 cursor-pointer transition-colors"
            >
                <Upload size={12} />
                {isUploading ? "Загрузка..." : "Заменить"}
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
                            onChange({ src: compressedBase64 });
                            return uploadImage(compressedBase64, "tmp");
                        }).then((src) => {
                            if (src) onChange({ src });
                        }).finally(() => setIsUploading(false));
                    }).catch(() => setIsUploading(false));
                }}
            />
            <div className="grid grid-cols-4 rounded-[var(--radius-md)] border border-border-primary overflow-hidden">
                {fitModes.map((mode) => (
                    <button
                        key={mode}
                        onClick={() => onChange({ objectFit: mode })}
                        className={cn(
                            "h-8 text-[10px] border-r border-border-primary last:border-r-0 transition-colors cursor-pointer",
                            (layer.objectFit || "cover") === mode
                                ? "bg-accent-primary/10 text-accent-primary"
                                : "text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary",
                        )}
                    >
                        {IMAGE_FIT_MODE_LABELS[mode]}
                    </button>
                ))}
            </div>
            <TwoColumn>
                <NumberField label="Focus X" value={Math.round((layer.focusX ?? 0.5) * 100)} min={0} max={100} onChange={(value) => onChange({ focusX: value / 100 })} />
                <NumberField label="Focus Y" value={Math.round((layer.focusY ?? 0.5) * 100)} min={0} max={100} onChange={(value) => onChange({ focusY: value / 100 })} />
            </TwoColumn>
        </InspectorSection>
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
    return (
        <InspectorSection title="Стиль" icon={<Paintbrush size={13} />}>
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
                    strokeWidth: layer.strokeWidth,
                    strokeAlign: layer.strokeAlign,
                    strokeJoin: layer.strokeJoin,
                }}
                onChange={onChange}
            />
            <NumberField label="Radius" value={layer.cornerRadius} min={0} onChange={(cornerRadius) => onChange({ cornerRadius: Math.max(0, cornerRadius) })} />
            {showClip && layer.type === "frame" && (
                <ToggleButton
                    active={layer.clipContent}
                    icon={<Scissors size={12} />}
                    label="Clip content"
                    onClick={() => onChange({ clipContent: !layer.clipContent })}
                />
            )}
        </InspectorSection>
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

function InspectorSection({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
    return (
        <section className="border-b border-border-primary pb-3 last:border-b-0 last:pb-0">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-text-tertiary">
                {icon}
                {title}
            </div>
            <div className="space-y-2">{children}</div>
        </section>
    );
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
        <LabeledControl label={label}>
            <div className="relative">
                {icon && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary">{icon}</span>}
                <SmartNumberInput
                    value={value}
                    min={min}
                    max={max}
                    step={step}
                    onChange={onChange}
                    className={cn(FIELD_CLASS, icon && "pl-7")}
                />
            </div>
        </LabeledControl>
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
    enabled = true,
    onToggleEnabled,
}: {
    label: string;
    value: Parameters<typeof PaintInput>[0]["value"];
    onChange: Parameters<typeof PaintInput>[0]["onChange"];
    gradientTargetId?: string;
    enabled?: boolean;
    onToggleEnabled?: () => void;
}) {
    return (
        <LabeledControl label={label}>
            <div className="flex items-center gap-2">
                <div className={cn("flex-1", !enabled && "opacity-30 pointer-events-none")}>
                    <PaintInput value={value} gradientTargetId={gradientTargetId} onChange={onChange} />
                </div>
                {onToggleEnabled && (
                    <button
                        type="button"
                        onClick={onToggleEnabled}
                        className="p-1 rounded-[var(--radius-sm)] text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary cursor-pointer"
                        title={enabled ? "Скрыть" : "Показать"}
                    >
                        {enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                )}
            </div>
        </LabeledControl>
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
                "flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border text-[10px] transition-colors cursor-pointer",
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

function ConstraintGlyph({ axis, value }: { axis: "x" | "y"; value: string }) {
    return (
        <span className="relative block h-7 w-7 shrink-0 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-text-tertiary">
            <span className="absolute inset-[5px] rounded-[2px] border border-current opacity-50" />
            <span className={cn(
                "absolute rounded-full bg-current",
                axis === "x" ? "top-1/2 h-1 w-1 -translate-y-1/2" : "left-1/2 h-1 w-1 -translate-x-1/2",
                value === "left" && "left-[4px]",
                value === "right" && "right-[4px]",
                value === "top" && "top-[4px]",
                value === "bottom" && "bottom-[4px]",
                value === "center" && (axis === "x" ? "left-1/2 -translate-x-1/2" : "top-1/2 -translate-y-1/2"),
                value === "stretch" && (axis === "x" ? "left-[4px] right-[4px] w-auto" : "top-[4px] bottom-[4px] h-auto"),
                value === "scale" && "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ring-2 ring-current",
            )} />
        </span>
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
