"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/* ─── Container variants ─────────────────────────────── */

const containerVariants = cva("flex items-center w-fit", {
    variants: {
        variant: {
            /** Pill-style: bg container with rounded active pill */
            pill: "gap-1 bg-bg-secondary rounded-[var(--radius-md)] p-1",
            /** Bordered toggle: outlined container with dividers */
            bordered: "rounded-[var(--radius-lg)] border border-border-primary overflow-hidden",
        },
        size: {
            md: "",
            sm: "",
        },
    },
    defaultVariants: {
        variant: "pill",
        size: "md",
    },
});

/* ─── Item variants ──────────────────────────────────── */

const pillItemVariants = cva(
    "flex items-center justify-center gap-2 font-medium transition-all cursor-pointer",
    {
        variants: {
            size: {
                md: "px-4 py-2 text-xs rounded-[var(--radius-sm)]",
                sm: "px-3 py-1.5 text-[10px] rounded-[var(--radius-sm)]",
            },
            active: {
                true: "bg-bg-primary text-text-primary shadow-[var(--shadow-sm)]",
                false: "text-text-secondary hover:text-text-primary",
            },
        },
        defaultVariants: { size: "md", active: false },
    }
);

const borderedItemVariants = cva(
    "flex-1 flex items-center justify-center font-medium transition-colors cursor-pointer",
    {
        variants: {
            size: {
                md: "gap-1.5 py-2.5 text-xs",
                sm: "gap-1 py-2 text-[10px]",
            },
            active: {
                true: "bg-accent-primary/10 text-accent-primary",
                false: "text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary",
            },
        },
        defaultVariants: { size: "md", active: false },
    }
);

/* ─── Types ──────────────────────────────────────────── */

export interface SegmentOption<T extends string = string> {
    value: T;
    label: string;
    icon?: React.ReactNode;
}

interface SegmentedControlProps<T extends string = string>
    extends VariantProps<typeof containerVariants> {
    value: T;
    onChange: (value: T) => void;
    options: SegmentOption<T>[];
    className?: string;
    /** Full width: make container stretch */
    fullWidth?: boolean;
}

/* ─── Component ──────────────────────────────────────── */

export function SegmentedControl<T extends string = string>({
    value,
    onChange,
    options,
    variant = "pill",
    size = "md",
    className,
    fullWidth,
}: SegmentedControlProps<T>) {
    const isPill = variant === "pill";

    return (
        <div
            className={cn(
                containerVariants({ variant, size }),
                fullWidth && "w-full",
                className
            )}
        >
            {options.map((opt, i) => {
                const isActive = opt.value === value;
                const showDivider = !isPill && i > 0;

                return (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChange(opt.value)}
                        className={cn(
                            isPill
                                ? pillItemVariants({ size, active: isActive })
                                : borderedItemVariants({ size, active: isActive }),
                            showDivider && "border-l border-border-primary"
                        )}
                    >
                        {opt.icon}
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}
