"use client";

/**
 * /team — Team Members page
 *
 * Shows all members of the current workspace with roles.
 */

import { Users, Crown, Paintbrush, Eye, UserIcon, Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { trpc } from "@/lib/trpc";

const ROLE_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    ADMIN: { label: "Администратор", icon: <Crown size={14} />, color: "text-amber-400 bg-amber-500/10" },
    CREATOR: { label: "Создатель", icon: <Paintbrush size={14} />, color: "text-blue-400 bg-blue-500/10" },
    USER: { label: "Участник", icon: <UserIcon size={14} />, color: "text-green-400 bg-green-500/10" },
    VIEWER: { label: "Зритель", icon: <Eye size={14} />, color: "text-gray-400 bg-gray-500/10" },
};

export default function TeamPage() {
    const { currentWorkspace } = useWorkspace();

    const membersQuery = trpc.workspace.listMembers.useQuery(
        { workspaceId: currentWorkspace?.id ?? "" },
        { enabled: !!currentWorkspace?.id, refetchOnWindowFocus: false }
    );

    const members = membersQuery.data ?? [];

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
                                return (
                                    <div
                                        key={member.id}
                                        className="flex items-center justify-between p-4 bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] hover:border-border-secondary transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            {/* Avatar */}
                                            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-accent-primary/20 to-accent-primary/5 text-accent-primary text-sm font-semibold">
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
                                        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-full)] text-[10px] font-medium ${roleInfo.color}`}>
                                            {roleInfo.icon}
                                            {roleInfo.label}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </AppShell>
    );
}
