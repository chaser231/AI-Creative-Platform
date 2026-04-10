"use client";

import { Plus, Trash2, Check, Link, Unlink, X, Copy, FileText } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import { useState, useRef } from "react";
import { cloneLayerTree } from "@/utils/cloneLayerTree";

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
    } = useCanvasStore(useShallow((s) => ({
        resizes: s.resizes, activeResizeId: s.activeResizeId,
        setActiveResize: s.setActiveResize, addResize: s.addResize,
        removeResize: s.removeResize, toggleInstanceMode: s.toggleInstanceMode,
        renameResize: s.renameResize,
        layers: s.layers,
        masterComponents: s.masterComponents,
    })));
    const [showAddForm, setShowAddForm] = useState(false);
    const [customName, setCustomName] = useState("");
    const [customWidth, setCustomWidth] = useState("1200");
    const [customHeight, setCustomHeight] = useState("628");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState("");
    const renameRef = useRef<HTMLInputElement>(null);

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
            instancesEnabled: true,
            layerSnapshot: mode === "clone" ? cloneLayerTree(layers) : [],
        };

        addResize(format);
        setCustomName("");
        setCustomWidth("1200");
        setCustomHeight("628");
        setShowAddForm(false);
    };

    return (
        <div className="w-[240px] min-w-[240px] h-full border border-border-primary rounded-[var(--radius-2xl)] shadow-[var(--shadow-md)] flex flex-col overflow-hidden backdrop-blur-xl bg-bg-surface/85">
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

            {showAddForm && (
                <div className="p-3 border-b border-border-primary bg-bg-secondary space-y-2">
                    <input
                        type="text"
                        placeholder="Название"
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        className="w-full h-7 px-2 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary text-[11px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border-focus"
                        autoFocus
                    />
                    <div className="flex items-center gap-1.5">
                        <input
                            type="number"
                            placeholder="W"
                            value={customWidth}
                            onChange={(e) => setCustomWidth(e.target.value)}
                            className="min-w-0 flex-1 h-7 px-2 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                        />
                        <span className="text-[10px] text-text-tertiary shrink-0">×</span>
                        <input
                            type="number"
                            placeholder="H"
                            value={customHeight}
                            onChange={(e) => setCustomHeight(e.target.value)}
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
                {resizes.map((resize) => (
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
                            ${activeResizeId === resize.id
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
                            <div className="text-[10px] text-text-tertiary font-light">{resize.label}</div>
                        </div>
                        {activeResizeId === resize.id && (
                            <Check size={12} className="text-accent-primary shrink-0" />
                        )}
                        {/* Link/Unlink only for legacy (non-snapshot) formats */}
                        {resize.id !== "master" && resize.layerSnapshot === undefined && masterComponents.length > 0 && (
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
                ))}
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
        </div>
    );
}
