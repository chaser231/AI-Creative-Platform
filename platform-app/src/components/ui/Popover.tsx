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
}: {
    children: React.ReactNode;
    isOpen: boolean;
    onClose: () => void;
    className?: string;
}) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            ref={ref}
            className={`absolute top-full left-0 mt-2 p-3 bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] backdrop-blur-xl z-30 min-w-[220px] ${className}`}
        >
            {children}
        </div>
    );
}
