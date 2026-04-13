"use client";

import { Plus, Trash2, Check, Link, Unlink, X, Copy, FileText, Crown, Settings2, Pencil, Maximize2 } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import { useState, useRef, useCallback } from "react";
import { cloneLayerTree } from "@/utils/cloneLayerTree";
import { BindToMasterModal } from "./BindToMasterModal";
import { ContextMenu } from "./ContextMenu";
import type { ContextMenuEntry } from "./ContextMenu";

export function ResizePanel() {
    const {
        resizes,
        activeResizeId,
        setActiveResize,
        addResize,
        removeResize,
        toggleInstanceMode,
        renameResize,
        resizeFormat,
        duplicateResize,
        layers,
        masterComponents,
        promoteFormatToMaster,
        demoteFormatFromMaster,
        unbindFormat,
    } = useCanvasStore(useShallow((s) => ({
        resizes: s.resizes, activeResizeId: s.activeResizeId,
        setActiveResize: s.setActiveResize, addResize: s.addResize,
        removeResize: s.removeResize, toggleInstanceMode: s.toggleInstanceMode,
        renameResize: s.renameResize,
        resizeFormat: s.resizeFormat,
        duplicateResize: s.duplicateResize,
        layers: s.layers,
        masterComponents: s.masterComponents,
        promoteFormatToMaster: s.promoteFormatToMaster,
        demoteFormatFromMaster: s.demoteFormatFromMaster,
        unbindFormat: s.unbindFormat,
    })));
    const [showAddForm, setShowAddForm] = useState(false);
    const [customName, setCustomName] = useState("");
    const [customWidth, setCustomWidth] = useState("1200");
    const [customHeight, setCustomHeight] = useState("628");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState("");
    const renameRef = useRef<HTMLInputElement>(null);

    // Context menu state — uses the app's shared ContextMenu component
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        resizeId: string;
    } | null>(null);

    // Inline size editing state
    const [editingSizeId, setEditingSizeId] = useState<string | null>(null);
    const [editWidth, setEditWidth] = useState("");
    const [editHeight, setEditHeight] = useState("");

    // Phase 2: Bind modal state
    const [bindModalFormatId, setBindModalFormatId] = useState<string | null>(null);

    const hasMasterFormat = resizes.some(r => r.isMaster);

    const handleContextMenu = useCallback((e: React.MouseEvent, resizeId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, resizeId });
    }, []);

    const handleStartResize = useCallback((resizeId: string) => {
        const format = resizes.find(r => r.id === resizeId);
        if (!format) return;
        setEditingSizeId(resizeId);
        setEditWidth(String(format.width));
        setEditHeight(String(format.height));
    }, [resizes]);

    const handleStartRename = useCallback((resizeId: string) => {
        const format = resizes.find(r => r.id === resizeId);
        if (!format) return;
        setEditingId(resizeId);
        setEditingName(format.name);
    }, [resizes]);

    const handleConfirmResize = useCallback(() => {
        if (!editingSizeId) return;
        const w = Math.max(1, Number(editWidth) || 100);
        const h = Math.max(1, Number(editHeight) || 100);
        resizeFormat(editingSizeId, w, h);
        setEditingSizeId(null);
    }, [editingSizeId, editWidth, editHeight, resizeFormat]);

    // Build context menu items for a specific format
    const buildFormatContextMenuItems = useCallback((resizeId: string): ContextMenuEntry[] => {
        const format = resizes.find(r => r.id === resizeId);
        if (!format) return [];
        const isMaster = format.isMaster === true;

        const items: ContextMenuEntry[] = [
            {
                label: "Переименовать",
                icon: <Pencil size={13} />,
                onClick: () => handleStartRename(resizeId),
            },
            {
                label: "Изменить размер",
                icon: <Maximize2 size={13} />,
                onClick: () => handleStartResize(resizeId),
            },
            {
                label: "Дублировать",
                icon: <Copy size={13} />,
                shortcut: "⌘D",
                onClick: () => duplicateResize(resizeId),
            },
            { separator: true },
            {
                label: isMaster ? "Снять статус мастера" : "Назначить мастером",
                icon: <Crown size={13} className={isMaster ? "text-amber-400" : ""} />,
                onClick: () => {
                    if (isMaster) {
                        demoteFormatFromMaster(resizeId);
                    } else {
                        promoteFormatToMaster(resizeId);
                    }
                },
            },
        ];

        // Delete — only for non-default formats
        if (format.id !== "master") {
            items.push(
                { separator: true },
                {
                    label: "Удалить",
                    icon: <Trash2 size={13} />,
                    danger: true,
                    onClick: () => removeResize(resizeId),
                }
            );
        }

        return items;
    }, [resizes, handleStartRename, handleStartResize, duplicateResize, promoteFormatToMaster, demoteFormatFromMaster, removeResize]);

    const handleAddCustom = (mode: "clone" | "empty") => {
        if (!customName.trim()) return;
        const width = Number(customWidth) || 1200;
        const height = Number(customHeight) || 628;

        const format = {
            id: `custom-${Date.now()}`,
            name: customName.trim(),
            width,
            height,
            label: `${width} × ${height}`,
            instancesEnabled: false,
            layerSnapshot: mode === "clone"
                ? cloneLayerTree(layers)
                : [],
        };

        addResize(format);
        setCustomName("");
        setCustomWidth("1200");
        setCustomHeight("628");
        setShowAddForm(false);
    };

    return (
        <div className="w-[240px] min-w-[240px] h-full border border-border-primary rounded-[var(--radius-2xl)] shadow-[var(--shadow-md)] flex flex-col overflow-hidden backdrop-blur-xl bg-bg-surface/85">
            {/* Header */}
            <div className="p-4 border-b border-border-primary flex items-center justify-between">
                <h3 className="text-[11px] font-medium text-text-tertiary uppercase tracking-widest">
                    Форматы
                </h3>
                <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="p-1.5 rounded-[var(--radius-md)] hover:bg-bg-secondary transition-colors cursor-pointer"
                    title="Добавить формат"
                >
                    {showAddForm ? <X size={14} className="text-text-secondary" /> : <Plus size={14} className="text-text-secondary" />}
                </button>
            </div>

            {/* Add Format form (collapsible) */}
            {showAddForm && (
                <div className="p-3 border-b border-border-primary bg-bg-secondary space-y-2">
                    <input
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        placeholder="Название"
                        className="w-full h-7 px-2 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary text-[11px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border-focus"
                    />
                    <div className="flex gap-1.5 items-center">
                        <input
                            value={customWidth}
                            onChange={(e) => setCustomWidth(e.target.value.replace(/\D/g, ""))}
                            className="min-w-0 flex-1 h-7 px-2 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                        />
                        <span className="text-[10px] text-text-tertiary">×</span>
                        <input
                            value={customHeight}
                            onChange={(e) => setCustomHeight(e.target.value.replace(/\D/g, ""))}
                            className="min-w-0 flex-1 h-7 px-2 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                        />
                    </div>

                    {/* Choice: duplicate current content or start fresh */}
                    {layers.length > 0 ? (
                        <div className="flex gap-1.5">
                            <button
                                onClick={() => handleAddCustom("clone")}
                                disabled={!customName.trim()}
                                className="flex-1 flex items-center justify-center gap-1 h-7 rounded-[var(--radius-md)] bg-accent-primary text-text-inverse text-[11px] font-medium hover:bg-accent-primary-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                title="Дублировать содержимое текущего формата в новый"
                            >
                                <Copy size={11} />
                                С содержимым
                            </button>
                            <button
                                onClick={() => handleAddCustom("empty")}
                                disabled={!customName.trim()}
                                className="flex-1 flex items-center justify-center gap-1 h-7 rounded-[var(--radius-md)] border border-border-primary text-text-secondary text-[11px] font-medium hover:bg-bg-tertiary hover:text-text-primary transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                title="Создать пустой формат без содержимого"
                            >
                                <FileText size={11} />
                                Чистый лист
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => handleAddCustom("empty")}
                            disabled={!customName.trim()}
                            className="w-full h-7 rounded-[var(--radius-md)] bg-accent-primary text-text-inverse text-[11px] font-medium hover:bg-accent-primary-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Добавить
                        </button>
                    )}
                </div>
            )}

            {/* Format list */}
            <div className="flex-1 overflow-y-auto p-2">
                {resizes.map((resize) => {
                    const isActive = activeResizeId === resize.id;
                    const isMaster = resize.isMaster === true;
                    const isBound = (resize.layerBindings?.length ?? 0) > 0;
                    const isSnapshot = resize.layerSnapshot !== undefined;
                    const isLegacy = !isSnapshot && masterComponents.length > 0;
                    const isEditingSize = editingSizeId === resize.id;

                    return (
                        <div key={resize.id} className="mb-0.5">
                            <div
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        setActiveResize(resize.id);
                                    }
                                }}
                                onClick={() => setActiveResize(resize.id)}
                                onContextMenu={(e) => handleContextMenu(e, resize.id)}
                                className={`
                                    w-full flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-lg)]
                                    transition-all cursor-pointer text-left group
                                    ${isActive
                                        ? "bg-bg-tertiary border border-border-primary shadow-[var(--shadow-sm)]"
                                        : "hover:bg-bg-secondary border border-transparent"
                                    }
                                `}
                            >
                                {/* Format thumbnail */}
                                <div
                                    className="shrink-0 border border-border-secondary rounded-[3px] bg-bg-secondary"
                                    style={{
                                        width: Math.max(16, Math.min(28, resize.width / 40)),
                                        height: Math.max(16, Math.min(28, resize.height / 40)),
                                    }}
                                />

                                {/* Name & label — truncate on overflow */}
                                <div className="flex-1 min-w-0 overflow-hidden">
                                    <div className="text-[11px] font-medium text-text-primary truncate flex items-center gap-1">
                                        {isMaster && (
                                            <Crown size={10} className="text-amber-400 shrink-0" />
                                        )}
                                        {editingId === resize.id ? (
                                            <input
                                                ref={renameRef}
                                                value={editingName}
                                                onChange={(e) => setEditingName(e.target.value)}
                                                onBlur={() => {
                                                    if (editingName.trim()) renameResize(resize.id, editingName.trim());
                                                    setEditingId(null);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") {
                                                        if (editingName.trim()) renameResize(resize.id, editingName.trim());
                                                        setEditingId(null);
                                                    }
                                                    if (e.key === "Escape") setEditingId(null);
                                                    e.stopPropagation();
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                autoFocus
                                                className="w-full h-5 px-1 rounded-[var(--radius-sm)] border border-border-focus bg-bg-secondary text-[11px] text-text-primary focus:outline-none"
                                            />
                                        ) : (
                                            <span
                                                className="truncate"
                                                onDoubleClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditingId(resize.id);
                                                    setEditingName(resize.name);
                                                }}
                                                title={resize.name}
                                            >
                                                {resize.name}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[10px] text-text-tertiary font-light truncate">
                                        {resize.label}
                                        {isBound && (
                                            <span className="text-accent-primary ml-1">· {resize.layerBindings!.length} связей</span>
                                        )}
                                    </div>
                                </div>

                                {/* Action buttons — fixed width area to prevent jumping */}
                                <div className="flex items-center gap-0.5 shrink-0 w-[52px] justify-end">
                                    {/* Active check — always occupies space via min-w */}
                                    {isActive && (
                                        <Check size={11} className="text-accent-primary shrink-0" />
                                    )}

                                    {/* Phase 2: Master/Bind controls — available for all formats */}
                                    {(
                                        <>
                                            {/* Promote/Demote master */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (isMaster) {
                                                        demoteFormatFromMaster(resize.id);
                                                    } else {
                                                        promoteFormatToMaster(resize.id);
                                                    }
                                                }}
                                                className={`p-0.5 rounded-[var(--radius-sm)] transition-all cursor-pointer ${
                                                    isMaster
                                                        ? "text-amber-400 hover:bg-bg-tertiary"
                                                        : "text-text-tertiary opacity-0 group-hover:opacity-60 hover:bg-bg-tertiary hover:!opacity-100"
                                                }`}
                                                title={isMaster ? "Снять статус мастера" : "Назначить мастером"}
                                            >
                                                <Crown size={10} />
                                            </button>

                                            {/* Bind to master */}
                                            {!isMaster && hasMasterFormat && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setBindModalFormatId(resize.id);
                                                    }}
                                                    className={`p-0.5 rounded-[var(--radius-sm)] transition-all cursor-pointer ${
                                                        isBound
                                                            ? "text-accent-primary hover:bg-bg-tertiary"
                                                            : "text-text-tertiary opacity-0 group-hover:opacity-60 hover:bg-bg-tertiary hover:!opacity-100"
                                                    }`}
                                                    title={isBound ? `Настроить привязку (${resize.layerBindings!.length})` : "Привязать к мастеру"}
                                                >
                                                    <Settings2 size={10} />
                                                </button>
                                            )}
                                        </>
                                    )}

                                    {/* Legacy Link/Unlink */}
                                    {isLegacy && resize.id !== "master" && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleInstanceMode(resize.id);
                                            }}
                                            className={`p-0.5 rounded-[var(--radius-sm)] transition-all cursor-pointer ${resize.instancesEnabled
                                                ? "text-accent-primary hover:bg-bg-tertiary"
                                                : "text-text-tertiary opacity-60 hover:bg-bg-tertiary hover:opacity-100"
                                            }`}
                                            title={resize.instancesEnabled ? "Связан с мастером (контент)" : "Отвязан от мастера"}
                                        >
                                            {resize.instancesEnabled ? <Link size={10} /> : <Unlink size={10} />}
                                        </button>
                                    )}

                                    {/* Delete */}
                                    {resize.id !== "master" && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                removeResize(resize.id);
                                            }}
                                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded-[var(--radius-sm)] hover:bg-bg-tertiary transition-opacity cursor-pointer"
                                            title="Удалить формат"
                                        >
                                            <Trash2 size={10} className="text-text-tertiary" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Inline size editing (appears below the item when active) */}
                            {isEditingSize && (
                                <div
                                    className="mx-2 mt-1 p-2 bg-bg-secondary rounded-[var(--radius-lg)] border border-border-primary space-y-2"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="flex items-center gap-1 text-[9px] text-text-tertiary uppercase tracking-wider font-medium">
                                        <Maximize2 size={9} />
                                        Размер артборда
                                    </div>
                                    <div className="flex gap-1.5 items-center">
                                        <input
                                            value={editWidth}
                                            onChange={(e) => setEditWidth(e.target.value.replace(/\D/g, ""))}
                                            autoFocus
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") handleConfirmResize();
                                                if (e.key === "Escape") setEditingSizeId(null);
                                                e.stopPropagation();
                                            }}
                                            className="min-w-0 flex-1 h-6 px-2 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                                            placeholder="W"
                                        />
                                        <span className="text-[10px] text-text-tertiary">×</span>
                                        <input
                                            value={editHeight}
                                            onChange={(e) => setEditHeight(e.target.value.replace(/\D/g, ""))}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") handleConfirmResize();
                                                if (e.key === "Escape") setEditingSizeId(null);
                                                e.stopPropagation();
                                            }}
                                            className="min-w-0 flex-1 h-6 px-2 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                                            placeholder="H"
                                        />
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={handleConfirmResize}
                                            className="flex-1 flex items-center justify-center gap-1 h-6 rounded-[var(--radius-md)] bg-accent-primary text-text-inverse text-[10px] font-medium hover:bg-accent-primary-hover transition-colors cursor-pointer"
                                        >
                                            <Check size={10} />
                                            Применить
                                        </button>
                                        <button
                                            onClick={() => setEditingSizeId(null)}
                                            className="h-6 px-2 rounded-[var(--radius-md)] border border-border-primary text-text-tertiary text-[10px] hover:bg-bg-tertiary hover:text-text-primary transition-colors cursor-pointer"
                                        >
                                            <X size={10} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Context Menu — uses the shared ContextMenu component with createPortal */}
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    items={buildFormatContextMenuItems(contextMenu.resizeId)}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* Phase 2: Bind to Master Modal */}
            {bindModalFormatId && (
                <BindToMasterModal
                    formatId={bindModalFormatId}
                    onClose={() => setBindModalFormatId(null)}
                />
            )}
        </div>
    );
}
