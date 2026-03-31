"use client";

import { Undo2, Redo2, ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface BreadcrumbItem {
    label: string;
    href?: string;
}

interface TopBarProps {
    breadcrumbs?: BreadcrumbItem[];
    actions?: React.ReactNode;
    className?: string;
    onUndo?: () => void;
    onRedo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
    centerContent?: React.ReactNode;
    customLeftContent?: React.ReactNode;
    showBackToProjects?: boolean;
    showHistoryNavigation?: boolean;
    onBackRequest?: () => void;
}

export function TopBar({
    breadcrumbs = [],
    actions,
    className,
    onUndo,
    onRedo,
    canUndo = false,
    canRedo = false,
    centerContent,
    customLeftContent,
    showBackToProjects = true,
    showHistoryNavigation = false,
    onBackRequest,
}: TopBarProps) {
    const router = useRouter();

    return (
        <header
            className={cn(
                "flex items-center justify-between h-14 px-6 bg-bg-primary",
                className
            )}
        >
            {/* Left: back + breadcrumbs */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
                {/* Navigation: either "Back to Projects" or History Arrows */}
                {showBackToProjects && onBackRequest ? (
                    <button
                        onClick={onBackRequest}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-full)] text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors shrink-0 cursor-pointer border-none bg-transparent"
                    >
                        <ArrowLeft size={14} />
                        К проектам
                    </button>
                ) : showBackToProjects ? (
                    <Link
                        href="/"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-full)] text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors shrink-0"
                    >
                        <ArrowLeft size={14} />
                        К проектам
                    </Link>
                ) : null}

                {showHistoryNavigation && (
                    <div className="flex items-center gap-1 mr-2">
                        <button
                            onClick={() => router.back()}
                            className="p-1.5 rounded-[var(--radius-full)] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
                            title="Назад"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <button
                            onClick={() => router.forward()}
                            className="p-1.5 rounded-[var(--radius-full)] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
                            title="Вперед"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                )}

                {/* Breadcrumbs */}
                <nav className="flex items-center gap-1.5 text-sm min-w-0">
                    {breadcrumbs.map((item, index) => (
                        <span key={index} className="flex items-center gap-1.5">
                            {index > 0 && (
                                <span className="text-text-tertiary text-[10px]">›</span>
                            )}
                            {index === breadcrumbs.length - 1 ? (
                                <span className="font-medium text-text-primary truncate">
                                    {item.label}
                                </span>
                            ) : item.href ? (
                                <Link
                                    href={item.href}
                                    className="text-text-secondary font-light hover:text-text-primary cursor-pointer transition-colors"
                                >
                                    {item.label}
                                </Link>
                            ) : (
                                <span className="text-text-secondary font-light hover:text-text-primary cursor-pointer transition-colors">
                                    {item.label}
                                </span>
                            )}
                        </span>
                    ))}
                </nav>

                {/* Custom left content (e.g. editable project name + status) */}
                {customLeftContent}
            </div>

            {/* Center: undo/redo + mode switcher */}
            <div className="flex items-center gap-2 shrink-0">
                {/* Undo/Redo - Only show if handlers are provided */}
                {(onUndo || onRedo) && (
                    <div className="flex items-center gap-0.5 mr-2">
                        <button
                            onClick={onUndo}
                            disabled={!canUndo}
                            title="Отменить (⌘Z)"
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-lg)] text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-text-secondary"
                        >
                            <Undo2 size={14} />
                            <span className="hidden sm:inline">Отменить</span>
                        </button>
                        <button
                            onClick={onRedo}
                            disabled={!canRedo}
                            title="Повторить (⌘⇧Z)"
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-[var(--radius-lg)] text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-text-secondary"
                        >
                            <Redo2 size={14} />
                            <span className="hidden sm:inline">Повторить</span>
                        </button>
                    </div>
                )}

                {/* Mode Switcher (passed as centerContent) */}
                {centerContent}
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-2 justify-end flex-1">
                {actions}
            </div>
        </header>
    );
}
