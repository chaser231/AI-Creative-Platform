"use client";

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
    return (
        <div className="flex items-center gap-1">
            <span className="text-[10px] text-text-tertiary font-light select-none">{label}</span>
            <input
                type="number"
                value={value}
                min={min}
                onChange={(e) => onChange(e.target.value)}
                className={`${width} h-7 px-1.5 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus`}
            />
        </div>
    );
}
