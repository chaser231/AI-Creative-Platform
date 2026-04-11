"use client";

import { useState } from "react";
import { Paintbrush, Eye, EyeOff } from "lucide-react";
import { Popover, PopoverButton } from "@/components/ui/Popover";
import { Select } from "@/components/ui/Select";
import type { BadgeLayer } from "@/types";
import { ColorInput } from "./ColorInput";

export function BadgePropsGrouped({
    layer,
    onChange,
}: {
    layer: BadgeLayer;
    onChange: (updates: Partial<BadgeLayer>) => void;
}) {
    const [activePopover, setActivePopover] = useState<string | null>(null);
    const togglePopover = (name: string) => setActivePopover((prev) => (prev === name ? null : name));

    const fillEnabled = layer.fillEnabled !== false;

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
            <Select
                size="xs"
                value={layer.shape}
                onChange={(val) => onChange({ shape: val as BadgeLayer["shape"] })}
                options={[
                    { value: "pill", label: "Pill" },
                    { value: "rectangle", label: "Rect" },
                    { value: "circle", label: "Circle" },
                ]}
            />

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
                        {/* Opacity */}
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Непрозрачность</label>
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={Math.round((layer.opacity ?? 1) * 100)}
                                    onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
                                    className="flex-1 h-1.5 accent-accent-primary cursor-pointer"
                                />
                                <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={Math.round((layer.opacity ?? 1) * 100)}
                                    onChange={(e) => {
                                        const v = Math.max(0, Math.min(100, Number(e.target.value)));
                                        onChange({ opacity: v / 100 });
                                    }}
                                    className="w-12 h-7 px-1 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-[10px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                                />
                                <span className="text-[10px] text-text-tertiary">%</span>
                            </div>
                        </div>
                        <div className="w-full h-px bg-border-primary" />
                        {/* Fill */}
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Фон</label>
                            <div className="flex items-center gap-1.5">
                                <div className={`transition-opacity ${fillEnabled ? '' : 'opacity-30 pointer-events-none'}`}>
                                    <ColorInput value={layer.fill} onChange={(v) => onChange({ fill: v })} />
                                </div>
                                <button
                                    onClick={() => onChange({ fillEnabled: !fillEnabled })}
                                    className={`p-1 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${fillEnabled ? 'text-text-secondary hover:text-text-primary' : 'text-text-tertiary/40 hover:text-text-tertiary'}`}
                                    title={fillEnabled ? "Скрыть заливку" : "Показать заливку"}
                                >
                                    {fillEnabled ? <Eye size={12} /> : <EyeOff size={12} />}
                                </button>
                            </div>
                        </div>
                        {/* Text Color */}
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
