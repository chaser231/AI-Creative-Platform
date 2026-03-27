"use client";

import { useState } from "react";
import { LayoutDashboard, Paintbrush, Scissors } from "lucide-react";
import { Popover, PopoverButton } from "@/components/ui/Popover";
import type { FrameLayer } from "@/types";
import { ColorInput } from "./ColorInput";
import { CompactInput } from "./CompactInput";

export function FramePropsGrouped({
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
                                onChange={(e) => onChange({ layoutMode: e.target.value as FrameLayer["layoutMode"] })}
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
                                                onChange={(e) => onChange({ primaryAxisAlignItems: e.target.value as FrameLayer["primaryAxisAlignItems"] })}
                                                className="w-full h-7 px-1.5 text-[10px] bg-bg-secondary border border-border-primary rounded-[var(--radius-sm)] text-text-primary cursor-pointer focus:outline-none"
                                            >
                                                <option value="flex-start">Start</option>
                                                <option value="center">Center</option>
                                                <option value="flex-end">End</option>
                                                <option value="space-between">Space Between</option>
                                            </select>
                                            <select
                                                value={layer.counterAxisAlignItems || "flex-start"}
                                                onChange={(e) => onChange({ counterAxisAlignItems: e.target.value as FrameLayer["counterAxisAlignItems"] })}
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
                                                onChange={(e) => onChange({ primaryAxisSizingMode: e.target.value as FrameLayer["primaryAxisSizingMode"] })}
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
                                                onChange={(e) => onChange({ counterAxisSizingMode: e.target.value as FrameLayer["counterAxisSizingMode"] })}
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
                            <input type="number" min={0} value={layer.cornerRadius} onChange={(e) => onChange({ cornerRadius: Math.max(0, Number(e.target.value)) })}
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
