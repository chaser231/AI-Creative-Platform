"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
    LayoutDashboard,
    FolderKanban,
    Image,
    Users,
    Settings,
    Palette,
    ChevronDown,
    Plus,
    Star,
    LayoutTemplate,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { UserMenu } from "@/components/auth/UserMenu";

interface NavItem {
    label: string;
    href: string;
    icon: React.ReactNode;
}

const navItems: NavItem[] = [
    { label: "Последние проекты", href: "/", icon: <LayoutDashboard size={18} /> },
    { label: "Все проекты", href: "/projects", icon: <FolderKanban size={18} /> },
    { label: "Ассеты", href: "/assets", icon: <Image size={18} /> },
    { label: "Шаблоны", href: "/templates", icon: <LayoutTemplate size={18} /> },
    { label: "Бренд-кит", href: "/settings/brand-kit", icon: <Palette size={18} /> },
    { label: "Команда", href: "/team", icon: <Users size={18} /> },
];

const favoriteProjects = [
    { label: "Баннеры промокод Salton", href: "/editor/salton" },
    { label: "Фото счастливой семьи", href: "/editor/happy-family" },
    { label: "Товары для дома", href: "/editor/home-goods" },
];

export function Sidebar() {
    const pathname = usePathname();

    return (
        <aside className="flex flex-col w-[240px] min-w-[240px] h-screen bg-bg-secondary">
            {/* Logo + New button */}
            <div className="flex items-center justify-between px-4 h-16">
                <div className="flex items-center gap-2.5">
                    <div className="flex items-center justify-center w-9 h-9 rounded-[var(--radius-xl)] bg-gradient-to-br from-orange-400 via-red-400 to-yellow-400">
                        <span className="text-white text-lg">🔥</span>
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-text-primary leading-tight">
                            AI Creative
                        </p>
                    </div>
                </div>
                <button className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-lg)] bg-bg-surface border border-border-primary hover:bg-bg-tertiary transition-colors cursor-pointer shadow-[var(--shadow-sm)]">
                    <Plus size={16} className="text-text-secondary" />
                </button>
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

                {/* Favorites section */}
                <div className="pt-4">
                    <p className="px-3 text-[10px] font-medium text-text-tertiary uppercase tracking-widest mb-2">
                        Избранные проекты
                    </p>
                    {favoriteProjects.map((project) => (
                        <Link
                            key={project.href}
                            href={project.href}
                            className="flex items-center gap-2.5 px-3 py-1.5 rounded-[var(--radius-lg)] text-[13px] text-text-secondary hover:text-text-primary hover:bg-bg-surface/60 transition-all duration-[var(--transition-fast)]"
                        >
                            <Star size={14} className="text-text-tertiary shrink-0" />
                            <span className="truncate">{project.label}</span>
                        </Link>
                    ))}
                </div>
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
