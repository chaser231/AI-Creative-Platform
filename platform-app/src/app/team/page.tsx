"use client";

/**
 * /team — Team Members page
 *
 * Shows all members of the current workspace with roles.
 * Admins can change roles and remove members.
 */

import { useState } from "react";
import { Users, Crown, Paintbrush, Eye, UserIcon, Loader2, Trash2, ChevronDown, Link2, Check } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { trpc } from "@/lib/trpc";

interface RoleInfo {
    label: string;
    icon: React.ReactNode;
    color: string;
}

const ROLE_LABELS: Record<string, RoleInfo> = {
    ADMIN: { label: "Администратор", icon: <Crown size={14} />, color: "text-amber-400 bg-amber-500/10" },
    CREATOR: { label: "Создатель", icon: <Paintbrush size={14} />, color: "text-blue-400 bg-blue-500/10" },
    USER: { label: "Участник", icon: <UserIcon size={14} />, color: "text-green-400 bg-green-500/10" },
    VIEWER: { label: "Зритель", icon: <Eye size={14} />, color: "text-gray-400 bg-gray-500/10" },
};

const ROLES = ["ADMIN", "CREATOR", "USER", "VIEWER"] as const;

interface Member {
    id: string;
    role: string;
    user: {
        id: string;
        name: string;
        email: string;
        avatarUrl: string | null;
    };
}

