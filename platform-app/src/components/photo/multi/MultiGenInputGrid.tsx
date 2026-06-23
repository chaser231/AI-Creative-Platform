"use client";

import { Loader2, X, Check, AlertCircle, Clock, MinusCircle } from "lucide-react";
import type { BatchItemStatus } from "@/lib/batchGenerationRunner";

export interface InputCell {
    id: string;
    sourceUrl: string;
    sourceName: string | null;
    status?: BatchItemStatus;
    error?: string | null;
}

interface MultiGenInputGridProps {
    cells: InputCell[];
    onRemove?: (id: string) => void;
}

const STATUS_META: Record<
    BatchItemStatus,
    { label: string; icon: typeof Check; className: string }
> = {
    PENDING: { label: "Ожидание", icon: Clock, className: "text-text-tertiary" },
    RUNNING: { label: "Генерация", icon: Loader2, className: "text-accent-primary" },
    COMPLETED: { label: "Готово", icon: Check, className: "text-emerald-500" },
    FAILED: { label: "Ошибка", icon: AlertCircle, className: "text-red-400" },
    SKIPPED: { label: "Пропущено", icon: MinusCircle, className: "text-text-tertiary" },
};

export function MultiGenInputGrid({ cells, onRemove }: MultiGenInputGridProps) {
    if (cells.length === 0) {
        return (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-border-primary px-4 py-10 text-center text-[12px] text-text-tertiary">
                Источники не добавлены
            </div>
        );
    }

    return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(116px,1fr))] gap-2">
            {cells.map((cell) => {
                const meta = cell.status ? STATUS_META[cell.status] : null;
                const Icon = meta?.icon;
                return (
                    <div
                        key={cell.id}
                        className={`group relative aspect-square overflow-hidden rounded-[var(--radius-md)] border bg-bg-tertiary ${
                            cell.status === "FAILED"
                                ? "border-red-400/60"
                                : "border-border-primary"
                        }`}
                        title={cell.error || cell.sourceName || undefined}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={cell.sourceUrl}
                            alt={cell.sourceName || "input"}
                            className="h-full w-full object-cover"
                        />

                        {cell.status === "RUNNING" && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                                <Loader2 size={20} className="animate-spin text-on-dark" />
                            </div>
                        )}

                        {meta && Icon && cell.status !== "RUNNING" && (
                            <div className="absolute bottom-1 left-1 flex items-center gap-1 rounded-full bg-bg-surface/90 px-1.5 py-0.5 text-[10px] font-medium shadow-sm">
                                <Icon size={10} className={meta.className} />
                                <span className="text-text-secondary">{meta.label}</span>
                            </div>
                        )}

                        {onRemove && (
                            <button
                                onClick={() => onRemove(cell.id)}
                                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-on-dark opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
                                title="Убрать"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
