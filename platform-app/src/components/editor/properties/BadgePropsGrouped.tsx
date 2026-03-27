"use client";

import { useState } from "react";
import { Paintbrush } from "lucide-react";
import { Popover, PopoverButton } from "@/components/ui/Popover";
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