export default function TeamPage() {
    const { currentWorkspace, isAdmin } = useWorkspace();
    const [copiedLink, setCopiedLink] = useState(false);
    const [roleDropdownId, setRoleDropdownId] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);

    const membersQuery = trpc.workspace.listMembers.useQuery(
        { workspaceId: currentWorkspace?.id ?? "" },
        { enabled: !!currentWorkspace?.id, refetchOnWindowFocus: false }
    );

    const updateRoleMutation = trpc.workspace.updateMemberRole.useMutation({
        onSuccess: () => {
            membersQuery.refetch();
            setRoleDropdownId(null);
        },
        onError: (err) => {
            setToast(err.message);
            setTimeout(() => setToast(null), 3000);
        },
    });

    const removeMemberMutation = trpc.workspace.removeMember.useMutation({
        onSuccess: () => {
            membersQuery.refetch();
        },
        onError: (err) => {
            setToast(err.message);
            setTimeout(() => setToast(null), 3000);
        },
    });

    const members = (membersQuery.data ?? []) as Member[];

    const handleCopyInviteLink = () => {
        if (currentWorkspace?.slug) {
            const url = `${window.location.origin}/invite/${currentWorkspace.slug}`;
            navigator.clipboard.writeText(url);
            setCopiedLink(true);
            setTimeout(() => setCopiedLink(false), 2000);
        }
    };

    const handleRoleChange = (memberId: string, role: string) => {
        if (!currentWorkspace) return;
        updateRoleMutation.mutate({
            workspaceId: currentWorkspace.id,
            memberId,
            role: role as "ADMIN" | "CREATOR" | "USER" | "VIEWER",
        });
    };

    const handleRemoveMember = (memberId: string, memberName: string) => {
        if (!currentWorkspace) return;
        if (!confirm(`Удалить ${memberName} из команды?`)) return;
        removeMemberMutation.mutate({
            workspaceId: currentWorkspace.id,
            memberId,
        });
    };

    return (
        <AppShell>
            <TopBar
                breadcrumbs={[
                    { label: currentWorkspace?.name || "AI Creative" },
                    { label: "Команда" },
                ]}
                showBackToProjects={false}
                showHistoryNavigation={true}
            />
            <div className="flex-1 overflow-y-auto">
                <div className="px-6 pt-6 max-w-3xl">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-[var(--radius-xl)] bg-accent-primary/10">
                                <Users size={22} className="text-accent-primary" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-text-primary">Команда</h1>
                                <p className="text-xs text-text-tertiary mt-0.5">
                                    {members.length} {members.length === 1 ? "участник" : "участников"}
                                </p>
                            </div>
                        </div>

                        {/* Invite link button */}
                        <button
                            onClick={handleCopyInviteLink}
                            className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-text-secondary bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] hover:border-border-secondary hover:text-text-primary transition-all cursor-pointer"
                        >
                            {copiedLink ? <Check size={14} className="text-green-400" /> : <Link2 size={14} />}
                            {copiedLink ? "Скопировано!" : "Скопировать ссылку-приглашение"}
                        </button>
                    </div>

                    {membersQuery.isLoading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 size={24} className="animate-spin text-text-tertiary" />
                        </div>
                    ) : members.length === 0 ? (
                        <div className="text-center py-20">
                            <Users size={40} className="text-text-tertiary/30 mx-auto mb-3" />
                            <p className="text-sm text-text-tertiary">Пока никого нет</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {members.map((member) => {
                                const roleInfo = ROLE_LABELS[member.role] || ROLE_LABELS.USER;
                                const isRoleDropdownOpen = roleDropdownId === member.id;

                                return (
                                    <div
                                        key={member.id}
                                        className="flex items-center justify-between p-4 bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] hover:border-border-secondary transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            {/* Avatar */}
                                            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-accent-primary/20 to-accent-primary/5 text-accent-primary text-sm font-semibold overflow-hidden">
                                                {member.user.avatarUrl ? (
                                                    <img
                                                        src={member.user.avatarUrl}
                                                        alt={member.user.name}
                                                        className="w-10 h-10 rounded-full object-cover"
                                                    />
                                                ) : (
                                                    member.user.name?.charAt(0)?.toUpperCase() || "?"
                                                )}
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-text-primary">
                                                    {member.user.name}
                                                </p>
                                                <p className="text-[11px] text-text-tertiary">
                                                    {member.user.email}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {/* Role badge / dropdown */}
                                            {isAdmin ? (
                                                <div className="relative">
                                                    <button
                                                        onClick={() =>
                                                            setRoleDropdownId(isRoleDropdownOpen ? null : member.id)
                                                        }
                                                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-full)] text-[10px] font-medium cursor-pointer hover:opacity-80 transition-opacity ${roleInfo.color}`}
                                                    >
                                                        {roleInfo.icon}
                                                        {roleInfo.label}
                                                        <ChevronDown size={10} className={isRoleDropdownOpen ? "rotate-180" : ""} />
                                                    </button>

                                                    {isRoleDropdownOpen && (
                                                        <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-bg-surface border border-border-primary rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] py-1 animate-in fade-in slide-in-from-top-1 duration-150">
                                                            {ROLES.map((r) => {
                                                                const ri = ROLE_LABELS[r];
                                                                return (
                                                                    <button
                                                                        key={r}
                                                                        onClick={() => handleRoleChange(member.id, r)}
                                                                        className={`flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors cursor-pointer ${
                                                                            member.role === r
                                                                                ? "text-accent-primary bg-bg-tertiary font-medium"
                                                                                : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
                                                                        }`}
                                                                    >
                                                                        {ri.icon}
                                                                        {ri.label}
                                                                        {member.role === r && <Check size={12} className="ml-auto" />}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-full)] text-[10px] font-medium ${roleInfo.color}`}>
                                                    {roleInfo.icon}
                                                    {roleInfo.label}
                                                </div>
                                            )}

                                            {/* Remove button — admin only, can't remove self */}
                                            {isAdmin && (
                                                <button
                                                    onClick={() => handleRemoveMember(member.id, member.user.name)}
                                                    className="p-1.5 rounded-[var(--radius-md)] text-text-tertiary hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                                                    title="Удалить из команды"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Toast */}
            {toast && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 bg-red-500/10 border border-red-500/20 rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] text-sm text-red-400 animate-in fade-in slide-in-from-bottom-2 duration-200">
                    {toast}
                </div>
            )}
        </AppShell>
    );
}
