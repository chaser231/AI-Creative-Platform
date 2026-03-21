"use client";

import { useCanvasStore } from "@/store/canvasStore";
import type { ArtboardProps } from "@/store/canvasStore";
import type { Layer, TextLayer, RectangleLayer, BadgeLayer, FrameLayer, ImageLayer, ConstraintH, ConstraintV, TemplateSlotRole } from "@/types";
import { DEFAULT_CONSTRAINTS } from "@/types";
import { PREINSTALLED_FONTS, saveUserFont, getUserFonts } from "@/lib/customFonts";

const SYSTEM_FONTS = [
    "Inter", "Roboto", "Open Sans", "Montserrat", 
    "PT Sans", "Outfit", "Arial", "Georgia"
];
import {
    Link2,
    Type,
    ALargeSmall,
    BoxSelect,
    AlignLeft,
    AlignCenter,
    AlignRight,
    Palette,
    ChevronDown,
    ImageIcon,
    Scissors,
    Move,
    Paintbrush,
    Maximize2,
    RotateCw,
    Anchor,
    LayoutDashboard,
    Link,
    Unlink,
} from "lucide-react";
import { Popover, PopoverButton } from "@/components/ui/Popover";
import { useState, useRef, useEffect } from "react";

export function PropertiesPanel() {
    const { layers, selectedLayerIds, updateLayer, activeResizeId, artboardProps, updateArtboardProps, alignSelectedLayers } = useCanvasStore();

    const isMultiSelection = selectedLayerIds.length > 1;
    const selectedLayer = selectedLayerIds.length === 1
        ? layers.find((l) => l.id === selectedLayerIds[0])
        : null;

    const isInsideAL = selectedLayerIds.some(id => {
        const parent = layers.find(l => l.type === "frame" && (l as FrameLayer).childIds.includes(id)) as FrameLayer | undefined;
        return parent?.layoutMode && parent.layoutMode !== "none";
    });

    const [activePopover, setActivePopover] = useState<string | null>(null);
    const togglePopover = (name: string) => setActivePopover((prev) => (prev === name ? null : name));
    
    const [availableFonts, setAvailableFonts] = useState<string[]>(SYSTEM_FONTS || ["Inter"]);
    const [isUploadingFont, setIsUploadingFont] = useState(false);

    const panelPositionClass = "absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2.5 border border-border-primary rounded-[var(--radius-2xl)] shadow-[var(--shadow-lg)] max-w-[92%] backdrop-blur-xl bg-bg-surface/85";

    // When multiple items are selected
    if (isMultiSelection) {
        return (
            <div className={panelPositionClass}>
                <div className="flex items-center gap-2 px-2">
                    <span className="text-xs text-text-primary font-medium">Multiple items selected</span>
                    <span className="text-[10px] text-text-tertiary px-1.5 py-0.5 bg-bg-secondary rounded-full">
                        {selectedLayerIds.length}
                    </span>
                </div>
            </div>
        );
    }

    // When nothing is selected, show artboard properties
    if (!selectedLayer) {
        return (
            <div className={panelPositionClass}>
                <span className="text-[10px] text-text-tertiary font-medium uppercase tracking-wider shrink-0">Артборд</span>
                <div className="w-px h-5 bg-border-primary shrink-0" />
                <span className="text-[10px] text-text-tertiary font-light shrink-0">Фон</span>
                <ColorInput value={artboardProps.fill} onChange={(v) => updateArtboardProps({ fill: v })} />
                <div className="w-px h-5 bg-border-primary shrink-0" />
                <CompactInput label="R" value={artboardProps.cornerRadius} onChange={(v) => updateArtboardProps({ cornerRadius: Number(v) })} />
                <div className="w-px h-5 bg-border-primary shrink-0" />
                <span className="text-[10px] text-text-tertiary font-light shrink-0">Обводка</span>
                <ColorInput value={artboardProps.stroke || "#000000"} onChange={(v) => updateArtboardProps({ stroke: v })} />
                <CompactInput label="W" value={artboardProps.strokeWidth} onChange={(v) => updateArtboardProps({ strokeWidth: Number(v) })} />
                <div className="w-px h-5 bg-border-primary shrink-0" />
                <button
                    onClick={() => updateArtboardProps({ clipContent: !artboardProps.clipContent })}
                    className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-[var(--radius-sm)] border cursor-pointer transition-colors shrink-0 ${artboardProps.clipContent
                        ? "bg-accent-primary/10 border-accent-primary/30 text-accent-primary"
                        : "border-border-primary text-text-tertiary hover:text-text-primary"
                        }`}
                    title="Обрезка содержимого по артборду"
                >
                    <Scissors size={10} />
                    Clip
                </button>
            </div>
        );
    }

    return (
        <div className={panelPositionClass}>
            {/* Master/Instance indicator */}
            {selectedLayer.masterId && (
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-full)] text-[10px] font-semibold shrink-0 ${activeResizeId === "master"
                    ? "bg-green-600 text-white dark:bg-green-700"
                    : "bg-blue-600 text-white dark:bg-blue-700"
                    }`}>
                    <Link2 size={10} />
                    {activeResizeId === "master" ? "Мастер" : "Инстанс"}
                </div>
            )}

            {/* ── Alignment ────────── */}
            <div className={`flex items-center gap-0.5 bg-bg-secondary rounded-[var(--radius-lg)] p-0.5 border border-border-primary shrink-0 transition-opacity ${isInsideAL ? 'opacity-40 pointer-events-none' : ''}`}>
                <button onClick={() => alignSelectedLayers('left')} className="p-1 hover:bg-bg-tertiary rounded-[var(--radius-sm)] text-text-tertiary hover:text-text-primary transition-colors" title="Выровнять по левому краю"><AlignLeft size={12} /></button>
                <button onClick={() => alignSelectedLayers('center')} className="p-1 hover:bg-bg-tertiary rounded-[var(--radius-sm)] text-text-tertiary hover:text-text-primary transition-colors" title="Выровнять по горизонтальному центру"><AlignCenter size={12} /></button>
                <button onClick={() => alignSelectedLayers('right')} className="p-1 hover:bg-bg-tertiary rounded-[var(--radius-sm)] text-text-tertiary hover:text-text-primary transition-colors" title="Выровнять по правому краю"><AlignRight size={12} /></button>
                <div className="w-[1px] h-3 bg-border-primary mx-0.5" />
                <button onClick={() => alignSelectedLayers('top')} className="p-1 hover:bg-bg-tertiary rounded-[var(--radius-sm)] text-text-tertiary hover:text-text-primary transition-colors" title="Выровнять по верхнему краю"><AlignLeft size={12} className="-rotate-90" /></button>
                <button onClick={() => alignSelectedLayers('middle')} className="p-1 hover:bg-bg-tertiary rounded-[var(--radius-sm)] text-text-tertiary hover:text-text-primary transition-colors" title="Выровнять по вертикальному центру"><AlignCenter size={12} className="rotate-90" /></button>
                <button onClick={() => alignSelectedLayers('bottom')} className="p-1 hover:bg-bg-tertiary rounded-[var(--radius-sm)] text-text-tertiary hover:text-text-primary transition-colors" title="Выровнять по нижнему краю"><AlignRight size={12} className="-rotate-90" /></button>
            </div>

            <div className="w-px h-5 bg-border-primary shrink-0" />

            {/* ── Позиция (X, Y, Rotation) ────────── */}
            <div className="relative">
                <PopoverButton
                    icon={<Move size={12} />}
                    label="Позиция"
                    isActive={activePopover === "position"}
                    onClick={() => togglePopover("position")}
                />
                <Popover isOpen={activePopover === "position"} onClose={() => setActivePopover(null)}>
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1 block">X</label>
                                <input type="number" value={Math.round(selectedLayer.x)} onChange={(e) => updateLayer(selectedLayer.id, { x: Number(e.target.value) })}
                                    className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus" />
                            </div>
                            <div>
                                <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1 block">Y</label>
                                <input type="number" value={Math.round(selectedLayer.y)} onChange={(e) => updateLayer(selectedLayer.id, { y: Number(e.target.value) })}
                                    className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus" />
                            </div>
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1 block">Поворот (°)</label>
                            <input type="number" value={Math.round(selectedLayer.rotation)} onChange={(e) => updateLayer(selectedLayer.id, { rotation: Number(e.target.value) })}
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus" />
                        </div>
                    </div>
                </Popover>
            </div>

            {/* ── Размер (W, H) ────────────────────── */}
            <div className="relative">
                <PopoverButton
                    icon={<Maximize2 size={12} />}
                    label="Размер"
                    isActive={activePopover === "size"}
                    onClick={() => togglePopover("size")}
                />
                <Popover isOpen={activePopover === "size"} onClose={() => setActivePopover(null)}>
                    <div className="space-y-4">
                        {/* Base Dimensions */}
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1 block">Ширина</label>
                                <input type="number" value={Math.round(selectedLayer.width)} onChange={(e) => updateLayer(selectedLayer.id, { width: Number(e.target.value) })}
                                    className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus" />
                            </div>
                            <div>
                                <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1 block">Высота</label>
                                <input type="number" value={Math.round(selectedLayer.height)} onChange={(e) => updateLayer(selectedLayer.id, { height: Number(e.target.value) })}
                                    className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus" />
                            </div>
                        </div>
                        
                        {/* Size Sync Toggle (only for instances) */}
                        {activeResizeId !== "master" && selectedLayer.masterId && selectedLayer.type === "image" && (
                            <div className="mt-2 flex items-center justify-between bg-bg-secondary p-2 rounded-[var(--radius-md)] border border-border-primary">
                                <span className="text-[10px] text-text-secondary">Привязка размера к мастеру</span>
                                <button
                                    onClick={() => updateLayer(selectedLayer.id, { detachedSizeSync: !selectedLayer.detachedSizeSync })}
                                    className={`p-1 rounded-[var(--radius-sm)] transition-colors ${!selectedLayer.detachedSizeSync ? 'bg-accent-primary/20 text-accent-primary' : 'bg-bg-tertiary text-text-tertiary hover:bg-bg-tertiary/80 hover:text-text-primary'}`}
                                    title={!selectedLayer.detachedSizeSync ? "Размер синхронизируется" : "Размер отвязан. Ширина и высота этого слоя больше не будут меняться при изменении мастера."}
                                >
                                    {!selectedLayer.detachedSizeSync ? <Link size={12} /> : <Unlink size={12} />}
                                </button>
                            </div>
                        )}

                        {/* Auto-Layout Child Sizing (if applicable) */}
                        {(() => {
                            const parentFrame = layers.find(l => l.type === "frame" && (l as FrameLayer).childIds.includes(selectedLayer.id)) as FrameLayer | undefined;
                            if (parentFrame && parentFrame.layoutMode && parentFrame.layoutMode !== "none") {
                                return (
                                    <>
                                        <div className="w-full h-px bg-border-primary shrink-0" />
                                        <div>
                                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Размер в Авто-лейауте</label>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <span className="text-[10px] text-text-tertiary font-light mb-1 block">По горизонтали</span>
                                                    <select
                                                        value={selectedLayer.layoutSizingWidth || "fixed"}
                                                        onChange={(e) => updateLayer(selectedLayer.id, { layoutSizingWidth: e.target.value as any })}
                                                        className="w-full h-8 px-2 text-[11px] bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-border-focus"
                                                    >
                                                        <option value="fixed">Fixed</option>
                                                        <option value="fill">Fill</option>
                                                        {selectedLayer.type === "frame" && <option value="hug">Hug</option>}
                                                    </select>
                                                </div>
                                                <div>
                                                    <span className="text-[10px] text-text-tertiary font-light mb-1 block">По вертикали</span>
                                                    <select
                                                        value={selectedLayer.layoutSizingHeight || "fixed"}
                                                        onChange={(e) => updateLayer(selectedLayer.id, { layoutSizingHeight: e.target.value as any })}
                                                        className="w-full h-8 px-2 text-[11px] bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-border-focus"
                                                    >
                                                        <option value="fixed">Fixed</option>
                                                        <option value="fill">Fill</option>
                                                        {selectedLayer.type === "frame" && <option value="hug">Hug</option>}
                                                    </select>
                                                </div>
                                            </div>
                                            <div className="mt-3 flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    id="isAbsolutePositioned"
                                                    checked={!!selectedLayer.isAbsolutePositioned}
                                                    onChange={(e) => updateLayer(selectedLayer.id, { isAbsolutePositioned: e.target.checked })}
                                                    className="rounded border-border-primary text-accent-primary focus:ring-accent-primary bg-bg-secondary"
                                                />
                                                <label htmlFor="isAbsolutePositioned" className="text-[10px] text-text-primary cursor-pointer">
                                                    Абсолютное позиционирование
                                                </label>
                                            </div>
                                        </div>
                                    </>
                                );
                            }
                            return null;
                        })()}
                    </div>
                </Popover>
            </div>

            {/* ── Привязки и Слот ──────────────────── */}
            <div className="w-px h-6 bg-border-primary shrink-0" />
            <div className="relative">
                <PopoverButton
                    icon={<Anchor size={12} />}
                    label="Привязки"
                    isActive={activePopover === "constraints"}
                    onClick={() => togglePopover("constraints")}
                />
                <Popover isOpen={activePopover === "constraints"} onClose={() => setActivePopover(null)}>
                    <div className="space-y-4">
                        {/* Constraints */}
                        {(() => {
                            const c = selectedLayer.constraints ?? DEFAULT_CONSTRAINTS;
                            return (
                                <div>
                                    <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Выравнивание</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <span className="text-[10px] text-text-tertiary font-light mb-1 block">По горизонтали</span>
                                            <select
                                                value={c.horizontal}
                                                onChange={(e) => updateLayer(selectedLayer.id, {
                                                    constraints: { ...c, horizontal: e.target.value as ConstraintH }
                                                })}
                                                className="w-full h-8 px-2 text-[11px] bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-border-focus"
                                            >
                                                <option value="left">Слева (Left)</option>
                                                <option value="right">Справа (Right)</option>
                                                <option value="center">По центру (Center)</option>
                                                <option value="stretch">Растянуть (Stretch)</option>
                                                <option value="scale">Масштаб (Scale)</option>
                                            </select>
                                        </div>
                                        <div>
                                            <span className="text-[10px] text-text-tertiary font-light mb-1 block">По вертикали</span>
                                            <select
                                                value={c.vertical}
                                                onChange={(e) => updateLayer(selectedLayer.id, {
                                                    constraints: { ...c, vertical: e.target.value as ConstraintV }
                                                })}
                                                className="w-full h-8 px-2 text-[11px] bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-border-focus"
                                            >
                                                <option value="top">Сверху (Top)</option>
                                                <option value="bottom">Снизу (Bottom)</option>
                                                <option value="center">По центру (Center)</option>
                                                <option value="stretch">Растянуть (Stretch)</option>
                                                <option value="scale">Масштаб (Scale)</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}

                        <div className="w-full h-px bg-border-primary shrink-0" />

                        {/* Smart Layout Slot */}
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Роль в шаблоне (Slot)</label>
                            <select
                                value={selectedLayer.slotId || "none"}
                                onChange={(e) => updateLayer(selectedLayer.id, { slotId: e.target.value as TemplateSlotRole })}
                                className="w-full h-8 px-2 text-[11px] bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-border-focus"
                            >
                                <option value="none">Без роли (None)</option>
                                <option value="headline">Заголовок (Headline)</option>
                                <option value="subhead">Подзаголовок (Subhead)</option>
                                <option value="cta">Кнопка (CTA)</option>
                                <option value="background">Фон (Background)</option>
                                <option value="image-primary">Главное фото</option>
                                <option value="logo">Логотип (Logo)</option>
                            </select>
                        </div>

                        {/* Group Slot ID (for frames — links child texts for coordinated AI generation) */}
                        {selectedLayer.type === "frame" && (
                            <div className="mt-2">
                                <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Группа текстов (Group Slot ID)</label>
                                <input
                                    type="text"
                                    placeholder="например: hero, promo, footer"
                                    value={(selectedLayer as any).groupSlotId || ""}
                                    onChange={(e) => updateLayer(selectedLayer.id, { groupSlotId: e.target.value || undefined })}
                                    className="w-full h-8 px-2 text-[11px] bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus placeholder:text-text-tertiary"
                                />
                                <p className="text-[9px] text-text-tertiary mt-1">Связывает вложенные текстовые слои для совместной AI-генерации</p>
                            </div>
                        )}
                    </div>
                </Popover>
            </div>

            <div className="w-px h-6 bg-border-primary shrink-0" />

            {/* Type-specific properties */}
            {selectedLayer.type === "text" && (
                <TextPropsGrouped
                    layer={selectedLayer}
                    onChange={(updates) => updateLayer(selectedLayer.id, updates)}
                />
            )}
            {selectedLayer.type === "rectangle" && (
                <RectPropsGrouped
                    layer={selectedLayer}
                    onChange={(updates) => updateLayer(selectedLayer.id, updates)}
                />
            )}
            {selectedLayer.type === "badge" && (
                <BadgePropsGrouped
                    layer={selectedLayer}
                    onChange={(updates) => updateLayer(selectedLayer.id, updates)}
                />
            )}
            {selectedLayer.type === "image" && (
                <ImagePropsInline
                    layer={selectedLayer}
                    onChange={(updates) => updateLayer(selectedLayer.id, updates)}
                />
            )}
            {selectedLayer.type === "frame" && (
                <FramePropsGrouped
                    layer={selectedLayer as FrameLayer}
                    onChange={(updates) => updateLayer(selectedLayer.id, updates)}
                />
            )}
        </div>
    );
}

/* ─── Compact helpers ─────────────────────────────── */

function CompactInput({
    label,
    value,
    onChange,
    width = "w-14",
}: {
    label: string;
    value: number | string;
    onChange: (value: string) => void;
    width?: string;
}) {
    return (
        <div className="flex items-center gap-1">
            <span className="text-[10px] text-text-tertiary font-light select-none">{label}</span>
            <input
                type="number"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={`${width} h-7 px-1.5 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus`}
            />
        </div>
    );
}

function ColorInput({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div className="flex items-center gap-1.5">
            <input
                type="color"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-6 h-6 rounded-[var(--radius-sm)] border border-border-primary cursor-pointer"
            />
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-16 h-7 px-1.5 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-[10px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
        </div>
    );
}

/* ─── Text props grouped ──────────────────────────── */

function TextPropsGrouped({
    layer,
    onChange,
}: {
    layer: TextLayer;
    onChange: (updates: Partial<TextLayer>) => void;
}) {
    const [activePopover, setActivePopover] = useState<string | null>(null);
    const [availableFonts, setAvailableFonts] = useState<string[]>(SYSTEM_FONTS);
    const [isUploadingFont, setIsUploadingFont] = useState(false);

    useEffect(() => {
        const loadFonts = async () => {
            try {
                const userFonts = await getUserFonts();
                const fontNames = [
                    ...SYSTEM_FONTS,
                    ...PREINSTALLED_FONTS.map((f: any) => f.name),
                    ...userFonts.map((f: any) => f.name)
                ];
                setAvailableFonts(Array.from(new Set(fontNames)));
            } catch (err) {
                console.error("Failed to load custom fonts:", err);
            }
        };
        loadFonts();
    }, [activePopover]);

    const togglePopover = (name: string) => {
        setActivePopover((prev) => (prev === name ? null : name));
    };

    return (
        <div className="flex items-center gap-1 relative">
            {/* Шрифт — font family + weight */}
            <div className="relative">
                <PopoverButton
                    icon={<Type size={12} />}
                    label="Шрифт"
                    isActive={activePopover === "font"}
                    onClick={() => togglePopover("font")}
                />
                <Popover isOpen={activePopover === "font"} onClose={() => setActivePopover(null)}>
                    <div className="space-y-3">
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Семейство</label>
                            <select
                                value={layer.fontFamily}
                                onChange={(e) => onChange({ fontFamily: e.target.value })}
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-border-focus mb-2"
                            >
                                {availableFonts.map(f => (
                                    <option key={f} value={f}>{f}</option>
                                ))}
                            </select>

                            <label className="flex items-center justify-center gap-1.5 w-full h-8 px-2 rounded-[var(--radius-md)] bg-bg-primary border border-dashed border-border-focus text-text-secondary text-[10px] cursor-pointer hover:bg-bg-tertiary transition-colors">
                                {isUploadingFont ? "Загрузка..." : "+ Загрузить свой (.ttf, .otf)"}
                                <input 
                                    type="file" 
                                    accept=".ttf,.otf,.woff,.woff2" 
                                    className="hidden" 
                                    disabled={isUploadingFont}
                                    onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        const fontName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9-]/g, "");
                                        if (!fontName) return alert("Неверное имя файла шрифта");
                                        
                                        setIsUploadingFont(true);
                                        const reader = new FileReader();
                                        reader.onload = async (ev) => {
                                            try {
                                                const buffer = ev.target?.result as ArrayBuffer;
                                                if (!buffer) throw new Error("File read failed");
                                                const f = new FontFace(fontName, buffer);
                                                const loadedFace = await f.load();
                                                document.fonts.add(loadedFace);
                                                await saveUserFont(fontName, buffer);
                                                setAvailableFonts(prev => Array.from(new Set([...prev, fontName])));
                                                onChange({ fontFamily: fontName });
                                            } catch (err) {
                                                console.error("Failed to install font:", err);
                                                alert("Ошибка при установке шрифта");
                                            } finally {
                                                setIsUploadingFont(false);
                                            }
                                        };
                                        reader.onerror = () => setIsUploadingFont(false);
                                        reader.readAsArrayBuffer(file);
                                    }}
                                />
                            </label>
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Начертание</label>
                            <select
                                value={layer.fontWeight}
                                onChange={(e) => onChange({ fontWeight: e.target.value })}
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-border-focus"
                            >
                                <option value="300">Light</option>
                                <option value="400">Regular</option>
                                <option value="500">Medium</option>
                                <option value="600">SemiBold</option>
                                <option value="700">Bold</option>
                                <option value="800">ExtraBold</option>
                            </select>
                        </div>
                    </div>
                </Popover>
            </div>

            {/* Текст — size, spacing, line height */}
            <div className="relative">
                <PopoverButton
                    icon={<ALargeSmall size={12} />}
                    label="Текст"
                    isActive={activePopover === "text"}
                    onClick={() => togglePopover("text")}
                />
                <Popover isOpen={activePopover === "text"} onClose={() => setActivePopover(null)}>
                    <div className="space-y-3">
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Кегль</label>
                            <input
                                type="number"
                                value={layer.fontSize}
                                onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                            />
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Кернинг (px)</label>
                            <input
                                type="number"
                                value={layer.letterSpacing}
                                step={0.5}
                                onChange={(e) => onChange({ letterSpacing: Number(e.target.value) })}
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                            />
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Интерлиньяж</label>
                            <input
                                type="number"
                                value={layer.lineHeight}
                                step={0.1}
                                onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                            />
                        </div>
                    </div>
                </Popover>
            </div>

            {/* Контейнер — layout, overflow */}
            <div className="relative">
                <PopoverButton
                    icon={<BoxSelect size={12} />}
                    label="Контейнер"
                    isActive={activePopover === "layout"}
                    onClick={() => togglePopover("layout")}
                />
                <Popover isOpen={activePopover === "layout"} onClose={() => setActivePopover(null)}>
                    <div className="space-y-4">
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Размер Контейнера</label>
                            <select
                                value={layer.textAdjust || "auto_width"}
                                onChange={(e) => onChange({ textAdjust: e.target.value as any })}
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-border-focus"
                            >
                                <option value="auto_width">Auto Width</option>
                                <option value="auto_height">Auto Height</option>
                                <option value="fixed">Fixed Size</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <div className={`w-3.5 h-3.5 rounded-[var(--radius-sm)] border flex items-center justify-center transition-colors ${layer.truncateText ? 'bg-accent-primary border-accent-primary' : 'border-border-primary bg-bg-secondary group-hover:border-border-focus'}`}>
                                    {layer.truncateText && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
                                </div>
                                <span className="text-[11px] text-text-primary">Truncate Text</span>
                                <input
                                    type="checkbox"
                                    className="hidden"
                                    checked={layer.truncateText || false}
                                    onChange={(e) => onChange({ truncateText: e.target.checked })}
                                />
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <div className={`w-3.5 h-3.5 rounded-[var(--radius-sm)] border flex items-center justify-center transition-colors ${layer.verticalTrim ? 'bg-accent-primary border-accent-primary' : 'border-border-primary bg-bg-secondary group-hover:border-border-focus'}`}>
                                    {layer.verticalTrim && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
                                </div>
                                <span className="text-[11px] text-text-primary">Vertical Trim</span>
                                <input
                                    type="checkbox"
                                    className="hidden"
                                    checked={layer.verticalTrim || false}
                                    onChange={(e) => onChange({ verticalTrim: e.target.checked })}
                                />
                            </label>
                        </div>
                    </div>
                </Popover>
            </div>

            {/* Стиль текста — color, alignment, transform */}
            <div className="relative">
                <PopoverButton
                    icon={<Paintbrush size={12} />}
                    label="Стиль"
                    isActive={activePopover === "style"}
                    onClick={() => togglePopover("style")}
                />
                <Popover isOpen={activePopover === "style"} onClose={() => setActivePopover(null)}>
                    <div className="space-y-4">
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Цвет текста</label>
                            <ColorInput value={layer.fill} onChange={(v) => onChange({ fill: v })} />
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Выравнивание</label>
                            <div className="flex items-center border border-border-primary rounded-[var(--radius-md)] overflow-hidden w-fit">
                                <AlignButton
                                    icon={<AlignLeft size={12} />}
                                    isActive={layer.align === "left"}
                                    onClick={() => onChange({ align: "left" })}
                                    title="По левому краю"
                                />
                                <AlignButton
                                    icon={<AlignCenter size={12} />}
                                    isActive={layer.align === "center"}
                                    onClick={() => onChange({ align: "center" })}
                                    title="По центру"
                                />
                                <AlignButton
                                    icon={<AlignRight size={12} />}
                                    isActive={layer.align === "right"}
                                    onClick={() => onChange({ align: "right" })}
                                    title="По правому краю"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Регистр</label>
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <div className={`w-3.5 h-3.5 rounded-[var(--radius-sm)] border flex items-center justify-center transition-colors ${layer.textTransform === 'uppercase' ? 'bg-accent-primary border-accent-primary' : 'border-border-primary bg-bg-secondary group-hover:border-border-focus'}`}>
                                    {layer.textTransform === 'uppercase' && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
                                </div>
                                <span className="text-[11px] text-text-primary">ВЕРХНИЙ РЕГИСТР</span>
                                <input
                                    type="checkbox"
                                    className="hidden"
                                    checked={layer.textTransform === 'uppercase'}
                                    onChange={(e) => onChange({ textTransform: e.target.checked ? 'uppercase' : 'none' })}
                                />
                            </label>
                        </div>
                    </div>
                </Popover>
            </div>
        </div>
    );
}

function AlignButton({
    icon,
    isActive,
    onClick,
    title,
}: {
    icon: React.ReactNode;
    isActive: boolean;
    onClick: () => void;
    title: string;
}) {
    return (
        <button
            onClick={onClick}
            title={title}
            className={`p-1.5 transition-colors cursor-pointer ${isActive
                ? "bg-accent-primary/10 text-accent-primary"
                : "text-text-tertiary hover:text-text-primary hover:bg-bg-secondary"
                }`}
        >
            {icon}
        </button>
    );
}

/* ─── Rectangle props (grouped) ───────────────────── */

function RectPropsGrouped({
    layer,
    onChange,
}: {
    layer: RectangleLayer;
    onChange: (updates: Partial<RectangleLayer>) => void;
}) {
    const [activePopover, setActivePopover] = useState<string | null>(null);
    const togglePopover = (name: string) => setActivePopover((prev) => (prev === name ? null : name));

    return (
        <div className="flex items-center gap-1 relative">
            <div className="relative">
                <PopoverButton
                    icon={<Paintbrush size={12} />}
                    label="Стиль"
                    isActive={activePopover === "style"}
                    onClick={() => togglePopover("style")}
                />
                <Popover isOpen={activePopover === "style"} onClose={() => setActivePopover(null)}>
                    <div className="space-y-3">
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Заливка</label>
                            <ColorInput value={layer.fill} onChange={(v) => onChange({ fill: v })} />
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Обводка</label>
                            <ColorInput value={layer.stroke || "#000000"} onChange={(v) => onChange({ stroke: v })} />
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Радиус</label>
                            <input type="number" value={layer.cornerRadius} onChange={(e) => onChange({ cornerRadius: Number(e.target.value) })}
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus" />
                        </div>
                    </div>
                </Popover>
            </div>
        </div>
    );
}

/* ─── Badge props (grouped) ────────────────────────── */

function BadgePropsGrouped({
    layer,
    onChange,
}: {
    layer: BadgeLayer;
    onChange: (updates: Partial<BadgeLayer>) => void;
}) {
    const [activePopover, setActivePopover] = useState<string | null>(null);
    const togglePopover = (name: string) => setActivePopover((prev) => (prev === name ? null : name));

    return (
        <div className="flex items-center gap-1.5 relative">
            {/* Метка — always visible */}
            <div className="flex items-center gap-1">
                <span className="text-[10px] text-text-tertiary font-light">Метка</span>
                <input
                    type="text"
                    value={layer.label}
                    onChange={(e) => onChange({ label: e.target.value })}
                    className="w-20 h-7 px-1.5 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
            </div>

            {/* Форма */}
            <select
                value={layer.shape}
                onChange={(e) => onChange({ shape: e.target.value as BadgeLayer["shape"] })}
                className="h-7 px-1.5 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary cursor-pointer focus:outline-none"
            >
                <option value="pill">Pill</option>
                <option value="rectangle">Rect</option>
                <option value="circle">Circle</option>
            </select>

            {/* Стиль */}
            <div className="relative">
                <PopoverButton
                    icon={<Paintbrush size={12} />}
                    label="Стиль"
                    isActive={activePopover === "style"}
                    onClick={() => togglePopover("style")}
                />
                <Popover isOpen={activePopover === "style"} onClose={() => setActivePopover(null)}>
                    <div className="space-y-3">
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Фон</label>
                            <ColorInput value={layer.fill} onChange={(v) => onChange({ fill: v })} />
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Цвет текста</label>
                            <ColorInput value={layer.textColor} onChange={(v) => onChange({ textColor: v })} />
                        </div>
                    </div>
                </Popover>
            </div>
        </div>
    );
}

/* ─── Frame props (grouped) ────────────────────────── */

function FramePropsGrouped({
    layer,
    onChange,
}: {
    layer: FrameLayer;
    onChange: (updates: Partial<FrameLayer>) => void;
}) {
    const [activePopover, setActivePopover] = useState<string | null>(null);
    const togglePopover = (name: string) => setActivePopover((prev) => (prev === name ? null : name));

    return (
        <div className="flex items-center gap-1 relative">
            {/* Auto-Layout */}
            <div className="relative">
                <PopoverButton
                    icon={<LayoutDashboard size={12} />}
                    label="Лейаут"
                    isActive={activePopover === "layout"}
                    onClick={() => togglePopover("layout")}
                />
                <Popover isOpen={activePopover === "layout"} onClose={() => setActivePopover(null)}>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] text-text-primary font-medium">Авто-лейаут</label>
                            <select
                                value={layer.layoutMode || "none"}
                                onChange={(e) => onChange({ layoutMode: e.target.value as any })}
                                className="h-7 px-2 text-[10px] bg-bg-secondary border border-border-primary rounded-[var(--radius-sm)] text-text-primary cursor-pointer focus:outline-none"
                            >
                                <option value="none">Выкл</option>
                                <option value="horizontal">Горизонтальный</option>
                                <option value="vertical">Вертикальный</option>
                            </select>
                        </div>

                        {layer.layoutMode && layer.layoutMode !== "none" && (
                            <>
                                <div className="w-full h-px bg-border-primary shrink-0" />
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Отступы</label>
                                        <div className="space-y-1.5">
                                            <CompactInput label="Верт." value={layer.paddingTop || 0} onChange={(v) => onChange({ paddingTop: Number(v), paddingBottom: Number(v) })} width="w-full" />
                                            <CompactInput label="Гориз." value={layer.paddingLeft || 0} onChange={(v) => onChange({ paddingLeft: Number(v), paddingRight: Number(v) })} width="w-full" />
                                            <CompactInput label="Между" value={layer.spacing || 0} onChange={(v) => onChange({ spacing: Number(v) })} width="w-full" />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Выравнивание</label>
                                        <div className="space-y-1.5">
                                            <select
                                                value={layer.primaryAxisAlignItems || "flex-start"}
                                                onChange={(e) => onChange({ primaryAxisAlignItems: e.target.value as any })}
                                                className="w-full h-7 px-1.5 text-[10px] bg-bg-secondary border border-border-primary rounded-[var(--radius-sm)] text-text-primary cursor-pointer focus:outline-none"
                                            >
                                                <option value="flex-start">Start</option>
                                                <option value="center">Center</option>
                                                <option value="flex-end">End</option>
                                                <option value="space-between">Space Between</option>
                                            </select>
                                            <select
                                                value={layer.counterAxisAlignItems || "flex-start"}
                                                onChange={(e) => onChange({ counterAxisAlignItems: e.target.value as any })}
                                                className="w-full h-7 px-1.5 text-[10px] bg-bg-secondary border border-border-primary rounded-[var(--radius-sm)] text-text-primary cursor-pointer focus:outline-none"
                                            >
                                                <option value="flex-start">Top/Left</option>
                                                <option value="center">Center</option>
                                                <option value="flex-end">Bottom/Right</option>
                                                <option value="stretch">Stretch</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                <div className="w-full h-px bg-border-primary shrink-0" />
                                <div>
                                    <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Размер Контейнера</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <span className="text-[9px] text-text-tertiary font-light mb-1 block">Осн. Ось (Main)</span>
                                            <select
                                                value={layer.primaryAxisSizingMode || "fixed"}
                                                onChange={(e) => onChange({ primaryAxisSizingMode: e.target.value as any })}
                                                className="w-full h-7 px-1.5 text-[10px] bg-bg-secondary border border-border-primary rounded-[var(--radius-sm)] text-text-primary cursor-pointer focus:outline-none"
                                            >
                                                <option value="fixed">Fixed</option>
                                                <option value="auto">Hug Contents</option>
                                            </select>
                                        </div>
                                        <div>
                                            <span className="text-[9px] text-text-tertiary font-light mb-1 block">Попер. Ось (Cross)</span>
                                            <select
                                                value={layer.counterAxisSizingMode || "fixed"}
                                                onChange={(e) => onChange({ counterAxisSizingMode: e.target.value as any })}
                                                className="w-full h-7 px-1.5 text-[10px] bg-bg-secondary border border-border-primary rounded-[var(--radius-sm)] text-text-primary cursor-pointer focus:outline-none"
                                            >
                                                <option value="fixed">Fixed</option>
                                                <option value="auto">Hug Contents</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </Popover>
            </div>

            <div className="w-px h-6 bg-border-primary shrink-0" />
            <div className="relative">
                <PopoverButton
                    icon={<Paintbrush size={12} />}
                    label="Стиль"
                    isActive={activePopover === "style"}
                    onClick={() => togglePopover("style")}
                />
                <Popover isOpen={activePopover === "style"} onClose={() => setActivePopover(null)}>
                    <div className="space-y-3">
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Заливка</label>
                            <ColorInput value={layer.fill} onChange={(v) => onChange({ fill: v })} />
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Обводка</label>
                            <ColorInput value={layer.stroke || "#000000"} onChange={(v) => onChange({ stroke: v })} />
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Радиус</label>
                            <input type="number" value={layer.cornerRadius} onChange={(e) => onChange({ cornerRadius: Number(e.target.value) })}
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus" />
                        </div>
                    </div>
                </Popover>
            </div>

            {/* Clip toggle */}
            <button
                onClick={() => onChange({ clipContent: !layer.clipContent })}
                className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-[var(--radius-sm)] border cursor-pointer transition-colors ${layer.clipContent
                    ? "bg-accent-primary/10 border-accent-primary/30 text-accent-primary"
                    : "border-border-primary text-text-tertiary hover:text-text-primary"
                    }`}
                title="Обрезка содержимого"
            >
                <Scissors size={10} />
                Clip
            </button>
        </div>
    );
}

/* ─── Image props ────────────────────────────────────── */

function ImagePropsInline({
    layer,
    onChange,
}: {
    layer: ImageLayer;
    onChange: (updates: Partial<ImageLayer>) => void;
}) {
    const fileRef = useRef<HTMLInputElement>(null);

    const handleReplace = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            onChange({ src: reader.result as string });
        };
        reader.readAsDataURL(file);
        e.target.value = "";
    };

    return (
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-tertiary font-light">Изображение</span>
            <button
                onClick={() => fileRef.current?.click()}
                className="text-[10px] px-2 py-1 rounded-[var(--radius-sm)] border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-secondary cursor-pointer transition-colors"
            >
                Заменить
            </button>
            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleReplace}
            />
        </div>
    );
}
