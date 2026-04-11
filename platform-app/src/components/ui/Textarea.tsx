"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/* ─── Textarea variants ──────────────────────────────── */

const textareaVariants = cva(
    "w-full border border-border-primary bg-bg-secondary text-text-primary placeholder:text-text-tertiary resize-none transition-all duration-[var(--transition-fast)] focus:outline-none focus:ring-1 focus:ring-border-focus hover:border-border-secondary disabled:opacity-50 disabled:cursor-not-allowed",
    {
        variants: {
            size: {
                md: "px-3 py-2 text-sm rounded-[var(--radius-lg)]",
                sm: "px-3 py-2 text-[12px] rounded-[var(--radius-md)]",
            },
        },
        defaultVariants: {
            size: "md",
        },
    }
);

/* ─── Types ──────────────────────────────────────────── */

export interface TextareaProps
    extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "size">,
        VariantProps<typeof textareaVariants> {
    /** Optional label rendered above the textarea */
    label?: string;
}

/* ─── Component ──────────────────────────────────────── */

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    function Textarea({ size, label, className, ...props }, ref) {
        return (
            <div className={label ? "flex flex-col gap-1.5" : undefined}>
                {label && (
                    <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
                        {label}
                    </label>
                )}
                <textarea
                    ref={ref}
                    className={cn(textareaVariants({ size }), className)}
                    {...props}
                />
            </div>
        );
    }
);
