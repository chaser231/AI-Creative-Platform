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
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Input } from "@/components/ui/Input";
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
    const [editCategories, setEditCategories] = useState<string[]>([]);
    const [editContentType, setEditContentType] = useState("visual");

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

    // Delete confirm
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // All available category+BU values
    const CATEGORY_OPTIONS = [
        { value: "yandex-market", label: "Маркет" },
        { value: "yandex-food", label: "Еда" },
        { value: "yandex-go", label: "Go" },
        { value: "yandex-lavka", label: "Лавка" },
        { value: "in-app", label: "In-App" },
        { value: "performance", label: "Перформанс" },
        { value: "smm", label: "SMM" },
        { value: "digital", label: "Диджитал" },
        { value: "showcase", label: "Витрины" },
        { value: "email", label: "Email" },
        { value: "e-commerce", label: "E-commerce" },
        { value: "other", label: "Другое" },
    ];

    const CONTENT_TYPE_OPTIONS = [
        { value: "visual", label: "Визуальный" },
        { value: "video", label: "Видео" },
        { value: "generative", label: "Генеративный" },
        { value: "mixed", label: "Смешанный" },
    ];

    const openEditModal = (template: { id: string; name: string; description: string | null; isOfficial: boolean; categories: string[] }) => {
        setEditingTemplate(template);
        setEditName(template.name);
        setEditDesc(template.description || "");
        setEditOfficial(template.isOfficial);
        setEditCategories(template.categories || []);
    };

    const handleSaveEdit = async () => {
        if (!editingTemplate) return;
        await updateMutation.mutateAsync({
            id: editingTemplate.id,
            name: editName,
            description: editDesc,
            isOfficial: editOfficial,
            categories: editCategories,
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
                        <div className="flex-1">
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Поиск по названию..."
                                icon={<Search size={14} />}
                                className="h-9 text-xs"
                            />
                        </div>

                        {/* Workspace filter */}
                        <Select
                            size="sm"
                            value={wsFilter ?? "__all__"}
                            onChange={(val) => setWsFilter(val === "__all__" ? null : val)}
                            options={[
                                { value: "__all__", label: "Все воркспейсы" },
                                ...(workspaces?.map((ws) => ({ value: ws.id, label: ws.name })) ?? []),
                            ]}
                        />

                        {/* Official filter */}
                        <Select
                            size="sm"
                            value={officialFilter === undefined ? "__all__" : officialFilter ? "true" : "false"}
                            onChange={(val) => {
                                setOfficialFilter(val === "__all__" ? undefined : val === "true");
                            }}
                            options={[
                                { value: "__all__", label: "Все" },
                                { value: "true", label: "⭐ Official" },
                                { value: "false", label: "Пользовательские" },
                            ]}
                        />
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
                        <Textarea
                            value={editDesc}
                            onChange={(e) => setEditDesc(e.target.value)}
                            rows={3}
                        />
                    </div>

                    {/* Categories / BU chips */}
                    <div>
                        <label className="text-xs font-medium text-text-secondary mb-1.5 block">Категории / Сервис</label>
                        <div className="flex flex-wrap gap-1.5">
                            {CATEGORY_OPTIONS.map(opt => {
                                const active = editCategories.includes(opt.value);
                                return (
                                    <button
                                        key={opt.value}
                                        onClick={() => setEditCategories(prev =>
                                            active ? prev.filter(c => c !== opt.value) : [...prev, opt.value]
                                        )}
                                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer border ${active
                                            ? "bg-accent-primary text-text-inverse border-accent-primary"
                                            : "bg-bg-secondary text-text-secondary border-border-primary hover:border-accent-primary/30"
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                );
                            })}
                        </div>
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
