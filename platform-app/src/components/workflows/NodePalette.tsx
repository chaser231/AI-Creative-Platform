"use client";

/**
 * NodePalette — compact workflow tool rail plus a flyout node picker.
 * Items remain HTML5-draggable for canvas placement, and can also be
 * activated directly by click/keyboard for fast creation.
 */

import { NODE_REGISTRY } from "@/server/workflow/types";
import type { WorkflowNodeType, NodeDefinition } from "@/server/workflow/types";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
    Image as ImageIcon,
    Layers3,
    Move3D,
    Plus,
    Search,
    Sparkles,
    X,
    Workflow,
} from "lucide-react";

const CATEGORY_LABELS: Record<NodeDefinition["category"], string> = {
    input: "Источники",
    ai: "AI-узлы",
    transform: "Преобразования",
    output: "Выходы",
};

const CATEGORY_ORDER: NodeDefinition["category"][] = [
    "input",
    "ai",
    "transform",
    "output",
];

const CATEGORY_META: Record<
    NodeDefinition["category"],
    { icon: ComponentType<{ className?: string }>; dot: string; label: string }
> = {
    input: {
        icon: ImageIcon,
        dot: "bg-status-published",
        label: "Вход",
    },
    ai: {
        icon: Sparkles,
        dot: "bg-status-review",
        label: "AI",
    },
    transform: {
        icon: Move3D,
        dot: "bg-status-progress",
        label: "Fx",
    },
    output: {
        icon: Layers3,
        dot: "bg-status-draft",
        label: "Выход",
    },
};

type PaletteFilter = "all" | NodeDefinition["category"];

interface PaletteBoundary {
    contains(target: unknown): boolean;
}

const RAIL_ITEMS: Array<{
    filter: PaletteFilter;
    label: string;
    icon: ComponentType<{ className?: string }>;
}> = [
    { filter: "all", label: "Все узлы", icon: Plus },
    { filter: "input", label: CATEGORY_LABELS.input, icon: ImageIcon },
    { filter: "ai", label: CATEGORY_LABELS.ai, icon: Sparkles },
    { filter: "transform", label: CATEGORY_LABELS.transform, icon: Move3D },
    { filter: "output", label: CATEGORY_LABELS.output, icon: Layers3 },
];

function onDragStart(event: React.DragEvent, type: WorkflowNodeType) {
    event.dataTransfer.setData("application/reactflow", type);
    event.dataTransfer.effectAllowed = "move";
}

export function getNodePaletteGroups({
    activeFilter,
    query,
}: {
    activeFilter: PaletteFilter;
    query: string;
}) {
    const needle = query.trim().toLowerCase();
    return CATEGORY_ORDER.map((cat) => ({
        category: cat,
        items: Object.values(NODE_REGISTRY).filter((node) => {
            if (activeFilter !== "all" && node.category !== activeFilter) return false;
            if (!needle) return node.category === cat;
            const haystack = `${node.displayName} ${node.description}`.toLowerCase();
            return node.category === cat && haystack.includes(needle);
        }),
    })).filter((group) => group.items.length > 0);
}

export function shouldClosePaletteForPointerTarget(
    root: PaletteBoundary | null,
    target: unknown,
): boolean {
    if (!root || !target) return false;
    return !root.contains(target);
}

