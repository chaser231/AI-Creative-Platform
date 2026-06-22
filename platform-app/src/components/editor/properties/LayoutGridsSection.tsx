"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import {
    Columns3,
    Rows3,
    Grid3x3,
    LayoutGrid as ContainerIcon,
    Eye,
    EyeOff,
    Trash2,
    Plus,
    Settings2,
    ChevronDown,
    ChevronRight,
} from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { selectActiveLayoutGrids } from "@/store/canvas/createLayoutGridSlice";
import type { LayoutGrid, LayoutGridType } from "@/types";
import { Select } from "@/components/ui/Select";
import { SmartNumberInput } from "@/components/ui/SmartNumberInput";
import { ColorInput } from "./ColorInput";
import { resolveTrackSizes } from "@/utils/sliceGrid";
import { cn } from "@/lib/cn";

const FIELD_CLASS =
    "h-8 w-full min-w-0 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary px-2 text-center text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus";

const TYPE_OPTIONS: Array<{ type: LayoutGridType; label: string; icon: ReactNode }> = [
    { type: "columns", label: "Колонки", icon: <Columns3 size={13} /> },
    { type: "rows", label: "Строки", icon: <Rows3 size={13} /> },
    { type: "uniform", label: "Сетка", icon: <Grid3x3 size={13} /> },
    { type: "container", label: "Контейнер", icon: <ContainerIcon size={13} /> },
];

const TYPE_LABEL: Record<LayoutGridType, string> = {
    columns: "Колонки",
    rows: "Строки",
    uniform: "Сетка",
    container: "Контейнер",
};

type PopoverPosition = { top: number; left: number; maxHeight: number };

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block min-w-0">
            <span className="mb-1 block text-[9px] uppercase tracking-wider text-text-tertiary">{label}</span>
            {children}
        </label>
    );
}

function NumField(props: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
    return <SmartNumberInput {...props} className={FIELD_CLASS} />;
}

function gridSummary(grid: LayoutGrid): string {
    switch (grid.type) {
        case "uniform":
            return `${grid.cellSize ?? 8}px`;
        case "columns":
            return `${grid.count ?? 1} col · gap ${grid.gutter ?? 0}`;
        case "rows":
            return `${grid.count ?? 1} row · gap ${grid.gutter ?? 0}`;
        case "container":
            return `${grid.cols ?? 1}×${grid.rows ?? 1} · ${grid.gapX ?? 0}/${grid.gapY ?? 0}`;
    }
}

