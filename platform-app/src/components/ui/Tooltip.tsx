"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";

const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps {
    content: string;
    children: React.ReactNode;
    side?: "top" | "right" | "bottom" | "left";
    className?: string;
}

export function Tooltip({ content, children, side = "bottom", className }: TooltipProps) {
    return (
        <TooltipPrimitive.Root delayDuration={200}>
            <TooltipPrimitive.Trigger asChild>
                {children}
            </TooltipPrimitive.Trigger>
            <TooltipPrimitive.Portal>
                <TooltipPrimitive.Content
                    side={side}
                    sideOffset={6}
                    className={cn(
                        "z-50 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)]",
                        "bg-bg-inverse text-text-inverse shadow-[var(--shadow-md)]",
                        "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
                        "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
                        "data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
                        className
                    )}
                >
                    {content}
                </TooltipPrimitive.Content>
            </TooltipPrimitive.Portal>
        </TooltipPrimitive.Root>
    );
}

export { TooltipProvider };
