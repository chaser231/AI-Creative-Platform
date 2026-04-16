"use client";

import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
    Copy,
    Trash2,
    ArrowUpToLine,
    ArrowDownToLine,
    Eye,
    EyeOff,
    Lock,
    Unlock,
    Pencil,
    Download,
    Clipboard,
    ClipboardPaste,
    Image,
    Scissors,
    LayoutList,
    Pin,
    PinOff,
} from "lucide-react";

export interface ContextMenuItem {
    label: string;
    icon?: React.ReactNode;
    shortcut?: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
}

export interface ContextMenuSeparator {
    separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface ContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuEntry[];
    onClose: () => void;
}

function isSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
    return "separator" in entry;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    // Adjust position to stay within viewport
    const adjustedPosition = useCallback(() => {
        if (!menuRef.current) return { x, y };
        const rect = menuRef.current.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        return {
            x: x + rect.width > vw ? vw - rect.width - 8 : x,
            y: y + rect.height > vh ? vh - rect.height - 8 : y,
        };
    }, [x, y]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        // Delay to avoid immediate close from the same click
        const timer = setTimeout(() => {
            document.addEventListener("mousedown", handleClickOutside);
            document.addEventListener("keydown", handleEscape);
        }, 0);
        return () => {
            clearTimeout(timer);
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [onClose]);

    // Adjust position after render
    useEffect(() => {
        if (!menuRef.current) return;
        const pos = adjustedPosition();
        menuRef.current.style.left = `${pos.x}px`;
        menuRef.current.style.top = `${pos.y}px`;
    }, [adjustedPosition]);

    return createPortal(
        <div
            ref={menuRef}
            className="fixed z-[100] min-w-[180px] py-1.5 rounded-[var(--radius-lg)] border border-border-primary shadow-[var(--shadow-xl)] backdrop-blur-xl bg-bg-surface/95"
            style={{ left: x, top: y }}
            onContextMenu={(e) => e.preventDefault()}
        >
            {items.map((entry, i) => {
                if (isSeparator(entry)) {
                    return (
                        <div
                            key={`sep-${i}`}
                            className="my-1 mx-2 h-px bg-border-primary"
                        />
                    );
                }

                return (
                    <button
                        key={i}
                        onClick={() => {
                            if (!entry.disabled) {
                                entry.onClick();
                                onClose();
                            }
                        }}
                        disabled={entry.disabled}
                        className={`
                            w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[11px]
                            transition-colors cursor-pointer
                            ${entry.disabled
                                ? "text-text-tertiary/50 cursor-not-allowed"
                                : entry.danger
                                    ? "text-red-400 hover:bg-red-500/10"
                                    : "text-text-primary hover:bg-bg-secondary"
                            }
                        `}
                    >
                        {entry.icon && (
                            <span className="w-4 h-4 flex items-center justify-center shrink-0 opacity-70">
                                {entry.icon}
                            </span>
                        )}
                        <span className="flex-1">{entry.label}</span>
                        {entry.shortcut && (
                            <span className="text-[9px] text-text-tertiary font-light tracking-wide ml-4">
                                {entry.shortcut}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>,
        document.body
    );
}

/* ─── Pre-built menu generators ─────────────────────── */

export function buildLayerContextMenuItems(
    layerId: string,
    layerName: string,
    isVisible: boolean,
    isLocked: boolean,
    actions: {
        duplicate: () => void;
        remove: () => void;
        bringToFront: () => void;
        sendToBack: () => void;
        toggleVisibility: () => void;
        toggleLock: () => void;
        rename?: () => void;
        exportLayer?: () => void;
        copyLayers?: () => void;
        cutLayers?: () => void;
        pasteLayers?: () => void;
        copyAsPng?: () => void;
        wrapInAutoLayout?: () => void;
        toggleFixedAsset?: () => void;
    },
    options?: {
        isImageLayer?: boolean;
        isFixedAsset?: boolean;
        isTemplateMode?: boolean;
    }
): ContextMenuEntry[] {
    const items: ContextMenuEntry[] = [];

    // Clipboard actions
    if (actions.copyLayers) {
        items.push({
            label: "Копировать",
            icon: <Clipboard size={13} />,
            shortcut: "⌘C",
            onClick: actions.copyLayers,
        });
    }
    if (actions.cutLayers) {
        items.push({
            label: "Вырезать",
            icon: <Scissors size={13} />,
            shortcut: "⌘X",
            onClick: actions.cutLayers,
        });
    }
    if (actions.pasteLayers) {
        items.push({
            label: "Вставить",
            icon: <ClipboardPaste size={13} />,
            shortcut: "⌘V",
            onClick: actions.pasteLayers,
        });
    }
    if (actions.copyAsPng) {
        items.push({
            label: "Копировать как PNG",
            icon: <Image size={13} />,
            shortcut: "⌘⇧C",
            onClick: actions.copyAsPng,
        });
    }
    if (items.length > 0) {
        items.push({ separator: true });
    }

    items.push(
        {
            label: "Дублировать",
            icon: <Copy size={13} />,
            shortcut: "⌘D",
            onClick: actions.duplicate,
        },
        { separator: true },
        {
            label: "На передний план",
            icon: <ArrowUpToLine size={13} />,
            onClick: actions.bringToFront,
        },
        {
            label: "На задний план",
            icon: <ArrowDownToLine size={13} />,
            onClick: actions.sendToBack,
        },
        { separator: true },
        {
            label: isVisible ? "Скрыть" : "Показать",
            icon: isVisible ? <EyeOff size={13} /> : <Eye size={13} />,
            onClick: actions.toggleVisibility,
        },
        {
            label: isLocked ? "Разблокировать" : "Заблокировать",
            icon: isLocked ? <Unlock size={13} /> : <Lock size={13} />,
            onClick: actions.toggleLock,
        },
    );

    if (actions.rename) {
        items.push(
            { separator: true },
            {
                label: "Переименовать",
                icon: <Pencil size={13} />,
                onClick: actions.rename,
            }
        );
    }

    // Export
    if (actions.exportLayer) {
        items.push(
            { separator: true },
            {
                label: "Экспортировать как PNG",
                icon: <Download size={13} />,
                onClick: actions.exportLayer,
            }
        );
    }

    // Auto-layout wrap
    if (actions.wrapInAutoLayout) {
        items.push(
            { separator: true },
            {
                label: "Обернуть в авто-лейаут",
                icon: <LayoutList size={13} />,
                shortcut: "⇧A",
                onClick: actions.wrapInAutoLayout,
            }
        );
    }

    // Fixed template asset toggle (only for image layers in template editing mode)
    if (options?.isTemplateMode && options?.isImageLayer && actions.toggleFixedAsset) {
        items.push(
            { separator: true },
            {
                label: options.isFixedAsset
                    ? "Открепить ассет шаблона"
                    : "Закрепить как ассет шаблона",
                icon: options.isFixedAsset
                    ? <PinOff size={13} />
                    : <Pin size={13} />,
                onClick: actions.toggleFixedAsset,
            }
        );
    }

    items.push(
        { separator: true },
        {
            label: "Удалить",
            icon: <Trash2 size={13} />,
            shortcut: "⌫",
            danger: true,
            onClick: actions.remove,
        }
    );

    return items;
}

/**
 * Build context menu items for multi-selection scenarios.
 */
export function buildMultiSelectionContextMenuItems(
    count: number,
    actions: {
        duplicateAll: () => void;
        removeAll: () => void;
        exportAll: () => void;
        copyLayers?: () => void;
        cutLayers?: () => void;
        pasteLayers?: () => void;
        wrapInAutoLayout?: () => void;
    }
): ContextMenuEntry[] {
    const items: ContextMenuEntry[] = [];

    // Clipboard actions
    if (actions.copyLayers) {
        items.push({
            label: `Копировать (${count})`,
            icon: <Clipboard size={13} />,
            shortcut: "⌘C",
            onClick: actions.copyLayers,
        });
    }
    if (actions.cutLayers) {
        items.push({
            label: `Вырезать (${count})`,
            icon: <Scissors size={13} />,
            shortcut: "⌘X",
            onClick: actions.cutLayers,
        });
    }
    if (actions.pasteLayers) {
        items.push({
            label: "Вставить",
            icon: <ClipboardPaste size={13} />,
            shortcut: "⌘V",
            onClick: actions.pasteLayers,
        });
    }
    if (items.length > 0) {
        items.push({ separator: true });
    }

    items.push(
        {
            label: `Дублировать (${count})`,
            icon: <Copy size={13} />,
            shortcut: "⌘D",
            onClick: actions.duplicateAll,
        },
    );

    if (actions.wrapInAutoLayout) {
        items.push(
            { separator: true },
            {
                label: "Обернуть в авто-лейаут",
                icon: <LayoutList size={13} />,
                shortcut: "⇧A",
                onClick: actions.wrapInAutoLayout,
            },
        );
    }

    items.push(
        { separator: true },
        {
            label: `Экспортировать (${count}) как PNG`,
            icon: <Download size={13} />,
            onClick: actions.exportAll,
        },
        { separator: true },
        {
            label: `Удалить (${count})`,
            icon: <Trash2 size={13} />,
            shortcut: "⌫",
            danger: true,
            onClick: actions.removeAll,
        },
    );

    return items;
}
