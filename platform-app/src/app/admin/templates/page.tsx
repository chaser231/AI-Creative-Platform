"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
    Search, Star, MoreHorizontal, Copy, Trash2, Pencil, ExternalLink,
    LayoutTemplate, X, Check, StarOff, ShieldX,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { trpc } from "@/lib/trpc";

/* ─── Main Page ──────────────────────────────────────── */

export default function AdminTemplatesPage() {
    const router = useRouter();
    const utils = trpc.useUtils();

    // Access guard
    const { data: me, isLoading: meLoading } = trpc.auth.me.useQuery(undefined, { refetchOnWindowFocus: false });
    const isSuperAdmin = me?.role === "SUPER_ADMIN";

    const [search, setSearch] = useState("");
    const [wsFilter, setWsFilter] = useState<string | null>(null);
    const [officialFilter, setOfficialFilter] = useState<boolean | undefined>(undefined);

    // Data — only query if admin
    const { data, isLoading } = trpc.adminTemplate.list.useQuery({
        search: search || undefined,
        workspaceId: wsFilter || undefined,
        isOfficial: officialFilter,
    }, { enabled: isSuperAdmin });
    const { data: workspaces } = trpc.admin.workspaces.useQuery(undefined, { enabled: isSuperAdmin });

    // Mutations
    const updateMutation = trpc.adminTemplate.update.useMutation({
        onSuccess: () => utils.adminTemplate.list.invalidate(),
    });
    const duplicateMutation = trpc.adminTemplate.duplicate.useMutation({
        onSuccess: () => utils.adminTemplate.list.invalidate(),
    });
    const deleteMutation = trpc.adminTemplate.delete.useMutation({
        onSuccess: () => utils.adminTemplate.list.invalidate(),
    });

    // Edit modal state
    const [editingTemplate, setEditingTemplate] = useState<any | null>(null);
    const [editName, setEditName] = useState("");
    const [editDesc, setEditDesc] = useState("");
    const [editOfficial, setEditOfficial] = useState(false);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

    // Delete confirm
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    const openEditModal = (template: any) => {
        setEditingTemplate(template);
        setEditName(template.name);
        setEditDesc(template.description || "");
        setEditOfficial(template.isOfficial);
    };

    const handleSaveEdit = async () => {
        if (!editingTemplate) return;
        await updateMutation.mutateAsync({
            id: editingTemplate.id,
            name: editName,
            description: editDesc,
            isOfficial: editOfficial,
        });
        setEditingTemplate(null);
    };

    const handleDuplicate = async (id: string) => {
        await duplicateMutation.mutateAsync({ id });
        setContextMenu(null);
    };

    const handleDelete = async (id: string) => {
        await deleteMutation.mutateAsync({ id });
        setDeleteConfirm(null);
        setContextMenu(null);
    };

    const handleToggleOfficial = async (id: string, current: boolean) => {
        await updateMutation.mutateAsync({ id, isOfficial: !current });
        setContextMenu(null);
    };

    const handleEditInCanvas = (templateId: string) => {
        router.push(`/editor/template-${templateId}?mode=template-edit`);
        setContextMenu(null);
    };

    if (meLoading) {
        return (
            <AppShell>
                <TopBar breadcrumbs={[{ label: "Админ-панель", href: "/admin" }, { label: "Шаблоны" }]} showBackToProjects={false} showHistoryNavigation={true} />
                <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm text-text-tertiary">Загрузка...</p>
                </div>
            </AppShell>
        );
    }

    if (!isSuperAdmin) {
        return (
            <AppShell>
                <TopBar breadcrumbs={[{ label: "Админ-панель", href: "/admin" }, { label: "Шаблоны" }]} showBackToProjects={false} showHistoryNavigation={true} />
                <div className="flex-1 flex flex-col items-center justify-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
                        <ShieldX size={32} className="text-red-400" />
                    </div>
                    <h2 className="text-lg font-semibold text-text-primary">Нет доступа</h2>
                    <p className="text-sm text-text-tertiary max-w-[300px] text-center">
                        Эта страница доступна только супер-администраторам платформы.
                    </p>
                    <Button onClick={() => router.push("/")}>На главную</Button>
                </div>
            </AppShell>
        );
    }

    return (
        <AppShell>
            <TopBar
                breadcrumbs={[
                    { label: "Админ-панель", href: "/admin" },
                    { label: "Шаблоны" },
                ]}
                showBackToProjects={false}
                showHistoryNavigation={true}
            />

            <div className="flex-1 overflow-y-auto">
                <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-semibold text-text-primary">Управление шаблонами</h1>
                            <p className="text-sm text-text-tertiary mt-1">
                                {data?.total ?? 0} шаблонов по всем воркспейсам
                            </p>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="flex items-center gap-3">
                        <div className="flex-1 relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Поиск по названию..."
                                className="w-full h-9 pl-9 pr-3 text-xs rounded-xl border border-border-primary bg-bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/20 transition-all"
                            />
                        </div>

                        {/* Workspace filter */}
                        <select
                            value={wsFilter ?? ""}
                            onChange={(e) => setWsFilter(e.target.value || null)}
                            className="h-9 px-3 text-xs rounded-xl border border-border-primary bg-bg-surface text-text-primary focus:outline-none cursor-pointer"
                        >
                            <option value="">Все воркспейсы</option>
                            {workspaces?.map((ws) => (
                                <option key={ws.id} value={ws.id}>{ws.name}</option>
                            ))}
                        </select>

                        {/* Official filter */}
                        <select
                            value={officialFilter === undefined ? "" : officialFilter ? "true" : "false"}
                            onChange={(e) => {
                                const v = e.target.value;
                                setOfficialFilter(v === "" ? undefined : v === "true");
                            }}
                            className="h-9 px-3 text-xs rounded-xl border border-border-primary bg-bg-surface text-text-primary focus:outline-none cursor-pointer"
                        >
                            <option value="">Все</option>
                            <option value="true">⭐ Official</option>
                            <option value="false">Пользовательские</option>
                        </select>
                    </div>

                    {/* Templates Table */}
                    <div className="bg-bg-surface border border-border-primary rounded-2xl overflow-hidden">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-border-primary bg-bg-secondary/50">
                                    <th className="text-left px-4 py-3 font-medium text-text-tertiary">Название</th>
                                    <th className="text-left px-4 py-3 font-medium text-text-tertiary">Воркспейс</th>
                                    <th className="text-left px-4 py-3 font-medium text-text-tertiary">Категории</th>
                                    <th className="text-center px-4 py-3 font-medium text-text-tertiary">Official</th>
                                    <th className="text-center px-4 py-3 font-medium text-text-tertiary">Популярность</th>
                                    <th className="text-right px-4 py-3 font-medium text-text-tertiary">Обновлён</th>
                                    <th className="w-10"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {isLoading ? (
                                    <tr><td colSpan={7} className="px-4 py-12 text-center text-text-tertiary">Загрузка...</td></tr>
                                ) : data?.templates.length === 0 ? (
                                    <tr><td colSpan={7} className="px-4 py-12 text-center text-text-tertiary">Шаблоны не найдены</td></tr>
                                ) : data?.templates.map((tmpl) => (
                                    <tr
                                        key={tmpl.id}
                                        className="border-b border-border-primary/50 hover:bg-bg-secondary/30 transition-colors group"
                                    >
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <LayoutTemplate size={14} className="text-text-tertiary shrink-0" />
                                                <div className="min-w-0">
                                                    <p className="font-medium text-text-primary truncate max-w-[200px]">{tmpl.name}</p>
                                                    {tmpl.description && (
                                                        <p className="text-[10px] text-text-tertiary truncate max-w-[200px] mt-0.5">{tmpl.description}</p>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="px-2 py-0.5 rounded-md bg-bg-secondary border border-border-primary text-[10px] text-text-secondary">
                                                {tmpl.workspace.name}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex gap-1 flex-wrap">
                                                {tmpl.categories.slice(0, 2).map((cat) => (
                                                    <span key={cat} className="px-1.5 py-0.5 rounded-md bg-bg-tertiary text-[9px] text-text-tertiary">
                                                        {cat}
                                                    </span>
                                                ))}
                                                {tmpl.categories.length > 2 && (
                                                    <span className="text-[9px] text-text-tertiary">+{tmpl.categories.length - 2}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {tmpl.isOfficial ? (
                                                <Star size={14} className="text-amber-500 fill-amber-500 mx-auto" />
                                            ) : (
                                                <span className="text-text-tertiary">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center text-text-secondary">{tmpl.popularity}</td>
                                        <td className="px-4 py-3 text-right text-text-tertiary">
                                            {new Date(tmpl.updatedAt).toLocaleDateString("ru-RU")}
                                        </td>
                                        <td className="px-2 py-3 relative">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setContextMenu(
                                                        contextMenu?.id === tmpl.id
                                                            ? null
                                                            : { id: tmpl.id, x: e.clientX, y: e.clientY }
                                                    );
                                                }}
                                                className="p-1.5 rounded-lg hover:bg-bg-secondary text-text-tertiary hover:text-text-primary transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                                            >
                                                <MoreHorizontal size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {data && (
                            <div className="px-4 py-2 text-[10px] text-text-tertiary border-t border-border-primary/50">
                                Показано {data.templates.length} из {data.total}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
                    <div
                        className="fixed z-50 w-48 bg-bg-surface border border-border-primary rounded-xl shadow-lg py-1 overflow-hidden"
                        style={{
                            left: Math.min(contextMenu.x, window.innerWidth - 200),
                            top: Math.min(contextMenu.y, window.innerHeight - 250),
                        }}
                    >
                        <button
                            onClick={() => {
                                const tmpl = data?.templates.find((t) => t.id === contextMenu.id);
                                if (tmpl) openEditModal(tmpl);
                                setContextMenu(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-secondary transition-colors cursor-pointer"
                        >
                            <Pencil size={12} /> Редактировать
                        </button>
                        <button
                            onClick={() => handleEditInCanvas(contextMenu.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-secondary transition-colors cursor-pointer"
                        >
                            <ExternalLink size={12} /> Открыть в Canvas
                        </button>
                        <button
                            onClick={() => handleDuplicate(contextMenu.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-secondary transition-colors cursor-pointer"
                        >
                            <Copy size={12} /> Дублировать
                        </button>
                        <button
                            onClick={() => {
                                const tmpl = data?.templates.find((t) => t.id === contextMenu.id);
                                if (tmpl) handleToggleOfficial(tmpl.id, tmpl.isOfficial);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-bg-secondary transition-colors cursor-pointer"
                        >
                            {data?.templates.find((t) => t.id === contextMenu.id)?.isOfficial
                                ? <><StarOff size={12} /> Снять Official</>
                                : <><Star size={12} /> Сделать Official</>
                            }
                        </button>
                        <div className="border-t border-border-primary my-1" />
                        <button
                            onClick={() => {
                                setDeleteConfirm(contextMenu.id);
                                setContextMenu(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                        >
                            <Trash2 size={12} /> Удалить
                        </button>
                    </div>
                </>
            )}

            {/* Edit Modal */}
            <Modal
                open={!!editingTemplate}
                onClose={() => setEditingTemplate(null)}
                title="Редактировать шаблон"
                maxWidth="max-w-md"
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setEditingTemplate(null)}>Отмена</Button>
                        <Button onClick={handleSaveEdit} disabled={updateMutation.isPending}>
                            {updateMutation.isPending ? "Сохранение..." : "Сохранить"}
                        </Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <div>
                        <label className="text-xs font-medium text-text-secondary mb-1 block">Название</label>
                        <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full h-9 px-3 text-sm rounded-xl border border-border-primary bg-bg-secondary text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/20 transition-all"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-text-secondary mb-1 block">Описание</label>
                        <textarea
                            value={editDesc}
                            onChange={(e) => setEditDesc(e.target.value)}
                            rows={3}
                            className="w-full px-3 py-2 text-sm rounded-xl border border-border-primary bg-bg-secondary text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/20 transition-all resize-none"
                        />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={editOfficial}
                            onChange={(e) => setEditOfficial(e.target.checked)}
                            className="rounded"
                        />
                        <span className="text-xs text-text-secondary">Official шаблон ⭐</span>
                    </label>
                </div>
            </Modal>

            {/* Delete Confirm Modal */}
            <Modal
                open={!!deleteConfirm}
                onClose={() => setDeleteConfirm(null)}
                title="Удалить шаблон?"
                maxWidth="max-w-sm"
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Отмена</Button>
                        <Button
                            onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
                            className="!bg-red-500 hover:!bg-red-600"
                            disabled={deleteMutation.isPending}
                        >
                            {deleteMutation.isPending ? "Удаление..." : "Удалить"}
                        </Button>
                    </>
                }
            >
                <p className="text-sm text-text-secondary">
                    Это действие нельзя отменить. Шаблон будет удалён из базы данных.
                </p>
            </Modal>
        </AppShell>
    );
}
