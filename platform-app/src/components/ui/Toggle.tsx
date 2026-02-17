"use client";

import { cn } from "@/lib/cn";

interface ToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: string;
    className?: string;
}

export function Toggle({ checked, onChange, label, className }: ToggleProps) {
    return (
        <label
            className={cn(
                "inline-flex items-center gap-2.5 cursor-pointer select-none",
                className
            )}
        >
            <button
                role="switch"
                type="button"
                aria-checked={checked}
                onClick={() => onChange(!checked)}
                className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 rounded-[var(--radius-full)] border-2 border-transparent transition-colors duration-[var(--transition-base)] cursor-pointer",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus",
                    checked ? "bg-accent-lime" : "bg-border-secondary"
                )}
            >
                <span
                    className={cn(
                        "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-[var(--shadow-sm)] ring-0 transition-transform duration-[var(--transition-base)]",
                        checked ? "translate-x-5" : "translate-x-0"
                    )}
                />
            </button>
            {label && (
                <span className="text-sm font-medium text-text-primary">{label}</span>
            )}
        </label>
    );
}
