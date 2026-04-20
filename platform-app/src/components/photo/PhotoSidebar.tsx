"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Pencil, Trash2, MessageCircle, Home, Library, ArrowLeft, Loader2, MoreHorizontal } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePhotoStore } from "@/store/photoStore";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface PhotoSidebarProps {
    projectId: string;
    projectName: string;
}

export function PhotoSidebar({ projectId, projectName }: PhotoSidebarProps) {
    const activeSessionId = usePhotoStore((s) => s.activeSessionId);
    const setActiveSession = usePhotoStore((s) => s.setActiveSession);
    const libraryOpen = usePhotoStore((s) => s.libraryOpen);
    const setLibraryOpen = usePhotoStore((s) => s.setLibraryOpen);
    const clearEditContext = usePhotoStore((s) => s.clearEditContext);

    const sessionsQuery = trpc.ai.listSessions.useQuery(
        { projectId },
        { refetchOnWindowFocus: false }
    );
    const utils = trpc.useUtils();
    const createSessionMutation = trpc.ai.createSession.useMutation({
        onSuccess: (s) => {
            setActiveSession(s.id);
            clearEditContext();
            utils.ai.listSessions.invalidate({ projectId });
        },
    });
    const renameSessionMutation = trpc.ai.renameSession.useMutation({
        onSuccess: () => utils.ai.listSessions.invalidate({ projectId }),
    });
    const deleteSessionMutation = trpc.ai.deleteSession.useMutation({
        onSuccess: () => utils.ai.listSessions.invalidate({ projectId }),
    });

    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

    const sessions = (sessionsQuery.data ?? []) as Array<{
        id: string;
        name: string | null;
        updatedAt: Date | string;
        _count: { messages: number };
    }>;

    const handleCreate = () => {
        createSessionMutation.mutate({ projectId });
    };

    const handleSelect = (sessionId: string) => {
        setActiveSession(sessionId);
        clearEditContext();
    };

    const handleRenameStart = (id: string, current: string | null) => {
        setRenamingId(id);
        setRenameValue(current ?? "");
        setOpenMenuId(null);
    };

    const handleRenameCommit = (id: string) => {
        const trimmed = renameValue.trim();
        if (trimmed) {
            renameSessionMutation.mutate({ id, name: trimmed });
        }
        setRenamingId(null);
    };

    const handleDelete = (id: string) => {
        setDeleteTargetId(id);
        setOpenMenuId(null);
    };

    const confirmDelete = () => {
        if (!deleteTargetId) return;
        const id = deleteTargetId;
        deleteSessionMutation.mutate(
            { id },
            {
                onSettled: () => setDeleteTargetId(null),
            }
        );
        if (id === activeSessionId) {
            setActiveSession(null);
        }
    };

    const formatSessionLabel = (s: { name: string | null; updatedAt: Date | string; _count: { messages: number } }, index: number) => {
        if (s.name) return s.name;
        if (s._count.messages === 0) return "Новая сессия";
        return `Сессия ${sessions.length - index}`;
    };

    return (
        <aside className="w-[260px] shrink-0 border-r border-border-primary bg-bg-surface flex flex-col min-h-0">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border-primary">
                <Link
                    href="/"
                    className="flex items-center gap-1.5 text-[11px] text-text-tertiary hover:text-text-primary transition-colors mb-2"
                >
                    <ArrowLeft size={11} /> К проектам
                </Link>
                <div className="text-sm font-semibold text-text-primary truncate" title={projectName}>
                    {projectName}
                </div>
                <div className="text-[11px] text-text-tertiary mt-0.5">Фото-проект</div>
            </div>

            {/* New session */}
            <div className="px-3 pt-3 pb-2">
                <button
                    onClick={handleCreate}
                    disabled={createSessionMutation.isPending}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] text-[12px] font-medium bg-accent-lime-hover text-accent-lime-text hover:bg-accent-lime transition-colors cursor-pointer disabled:opacity-60"
                >
                    {createSessionMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    Новая сессия
                </button>
            </div>

            {/* Sessions list */}
            <div className="flex-1 overflow-y-auto px-2 pb-2">
                <div className="px-2 py-1 text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">
                    Сессии
                </div>
                {sessionsQuery.isLoading ? (
                    <div className="flex items-center justify-center py-6">
                        <Loader2 size={14} className="animate-spin text-text-tertiary" />
                    </div>
                ) : sessions.length === 0 ? (
                    <div className="px-3 py-4 text-[11px] text-text-tertiary text-center">
                        Нет сессий. Создайте первую.
                    </div>
                ) : (
                    sessions.map((s, index) => {
                        const isActive = s.id === activeSessionId;
                        const isRenaming = renamingId === s.id;
                        return (
                            <div
                                key={s.id}
                                className={`group relative flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-md)] cursor-pointer transition-colors ${
                                    isActive
                                        ? "bg-accent-lime/15 text-text-primary"
                                        : "hover:bg-bg-tertiary text-text-secondary"
                                }`}
                                onClick={() => !isRenaming && handleSelect(s.id)}
                            >
                                <MessageCircle size={12} className="shrink-0 text-text-tertiary" />
                                {isRenaming ? (
                                    <input
                                        autoFocus
                                        value={renameValue}
                                        onChange={(e) => setRenameValue(e.target.value)}
                                        onBlur={() => handleRenameCommit(s.id)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") handleRenameCommit(s.id);
                                            if (e.key === "Escape") setRenamingId(null);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        className="flex-1 min-w-0 bg-bg-tertiary text-[12px] text-text-primary px-1.5 py-0.5 rounded-[var(--radius-sm)] border border-border-focus outline-none"
                                    />
                                ) : (
                                    <span className="flex-1 min-w-0 text-[12px] truncate">
                                        {formatSessionLabel(s, index)}
                                    </span>
                                )}
                                {!isRenaming && (
                                    <>
                                        <span className="text-[10px] text-text-tertiary shrink-0">
                                            {s._count.messages}
                                        </span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setOpenMenuId(openMenuId === s.id ? null : s.id);
                                            }}
                                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-secondary"
                                        >
                                            <MoreHorizontal size={12} />
                                        </button>
                                    </>
                                )}

                                {openMenuId === s.id && (
                                    <div
                                        className="absolute right-0 top-full mt-1 z-50 w-36 bg-bg-surface border border-border-primary rounded-[var(--radius-md)] shadow-[var(--shadow-lg)] py-1"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <button
                                            onClick={() => handleRenameStart(s.id, s.name)}
                                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary cursor-pointer"
                                        >
                                            <Pencil size={11} /> Переименовать
                                        </button>
                                        <button
                                            onClick={() => handleDelete(s.id)}
                                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/10 cursor-pointer"
                                        >
                                            <Trash2 size={11} /> Удалить
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* Footer actions */}
            <div className="border-t border-border-primary px-2 py-2 space-y-0.5">
                <button
                    onClick={() => setLibraryOpen(!libraryOpen)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-md)] text-[12px] font-medium transition-colors cursor-pointer ${
                        libraryOpen
                            ? "bg-accent-lime/15 text-accent-primary"
                            : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
                    }`}
                >
                    <Library size={13} /> Библиотека
                </button>
                <Link
                    href="/"
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-md)] text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                >
                    <Home size={13} /> На главную
                </Link>
            </div>

            <ConfirmDialog
                open={!!deleteTargetId}
                title="Удалить сессию?"
                description="Все сообщения этой сессии будут удалены безвозвратно."
                busy={deleteSessionMutation.isPending}
                onConfirm={confirmDelete}
                onClose={() => setDeleteTargetId(null)}
            />
        </aside>
    );
}
