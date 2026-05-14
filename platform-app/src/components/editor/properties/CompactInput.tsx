"use client";

import { useState, useEffect } from "react";

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

    useEffect(() => {
        if (!isFocused) {
            setLocalValue(String(value));
        }
    }, [value, isFocused]);

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

    return (
        <div className="flex items-center gap-1">
            <span className="text-[10px] text-text-tertiary font-light select-none">{label}</span>
            <input
                type="number"
                value={localValue}
                min={min}
                onFocus={() => setIsFocused(true)}
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
