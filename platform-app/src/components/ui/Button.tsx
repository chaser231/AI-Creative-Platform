"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
    "inline-flex items-center justify-center font-medium transition-all duration-[var(--transition-fast)] cursor-pointer disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus whitespace-nowrap",
    {
        variants: {
            variant: {
                primary:
                    "bg-accent-primary text-text-inverse hover:bg-accent-primary-hover shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)]",
                secondary:
                    "bg-bg-surface border border-border-primary text-text-primary hover:bg-bg-tertiary hover:border-border-secondary",
                ghost:
                    "bg-transparent text-text-secondary hover:bg-bg-tertiary hover:text-text-primary",
                accent:
                    "bg-accent-lime text-text-inverse hover:bg-accent-lime-hover shadow-[var(--shadow-sm)] font-semibold",
                ai: "ai-gradient text-white hover:opacity-90 shadow-[var(--shadow-md)]",
                danger:
                    "bg-red-500 text-white hover:bg-red-600 shadow-[var(--shadow-sm)]",
            },
            size: {
                sm: "h-8 px-3.5 text-xs gap-1.5 rounded-[var(--radius-full)]",
                md: "h-9 px-4.5 text-sm gap-2 rounded-[var(--radius-full)]",
                lg: "h-11 px-6 text-sm gap-2.5 rounded-[var(--radius-full)]",
                icon: "h-9 w-9 rounded-[var(--radius-md)]",
            },
        },
        defaultVariants: {
            variant: "primary",
            size: "md",
        },
    }
);

interface ButtonProps
    extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    icon?: React.ReactNode;
    asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, icon, asChild = false, children, ...props }, ref) => {
        const Comp = asChild ? Slot : "button";
        return (
            <Comp
                ref={ref}
                className={cn(buttonVariants({ variant, size, className }))}
                {...props}
            >
                {icon && <span className="shrink-0">{icon}</span>}
                {children}
            </Comp>
        );
    }
);

Button.displayName = "Button";
export { Button, buttonVariants };
export type { ButtonProps };
