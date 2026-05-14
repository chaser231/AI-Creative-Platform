"use client";

import { useState, useEffect, useRef } from "react";

export function SmartNumberInput({
    value,
    onChange,
    className,
    min,
    max,
    step = 1,
}: {
    value: number;
    onChange: (val: number) => void;
    className?: string;
    min?: number;
    max?: number;
    step?: number;
}) {
    const formatValue = (v: number) => (Number.isInteger(v) ? String(v) : Number(v.toFixed(2)).toString());
    const [localValue, setLocalValue] = useState(formatValue(value));
    const [isFocused, setIsFocused] = useState(false);

    useEffect(() => {
        if (!isFocused) {
            setLocalValue(formatValue(value));
        }
    }, [value, isFocused]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setLocalValue(val);
        if (val !== "" && val !== "-") {
            let num = Number(val);
            if (!isNaN(num)) {
                // Don't clamp on change, clamp on blur so user can type freely
                onChange(num);
            }
        }
    };

    const handleBlur = () => {
        setIsFocused(false);
        if (localValue === "" || localValue === "-") {
            // Revert
            setLocalValue(formatValue(value));
        } else {
            let num = Number(localValue);
            if (!isNaN(num)) {
                if (min !== undefined) num = Math.max(min, num);
                if (max !== undefined) num = Math.min(max, num);
                onChange(num);
                setLocalValue(formatValue(num));
            } else {
                setLocalValue(formatValue(value));
            }
        }
    };

    return (
        <input
            type="number"
            value={localValue}
            min={min}
            max={max}
            step={step}
            onFocus={() => setIsFocused(true)}
            onBlur={handleBlur}
            onChange={handleChange}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.currentTarget.blur();
                }
            }}
            className={className}
        />
    );
}
