"use client";

/**
 * AssetPickerModal — workspace-scoped, single-select asset picker.
 *
 * Slim derivation of editor/AssetLibraryModal that drops canvas-coupled
 * features (project tab, "На холст", "Применить к выделению", export, delete).
 * Designed for workflows ImageInput node and any future caller that needs to
 * pick exactly one asset from the workspace library.
 *
 * Phase 3, Wave 1 — D-16 in 03-CONTEXT.md.
 */

import { useCallback, useMemo, useState } from "react";
import {
    Image as ImageIcon,
    Loader2,
    Search,
    SortAsc,
    SortDesc,
    X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/Input";

type SortBy = "createdAt" | "filename" | "sizeBytes";
type SortOrder = "asc" | "desc";

export interface AssetPickerSelection {
    id: string;
    url: string;
    filename: string;
}

export interface AssetPickerModalProps {
    open: boolean;
    onClose: () => void;
    onSelect: (assetId: string, asset: AssetPickerSelection) => void;
    workspaceId: string;
    /** Reserved for a future multi-select mode; v1.0 only supports single. */
    multiSelect?: false;
}

type AssetRow = {
    id: string;
    url: string;
    filename: string;
    sizeBytes: number;
    createdAt: Date;
};

export function AssetPickerModal({
    open,
    onClose,
    onSelect,
    workspaceId,
}: AssetPickerModalProps) {
    const [search, setSearch] = useState("");
    const [sortBy, setSortBy] = useState<SortBy>("createdAt");
    const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

    const assetsQuery = trpc.asset.listByWorkspace.useQuery(
        { workspaceId, type: "IMAGE", limit: 200 },
        { enabled: open && !!workspaceId },
    );

    // listByWorkspace returns the full set (no server-side search/sort);
    // filter + sort on the client to mirror the original modal's UX.
    const assets = useMemo<AssetRow[]>(() => {
        const raw = (assetsQuery.data ?? []) as AssetRow[];
        const q = search.trim().toLowerCase();
        let list = raw;
        if (q) list = list.filter((a) => a.filename.toLowerCase().includes(q));
        list = [...list].sort((a, b) => {
            let cmp = 0;
            if (sortBy === "filename") cmp = a.filename.localeCompare(b.filename);
            else if (sortBy === "sizeBytes") cmp = a.sizeBytes - b.sizeBytes;
            else cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            return sortOrder === "asc" ? cmp : -cmp;
        });
        return list;
    }, [assetsQuery.data, search, sortBy, sortOrder]);

    const toggleSort = useCallback(
        (field: SortBy) => {
            if (sortBy === field) {
                setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
            } else {
                setSortBy(field);
                setSortOrder("desc");
            }
        },
        [sortBy],
    );

    const handlePick = useCallback(
        (asset: AssetRow) => {
            onSelect(asset.id, {
                id: asset.id,
                url: asset.url,
                filename: asset.filename,
            });
            onClose();
        },
        [onSelect, onClose],
    );

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const formatDate = (date: Date) =>
        new Date(date).toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
        });

    if (!open) return null;

    const SortIcon = sortOrder === "desc" ? SortDesc : SortAsc;
    const isLoading = assetsQuery.isLoading;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="flex max-h-[85vh] w-[820px] max-w-[95vw] flex-col rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
                    <div className="flex items-center gap-3">
                        <ImageIcon size={18} className="text-blue-500" />
                        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                            Выберите изображение
                        </h2>
                        {assetsQuery.data && (
                            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                                {assets.length}
                            </span>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                        aria-label="Закрыть"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="flex items-center gap-3 border-b border-neutral-200 px-6 py-3 dark:border-neutral-800">
                    <div className="relative flex-1">
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Поиск ассетов..."
                            icon={<Search size={14} />}
                            className="h-9"
                        />
                    </div>
                    <div className="flex items-center gap-1">
                        <SortButton
                            active={sortBy === "createdAt"}
                            onClick={() => toggleSort("createdAt")}
                            label="Дата"
                            icon={sortBy === "createdAt" ? <SortIcon size={12} /> : null}
                        />
                        <SortButton
                            active={sortBy === "filename"}
                            onClick={() => toggleSort("filename")}
                            label="Имя"
                            icon={sortBy === "filename" ? <SortIcon size={12} /> : null}
                        />
                        <SortButton
                            active={sortBy === "sizeBytes"}
                            onClick={() => toggleSort("sizeBytes")}
                            label="Размер"
                            icon={sortBy === "sizeBytes" ? <SortIcon size={12} /> : null}
                        />
                    </div>
                </div>

                {/* Grid */}
                <div className="flex-1 overflow-y-auto p-6">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 size={24} className="animate-spin text-neutral-400" />
                        </div>
                    ) : assets.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-20">
                            <ImageIcon size={48} className="text-neutral-300 dark:text-neutral-700" />
                            <p className="text-sm text-neutral-500 dark:text-neutral-400">
                                {search ? "Ничего не найдено" : "В библиотеке пока нет изображений"}
                            </p>
                            <p className="text-xs text-neutral-400 dark:text-neutral-500">
                                Сгенерируйте или загрузите изображения — они появятся здесь
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-4 gap-3">
                            {assets.map((asset) => (
                                <button
                                    key={asset.id}
                                    type="button"
                                    onClick={() => handlePick(asset)}
                                    className="group relative aspect-square overflow-hidden rounded-xl border-2 border-transparent transition-all hover:border-blue-500"
                                >
                                    <img
                                        src={asset.url}
                                        alt={asset.filename}
                                        className="h-full w-full bg-neutral-100 object-cover dark:bg-neutral-800"
                                        loading="lazy"
                                    />
                                    <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 py-2 opacity-0 transition-opacity group-hover:opacity-100">
                                        <p className="truncate text-[10px] text-white/90">
                                            {asset.filename}
                                        </p>
                                        <p className="text-[9px] text-white/60">
                                            {formatSize(asset.sizeBytes)} · {formatDate(asset.createdAt)}
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function SortButton({
    active,
    onClick,
    label,
    icon,
}: {
    active: boolean;
    onClick: () => void;
    label: string;
    icon: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex h-9 items-center gap-1 rounded-lg border px-3 text-xs font-medium transition-colors ${
                active
                    ? "border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-400"
                    : "border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
            }`}
        >
            {label}
            {icon}
        </button>
    );
}
