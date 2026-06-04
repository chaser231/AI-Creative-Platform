"use client";

import { useState } from "react";
import { useNumberScrub } from "@/components/ui/SmartNumberInput";

export function CompactInput({
    label,
    value,
    onChange,
    width = "w-14",
    min,
}: {
    label: string;
    value: number | string;
    onChange: (value: string) => void;
    width?: string;
    min?: number;
}) {
    const [localValue, setLocalValue] = useState(String(value));
    const [isFocused, setIsFocused] = useState(false);
    const displayValue = isFocused ? localValue : String(value);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setLocalValue(val);
        if (val !== "" && val !== "-") {
            onChange(val);
        }
    };

    const handleBlur = () => {
        setIsFocused(false);
        if (localValue === "" || localValue === "-") {
            setLocalValue(String(value));
        } else {
            let num = Number(localValue);
            if (!isNaN(num)) {
                if (min !== undefined) num = Math.max(min, num);
                onChange(String(num));
                setLocalValue(String(num));
            } else {
                setLocalValue(String(value));
            }
        }
    };

    const scrub = useNumberScrub({
        value: Number(value) || 0,
        min,
        onChange: (next) => onChange(String(min !== undefined ? Math.max(min, next) : next)),
    });

    return (
        <div className="flex items-center gap-1">
            <span
                {...scrub}
                className="cursor-ew-resize select-none text-[10px] font-light text-text-tertiary hover:text-text-primary"
                title="Drag to adjust"
            >
                {label}
            </span>
            <input
                type="text"
                inputMode="decimal"
                value={displayValue}
                onFocus={() => {
                    setLocalValue(String(value));
                    setIsFocused(true);
                }}
                onBlur={handleBlur}
                onChange={handleChange}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.currentTarget.blur();
                    }
                }}
                className={`${width} h-7 px-1.5 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus`}
            />
        </div>
    );
}