export function NodePalette({
    onCreateNode,
}: {
    onCreateNode?: (type: WorkflowNodeType) => void;
}) {
    const paletteRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [activeFilter, setActiveFilter] = useState<PaletteFilter>("all");
    const [query, setQuery] = useState("");

    const grouped = useMemo(() => {
        return getNodePaletteGroups({ activeFilter, query });
    }, [activeFilter, query]);

    const openMenu = (filter: PaletteFilter) => {
        setActiveFilter(filter);
        setOpen(true);
    };

    const createNode = (type: WorkflowNodeType) => {
        onCreateNode?.(type);
        setOpen(false);
        setQuery("");
    };

    useEffect(() => {
        if (!open) return;

        const closeMenu = () => {
            setOpen(false);
            setQuery("");
        };

        const onPointerDown = (event: PointerEvent) => {
            const root = paletteRef.current;
            if (shouldClosePaletteForPointerTarget(root, event.target)) closeMenu();
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") closeMenu();
        };

        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    return (
        <div ref={paletteRef} className="contents">
            <aside
                className="pointer-events-auto absolute bottom-4 left-4 top-4 z-30 flex w-16 flex-col items-center overflow-hidden rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface/90 px-2 py-3 shadow-[var(--shadow-xl)] backdrop-blur-xl"
                aria-label="Панель узлов workflow"
            >
                <div className="flex flex-1 flex-col items-center gap-2">
                    {RAIL_ITEMS.map((item, index) => {
                        const Icon = item.icon;
                        const active = open && activeFilter === item.filter;
                        return (
                            <button
                                key={item.filter}
                                type="button"
                                onClick={() => openMenu(item.filter)}
                                className={[
                                    "flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] text-text-secondary transition duration-150 hover:bg-bg-tertiary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus/50",
                                    index === 0
                                        ? "mb-2 bg-accent-lime text-accent-lime-text shadow-[var(--shadow-sm)] hover:bg-accent-lime-hover hover:text-accent-lime-text dark:bg-text-primary dark:text-text-inverse dark:hover:bg-bg-inverse dark:hover:text-text-inverse"
                                        : "",
                                    active && index === 0
                                        ? "ring-2 ring-border-focus/40"
                                        : "",
                                    active && index !== 0
                                        ? "bg-bg-tertiary text-text-primary"
                                        : "",
                                ].join(" ")}
                                aria-label={item.label}
                                aria-pressed={active}
                            >
                                <Icon className="h-5 w-5" />
                            </button>
                        );
                    })}
                </div>

                <div className="mt-3 border-t border-border-primary pt-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-text-tertiary">
                        <Workflow className="h-5 w-5" />
                    </div>
                </div>
            </aside>

            {open && (
                <div className="pointer-events-auto absolute left-[88px] top-4 z-30 flex max-h-[calc(100%-2rem)] w-[380px] max-w-[calc(100vw-7rem)] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface/95 shadow-[var(--shadow-xl)] backdrop-blur-xl">
                    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border-primary px-4">
                        <Search className="h-4 w-4 shrink-0 text-text-tertiary" />
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            className="h-10 min-w-0 flex-1 bg-transparent text-sm font-medium text-text-primary outline-none placeholder:text-text-tertiary"
                            placeholder="Поиск узлов"
                            aria-label="Поиск узлов"
                            autoFocus
                        />
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-text-secondary transition hover:bg-bg-tertiary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus/50"
                            aria-label="Закрыть меню узлов"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </header>

                    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                        {grouped.length === 0 ? (
                            <div className="px-2 py-8 text-center text-xs text-text-secondary">
                                Ничего не найдено
                            </div>
                        ) : (
                            grouped.map(({ category, items }) => {
                                const meta = CATEGORY_META[category];
                                const Icon = meta.icon;

                                return (
                                    <section key={category} className="mb-4 last:mb-0">
                                        <div className="mb-1.5 flex items-center gap-2 px-2">
                                            <Icon className="h-3.5 w-3.5 text-text-tertiary" />
                                            <div className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                                                {CATEGORY_LABELS[category]}
                                            </div>
                                        </div>
                                        <ul className="space-y-1">
                                            {items.map((item) => (
                                                <li key={item.type}>
                                                    <button
                                                        type="button"
                                                        draggable
                                                        onDragStart={(event) =>
                                                            onDragStart(event, item.type)
                                                        }
                                                        onClick={() => createNode(item.type)}
                                                        className="group flex w-full cursor-grab select-none items-start gap-3 rounded-[var(--radius-lg)] border border-transparent px-3 py-2.5 text-left text-text-primary transition duration-150 hover:border-border-primary hover:bg-bg-secondary focus:outline-none focus:ring-2 focus:ring-border-focus/50 active:cursor-grabbing"
                                                        title={item.description}
                                                        aria-label={`Добавить узел: ${item.displayName}`}
                                                    >
                                                        <span
                                                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`}
                                                            aria-hidden
                                                        />
                                                        <span className="min-w-0 flex-1">
                                                            <span className="flex items-center justify-between gap-3">
                                                                <span className="truncate text-xs font-semibold">
                                                                    {item.displayName}
                                                                </span>
                                                                <span className="shrink-0 rounded-[var(--radius-full)] border border-border-primary px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary group-hover:text-text-secondary">
                                                                    {meta.label}
                                                                </span>
                                                            </span>
                                                            <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-text-secondary">
                                                                {item.description}
                                                            </span>
                                                        </span>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
