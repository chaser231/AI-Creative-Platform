"use client";

import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import type { ArtboardProps } from "@/store/canvasStore";
import type { Layer, TextLayer, RectangleLayer, BadgeLayer, FrameLayer, ImageLayer, ConstraintH, ConstraintV, TemplateSlotRole } from "@/types";
import { DEFAULT_CONSTRAINTS } from "@/types";
import {
    Link2,
    AlignLeft,
    AlignCenter,
    AlignRight,
    Scissors,
    Move,
    Maximize2,
    Anchor,
    Link,
    Unlink,
} from "lucide-react";
import { Popover, PopoverButton } from "@/components/ui/Popover";
import { useState } from "react";
import { CompactInput } from "./CompactInput";
import { ColorInput } from "./ColorInput";
import { TextPropsGrouped } from "./TextPropsGrouped";
import { RectPropsGrouped } from "./RectPropsGrouped";
import { BadgePropsGrouped } from "./BadgePropsGrouped";
import { FramePropsGrouped } from "./FramePropsGrouped";
import { ImagePropsInline } from "./ImagePropsInline";

export function PropertiesPanel() {
    const { layers, selectedLayerIds, updateLayer, activeResizeId, artboardProps, updateArtboardProps, alignSelectedLayers } = useCanvasStore(useShallow((s) => ({
        layers: s.layers, selectedLayerIds: s.selectedLayerIds, updateLayer: s.updateLayer,
        activeResizeId: s.activeResizeId, artboardProps: s.artboardProps,
        updateArtboardProps: s.updateArtboardProps, alignSelectedLayers: s.alignSelectedLayers,
    })));

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
                <CompactInput label="R" value={artboardProps.cornerRadius} min={0} onChange={(v) => updateArtboardProps({ cornerRadius: Math.max(0, Number(v)) })} />
                <div className="w-px h-5 bg-border-primary shrink-0" />
                <span className="text-[10px] text-text-tertiary font-light shrink-0">Обводка</span>
                <ColorInput value={artboardProps.stroke || "#000000"} onChange={(v) => updateArtboardProps({ stroke: v })} />
                <CompactInput label="W" value={artboardProps.strokeWidth} min={0} onChange={(v) => updateArtboardProps({ strokeWidth: Math.max(0, Number(v)) })} />
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
                                                        onChange={(e) => updateLayer(selectedLayer.id, { layoutSizingWidth: e.target.value as Layer["layoutSizingWidth"] })}
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
                                                        onChange={(e) => updateLayer(selectedLayer.id, { layoutSizingHeight: e.target.value as Layer["layoutSizingHeight"] })}
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
                                    value={(selectedLayer as FrameLayer).groupSlotId || ""}
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
