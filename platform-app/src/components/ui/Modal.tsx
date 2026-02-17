"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

interface ModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    maxWidth?: string;
}

export function Modal({
    open,
    onClose,
    title,
    children,
    footer,
    maxWidth = "max-w-lg",
}: ModalProps) {
    return (
        <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay
                    className="fixed inset-0 z-50"
                    style={{ backgroundColor: "rgba(0, 0, 0, 0.4)" }}
                />
                <DialogPrimitive.Content
                    className={cn(
                        "fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2",
                        "rounded-[var(--radius-3xl)] shadow-[var(--shadow-xl)] border border-border-primary bg-bg-surface",
                        "p-7 max-h-[85vh] overflow-y-auto",
                        maxWidth
                    )}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between mb-6">
                        <DialogPrimitive.Title className="text-xl font-light text-text-primary tracking-tight">
                            {title}
                        </DialogPrimitive.Title>
                        <DialogPrimitive.Close
                            className="p-2 rounded-[var(--radius-md)] text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
                        >
                            <X size={18} />
                        </DialogPrimitive.Close>
                    </div>

                    {/* Body */}
                    <div>{children}</div>

                    {/* Footer */}
                    {footer && (
                        <div className="flex justify-end gap-3 mt-7 pt-5 border-t border-border-primary">
                            {footer}
                        </div>
                    )}
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
