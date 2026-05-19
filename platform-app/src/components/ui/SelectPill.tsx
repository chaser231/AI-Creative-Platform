import type { ReactNode } from "react";

export interface SelectPillOption {
    value: string;
    label: string;
}

interface SelectPillProps {
    value: string | number;
    options: SelectPillOption[];
    onChange: (value: string) => void;
    icon?: ReactNode;
    label: string;
    className?: string;
    displayValue?: string;
    disabled?: boolean;
}

export function SelectPill({
    value,
    options,
    onChange,
    icon,
    label,
    className = "",
    displayValue,
    disabled,
}: SelectPillProps) {
    const selected = displayValue ?? options.find((option) => option.value === String(value))?.label ?? String(value);

    return (
        <div
            className={`relative flex h-8 items-center gap-1.5 rounded-[10px] border border-border-primary/60 bg-transparent px-2.5 text-[12px] text-text-secondary transition-colors hover:border-border-secondary hover:bg-bg-tertiary/30 focus-within:border-border-secondary focus-within:bg-bg-tertiary/30 ${disabled ? "opacity-50" : ""} ${className}`}
        >
            {icon && <span className="pointer-events-none flex-shrink-0 text-text-tertiary">{icon}</span>}
            <span className="pointer-events-none truncate font-medium text-text-secondary">{selected}</span>
            <span className="sr-only">{label}</span>
            <select
                value={value}
                disabled={disabled}
                aria-label={label}
                onChange={(event) => onChange(event.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    );
}
