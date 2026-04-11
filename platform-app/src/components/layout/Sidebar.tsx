"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
    LayoutDashboard,
    FolderKanban,
    Users,
    Settings,
    ChevronDown,
    Star,
    LayoutTemplate,
    Check,
    ShieldCheck,
    Compass,
    Plus,
    Sparkles,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { UserMenu } from "@/components/auth/UserMenu";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { trpc } from "@/lib/trpc";
import { WorkspaceBrowseModal } from "@/components/workspace/WorkspaceBrowseModal";
import { CreateWorkspaceModal } from "@/components/workspace/CreateWorkspaceModal";

interface NavItem {
    label: string;
    href: string;
    icon: React.ReactNode;
}

const navItems: NavItem[] = [
    { label: "Мои проекты", href: "/", icon: <LayoutDashboard size={18} /> },
    { label: "Все проекты", href: "/projects", icon: <FolderKanban size={18} /> },
    { label: "Шаблоны", href: "/templates", icon: <LayoutTemplate size={18} /> },
    { label: "Команда", href: "/team", icon: <Users size={18} /> },
    { label: "Настройки AI", href: "/settings/ai", icon: <Sparkles size={18} /> },
];

/** Workspace role label map */
const ROLE_LABELS: Record<string, string> = {
    ADMIN: "Админ",
    CREATOR: "Создатель",
    USER: "Юзер",
    VIEWER: "Зритель",
};

