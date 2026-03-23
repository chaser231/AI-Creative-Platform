"use client";

/**
 * /settings/workspace — Workspace Settings Page
 *
 * Allows workspace ADMINs to manage settings:
 * - Name, slug, BU
 * - Visibility, join policy
 * - Invite link
 * - Pending join requests
 * - Delete workspace
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import {
    Globe, Lock, Users, Check, X, Loader2, Copy,
    Trash2, ShieldAlert, ArrowRight, Clock,
} from "lucide-react";

const BU_OPTIONS = [
    { value: "yandex-market", label: "Яндекс Маркет" },
    { value: "yandex-go", label: "Яндекс Go" },
    { value: "yandex-food", label: "Яндекс Еда" },
    { value: "yandex-lavka", label: "Яндекс Лавка" },
    { value: "yandex-travel", label: "Яндекс Путешествия" },
    { value: "other", label: "Другое" },
];

export default function WorkspaceSettingsPage() {
    const router = useRouter();
    const { currentWorkspace, refetch, isAdmin } = useWorkspace();
    const utils = trpc.useUtils();

    // Form state
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [businessUnit, setBusinessUnit] = useState("other");
    const [visibility, setVisibility] = useState<"VISIBLE" | "HIDDEN">("VISIBLE");
    const [joinPolicy, setJoinPolicy] = useState<"OPEN" | "REQUEST" | "INVITE_ONLY">("OPEN");
    const [copied, setCopied] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [deleteInput, setDeleteInput] = useState("");

    // Load current values
    useEffect(() => {
        if (currentWorkspace) {
            setName(currentWorkspace.name);
            setSlug((currentWorkspace as any).slug || "");
            setBusinessUnit((currentWorkspace as any).businessUnit || "other");
            setVisibility((currentWorkspace as any).visibility || "VISIBLE");
            setJoinPolicy((currentWorkspace as any).joinPolicy || "OPEN");
        }
    }, [currentWorkspace]);

    // Mutations
    const updateMutation = trpc.workspace.update.useMutation({
        onSuccess: () => {
            refetch();
            utils.workspace.list.invalidate();
        },
    });

    const deleteMutation = trpc.workspace.delete.useMutation({
        onSuccess: () => {
            refetch();
            router.push("/");
        },
    });

    // Join requests
    const joinRequestsQuery = trpc.workspace.listJoinRequests.useQuery(
        { workspaceId: currentWorkspace?.id ?? "" },
        { enabled: !!currentWorkspace?.id && isAdmin }
    );
    const handleRequestMutation = trpc.workspace.handleJoinRequest.useMutation({
        onSuccess: () => {
            joinRequestsQuery.refetch();
            utils.workspace.listMembers.invalidate();
        },
    });

    const joinRequests = joinRequestsQuery.data ?? [];

    const handleSave = () => {
        if (!currentWorkspace) return;
        updateMutation.mutate({
            workspaceId: currentWorkspace.id,
            name: name.trim(),
            slug: slug.trim(),
            businessUnit,
            visibility,
            joinPolicy,
        });
    };

    const handleCopyInvite = () => {
        if (!slug) return;
        const url = `${window.location.origin}/invite/${slug}`;
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDelete = () => {
        if (!currentWorkspace || deleteInput !== currentWorkspace.name) return;
        deleteMutation.mutate({ workspaceId: currentWorkspace.id });
    };

    if (!currentWorkspace) {
        return (
            <AppShell>
                <TopBar breadcrumbs={[{ label: "Настройки" }, { label: "Воркспейс" }]} showBackToProjects={false} showHistoryNavigation={true} />
                <div className="flex-1 flex items-center justify-center">
                    <Loader2 size={20} className="animate-spin text-text-tertiary" />
                </div>
            </AppShell>
        );
    }

    if (!isAdmin) {
        return (
            <AppShell>
                <TopBar breadcrumbs={[{ label: "Настройки" }, { label: "Воркспейс" }]} showBackToProjects={false} showHistoryNavigation={true} />
                <div className="flex-1 flex flex-col items-center justify-center gap-3">
                    <ShieldAlert size={32} className="text-text-tertiary/30" />
                    <p className="text-sm text-text-tertiary">Настройки доступны только администраторам воркспейса</p>
                </div>
            </AppShell>
        );
    }

    return (
        <AppShell>
            <TopBar breadcrumbs={[{ label: "Настройки" }, { label: "Воркспейс" }]} showBackToProjects={false} showHistoryNavigation={true} />
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
                    {/* General */}
                    <section>
                        <h2 className="text-sm font-semibold text-text-primary mb-4">Основные</h2>
                        <div className="space-y-4 bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] p-5">
                            <div>
                                <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Название</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full h-10 px-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
                                />
                            </div>
                            <div>
                                <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">URL-идентификатор</label>
                                <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-text-tertiary shrink-0">/invite/</span>
                                    <input
                                        type="text"
                                        value={slug}
                                        onChange={(e) => setSlug(e.target.value.replace(/[^a-z0-9-]/g, ""))}
                                        className="flex-1 h-10 px-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-sm text-text-primary font-mono focus:outline-none focus:ring-1 focus:ring-border-focus"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Бизнес-юнит</label>
                                <select
                                    value={businessUnit}
                                    onChange={(e) => setBusinessUnit(e.target.value)}
                                    className="w-full h-10 px-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-sm text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-border-focus"
                                >
                                    {BU_OPTIONS.map((bu) => (
                                        <option key={bu.value} value={bu.value}>{bu.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </section>

                    {/* Access Control */}
                    <section>
                        <h2 className="text-sm font-semibold text-text-primary mb-4">Доступ</h2>
                        <div className="space-y-4 bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] p-5">
                            <div>
                                <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Видимость</label>
                                <div className="flex rounded-[var(--radius-lg)] border border-border-primary overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => setVisibility("VISIBLE")}
                                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
                                            visibility === "VISIBLE"
                                                ? "bg-accent-primary/10 text-accent-primary"
                                                : "text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary"
                                        }`}
                                    >
                                        <Globe size={12} /> Видима в обзоре
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setVisibility("HIDDEN")}
                                        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors cursor-pointer border-l border-border-primary ${
                                            visibility === "HIDDEN"
                                                ? "bg-accent-primary/10 text-accent-primary"
                                                : "text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary"
                                        }`}
                                    >
                                        <Lock size={12} /> Скрыта
                                    </button>
                                </div>
                                <p className="text-[10px] text-text-tertiary mt-1.5">
                                    {visibility === "VISIBLE" ? "Команда видна в обзоре команд всем пользователям" : "Команда доступна только по приглашению"}
                                </p>
                            </div>

                            <div>
                                <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Политика вступления</label>
                                <select
                                    value={joinPolicy}
                                    onChange={(e) => setJoinPolicy(e.target.value as any)}
                                    className="w-full h-10 px-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-sm text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-border-focus"
                                >
                                    <option value="OPEN">Свободное — все могут вступить</option>
                                    <option value="REQUEST">По заявке — требуется одобрение</option>
                                    <option value="INVITE_ONLY">Только по приглашению</option>
                                </select>
                            </div>

                            {/* Invite link */}
                            <div>
                                <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Ссылка-приглашение</label>
                                <div className="flex items-center gap-2">
                                    <code className="flex-1 h-10 flex items-center px-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-xs text-text-secondary font-mono truncate">
                                        {typeof window !== "undefined" ? `${window.location.origin}/invite/${slug}` : `/invite/${slug}`}
                                    </code>
                                    <button
                                        onClick={handleCopyInvite}
                                        className="h-10 px-3 flex items-center gap-1.5 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer shrink-0"
                                    >
                                        {copied ? <><Check size={12} className="text-green-500" /> Скопировано</> : <><Copy size={12} /> Копировать</>}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Pending Join Requests */}
                    {joinRequests.length > 0 && (
                        <section>
                            <h2 className="text-sm font-semibold text-text-primary mb-4">
                                Заявки на вступление
                                <span className="ml-2 text-[10px] font-normal text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded-full">
                                    {joinRequests.length}
                                </span>
                            </h2>
                            <div className="bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] overflow-hidden divide-y divide-border-primary">
                                {joinRequests.map((req: any) => (
                                    <div key={req.id} className="flex items-center justify-between px-5 py-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-8 h-8 rounded-full bg-bg-tertiary flex items-center justify-center shrink-0">
                                                <Users size={14} className="text-text-tertiary" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-text-primary truncate">{req.user.name}</p>
                                                <p className="text-[10px] text-text-tertiary truncate">{req.user.email}</p>
                                                {req.message && (
                                                    <p className="text-[10px] text-text-secondary mt-0.5 italic">«{req.message}»</p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <button
                                                onClick={() => handleRequestMutation.mutate({ requestId: req.id, action: "approve" })}
                                                disabled={handleRequestMutation.isPending}
                                                className="p-1.5 rounded-[var(--radius-md)] bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors cursor-pointer"
                                                title="Одобрить"
                                            >
                                                <Check size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleRequestMutation.mutate({ requestId: req.id, action: "reject" })}
                                                disabled={handleRequestMutation.isPending}
                                                className="p-1.5 rounded-[var(--radius-md)] bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors cursor-pointer"
                                                title="Отклонить"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Save */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleSave}
                            disabled={updateMutation.isPending}
                            className="h-10 px-6 flex items-center gap-2 bg-accent-primary text-white rounded-[var(--radius-lg)] text-sm font-medium hover:bg-accent-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                            {updateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : "Сохранить"}
                        </button>
                        {updateMutation.isSuccess && (
                            <span className="text-xs text-green-500 flex items-center gap-1"><Check size={12} /> Сохранено</span>
                        )}
                        {updateMutation.error && (
                            <span className="text-xs text-red-400">{updateMutation.error.message}</span>
                        )}
                    </div>

                    {/* Danger zone */}
                    <section className="border border-red-500/20 rounded-[var(--radius-xl)] p-5">
                        <h2 className="text-sm font-semibold text-red-400 mb-2">Опасная зона</h2>
                        <p className="text-xs text-text-tertiary mb-4">
                            Удаление воркспейса необратимо. Все проекты, шаблоны и данные будут потеряны.
                        </p>
                        {!deleteConfirm ? (
                            <button
                                onClick={() => setDeleteConfirm(true)}
                                className="h-9 px-4 flex items-center gap-2 border border-red-500/30 text-red-400 rounded-[var(--radius-lg)] text-xs font-medium hover:bg-red-500/10 transition-colors cursor-pointer"
                            >
                                <Trash2 size={12} /> Удалить воркспейс
                            </button>
                        ) : (
                            <div className="space-y-3">
                                <p className="text-xs text-red-400">
                                    Введите «<strong>{currentWorkspace.name}</strong>» для подтверждения:
                                </p>
                                <input
                                    type="text"
                                    value={deleteInput}
                                    onChange={(e) => setDeleteInput(e.target.value)}
                                    placeholder={currentWorkspace.name}
                                    className="w-full h-10 px-3 rounded-[var(--radius-lg)] border border-red-500/30 bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-red-500/50"
                                />
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleDelete}
                                        disabled={deleteInput !== currentWorkspace.name || deleteMutation.isPending}
                                        className="h-9 px-4 flex items-center gap-2 bg-red-500 text-white rounded-[var(--radius-lg)] text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-50 cursor-pointer"
                                    >
                                        {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <><Trash2 size={12} /> Удалить навсегда</>}
                                    </button>
                                    <button
                                        onClick={() => { setDeleteConfirm(false); setDeleteInput(""); }}
                                        className="h-9 px-4 text-xs text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                                    >
                                        Отмена
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </AppShell>
    );
}
