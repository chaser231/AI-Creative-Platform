"use client";

import { useEffect, useState } from "react";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";

export function ColorInput({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    const [localValue, setLocalValue] = useState(value);
    const { schedule, flush } = useDebouncedCallback(onChange);

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    const handleChange = (next: string) => {
        setLocalValue(next);
        schedule(next);
    };

    return (
        <div className="flex items-center gap-1.5">
            <input
                type="color"
                value={localValue}
                onChange={(e) => handleChange(e.target.value)}
                onBlur={flush}
                className="w-6 h-6 rounded-[var(--radius-sm)] border border-border-primary cursor-pointer"
            />
            <input
                type="text"
                value={localValue}
                onChange={(e) => handleChange(e.target.value)}
                onBlur={flush}
                className="w-16 h-7 px-1.5 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-[10px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
            />
        </div>
    );
}
