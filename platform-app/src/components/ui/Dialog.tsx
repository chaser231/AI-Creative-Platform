"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface DialogProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    width?: string;
}

export function Dialog({ open, onClose, title, children, width = "max-w-md" }: DialogProps) {
    const overlayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            ref={overlayRef}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
            onClick={(e) => {
                if (e.target === overlayRef.current) onClose();
            }}
        >
            <div
                className={`${width} w-full mx-4 bg-bg-surface border border-border-primary rounded-[var(--radius-2xl)] shadow-[var(--shadow-xl)] animate-slide-up overflow-hidden`}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
                    <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-[var(--radius-md)] text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
                    >
                        <X size={16} />
                    </button>
                </div>
                {/* Body */}
                <div className="p-5">{children}</div>
            </div>
        </div>
    );
}
