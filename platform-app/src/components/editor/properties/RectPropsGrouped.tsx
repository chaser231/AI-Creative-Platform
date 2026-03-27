"use client";

import { useState } from "react";
import { Paintbrush } from "lucide-react";
import { Popover, PopoverButton } from "@/components/ui/Popover";
import type { RectangleLayer } from "@/types";
import { ColorInput } from "./ColorInput";

export function RectPropsGrouped({
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
                            <input type="number" min={0} value={layer.cornerRadius} onChange={(e) => onChange({ cornerRadius: Math.max(0, Number(e.target.value)) })}
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus" />
                        </div>
                    </div>
                </Popover>
            </div>
        </div>
    );
}
