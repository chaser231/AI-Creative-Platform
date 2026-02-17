"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ className, label, error, id, ...props }, ref) => {
        return (
            <div className="flex flex-col gap-1.5">
                {label && (
                    <label
                        htmlFor={id}
                        className="text-sm font-medium text-text-primary"
                    >
                        {label}
                    </label>
                )}
                <input
                    ref={ref}
                    id={id}
                    className={cn(
                        "h-10 w-full rounded-[var(--radius-lg)] border border-border-primary bg-bg-surface px-3.5 text-sm text-text-primary",
                        "placeholder:text-text-tertiary",
                        "focus:outline-none focus:ring-2 focus:ring-accent-lime/50 focus:border-accent-lime",
                        "transition-all duration-[var(--transition-fast)]",
                        "hover:border-border-secondary",
                        error && "border-red-400 focus:ring-red-400/50 focus:border-red-400",
                        className
                    )}
                    {...props}
                />
                {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
        );
    }
);

Input.displayName = "Input";
export { Input };
