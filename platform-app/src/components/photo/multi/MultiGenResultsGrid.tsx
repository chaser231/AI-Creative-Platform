"use client";

import { Download, Loader2, Package } from "lucide-react";

export interface ResultCell {
    url: string;
    sourceName: string | null;
}

interface MultiGenResultsGridProps {
    results: ResultCell[];
    onExport: () => void;
    exporting: boolean;
}

export function MultiGenResultsGrid({
    results,
    onExport,
    exporting,
}: MultiGenResultsGridProps) {
    if (results.length === 0) return null;

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-text-primary">
                    Результаты · {results.length}
                </h3>
                <button
                    onClick={onExport}
                    disabled={exporting}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-accent-lime-hover px-3 py-1.5 text-[12px] font-medium text-accent-lime-text transition-colors hover:bg-accent-lime disabled:opacity-60 cursor-pointer"
                >
                    {exporting ? (
                        <Loader2 size={13} className="animate-spin" />
                    ) : (
                        <Package size={13} />
                    )}
                    Экспорт ZIP
                </button>
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
                {results.map((cell, i) => (
                    <div
                        key={`${cell.url}-${i}`}
                        className="group relative aspect-square overflow-hidden rounded-[var(--radius-md)] border border-border-primary bg-bg-tertiary"
                        title={cell.sourceName || undefined}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={cell.url}
                            alt={cell.sourceName || "result"}
                            className="h-full w-full object-cover"
                        />
                        <a
                            href={cell.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            download
                            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-on-dark opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
                            title="Скачать"
                        >
                            <Download size={12} />
                        </a>
                    </div>
                ))}
            </div>
        </div>
    );
}
