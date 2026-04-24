"use client";

import { useMemo, useState } from "react";
import { X, Download, Wand2, Trash2, LayoutGrid, Library, Loader2, Image as ImageRefIcon, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePhotoStore } from "@/store/photoStore";
import { useCreateBannerFromAsset } from "@/hooks/useCreateBannerFromAsset";
import { useProjectLibrary } from "@/hooks/useProjectLibrary";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { AIScenariosModal } from "@/components/workflows/AIScenariosModal";
import type { WorkflowScenarioRunResult } from "@/hooks/workflow/useWorkflowScenarioRun";

interface PhotoLibraryPanelProps {
    projectId: string;
}

type Scope = "project" | "workspace";
type Filter = "all" | "photo-generation";

export function PhotoLibraryPanel({ projectId }: PhotoLibraryPanelProps) {
    const setLibraryOpen = usePhotoStore((s) => s.setLibraryOpen);
    const setEditContext = usePhotoStore((s) => s.setEditContext);
    const pushReference = usePhotoStore((s) => s.pushReference);
    const [scope, setScope] = useState<Scope>("project");
    const [filter, setFilter] = useState<Filter>("all");
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; filename: string } | null>(null);
    const [scenarioTarget, setScenarioTarget] = useState<AssetRow | null>(null);
    const { createAndOpen } = useCreateBannerFromAsset();
    const { registerUrl } = useProjectLibrary();

    const projectQuery = trpc.project.getById.useQuery(
        { id: projectId },
        { refetchOnWindowFocus: false }
    );
    const workspaceId = (projectQuery.data as { workspaceId?: string } | undefined)?.workspaceId ?? "";

    const projectAssetsQuery = trpc.asset.listByProject.useQuery(
        { projectId },
        { enabled: scope === "project", refetchOnWindowFocus: false }
    );
    const workspaceAssetsQuery = trpc.asset.listByWorkspace.useQuery(
        {
            workspaceId,
            type: "IMAGE",
            source: filter === "photo-generation" ? "photo-generation" : undefined,
        },
        { enabled: scope === "workspace" && !!workspaceId, refetchOnWindowFocus: false }
    );

    const utils = trpc.useUtils();
    const deleteMutation = trpc.asset.delete.useMutation({
        onSuccess: () => {
            utils.asset.listByProject.invalidate({ projectId });
            if (workspaceId) utils.asset.listByWorkspace.invalidate({ workspaceId });
        },
    });

    type AssetRow = { id: string; url: string; filename: string; metadata: unknown };

    const assets = useMemo(() => {
        const rawAssets = (scope === "project"
            ? projectAssetsQuery.data ?? []
            : workspaceAssetsQuery.data ?? []) as AssetRow[];
        if (scope === "project" && filter === "photo-generation") {
            return rawAssets.filter((a) => {
                const source = (a.metadata as { source?: string } | null)?.source;
                return source === "photo-generation";
            });
        }
        return rawAssets;
    }, [scope, filter, projectAssetsQuery.data, workspaceAssetsQuery.data]);

    const isLoading = scope === "project" ? projectAssetsQuery.isLoading : workspaceAssetsQuery.isLoading;

    const handleScenarioResult = async (result: WorkflowScenarioRunResult) => {
        if (!result.imageUrl) return;
        if (result.scenarioConfig.output.behavior === "open-banner") {
            await createAndOpen({
                assetId: result.savedAssetId ?? result.assetId,
                imageUrl: result.savedAssetId || result.assetId ? undefined : result.imageUrl,
                name: result.scenarioConfig.title,
            });
            return;
        }
        await registerUrl({
            projectId,
            url: result.imageUrl,
            source: "workflow-scenario",
        });
    };

    return (
        <div className="flex-1 flex flex-col min-h-0">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary">
                <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                    <Library size={14} /> Библиотека
                </div>
                <button
                    onClick={() => setLibraryOpen(false)}
                    className="p-1 rounded hover:bg-bg-tertiary text-text-tertiary hover:text-text-primary"
                >
                    <X size={14} />
                </button>
            </div>

            {/* Scope tabs */}
            <div className="px-3 pt-2 pb-1 flex items-center gap-1">
                <TabButton active={scope === "project"} onClick={() => setScope("project")}>
                    Этот проект
                </TabButton>
                <TabButton active={scope === "workspace"} onClick={() => setScope("workspace")}>
                    Вся команда
                </TabButton>
            </div>

            {/* Source filter */}
            <div className="px-3 pb-2 flex items-center gap-1">
                <PillButton active={filter === "all"} onClick={() => setFilter("all")}>
                    Все
                </PillButton>
                <PillButton
                    active={filter === "photo-generation"}
                    onClick={() => setFilter("photo-generation")}
                >
                    AI-генерация
                </PillButton>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-y-auto px-3 pb-3">
                {isLoading ? (
                    <div className="flex items-center justify-center py-10">
                        <Loader2 size={16} className="animate-spin text-text-tertiary" />
                    </div>
                ) : assets.length === 0 ? (
                    <div className="text-center py-10 text-[11px] text-text-tertiary">
                        Пусто. Сгенерируйте изображения — они появятся здесь.
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        {assets.map((a) => (
                            <AssetTile
                                key={a.id}
                                asset={a}
                                onEdit={(url) => setEditContext({ assetId: a.id, url })}
                                onReference={(url) => pushReference(url)}
                                onScenarios={() => setScenarioTarget(a)}
                                onDelete={(id) => {
                                    const target = assets.find((x) => x.id === id);
                                    setDeleteTarget({ id, filename: target?.filename ?? "ассет" });
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

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

            <AIScenariosModal
                open={!!scenarioTarget}
                onClose={() => setScenarioTarget(null)}
                workspaceId={workspaceId}
                projectId={projectId}
                surface="asset"
                input={
                    scenarioTarget
                        ? {
                              kind: "image",
                              imageUrl: scenarioTarget.url,
                              assetId: scenarioTarget.id,
                          }
                        : undefined
                }
                onResult={handleScenarioResult}
            />
        </div>
    );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            className={`flex-1 px-2.5 py-1.5 rounded-[var(--radius-md)] text-[11px] font-medium transition-colors cursor-pointer ${
                active
                    ? "bg-bg-tertiary text-text-primary"
                    : "text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary/50"
            }`}
        >
            {children}
        </button>
    );
}

function PillButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors cursor-pointer ${
                active
                    ? "bg-accent-lime/20 text-accent-primary border border-accent-lime-hover/50"
                    : "text-text-tertiary hover:text-text-primary border border-border-primary"
            }`}
        >
            {children}
        </button>
    );
}

function AssetTile({
    asset,
    onEdit,
    onReference,
    onScenarios,
    onDelete,
}: {
    asset: { id: string; url: string; filename: string };
    onEdit: (url: string) => void;
    onReference: (url: string) => void;
    onScenarios: () => void;
    onDelete: (id: string) => void;
}) {
    const handleDownload = async () => {
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

    const { createAndOpen, isCreating } = useCreateBannerFromAsset();
    const handleUseInBanner = async () => {
        try {
            await createAndOpen({ assetId: asset.id });
        } catch (e) {
            console.error("Не удалось создать баннер из ассета:", e);
        }
    };

    return (
        <div className="relative group rounded-[var(--radius-md)] overflow-hidden border border-border-primary bg-bg-tertiary aspect-square">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={asset.url}
                alt={asset.filename}
                className="w-full h-full object-cover"
                draggable={false}
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 flex flex-col justify-between">
                <div className="flex items-center gap-1 flex-wrap">
                    <TileAction
                        icon={<Wand2 size={10} />}
                        title="Редактировать"
                        onClick={() => onEdit(asset.url)}
                    />
                    <TileAction
                        icon={<ImageRefIcon size={10} />}
                        title="Как референс"
                        onClick={() => onReference(asset.url)}
                    />
                    <TileAction
                        icon={<Sparkles size={10} />}
                        title="AI сценарии"
                        onClick={onScenarios}
                    />
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                        <TileAction icon={<Download size={10} />} title="Скачать" onClick={handleDownload} />
                        <TileAction
                            icon={isCreating ? <Loader2 size={10} className="animate-spin" /> : <LayoutGrid size={10} />}
                            title="В баннер"
                            onClick={handleUseInBanner}
                            disabled={isCreating}
                        />
                    </div>
                    <TileAction
                        icon={<Trash2 size={10} />}
                        title="Удалить"
                        danger
                        onClick={() => onDelete(asset.id)}
                    />
                </div>
            </div>
        </div>
    );
}

function TileAction({
    icon,
    onClick,
    danger,
    title,
    disabled,
}: {
    icon: React.ReactNode;
    onClick: () => void;
    danger?: boolean;
    title?: string;
    disabled?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            title={title}
            disabled={disabled}
            className={`p-1.5 rounded-[var(--radius-sm)] text-white ${danger ? "bg-red-500/70 hover:bg-red-500" : "bg-white/15 hover:bg-white/30"} transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed`}
        >
            {icon}
        </button>
    );
}
