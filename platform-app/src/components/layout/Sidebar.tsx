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
} from "lucide-react";
import { cn } from "@/lib/cn";
import { UserMenu } from "@/components/auth/UserMenu";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { trpc } from "@/lib/trpc";

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
];

export function Sidebar() {
    const pathname = usePathname();
    const { workspaces, currentWorkspace, setWorkspaceId } = useWorkspace();
    const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

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
        <aside className="flex flex-col w-[240px] min-w-[240px] h-screen bg-bg-secondary">
            {/* Workspace Switcher */}
            <div className="px-3 pt-3 pb-1" ref={dropdownRef}>
                <button
                    onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
                    className="flex items-center justify-between w-full px-3 py-2.5 rounded-[var(--radius-xl)] hover:bg-bg-surface/60 transition-colors cursor-pointer group"
                >
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-lg)] bg-gradient-to-br from-orange-400 via-red-400 to-yellow-400 shrink-0">
                            <span className="text-white text-sm">🔥</span>
                        </div>
                        <div className="min-w-0 text-left">
                            <p className="text-[13px] font-semibold text-text-primary truncate leading-tight">
                                {currentWorkspace?.name || "AI Creative"}
                            </p>
                            <p className="text-[10px] text-text-tertiary truncate">
                                Команда
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
                                <span className="truncate">{ws.name}</span>
                                {ws.id === currentWorkspace?.id && <Check size={14} />}
                            </button>
                        ))}
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
                        {favorites.map((project) => (
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
            </nav>

            {/* Footer */}
            <div className="px-3 py-3 border-t border-border-primary space-y-1">
                <UserMenu />
                <Link
                    href="/settings"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-xl)] text-[13px] text-text-secondary hover:text-text-primary hover:bg-bg-surface/60 transition-all"
                >
                    <Settings size={18} className="text-text-tertiary" />
                    Настройки
                </Link>
            </div>
        </aside>
    );
}
