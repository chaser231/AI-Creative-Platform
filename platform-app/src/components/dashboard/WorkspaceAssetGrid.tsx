"use client";

import { useState } from "react";
import { Loader2, Download, Trash2, LayoutGrid, Image as ImageIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useCreateBannerFromAsset } from "@/hooks/useCreateBannerFromAsset";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface WorkspaceAssetGridProps {
    workspaceId: string | null;
}

type Filter = "all" | "photo-generation" | "upload";

export function WorkspaceAssetGrid({ workspaceId }: WorkspaceAssetGridProps) {
    const [filter, setFilter] = useState<Filter>("all");
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; filename: string } | null>(null);
    const { createAndOpen, isCreating } = useCreateBannerFromAsset();

    const assetsQuery = trpc.asset.listByWorkspace.useQuery(
        {
            workspaceId: workspaceId ?? "",
            type: "IMAGE",
            source: filter === "all" ? undefined : filter,
            limit: 200,
        },
        { enabled: !!workspaceId, refetchOnWindowFocus: false }
    );

    const utils = trpc.useUtils();
    const deleteMutation = trpc.asset.delete.useMutation({
        onSuccess: () => {
            if (workspaceId) utils.asset.listByWorkspace.invalidate({ workspaceId });
        },
    });

    const assets = (assetsQuery.data ?? []) as Array<{ id: string; url: string; filename: string }>;

    const handleDownload = async (asset: { url: string; filename: string }) => {
        try {
            const res = await fetch(asset.url);
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = asset.filename || "asset.png";
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(blobUrl);
        } catch {
            window.open(asset.url, "_blank");
        }
    };

    return (
        <div>
            {/* Filter pills */}
            <div className="flex items-center gap-2 mb-5">
                <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
                    Все
                </FilterPill>
                <FilterPill
                    active={filter === "photo-generation"}
                    onClick={() => setFilter("photo-generation")}
                >
                    AI-генерация
                </FilterPill>
                <FilterPill active={filter === "upload"} onClick={() => setFilter("upload")}>
                    Загруженные
                </FilterPill>
            </div>

            {assetsQuery.isLoading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 size={24} className="animate-spin text-text-tertiary" />
                </div>
            ) : assets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-text-tertiary">
                    <ImageIcon size={32} className="mb-3 opacity-40" />
                    <p className="text-sm">Ассетов пока нет</p>
                    <p className="text-xs text-text-tertiary mt-1">
                        Сгенерируйте фото в проекте или загрузите собственные изображения
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {assets.map((asset) => (
                        <div
                            key={asset.id}
                            className="group relative rounded-[var(--radius-lg)] overflow-hidden border border-border-primary bg-bg-surface aspect-square"
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={asset.url}
                                alt={asset.filename}
                                className="w-full h-full object-cover"
                                draggable={false}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2 flex flex-col justify-end">
                                <div className="flex items-center justify-between gap-1">
                                    <div className="flex items-center gap-1">
                                        <AssetAction
                                            icon={<Download size={12} />}
                                            label="Скачать"
                                            onClick={() => handleDownload(asset)}
                                        />
                                        <AssetAction
                                            icon={isCreating ? <Loader2 size={12} className="animate-spin" /> : <LayoutGrid size={12} />}
                                            label="В баннер"
                                            disabled={isCreating}
                                            onClick={async () => {
                                                try {
                                                    await createAndOpen({ assetId: asset.id });
                                                } catch (e) {
                                                    console.error("Не удалось создать баннер из ассета:", e);
                                                }
                                            }}
                                        />
                                    </div>
                                    <AssetAction
                                        icon={<Trash2 size={12} />}
                                        label="Удалить"
                                        danger
                                        onClick={() => setDeleteTarget({ id: asset.id, filename: asset.filename })}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <ConfirmDialog
                open={!!deleteTarget}
                title="Удалить ассет?"
                description={deleteTarget ? (
                    <>«<span className="text-text-secondary">{deleteTarget.filename}</span>» будет удалён безвозвратно</>
                ) : undefined}
                busy={deleteMutation.isPending}
                onConfirm={() => {
                    if (!deleteTarget) return;
                    deleteMutation.mutate(
                        { id: deleteTarget.id },
                        { onSettled: () => setDeleteTarget(null) }
                    );
                }}
                onClose={() => setDeleteTarget(null)}
            />
        </div>
    );
}

function FilterPill({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                active
                    ? "bg-accent-lime/20 text-accent-primary border border-accent-lime-hover/50"
                    : "text-text-tertiary hover:text-text-primary border border-border-primary bg-bg-surface"
            }`}
        >
            {children}
        </button>
    );
}

function AssetAction({
    icon,
    label,
    onClick,
    danger,
    disabled,
}: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
}) {
    return (
        <button
            title={label}
            onClick={onClick}
            disabled={disabled}
            className={`p-1.5 rounded-[var(--radius-sm)] text-white ${
                danger ? "bg-red-500/70 hover:bg-red-500" : "bg-white/15 hover:bg-white/30"
            } transition-colors cursor-pointer backdrop-blur-sm disabled:opacity-60 disabled:cursor-not-allowed`}
        >
            {icon}
        </button>
    );
}
