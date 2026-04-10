"use client";

import { Plus, Trash2, Check, Link, Unlink, X, Copy, FileText, Crown, Settings2 } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import { useState, useRef } from "react";
import { cloneLayerTree } from "@/utils/cloneLayerTree";
import { BindToMasterModal } from "./BindToMasterModal";

export function ResizePanel() {
    const {
        resizes,
        activeResizeId,
        setActiveResize,
        addResize,
        removeResize,
        toggleInstanceMode,
        renameResize,
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

    // Phase 2: Bind modal state
    const [bindModalFormatId, setBindModalFormatId] = useState<string | null>(null);

    const hasMasterFormat = resizes.some(r => r.isMaster);

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
        <div className="flex flex-col h-full">
            {/* Top Add Format form (collapsible) */}
            {showAddForm && (
                <div className="p-3 border-b border-border-primary space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
                            Новый формат
                        </span>
                        <button
                            onClick={() => setShowAddForm(false)}
                            className="p-0.5 rounded-[var(--radius-sm)] hover:bg-bg-tertiary cursor-pointer"
                        >
                            <X size={12} className="text-text-tertiary" />
                        </button>
                    </div>
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

            <div className="flex-1 overflow-y-auto p-2">
                {resizes.map((resize) => {
                    const isActive = activeResizeId === resize.id;
                    const isMaster = resize.isMaster === true;
                    const isBound = (resize.layerBindings?.length ?? 0) > 0;
                    const isSnapshot = resize.layerSnapshot !== undefined;
                    const isLegacy = !isSnapshot && masterComponents.length > 0;

                    return (
                        <div
                            key={resize.id}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setActiveResize(resize.id);
                                }
                            }}
                            onClick={() => setActiveResize(resize.id)}
                            className={`
                                w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-lg)] mb-1
                                transition-all cursor-pointer text-left group
                                ${isActive
                                    ? "bg-bg-tertiary border border-border-primary shadow-[var(--shadow-sm)]"
                                    : "hover:bg-bg-secondary border border-transparent"
                                }
                            `}
                        >
                            <div
                                className="shrink-0 border border-border-secondary rounded-[3px] bg-bg-secondary"
                                style={{
                                    width: Math.max(16, Math.min(28, resize.width / 40)),
                                    height: Math.max(16, Math.min(28, resize.height / 40)),
                                }}
                            />
                            <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-medium text-text-primary truncate flex items-center gap-1.5">
                                    {/* Master crown icon */}
                                    {isMaster && (
                                        <Crown size={11} className="text-amber-400 shrink-0" />
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
                                            onDoubleClick={(e) => {
                                                e.stopPropagation();
                                                setEditingId(resize.id);
                                                setEditingName(resize.name);
                                            }}
                                            title="Двойной клик для переименования"
                                        >
                                            {resize.name}
                                        </span>
                                    )}
                                </div>
                                <div className="text-[10px] text-text-tertiary font-light flex items-center gap-1">
                                    {resize.label}
                                    {isBound && (
                                        <span className="text-accent-primary">
                                            · {resize.layerBindings!.length} связей
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Active check */}
                            {isActive && (
                                <Check size={12} className="text-accent-primary shrink-0" />
                            )}

                            {/* Phase 2: Master/Bind controls for snapshot formats */}
                            {isSnapshot && resize.id !== "master" && (
                                <div className="flex items-center gap-0.5">
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
                                        className={`p-1 rounded-[var(--radius-sm)] transition-all cursor-pointer ${
                                            isMaster
                                                ? "text-amber-400 hover:bg-bg-tertiary"
                                                : "text-text-tertiary opacity-0 group-hover:opacity-60 hover:bg-bg-tertiary hover:!opacity-100"
                                        }`}
                                        title={isMaster ? "Снять статус мастера" : "Назначить мастером"}
                                    >
                                        <Crown size={11} />
                                    </button>

                                    {/* Bind to master (only if not master itself and a master exists) */}
                                    {!isMaster && hasMasterFormat && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setBindModalFormatId(resize.id);
                                            }}
                                            className={`p-1 rounded-[var(--radius-sm)] transition-all cursor-pointer ${
                                                isBound
                                                    ? "text-accent-primary hover:bg-bg-tertiary"
                                                    : "text-text-tertiary opacity-0 group-hover:opacity-60 hover:bg-bg-tertiary hover:!opacity-100"
                                            }`}
                                            title={isBound ? `Настроить привязку (${resize.layerBindings!.length} связей)` : "Привязать к мастеру"}
                                        >
                                            <Settings2 size={11} />
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Legacy Link/Unlink for non-snapshot formats */}
                            {isLegacy && resize.id !== "master" && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleInstanceMode(resize.id);
                                    }}
                                    className={`p-1 rounded-[var(--radius-sm)] transition-all cursor-pointer ${resize.instancesEnabled
                                        ? "text-accent-primary hover:bg-bg-tertiary"
                                        : "text-text-tertiary opacity-60 hover:bg-bg-tertiary hover:opacity-100"
                                    }`}
                                    title={resize.instancesEnabled ? "Связан с мастером (контент)" : "Отвязан от мастера"}
                                >
                                    {resize.instancesEnabled ? <Link size={11} /> : <Unlink size={11} />}
                                </button>
                            )}

                            {/* Delete */}
                            {resize.id !== "master" && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeResize(resize.id);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-1 rounded-[var(--radius-sm)] hover:bg-bg-tertiary transition-opacity cursor-pointer"
                                    title="Удалить формат"
                                >
                                    <Trash2 size={11} className="text-text-tertiary" />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Bottom "Add Format" persistent button */}
            <div className="p-3 border-t border-border-primary">
                <button
                    onClick={() => setShowAddForm(true)}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-[var(--radius-lg)] border border-dashed border-border-secondary text-[11px] font-medium text-text-secondary hover:text-text-primary hover:border-border-primary hover:bg-bg-secondary transition-all cursor-pointer"
                >
                    <Plus size={13} />
                    Добавить формат
                </button>
            </div>

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
