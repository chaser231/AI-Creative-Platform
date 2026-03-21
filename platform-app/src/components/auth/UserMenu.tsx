/**
 * UserMenu Component
 *
 * Shows current user's avatar and name in the sidebar
 * with sign-out option. Shows sign-in button if not authenticated.
 */

"use client";

import { useSession, signOut, signIn } from "next-auth/react";
import { LogOut, User as UserIcon } from "lucide-react";

export function UserMenu() {
    const { data: session, status } = useSession();

    // Loading state
    if (status === "loading") {
        return (
            <div className="flex items-center gap-2 px-3 py-2">
                <div className="w-8 h-8 rounded-full bg-bg-tertiary animate-pulse" />
                <div className="flex-1 min-w-0">
                    <div className="h-3 w-20 bg-bg-tertiary rounded animate-pulse" />
                </div>
            </div>
        );
    }

    // Not authenticated
    if (!session?.user) {
        return (
            <button
                onClick={() => signIn("yandex")}
                className="flex items-center gap-2 px-3 py-2 w-full rounded-lg hover:bg-bg-secondary transition-colors text-sm text-text-secondary hover:text-text-primary cursor-pointer"
            >
                <UserIcon size={16} />
                <span>Войти</span>
            </button>
        );
    }

    // Authenticated
    return (
        <div className="flex items-center gap-2 px-3 py-2 group">
            {session.user.image ? (
                <img
                    src={session.user.image}
                    alt={session.user.name || ""}
                    className="w-8 h-8 rounded-full border border-border-primary"
                />
            ) : (
                <div className="w-8 h-8 rounded-full bg-accent-primary/10 flex items-center justify-center text-accent-primary text-xs font-semibold">
                    {(session.user.name || "U")[0].toUpperCase()}
                </div>
            )}
            <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-text-primary truncate">
                    {session.user.name}
                </p>
                <p className="text-[10px] text-text-tertiary truncate">
                    {session.user.email}
                </p>
            </div>
            <button
                onClick={() => signOut({ callbackUrl: "/auth/signin" })}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-bg-tertiary transition-all cursor-pointer"
                title="Выйти"
            >
                <LogOut size={12} className="text-text-tertiary" />
            </button>
        </div>
    );
}
