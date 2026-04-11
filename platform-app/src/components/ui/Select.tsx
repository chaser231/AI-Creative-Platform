"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown, Check } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/* ─── Trigger variants ─────────────────────────────── */

const selectTriggerVariants = cva(
    "inline-flex items-center justify-between w-full border border-border-primary bg-bg-secondary text-text-primary cursor-pointer transition-all duration-[var(--transition-fast)] hover:border-border-secondary focus:outline-none focus:ring-1 focus:ring-border-focus",
    {
        variants: {
            size: {
                md: "h-10 px-3 text-sm rounded-[var(--radius-lg)] gap-2",
                sm: "h-8 px-2 text-[11px] rounded-[var(--radius-md)] gap-1.5",
                xs: "h-7 px-1.5 text-[10px] rounded-[var(--radius-sm)] gap-1",
            },
        },
        defaultVariants: {
            size: "md",
        },
    }
);

/* ─── Item variants (for consistent sizing) ────────── */

const selectItemVariants = cva(
    "relative flex items-center rounded-[var(--radius-md)] cursor-pointer select-none outline-none transition-colors data-[highlighted]:bg-bg-tertiary data-[highlighted]:text-text-primary text-text-secondary",
    {
        variants: {
            size: {
                md: "px-3 py-2 text-sm pr-8",
                sm: "px-2 py-1.5 text-[11px] pr-7",
                xs: "px-1.5 py-1 text-[10px] pr-6",
            },
        },
        defaultVariants: {
            size: "md",
        },
    }
);

/* ─── Types ────────────────────────────────────────── */

export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
}

interface SelectProps extends VariantProps<typeof selectTriggerVariants> {
    value: string;
    onChange: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    label?: string;
    className?: string;
    triggerClassName?: string;
    disabled?: boolean;
}

/* ─── Component ────────────────────────────────────── */

export function Select({
    value,
    onChange,
    options,
    size,
    placeholder = "Выбрать...",
    label,
    className,
    triggerClassName,
    disabled,
}: SelectProps) {
    const chevronSize = size === "xs" ? 8 : size === "sm" ? 10 : 14;
    const checkSize = size === "xs" ? 10 : size === "sm" ? 11 : 13;

    return (
        <div className={cn(label ? "flex flex-col gap-1.5" : undefined, className)}>
            {label && (
                <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
                    {label}
                </label>
            )}
            <SelectPrimitive.Root value={value} onValueChange={onChange} disabled={disabled}>
                <SelectPrimitive.Trigger
                    className={cn(selectTriggerVariants({ size }), triggerClassName)}
                >
                    <SelectPrimitive.Value placeholder={placeholder} />
                    <SelectPrimitive.Icon>
                        <ChevronDown size={chevronSize} className="text-text-tertiary shrink-0" />
                    </SelectPrimitive.Icon>
                </SelectPrimitive.Trigger>

                <SelectPrimitive.Portal>
                    <SelectPrimitive.Content
                        className="z-[9999] overflow-hidden bg-bg-surface border border-border-primary rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] backdrop-blur-xl"
                        position="popper"
                        sideOffset={4}
                        align="start"
                    >
                        <SelectPrimitive.Viewport className="p-1 max-h-[280px]">
                            {options.map((option) => (
                                <SelectPrimitive.Item
                                    key={option.value}
                                    value={option.value}
                                    disabled={option.disabled}
                                    className={cn(selectItemVariants({ size }))}
                                >
                                    <SelectPrimitive.ItemText>
                                        {option.label}
                                    </SelectPrimitive.ItemText>
                                    <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center">
                                        <Check size={checkSize} className="text-accent-primary" />
                                    </SelectPrimitive.ItemIndicator>
                                </SelectPrimitive.Item>
                            ))}
                        </SelectPrimitive.Viewport>
                    </SelectPrimitive.Content>
                </SelectPrimitive.Portal>
            </SelectPrimitive.Root>
        </div>
    );
}
