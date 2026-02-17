"use client";

import { useCanvasStore } from "@/store/canvasStore";
import type { ArtboardProps } from "@/store/canvasStore";
import type { Layer, TextLayer, RectangleLayer, BadgeLayer, FrameLayer, ImageLayer, ConstraintH, ConstraintV } from "@/types";
import { DEFAULT_CONSTRAINTS } from "@/types";
import {
    Link2,
    Type,
    ALargeSmall,
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
} from "lucide-react";
import { useState, useRef, useEffect } from "react";

export function PropertiesPanel() {
    const { layers, selectedLayerId, updateLayer, activeResizeId, artboardProps, updateArtboardProps } = useCanvasStore();
    const selectedLayer = layers.find((l) => l.id === selectedLayerId);
    const [activePopover, setActivePopover] = useState<string | null>(null);
    const togglePopover = (name: string) => setActivePopover((prev) => (prev === name ? null : name));

    const panelPositionClass = "absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2.5 border border-border-primary rounded-[var(--radius-2xl)] shadow-[var(--shadow-lg)] max-w-[92%] backdrop-blur-xl bg-bg-surface/85";

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
                    <div className="space-y-3">
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
                    </div>
                </Popover>
            </div>

            {/* Constraints — shown when layer is inside a frame */}
            {(() => {
                const parentFrame = layers.find(
                    (l) => l.type === "frame" && (l as FrameLayer).childIds.includes(selectedLayer.id)
                );
                if (!parentFrame) return null;
                const c = selectedLayer.constraints ?? DEFAULT_CONSTRAINTS;
                return (
                    <>
                        <div className="w-px h-6 bg-border-primary shrink-0" />
                        <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] text-text-tertiary font-light">H</span>
                            <select
                                value={c.horizontal}
                                onChange={(e) => updateLayer(selectedLayer.id, {
                                    constraints: { ...c, horizontal: e.target.value as ConstraintH }
                                })}
                                className="h-6 px-1 text-[10px] bg-bg-secondary border border-border-primary rounded-[var(--radius-sm)] text-text-primary cursor-pointer focus:outline-none"
                            >
                                <option value="left">Left</option>
                                <option value="right">Right</option>
                                <option value="center">Center</option>
                                <option value="stretch">Stretch</option>
                                <option value="scale">Scale</option>
                            </select>
                            <span className="text-[10px] text-text-tertiary font-light">V</span>
                            <select
                                value={c.vertical}
                                onChange={(e) => updateLayer(selectedLayer.id, {
                                    constraints: { ...c, vertical: e.target.value as ConstraintV }
                                })}
                                className="h-6 px-1 text-[10px] bg-bg-secondary border border-border-primary rounded-[var(--radius-sm)] text-text-primary cursor-pointer focus:outline-none"
                            >
                                <option value="top">Top</option>
                                <option value="bottom">Bottom</option>
                                <option value="center">Center</option>
                                <option value="stretch">Stretch</option>
                                <option value="scale">Scale</option>
                            </select>
                        </div>
                    </>
                );
            })()}

            {/* Divider */}
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

/* ─── Popover wrapper ─────────────────────────────── */

function PopoverButton({
    icon,
    label,
    isActive,
    onClick,
}: {
    icon: React.ReactNode;
    label: string;
    isActive: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-md)] transition-all cursor-pointer text-[10px] font-medium shrink-0 ${isActive
                ? "bg-bg-tertiary text-text-primary shadow-[var(--shadow-sm)] border border-border-primary"
                : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary border border-transparent"
                }`}
            title={label}
        >
            {icon}
            <span className="select-none">{label}</span>
            <ChevronDown size={8} className={`transition-transform ${isActive ? "rotate-180" : ""}`} />
        </button>
    );
}

function Popover({
    children,
    isOpen,
    onClose,
}: {
    children: React.ReactNode;
    isOpen: boolean;
    onClose: () => void;
}) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            ref={ref}
            className="absolute top-full left-0 mt-2 p-3 bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] backdrop-blur-xl z-30 min-w-[220px]"
        >
            {children}
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
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-border-focus"
                            >
                                <option value="Inter">Inter</option>
                                <option value="Roboto">Roboto</option>
                                <option value="Open Sans">Open Sans</option>
                                <option value="Montserrat">Montserrat</option>
                                <option value="PT Sans">PT Sans</option>
                                <option value="Outfit">Outfit</option>
                                <option value="Arial">Arial</option>
                                <option value="Georgia">Georgia</option>
                            </select>
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

            {/* Выравнивание — alignment buttons inline */}
            <div className="flex items-center border border-border-primary rounded-[var(--radius-md)] overflow-hidden shrink-0">
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

            {/* Цвет — inline color, always clear */}
            <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] text-text-tertiary font-light select-none">Цвет</span>
                <input
                    type="color"
                    value={layer.fill}
                    onChange={(e) => onChange({ fill: e.target.value })}
                    className="w-6 h-6 rounded-[var(--radius-sm)] border border-border-primary cursor-pointer"
                />
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
