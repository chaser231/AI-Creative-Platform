import { useState } from "react";
import { Tag } from "lucide-react";
import type { BadgeComponentProps } from "@/types";
import type { BusinessUnit } from "@/types";

interface BadgeContentBlockProps {
    id: string;
    name: string;
    props: BadgeComponentProps;
    value: string;
    onChange: (value: string) => void;
    businessUnit?: BusinessUnit;
}

export function BadgeContentBlock({ id, name, props, value, onChange, businessUnit }: BadgeContentBlockProps) {
    // We could add color pickers here dependent on BU, but for now just the label.
    
    // Some quick BU preset suggestions
    const presets = businessUnit === "yandex-market" 
        ? ["Скидка", "Акция", "Новинка"]
        : businessUnit === "yandex-food" 
            ? ["Вкусно", "Быстро", "20%"]
            : ["New", "Sale", "Special"];

    return (
        <div className="p-4 bg-bg-primary border border-border-primary rounded-[var(--radius-lg)] shadow-sm">
            <div className="flex justify-between items-center mb-2">
                <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Tag size={16} className="text-text-secondary" />
                    {name}
                </label>
            </div>
            
            <input
                type="text"
                placeholder={props.label || "Текст бейджа"}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
            />
            
            <div className="flex gap-2 mt-2 flex-wrap">
                {presets.map(p => (
                    <button
                        key={p}
                        onClick={() => onChange(p)}
                        className="px-2 py-1 text-[11px] font-medium bg-bg-secondary hover:bg-bg-surface border border-border-primary rounded-[var(--radius-sm)] text-text-secondary transition-colors cursor-pointer"
                    >
                        {p}
                    </button>
                ))}
            </div>
        </div>
    );
}
