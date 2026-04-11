import React, { useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

export function PopoverButton({
    icon,
    label,
    isActive,
    onClick,
}: {
    icon?: React.ReactNode;
    label: string;
    isActive: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-md)] transition-all cursor-pointer text-[10px] font-medium shrink-0 ${isActive
                ? "bg-bg-tertiary text-text-primary shadow-[var(--shadow-sm)] border border-border-primary"
                : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary border border-transparent"
                }`}
            title={label}
        >
            {icon}
            <span className="select-none">{label}</span>
            <ChevronDown size={8} className={`transition-transform ${isActive ? "rotate-180" : ""}`} />
        </button>
    );
}

export function Popover({
    children,
    isOpen,
    onClose,
    className = "",
    position = "bottom",
}: {
    children: React.ReactNode;
    isOpen: boolean;
    onClose: () => void;
    className?: string;
    position?: "top" | "bottom";
}) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as Node;
            // 1. Click inside popover — ignore
            if (ref.current?.contains(target)) return;
            // 2. Click inside a Radix portal (Select, Dropdown, etc.) — ignore
            //    Radix UI renders portal content with data-radix-popper-content-wrapper
            const el = target instanceof Element ? target : target.parentElement;
            if (el?.closest('[data-radix-popper-content-wrapper]')) return;
            // 3. Everything else — close
            onClose();
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            ref={ref}
            className={`absolute ${position === 'top' ? 'bottom-full mb-3' : 'top-full mt-2'} left-0 p-3 bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] backdrop-blur-xl z-30 min-w-[220px] ${className}`}
        >
            {children}
        </div>
    );
}
