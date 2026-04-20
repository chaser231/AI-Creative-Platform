"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";

export interface ConfirmDialogProps {
    open: boolean;
    title: string;
    description?: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Visual intent — "danger" paints the confirm button red. */
    tone?: "default" | "danger";
    busy?: boolean;
    onConfirm: () => void;
    onClose: () => void;
}

/**
 * Themed confirmation dialog that replaces `window.confirm`.
 *
 * Use for destructive actions (delete asset / project / member).
 * Closes on backdrop click or Escape; confirm button fires `onConfirm`.
 */
export function ConfirmDialog({
    open,
    title,
    description,
    confirmLabel = "Удалить",
    cancelLabel = "Отмена",
    tone = "danger",
    busy,
    onConfirm,
    onClose,
}: ConfirmDialogProps) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [open, onClose]);

    if (!open || typeof document === "undefined") return null;

    const confirmClasses =
        tone === "danger"
            ? "bg-red-500 hover:bg-red-600 text-white"
            : "bg-accent-lime hover:bg-accent-lime-hover text-on-light";

    return createPortal(
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <div
                className="bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] p-6 max-w-sm w-full mx-4 shadow-[var(--shadow-lg)]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start gap-3 mb-4">
                    {tone === "danger" && (
                        <div className="p-2 rounded-[var(--radius-lg)] bg-red-500/10 shrink-0">
                            <AlertTriangle size={20} className="text-red-400" />
                        </div>
                    )}
                    <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
                        {description && (
                            <div className="text-xs text-text-tertiary mt-1 leading-relaxed">
                                {description}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="px-4 py-2 text-xs font-medium text-text-secondary hover:text-text-primary bg-bg-tertiary rounded-[var(--radius-md)] transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={busy}
                        className={`px-4 py-2 text-xs font-medium rounded-[var(--radius-md)] transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${confirmClasses}`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