/** Deterministic gradient from workspace name */
function wsGradient(name: string): string {
    const gradients = [
        "from-orange-400 via-red-400 to-yellow-400",
        "from-blue-400 via-indigo-400 to-purple-400",
        "from-emerald-400 via-teal-400 to-cyan-400",
        "from-pink-400 via-rose-400 to-red-400",
        "from-amber-400 via-orange-400 to-red-400",
        "from-violet-400 via-purple-400 to-fuchsia-400",
        "from-sky-400 via-blue-400 to-indigo-400",
        "from-lime-400 via-green-400 to-emerald-400",
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return gradients[Math.abs(hash) % gradients.length];
}

export function Sidebar() {
    const pathname = usePathname();
    const { workspaces, currentWorkspace, setWorkspaceId } = useWorkspace();
    const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Modals
    const [browseOpen, setBrowseOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);

    // Check if user is super admin
    const meQuery = trpc.auth.me.useQuery(undefined, { refetchOnWindowFocus: false });
    const isSuperAdmin = meQuery.data?.role === "SUPER_ADMIN";

    // Fetch favorite projects from DB
    const favoritesQuery = trpc.project.listFavorites.useQuery(
        { workspaceId: currentWorkspace?.id ?? "" },
        {
            enabled: !!currentWorkspace?.id,
            refetchOnWindowFocus: false,
        }
    );
    const favorites = favoritesQuery.data ?? [];

    // Close dropdown on outside click
    useEffect(() => {
        if (!wsDropdownOpen) return;
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setWsDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [wsDropdownOpen]);

    return (
        <>
            <aside className="flex flex-col w-[240px] min-w-[240px] h-screen bg-bg-secondary">
                {/* Workspace Switcher */}
                <div className="px-3 pt-3 pb-1" ref={dropdownRef}>
                    <button
                        onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
                        className="flex items-center justify-between w-full px-3 py-2.5 rounded-[var(--radius-xl)] hover:bg-bg-surface/60 transition-colors cursor-pointer group"
                    >
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className={cn(
                                "flex items-center justify-center w-8 h-8 rounded-[var(--radius-lg)] bg-gradient-to-br shrink-0",
                                wsGradient(currentWorkspace?.name || "AI")
                            )}>
                                <span className="text-white text-sm font-semibold">
                                    {(currentWorkspace?.name || "A").charAt(0).toUpperCase()}
                                </span>
                            </div>
                            <div className="min-w-0 text-left">
                                <p className="text-[13px] font-semibold text-text-primary truncate leading-tight">
                                    {currentWorkspace?.name || "AI Creative"}
                                </p>
                                <p className="text-[10px] text-text-tertiary truncate">
                                    {currentWorkspace?.role ? ROLE_LABELS[currentWorkspace.role] || currentWorkspace.role : "Команда"}
                                </p>
                            </div>
                        </div>
                        <ChevronDown
                            size={14}
                            className={cn(
                                "text-text-tertiary shrink-0 transition-transform",
                                wsDropdownOpen && "rotate-180"
                            )}
                        />
                    </button>

                    {/* Workspace dropdown */}
                    {wsDropdownOpen && (
                        <div className="mt-1 bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] py-1 overflow-hidden">
                            <p className="px-3 py-1.5 text-[10px] font-medium text-text-tertiary uppercase tracking-widest">
                                Команды
                            </p>
                            {workspaces.map((ws) => (
                                <button
                                    key={ws.id}
                                    onClick={() => {
                                        setWorkspaceId(ws.id);
                                        setWsDropdownOpen(false);
                                    }}
                                    className={cn(
                                        "flex items-center justify-between w-full px-3 py-2 text-xs transition-colors cursor-pointer",
                                        ws.id === currentWorkspace?.id
                                            ? "text-accent-primary bg-bg-tertiary font-medium"
                                            : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
                                    )}
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className={cn(
                                            "flex items-center justify-center w-5 h-5 rounded-[var(--radius-sm)] bg-gradient-to-br shrink-0 text-[9px] font-semibold text-white",
                                            wsGradient(ws.name)
                                        )}>
                                            {ws.name.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="truncate">{ws.name}</span>
                                        <span className="text-[9px] text-text-tertiary">
                                            {ROLE_LABELS[ws.role] || ws.role}
                                        </span>
                                    </div>
                                    {ws.id === currentWorkspace?.id && <Check size={14} />}
                                </button>
                            ))}

                            {/* Actions */}
                            <div className="border-t border-border-primary mt-1 pt-1">
                                <button
                                    onClick={() => {
                                        setWsDropdownOpen(false);
                                        setBrowseOpen(true);
                                    }}
                                    className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
                                >
                                    <Compass size={14} className="text-text-tertiary" />
                                    Обзор команд
                                </button>
                                <button
                                    onClick={() => {
                                        setWsDropdownOpen(false);
                                        setCreateOpen(true);
                                    }}
                                    className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
                                >
                                    <Plus size={14} className="text-text-tertiary" />
                                    Создать команду
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
                    {navItems.map((item) => {
                        const isActive =
                            item.href === "/"
                                ? pathname === "/"
                                : pathname.startsWith(item.href);

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={cn(
                                    "flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-xl)] text-[13px] transition-all duration-[var(--transition-fast)]",
                                    isActive
                                        ? "bg-bg-surface text-text-primary shadow-[var(--shadow-sm)]"
                                        : "text-text-secondary hover:text-text-primary hover:bg-bg-surface/60"
                                )}
                            >
                                <span className={cn(isActive ? "text-accent-primary" : "text-text-tertiary")}>
                                    {item.icon}
                                </span>
                                {item.label}
                            </Link>
                        );
                    })}

                    {/* Favorites section — real data from DB */}
                    {favorites.length > 0 && (
                        <div className="pt-4">
                            <p className="px-3 text-[10px] font-medium text-text-tertiary uppercase tracking-widest mb-2">
                                Избранные проекты
                            </p>
                            {favorites.map((project: { id: string; name: string }) => (
                                <Link
                                    key={project.id}
                                    href={`/editor/${project.id}`}
                                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-[var(--radius-lg)] text-[13px] text-text-secondary hover:text-text-primary hover:bg-bg-surface/60 transition-all duration-[var(--transition-fast)]"
                                >
                                    <Star size={14} className="text-amber-400 shrink-0 fill-amber-400" />
                                    <span className="truncate">{project.name}</span>
                                </Link>
                            ))}
                        </div>
                    )}

                    {/* Admin section — SUPER_ADMIN only */}
                    {isSuperAdmin && (
                        <div className="pt-4">
                            <p className="px-3 text-[10px] font-medium text-text-tertiary uppercase tracking-widest mb-2">
                                Администрирование
                            </p>
                            {[
                                { label: "Админ-панель", href: "/admin", icon: <ShieldCheck size={18} /> },
                                { label: "Шаблоны (админ)", href: "/admin/templates", icon: <LayoutTemplate size={18} /> },
                            ].map((item) => {
                                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={cn(
                                            "flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-xl)] text-[13px] transition-all duration-[var(--transition-fast)]",
                                            isActive
                                                ? "bg-bg-surface text-text-primary shadow-[var(--shadow-sm)]"
                                                : "text-text-secondary hover:text-text-primary hover:bg-bg-surface/60"
                                        )}
                                    >
                                        <span className={cn(isActive ? "text-amber-500" : "text-text-tertiary")}>
                                            {item.icon}
                                        </span>
                                        {item.label}
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </nav>

                {/* Footer */}
                <div className="px-3 py-3 border-t border-border-primary space-y-1">
                    <UserMenu />
                    <Link
                        href="/settings/profile"
                        className="flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-xl)] text-[13px] text-text-secondary hover:text-text-primary hover:bg-bg-surface/60 transition-all"
                    >
                        <Settings size={18} className="text-text-tertiary" />
                        Настройки
                    </Link>
                </div>
            </aside>

            {/* Modals */}
            <WorkspaceBrowseModal isOpen={browseOpen} onClose={() => setBrowseOpen(false)} />
            <CreateWorkspaceModal isOpen={createOpen} onClose={() => setCreateOpen(false)} />
        </>
    );
}