export function LayoutGridsSection() {
    const {
        grids,
        layoutGridsVisible,
        canvasWidth,
        canvasHeight,
        addLayoutGrid,
        updateLayoutGrid,
        removeLayoutGrid,
        toggleLayoutGridsVisible,
    } = useCanvasStore(useShallow((s) => ({
        grids: selectActiveLayoutGrids(s),
        layoutGridsVisible: s.layoutGridsVisible,
        canvasWidth: s.canvasWidth,
        canvasHeight: s.canvasHeight,
        addLayoutGrid: s.addLayoutGrid,
        updateLayoutGrid: s.updateLayoutGrid,
        removeLayoutGrid: s.removeLayoutGrid,
        toggleLayoutGridsVisible: s.toggleLayoutGridsVisible,
    })));

    const [sectionExpanded, setSectionExpanded] = useState(true);
    const [addOpen, setAddOpen] = useState(false);
    const [openSettingsId, setOpenSettingsId] = useState<string | null>(null);

    return (
        <section className="border-b border-border-primary pb-3 last:border-b-0 last:pb-0">
            <div className="mb-2 flex items-center justify-between gap-1">
                <button
                    type="button"
                    onClick={() => setSectionExpanded((v) => !v)}
                    className="flex min-w-0 flex-1 items-center gap-1 rounded-[var(--radius-sm)] py-0.5 text-left transition-colors hover:text-text-primary cursor-pointer"
                    aria-expanded={sectionExpanded}
                >
                    {sectionExpanded
                        ? <ChevronDown size={14} className="shrink-0 text-text-tertiary" />
                        : <ChevronRight size={14} className="shrink-0 text-text-tertiary" />}
                    <span className="text-[12px] font-semibold text-text-primary">Сетки</span>
                    {grids.length > 0 && (
                        <span className="rounded-full bg-bg-tertiary px-1.5 py-0.5 text-[9px] font-medium text-text-tertiary">
                            {grids.length}
                        </span>
                    )}
                </button>
                <button
                    type="button"
                    title={layoutGridsVisible ? "Скрыть сетки на холсте" : "Показать сетки на холсте"}
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleLayoutGridsVisible();
                    }}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer"
                >
                    {layoutGridsVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
            </div>

            {sectionExpanded && (
                <div className="space-y-2">
                    {grids.map((grid, index) => (
                        <GridCard
                            key={grid.id}
                            grid={grid}
                            index={index}
                            width={canvasWidth}
                            height={canvasHeight}
                            settingsOpen={openSettingsId === grid.id}
                            onToggleSettings={() => setOpenSettingsId((id) => (id === grid.id ? null : grid.id))}
                            onCloseSettings={() => setOpenSettingsId(null)}
                            onChange={(patch) => updateLayoutGrid(grid.id, patch)}
                            onRemove={() => {
                                if (openSettingsId === grid.id) setOpenSettingsId(null);
                                removeLayoutGrid(grid.id);
                            }}
                        />
                    ))}

                    {grids.length === 0 && (
                        <p className="text-[10px] text-text-tertiary">
                            Нет сеток. Добавьте сетку, чтобы задать сейфзоны.
                        </p>
                    )}

                    {addOpen ? (
                        <div className="grid grid-cols-2 gap-1.5">
                            {TYPE_OPTIONS.map((opt) => (
                                <button
                                    key={opt.type}
                                    type="button"
                                    onClick={() => {
                                        addLayoutGrid(opt.type);
                                        setAddOpen(false);
                                    }}
                                    className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary px-2 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer"
                                >
                                    {opt.icon}
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setAddOpen(true)}
                            className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-border-primary px-2 py-1.5 text-[11px] text-text-secondary transition-colors hover:border-border-secondary hover:text-text-primary cursor-pointer"
                        >
                            <Plus size={13} />
                            Добавить сетку
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}

function GridCard({
    grid,
    index,
    width,
    height,
    settingsOpen,
    onToggleSettings,
    onCloseSettings,
    onChange,
    onRemove,
}: {
    grid: LayoutGrid;
    index: number;
    width: number;
    height: number;
    settingsOpen: boolean;
    onToggleSettings: () => void;
    onCloseSettings: () => void;
    onChange: (patch: Partial<LayoutGrid>) => void;
    onRemove: () => void;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null);

    const updatePopoverPosition = useCallback(() => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect || typeof window === "undefined") return;
        const popoverWidth = 268;
        const viewportPadding = 12;
        const gap = 6;
        const preferredMaxHeight = Math.min(420, window.innerHeight - viewportPadding * 2);
        const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
        const spaceAbove = rect.top - viewportPadding;
        const openBelow = spaceBelow >= Math.min(220, preferredMaxHeight) || spaceBelow >= spaceAbove;
        const availableHeight = Math.max(160, (openBelow ? spaceBelow : spaceAbove) - gap);
        const maxHeight = Math.min(preferredMaxHeight, availableHeight);
        const top = openBelow
            ? Math.max(viewportPadding, Math.min(rect.bottom + gap, window.innerHeight - viewportPadding - maxHeight))
            : Math.max(viewportPadding, rect.top - gap - maxHeight);

        setPopoverPosition({
            top,
            left: Math.max(viewportPadding, Math.min(rect.right - popoverWidth, window.innerWidth - popoverWidth - viewportPadding)),
            maxHeight,
        });
    }, []);

    useEffect(() => {
        if (!settingsOpen) return;
        updatePopoverPosition();
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Node;
            if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
            const el = target instanceof Element ? target : target.parentElement;
            if (el?.closest("[data-radix-popper-content-wrapper]")) return;
            onCloseSettings();
        };
        window.addEventListener("resize", updatePopoverPosition);
        window.addEventListener("scroll", updatePopoverPosition, true);
        document.addEventListener("pointerdown", onPointerDown);
        return () => {
            window.removeEventListener("resize", updatePopoverPosition);
            window.removeEventListener("scroll", updatePopoverPosition, true);
            document.removeEventListener("pointerdown", onPointerDown);
        };
    }, [settingsOpen, updatePopoverPosition, onCloseSettings]);

    return (
        <div
            ref={rootRef}
            className={cn(
                "rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary/50 px-2 py-1.5",
                !grid.visible && "opacity-60",
            )}
        >
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    title={grid.visible ? "Скрыть сетку" : "Показать сетку"}
                    onClick={() => onChange({ visible: !grid.visible })}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer"
                >
                    {grid.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>

                <div
                    className="h-5 w-5 shrink-0 rounded-[var(--radius-sm)] border border-border-primary"
                    style={{ backgroundColor: grid.color, opacity: Math.max(0.35, grid.opacity ?? 0.1) }}
                    title={grid.color}
                />

                <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-medium text-text-primary">
                        {TYPE_LABEL[grid.type]} {index + 1}
                    </div>
                    <div className="truncate text-[9px] text-text-tertiary">{gridSummary(grid)}</div>
                </div>

                <button
                    type="button"
                    onClick={() => {
                        updatePopoverPosition();
                        onToggleSettings();
                    }}
                    className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer",
                        settingsOpen && "bg-accent-primary/10 text-accent-primary",
                    )}
                    title="Параметры сетки"
                >
                    <Settings2 size={14} />
                </button>

                <button
                    type="button"
                    title="Удалить сетку"
                    onClick={onRemove}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-red-500 cursor-pointer"
                >
                    <Trash2 size={13} />
                </button>
            </div>

            {settingsOpen && popoverPosition && typeof document !== "undefined" && createPortal(
                <div
                    ref={popoverRef}
                    className="fixed z-[9999] w-[268px] space-y-3 overflow-y-auto rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface p-3 shadow-[var(--shadow-xl)]"
                    style={{ top: popoverPosition.top, left: popoverPosition.left, maxHeight: popoverPosition.maxHeight }}
                >
                    <div className="text-[11px] font-semibold text-text-primary">
                        {TYPE_LABEL[grid.type]} {index + 1}
                    </div>

                    <Field label="Тип">
                        <Select
                            size="xs"
                            value={grid.type}
                            onChange={(value) => onChange({ type: value as LayoutGridType })}
                            options={TYPE_OPTIONS.map((o) => ({ value: o.type, label: TYPE_LABEL[o.type] }))}
                        />
                    </Field>

                    <div className="flex items-center justify-between gap-2">
                        <ColorInput value={grid.color} onChange={(color) => onChange({ color })} />
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] uppercase tracking-wider text-text-tertiary">Прозр.</span>
                            <div className="w-14">
                                <SmartNumberInput
                                    value={Math.round((grid.opacity ?? 0) * 100)}
                                    min={0}
                                    max={100}
                                    onChange={(v) => onChange({ opacity: Math.min(1, Math.max(0, v / 100)) })}
                                    className={FIELD_CLASS}
                                />
                            </div>
                        </div>
                    </div>

                    <GridTypeFields grid={grid} width={width} height={height} onChange={onChange} />
                </div>,
                document.body,
            )}
        </div>
    );
}

function GridTypeFields({ grid, width, height, onChange }: { grid: LayoutGrid; width: number; height: number; onChange: (patch: Partial<LayoutGrid>) => void }) {
    if (grid.type === "uniform") {
        return (
            <div className="grid grid-cols-2 gap-2">
                <Field label="Размер">
                    <NumField value={grid.cellSize ?? 8} min={1} onChange={(v) => onChange({ cellSize: Math.max(1, v) })} />
                </Field>
            </div>
        );
    }

    if (grid.type === "columns" || grid.type === "rows") {
        const isColumns = grid.type === "columns";
        const align = grid.align ?? "stretch";
        const alignOptions = isColumns
            ? [
                { value: "stretch", label: "Растянуть" },
                { value: "min", label: "Слева" },
                { value: "center", label: "По центру" },
                { value: "max", label: "Справа" },
            ]
            : [
                { value: "stretch", label: "Растянуть" },
                { value: "min", label: "Сверху" },
                { value: "center", label: "По центру" },
                { value: "max", label: "Снизу" },
            ];
        return (
            <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                    <Field label={isColumns ? "Колонки" : "Строки"}>
                        <NumField value={grid.count ?? 1} min={1} max={48} onChange={(v) => onChange({ count: Math.max(1, Math.round(v)) })} />
                    </Field>
                    <Field label="Гэп">
                        <NumField value={grid.gutter ?? 0} min={0} onChange={(v) => onChange({ gutter: Math.max(0, v) })} />
                    </Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Field label="Марджин">
                        <NumField value={grid.margin ?? 0} min={0} onChange={(v) => onChange({ margin: Math.max(0, v) })} />
                    </Field>
                    <Field label="Выравнивание">
                        <Select
                            size="xs"
                            value={align}
                            onChange={(value) => onChange({ align: value as LayoutGrid["align"] })}
                            options={alignOptions}
                        />
                    </Field>
                </div>
                {align !== "stretch" && (
                    <div className="grid grid-cols-2 gap-2">
                        <Field label={isColumns ? "Ширина" : "Высота"}>
                            <NumField
                                value={grid.trackSize ?? 100}
                                min={1}
                                onChange={(v) => onChange({ trackSize: Math.max(1, v) })}
                            />
                        </Field>
                    </div>
                )}
            </div>
        );
    }

    return <ContainerFields grid={grid} width={width} height={height} onChange={onChange} />;
}

function setTrackSize(arr: Array<number | null> | undefined, count: number, index: number, value: number): Array<number | null> {
    const next = Array.from({ length: count }, (_, i) => arr?.[i] ?? null);
    next[index] = Math.max(0, value);
    return next;
}

function toFixedSizes(arr?: Array<number | null>): Array<number | undefined> | undefined {
    return arr ? arr.map((v) => (v == null ? undefined : v)) : undefined;
}

function ContainerFields({ grid, width, height, onChange }: { grid: LayoutGrid; width: number; height: number; onChange: (patch: Partial<LayoutGrid>) => void }) {
    const cols = Math.max(1, grid.cols ?? 1);
    const rows = Math.max(1, grid.rows ?? 1);
    const margins = grid.margins ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const gapX = grid.gapX ?? 0;
    const gapY = grid.gapY ?? 0;
    const hasFixed = (grid.colSizes ?? []).some((v) => v != null) || (grid.rowSizes ?? []).some((v) => v != null);

    const innerW = Math.max(0, width - margins.left - margins.right);
    const innerH = Math.max(0, height - margins.top - margins.bottom);
    const colWidths = resolveTrackSizes(innerW, cols, toFixedSizes(grid.colSizes), gapX);
    const rowHeights = resolveTrackSizes(innerH, rows, toFixedSizes(grid.rowSizes), gapY);

    return (
        <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
                <Field label="Колонки">
                    <NumField value={cols} min={1} max={24} onChange={(v) => onChange({ cols: Math.max(1, Math.round(v)) })} />
                </Field>
                <Field label="Строки">
                    <NumField value={rows} min={1} max={24} onChange={(v) => onChange({ rows: Math.max(1, Math.round(v)) })} />
                </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <Field label="Гэп X">
                    <NumField value={grid.gapX ?? 0} min={0} onChange={(v) => onChange({ gapX: Math.max(0, v) })} />
                </Field>
                <Field label="Гэп Y">
                    <NumField value={grid.gapY ?? 0} min={0} onChange={(v) => onChange({ gapY: Math.max(0, v) })} />
                </Field>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
                <Field label="↑"><NumField value={margins.top} min={0} onChange={(v) => onChange({ margins: { ...margins, top: Math.max(0, v) } })} /></Field>
                <Field label="→"><NumField value={margins.right} min={0} onChange={(v) => onChange({ margins: { ...margins, right: Math.max(0, v) } })} /></Field>
                <Field label="↓"><NumField value={margins.bottom} min={0} onChange={(v) => onChange({ margins: { ...margins, bottom: Math.max(0, v) } })} /></Field>
                <Field label="←"><NumField value={margins.left} min={0} onChange={(v) => onChange({ margins: { ...margins, left: Math.max(0, v) } })} /></Field>
            </div>

            {cols > 1 && (
                <div>
                    <span className="mb-1 block text-[9px] uppercase tracking-wider text-text-tertiary">Ширины колонок</span>
                    <div className="flex flex-wrap gap-1.5">
                        {Array.from({ length: cols }, (_, i) => (
                            <div key={`c-${i}`} className="w-14">
                                <NumField
                                    value={Math.round(colWidths[i] ?? 0)}
                                    min={0}
                                    onChange={(v) => onChange({ colSizes: setTrackSize(grid.colSizes, cols, i, v) })}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {rows > 1 && (
                <div>
                    <span className="mb-1 block text-[9px] uppercase tracking-wider text-text-tertiary">Высоты строк</span>
                    <div className="flex flex-wrap gap-1.5">
                        {Array.from({ length: rows }, (_, i) => (
                            <div key={`r-${i}`} className="w-14">
                                <NumField
                                    value={Math.round(rowHeights[i] ?? 0)}
                                    min={0}
                                    onChange={(v) => onChange({ rowSizes: setTrackSize(grid.rowSizes, rows, i, v) })}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {hasFixed && (
                <button
                    type="button"
                    onClick={() => onChange({ colSizes: [], rowSizes: [] })}
                    className="text-[10px] text-text-tertiary transition-colors hover:text-text-primary cursor-pointer"
                >
                    Сбросить размеры треков (авто)
                </button>
            )}
        </div>
    );
}
