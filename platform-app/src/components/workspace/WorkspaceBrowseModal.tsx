"use client";

/**
 * WorkspaceBrowseModal
 *
 * Modal for discovering and joining workspaces.
 * Shows all VISIBLE workspaces with search, stats, and join/request buttons.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { Input } from "@/components/ui/Input";
import {
    X, Search, Users, FolderKanban, Check, Clock, Lock,
    ArrowRight, Globe, Loader2
} from "lucide-react";

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

interface BrowseWorkspace {
    id: string;
    name: string;
    slug: string;
    businessUnit: string;
    visibility: string;
    joinPolicy: string;
    logoUrl: string | null;
    memberCount: number;
    projectCount: number;
    isJoined: boolean;
    hasPendingRequest: boolean;
}

export function WorkspaceBrowseModal({ isOpen, onClose }: Props) {
    const [search, setSearch] = useState("");
    const { setWorkspaceId, refetch } = useWorkspace();

    const { data: workspaces, isLoading } = trpc.workspace.listAll.useQuery(undefined, {
        enabled: isOpen,
    });

    const joinMutation = trpc.workspace.join.useMutation({
        onSuccess: (result: { status: string }) => {
            if (result.status === "joined") {
                refetch();
            }
        },
    });

    const filtered = (workspaces ?? []).filter((ws: BrowseWorkspace) =>
        ws.name.toLowerCase().includes(search.toLowerCase()) ||
        ws.businessUnit.toLowerCase().includes(search.toLowerCase())
    );

    const handleJoin = async (wsId: string) => {
        const result = await joinMutation.mutateAsync({ workspaceId: wsId });
        if (result.status === "joined") {
            setWorkspaceId(wsId);
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

            {/* Modal */}
            <div className="relative w-full max-w-lg mx-4 bg-bg-surface border border-border-primary rounded-[var(--radius-2xl)] shadow-[var(--shadow-lg)] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border-primary">
                    <div>
                        <h2 className="text-base font-semibold text-text-primary">Обзор команд</h2>
                        <p className="text-xs text-text-tertiary mt-0.5">
                            Найдите и присоединитесь к команде
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-[var(--radius-md)] hover:bg-bg-secondary text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Search */}
                <div className="px-6 py-3 border-b border-border-primary">
                    <div className="relative">
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Поиск по названию или BU..."
                            icon={<Search size={14} />}
                            className="h-9"
                            autoFocus
                        />
                    </div>
                </div>

                {/* List */}
                <div className="max-h-[400px] overflow-y-auto p-3">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 size={20} className="animate-spin text-text-tertiary" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-12">
                            <Globe size={32} className="mx-auto text-text-tertiary/30 mb-3" />
                            <p className="text-sm text-text-tertiary">
                                {search ? "Ничего не найдено" : "Нет доступных команд"}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            {filtered.map((ws: BrowseWorkspace) => (
                                <div
                                    key={ws.id}
                                    className="flex items-center justify-between p-3 rounded-[var(--radius-xl)] hover:bg-bg-secondary/60 transition-colors group"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        {/* Avatar */}
                                        <div className="flex items-center justify-center w-9 h-9 rounded-[var(--radius-lg)] bg-gradient-to-br from-accent-primary/20 to-accent-primary/5 shrink-0">
                                            <span className="text-sm font-semibold text-accent-primary">
                                                {ws.name.charAt(0).toUpperCase()}
                                            </span>
                                        </div>

                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-medium text-text-primary truncate">
                                                    {ws.name}
                                                </p>
                                                {ws.visibility === "HIDDEN" && (
                                                    <Lock size={10} className="text-text-tertiary shrink-0" />
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 mt-0.5">
                                                <span className="text-[10px] text-text-tertiary">
                                                    {ws.businessUnit}
                                                </span>
                                                <span className="flex items-center gap-1 text-[10px] text-text-tertiary">
                                                    <Users size={9} /> {ws.memberCount}
                                                </span>
                                                <span className="flex items-center gap-1 text-[10px] text-text-tertiary">
                                                    <FolderKanban size={9} /> {ws.projectCount}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Action */}
                                    <div className="shrink-0 ml-3">
                                        {ws.isJoined ? (
                                            <span className="flex items-center gap-1 text-[10px] text-green-500 font-medium px-2.5 py-1.5 rounded-[var(--radius-lg)] bg-green-500/10">
                                                <Check size={10} /> Участник
                                            </span>
                                        ) : ws.hasPendingRequest ? (
                                            <span className="flex items-center gap-1 text-[10px] text-amber-500 font-medium px-2.5 py-1.5 rounded-[var(--radius-lg)] bg-amber-500/10">
                                                <Clock size={10} /> Заявка
                                            </span>
                                        ) : ws.joinPolicy === "INVITE_ONLY" ? (
                                            <span className="flex items-center gap-1 text-[10px] text-text-tertiary font-medium px-2.5 py-1.5 rounded-[var(--radius-lg)] bg-bg-tertiary">
                                                <Lock size={10} /> По приглашению
                                            </span>
                                        ) : (
                                            <button
                                                onClick={() => handleJoin(ws.id)}
                                                disabled={joinMutation.isPending}
                                                className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-[var(--radius-lg)] bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 transition-colors cursor-pointer disabled:opacity-50"
                                            >
                                                {joinMutation.isPending ? (
                                                    <Loader2 size={10} className="animate-spin" />
                                                ) : (
                                                    <>
                                                        {ws.joinPolicy === "REQUEST" ? "Запросить" : "Войти"}
                                                        <ArrowRight size={10} />
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
