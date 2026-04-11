"use client";

import { useState, useMemo, useCallback } from "react";
import {
    X, Search, Trash2, Download, Plus, CheckSquare, Square,
    SortAsc, SortDesc, Image as ImageIcon, Loader2, FolderOpen,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/Input";
import { useCanvasStore } from "@/store/canvasStore";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AssetLibraryModalProps {
    projectId: string;
    open: boolean;
    onClose: () => void;
}

type SortBy = "createdAt" | "filename" | "sizeBytes";
type SortOrder = "asc" | "desc";

// ─── Component ──────────────────────────────────────────────────────────────

export function AssetLibraryModal({ projectId, open, onClose }: AssetLibraryModalProps) {
    const [search, setSearch] = useState("");
    const [sortBy, setSortBy] = useState<SortBy>("createdAt");
    const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const addImageLayer = useCanvasStore((s) => s.addImageLayer);

    // ── Data fetching ───────────────────────────────────────────────
    const { data: assets, isLoading, refetch } = trpc.asset.listByProject.useQuery(
        { projectId, search: search || undefined, sortBy, sortOrder },
        { enabled: open }
    );

    const deleteMutation = trpc.asset.deleteMany.useMutation({
        onSuccess: () => {
            setSelectedIds(new Set());
            refetch();
        },
    });

    // ── Selection ───────────────────────────────────────────────────
    const toggleSelect = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const selectAll = useCallback(() => {
        if (!assets) return;
        if (selectedIds.size === assets.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(assets.map(a => a.id)));
        }
    }, [assets, selectedIds.size]);

    const selectedAssets = useMemo(
        () => assets?.filter(a => selectedIds.has(a.id)) || [],
        [assets, selectedIds]
    );

    // ── Actions ─────────────────────────────────────────────────────
    const handleAddToCanvas = useCallback(() => {
        for (const asset of selectedAssets) {
            addImageLayer(asset.url, 400, 400);
        }
        setSelectedIds(new Set());
    }, [selectedAssets, addImageLayer]);

    const handleExport = useCallback(async () => {
        for (const asset of selectedAssets) {
            try {
                const response = await fetch(asset.url);
                const blob = await response.blob();
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = asset.filename;
                a.click();
                URL.revokeObjectURL(a.href);
            } catch {
                // Open URL directly as fallback
                window.open(asset.url, "_blank");
            }
        }
    }, [selectedAssets]);

    const handleDelete = useCallback(() => {
        if (selectedIds.size === 0) return;
        if (!confirm(`Удалить ${selectedIds.size} ассет(ов)? Это действие нельзя отменить.`)) return;
        deleteMutation.mutate({ ids: [...selectedIds] });
    }, [selectedIds, deleteMutation]);

    const toggleSort = useCallback((field: SortBy) => {
        if (sortBy === field) {
            setSortOrder(prev => prev === "desc" ? "asc" : "desc");
        } else {
            setSortBy(field);
            setSortOrder("desc");
        }
    }, [sortBy]);

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const formatDate = (date: Date) => {
        return new Date(date).toLocaleDateString("ru-RU", {
            day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        });
    };

    if (!open) return null;

    const SortIcon = sortOrder === "desc" ? SortDesc : SortAsc;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-bg-surface border border-border-primary rounded-2xl shadow-2xl w-[900px] max-w-[95vw] max-h-[85vh] flex flex-col animate-in slide-in-from-bottom-4 duration-300">
                {/* ── Header ──────────────────────────────────────────── */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border-primary">
                    <div className="flex items-center gap-3">
                        <FolderOpen size={20} className="text-accent-primary" />
                        <h2 className="text-lg font-semibold text-text-primary">Ассеты проекта</h2>
                        {assets && (
                            <span className="text-xs text-text-tertiary bg-bg-tertiary px-2 py-0.5 rounded-full">
                                {assets.length}
                            </span>
                        )}
                    </div>
                    <button onClick={onClose} className="p-2 text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors cursor-pointer">
                        <X size={18} />
                    </button>
                </div>

                {/* ── Toolbar ─────────────────────────────────────────── */}
                <div className="flex items-center gap-3 px-6 py-3 border-b border-border-primary">
                    {/* Search */}
                    <div className="relative flex-1">
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Поиск ассетов..."
                            icon={<Search size={14} />}
                            className="h-9"
                        />
                    </div>

                    {/* Sort buttons */}
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => toggleSort("createdAt")}
                            className={`flex items-center gap-1 px-3 h-9 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                                sortBy === "createdAt" ? "bg-accent-primary/10 text-accent-primary border-accent-primary/30" : "bg-bg-secondary text-text-secondary border-border-primary hover:bg-bg-tertiary"
                            }`}
                        >
                            Дата {sortBy === "createdAt" && <SortIcon size={12} />}
                        </button>
                        <button
                            onClick={() => toggleSort("filename")}
                            className={`flex items-center gap-1 px-3 h-9 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                                sortBy === "filename" ? "bg-accent-primary/10 text-accent-primary border-accent-primary/30" : "bg-bg-secondary text-text-secondary border-border-primary hover:bg-bg-tertiary"
                            }`}
                        >
                            Имя {sortBy === "filename" && <SortIcon size={12} />}
                        </button>
                        <button
                            onClick={() => toggleSort("sizeBytes")}
                            className={`flex items-center gap-1 px-3 h-9 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                                sortBy === "sizeBytes" ? "bg-accent-primary/10 text-accent-primary border-accent-primary/30" : "bg-bg-secondary text-text-secondary border-border-primary hover:bg-bg-tertiary"
                            }`}
                        >
                            Размер {sortBy === "sizeBytes" && <SortIcon size={12} />}
                        </button>
                    </div>

                    {/* Select all */}
                    <button
                        onClick={selectAll}
                        className="flex items-center gap-1.5 px-3 h-9 text-xs font-medium rounded-lg border bg-bg-secondary text-text-secondary border-border-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
                    >
                        {assets && selectedIds.size === assets.length && assets.length > 0
                            ? <CheckSquare size={14} />
                            : <Square size={14} />
                        }
                        Все
                    </button>
                </div>

                {/* ── Grid ────────────────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto p-6">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 size={24} className="animate-spin text-text-tertiary" />
                        </div>
                    ) : !assets || assets.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3">
                            <ImageIcon size={48} className="text-text-tertiary/40" />
                            <p className="text-sm text-text-tertiary">
                                {search ? "Ничего не найдено" : "В проекте пока нет ассетов"}
                            </p>
                            <p className="text-xs text-text-tertiary/60">
                                Сгенерируйте или загрузите изображения — они появятся здесь
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-4 gap-3">
                            {assets.map((asset) => {
                                const isSelected = selectedIds.has(asset.id);
                                return (
                                    <button
                                        key={asset.id}
                                        onClick={() => toggleSelect(asset.id)}
                                        className={`group relative aspect-square rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${
                                            isSelected
                                                ? "border-accent-primary ring-2 ring-accent-primary/20"
                                                : "border-transparent hover:border-border-primary"
                                        }`}
                                    >
                                        {/* Image */}
                                        <img
                                            src={asset.url}
                                            alt={asset.filename}
                                            className="w-full h-full object-cover bg-bg-tertiary"
                                            loading="lazy"
                                        />

                                        {/* Selection overlay */}
                                        <div className={`absolute inset-0 transition-opacity ${isSelected ? "bg-accent-primary/10" : "bg-black/0 group-hover:bg-black/10"}`} />

                                        {/* Checkbox */}
                                        <div className={`absolute top-2 left-2 transition-opacity ${isSelected || "opacity-0 group-hover:opacity-100"}`}>
                                            {isSelected
                                                ? <CheckSquare size={18} className="text-accent-primary drop-shadow-md" />
                                                : <Square size={18} className="text-white drop-shadow-md" />
                                            }
                                        </div>

                                        {/* Info overlay */}
                                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 py-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <p className="text-[10px] text-white/90 truncate">{asset.filename}</p>
                                            <p className="text-[9px] text-white/60">
                                                {formatSize(asset.sizeBytes)} · {formatDate(asset.createdAt)}
                                            </p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* ── Footer / Actions ────────────────────────────────── */}
                {selectedIds.size > 0 && (
                    <div className="flex items-center justify-between px-6 py-3 border-t border-border-primary bg-bg-secondary/50">
                        <span className="text-xs text-text-secondary">
                            Выбрано: <span className="font-semibold text-text-primary">{selectedIds.size}</span>
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleAddToCanvas}
                                className="flex items-center gap-1.5 px-4 h-9 text-xs font-medium rounded-lg bg-accent-primary text-text-inverse hover:opacity-90 transition-opacity cursor-pointer"
                            >
                                <Plus size={14} /> На холст
                            </button>
                            <button
                                onClick={handleExport}
                                className="flex items-center gap-1.5 px-4 h-9 text-xs font-medium rounded-lg bg-bg-primary text-text-primary border border-border-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
                            >
                                <Download size={14} /> Экспорт
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={deleteMutation.isPending}
                                className="flex items-center gap-1.5 px-4 h-9 text-xs font-medium rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors cursor-pointer disabled:opacity-50"
                            >
                                <Trash2 size={14} /> Удалить
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
