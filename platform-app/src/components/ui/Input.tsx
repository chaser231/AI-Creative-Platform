"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    /** Leading icon (rendered left-aligned inside the input) */
    icon?: ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ className, label, error, icon, id, ...props }, ref) => {
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
                <div className="relative">
                    {icon && (
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none">
                            {icon}
                        </span>
                    )}
                    <input
                        ref={ref}
                        id={id}
                        className={cn(
                            "h-10 w-full rounded-[var(--radius-lg)] border border-border-primary bg-bg-surface text-sm text-text-primary",
                            "placeholder:text-text-tertiary",
                            "focus:outline-none focus:ring-2 focus:ring-accent-lime/50 focus:border-accent-lime",
                            "transition-all duration-[var(--transition-fast)]",
                            "hover:border-border-secondary",
                            icon ? "pl-9 pr-3.5" : "px-3.5",
                            error && "border-red-400 focus:ring-red-400/50 focus:border-red-400",
                            className
                        )}
                        {...props}
                    />
                </div>
                {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
        );
    }
);

Input.displayName = "Input";
export { Input };
