"use client";

/**
 * /invite/[slug] — Invite page
 *
 * Public-facing page to join a workspace via invite link.
 * Shows workspace info and a "Join" button.
 */

import { use } from "react";
import { useRouter } from "next/navigation";
import { Users, FolderKanban, Loader2, ArrowRight, CheckCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import Link from "next/link";

export default function InvitePage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = use(params);
    const router = useRouter();
    const { data: session } = useSession();

    const workspaceQuery = trpc.workspace.getInviteInfo.useQuery(
        { slug },
        { retry: 1 }
    );

    const joinMutation = trpc.workspace.join.useMutation({
        onSuccess: (result: { alreadyMember: boolean }) => {
            if (result.alreadyMember) {
                // Already a member, just go to dashboard
                router.push("/");
            } else {
                // Joined! Go to dashboard
                router.push("/");
            }
        },
    });

    const workspace = workspaceQuery.data;

    if (workspaceQuery.isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-bg-primary">
                <Loader2 size={32} className="animate-spin text-text-tertiary" />
            </div>
        );
    }

    if (workspaceQuery.isError || !workspace) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-bg-primary">
                <div className="text-center">
                    <h1 className="text-2xl font-bold text-text-primary mb-2">Команда не найдена</h1>
                    <p className="text-sm text-text-tertiary mb-6">
                        Ссылка недействительна или команда была удалена
                    </p>
                    <Link
                        href="/"
                        className="text-sm text-accent-primary hover:underline"
                    >
                        ← На главную
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-bg-primary p-4">
            <div className="w-full max-w-md">
                {/* Card */}
                <div className="bg-bg-surface border border-border-primary rounded-[var(--radius-2xl)] p-8 shadow-[var(--shadow-lg)]">
                    {/* Header */}
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-primary/20 to-accent-primary/5 mb-4">
                            <Users size={28} className="text-accent-primary" />
                        </div>
                        <h1 className="text-2xl font-bold text-text-primary mb-1">
                            {workspace.name}
                        </h1>
                        <p className="text-sm text-text-tertiary">
                            Приглашение в команду
                        </p>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center justify-center gap-6 mb-8">
                        <div className="flex items-center gap-2 text-text-secondary">
                            <Users size={16} className="text-text-tertiary" />
                            <span className="text-sm">
                                {workspace.memberCount} {workspace.memberCount === 1 ? "участник" : "участников"}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-text-secondary">
                            <FolderKanban size={16} className="text-text-tertiary" />
                            <span className="text-sm">
                                {workspace.projectCount} {workspace.projectCount === 1 ? "проект" : "проектов"}
                            </span>
                        </div>
                    </div>

                    {/* Action */}
                    {!session ? (
                        <div className="text-center">
                            <p className="text-sm text-text-tertiary mb-4">
                                Войдите, чтобы присоединиться к команде
                            </p>
                            <Link
                                href={`/auth/signin?callbackUrl=/invite/${slug}`}
                                className="inline-flex items-center gap-2 px-6 py-3 bg-accent-primary text-text-inverse rounded-[var(--radius-xl)] font-medium text-sm hover:bg-accent-primary/90 transition-colors"
                            >
                                Войти через Яндекс
                                <ArrowRight size={16} />
                            </Link>
                        </div>
                    ) : (
                        <button
                            onClick={() => joinMutation.mutate({ workspaceId: workspace.id, viaInvite: true })}
                            disabled={joinMutation.isPending}
                            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-accent-primary text-text-inverse rounded-[var(--radius-xl)] font-medium text-sm hover:bg-accent-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                            {joinMutation.isPending ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : joinMutation.isSuccess ? (
                                <>
                                    <CheckCircle size={16} />
                                    Присоединились!
                                </>
                            ) : (
                                <>
                                    Присоединиться
                                    <ArrowRight size={16} />
                                </>
                            )}
                        </button>
                    )}
                </div>

                {/* Footer link */}
                <div className="text-center mt-4">
                    <Link
                        href="/"
                        className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
                    >
                        AI Creative Platform
                    </Link>
                </div>
            </div>
        </div>
    );
}
