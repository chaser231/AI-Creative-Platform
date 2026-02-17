"use client";

import { Monitor, Plus, Trash2, Check, Link, Unlink } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { PRESET_FORMATS, FORMAT_PACKS } from "@/types";
import type { ResizeFormat } from "@/types";
import { useState, useRef } from "react";

export function ResizePanel() {
    const {
        resizes,
        activeResizeId,
        setActiveResize,
        addResize,
        removeResize,
        toggleInstanceMode,
        renameResize,
    } = useCanvasStore();
    const [showPresets, setShowPresets] = useState(false);
    const [showCustom, setShowCustom] = useState(false);
    const [customName, setCustomName] = useState("");
    const [customWidth, setCustomWidth] = useState("1200");
    const [customHeight, setCustomHeight] = useState("628");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState("");
    const renameRef = useRef<HTMLInputElement>(null);

    const availablePresets = PRESET_FORMATS.filter(
        (p) => !resizes.some((r) => r.id === p.id)
    );

    const handleAddCustom = () => {
        if (!customName.trim()) return;
        const width = Number(customWidth) || 1200;
        const height = Number(customHeight) || 628;
        addResize({
            id: `custom-${Date.now()}`,
            name: customName.trim(),
            width,
            height,
            label: `${width} × ${height}`,
            instancesEnabled: true,
        });
        setCustomName("");
        setCustomWidth("1200");
        setCustomHeight("628");
        setShowCustom(false);
    };

    return (
        <div className="w-[240px] min-w-[240px] h-full border border-border-primary rounded-[var(--radius-2xl)] shadow-[var(--shadow-md)] flex flex-col overflow-hidden backdrop-blur-xl bg-bg-surface/85">
            <div className="p-4 border-b border-border-primary flex items-center justify-between">
                <h3 className="text-[11px] font-medium text-text-tertiary uppercase tracking-widest">
                    Форматы
                </h3>
                <button
                    onClick={() => { setShowPresets(!showPresets); setShowCustom(false); }}
                    className="p-1.5 rounded-[var(--radius-md)] hover:bg-bg-secondary transition-colors cursor-pointer"
                    title="Добавить формат"
                >
                    <Plus size={14} className="text-text-secondary" />
                </button>
            </div>

            {showPresets && (
                <div className="p-2 border-b border-border-primary bg-bg-secondary">
                    <p className="text-[10px] text-text-tertiary mb-2 px-2 font-light">Добавить пресет:</p>
                    {availablePresets.map((preset) => (
                        <button
                            key={preset.id}
                            onClick={() => {
                                addResize(preset);
                                setShowPresets(false);
                            }}
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-md)] hover:bg-bg-primary transition-colors cursor-pointer text-left"
                        >
                            <Monitor size={11} className="text-text-tertiary shrink-0" />
                            <span className="text-[11px] text-text-primary">{preset.name}</span>
                            <span className="text-[10px] text-text-tertiary ml-auto font-light">{preset.label}</span>
                        </button>
                    ))}

                    {/* Format packs */}
                    <div className="mt-2 pt-2 border-t border-border-primary">
                        <p className="text-[10px] text-text-tertiary mb-1.5 px-2 font-light">Паки форматов:</p>
                        <div className="flex flex-wrap gap-1 px-1">
                            {FORMAT_PACKS.map((pack) => {
                                const packFormats = PRESET_FORMATS.filter((p) => pack.formatIds.includes(p.id));
                                const alreadyAdded = packFormats.every((pf) => resizes.some((r) => r.id === pf.id));
                                return (
                                    <button
                                        key={pack.id}
                                        disabled={alreadyAdded}
                                        onClick={() => {
                                            packFormats
                                                .filter((pf) => !resizes.some((r) => r.id === pf.id))
                                                .forEach((pf) => addResize(pf));
                                        }}
                                        className={`px-2.5 py-1 rounded-[var(--radius-full)] text-[10px] font-medium border transition-colors cursor-pointer ${alreadyAdded
                                                ? "border-border-primary text-text-tertiary opacity-50 cursor-not-allowed"
                                                : "border-accent-primary/30 text-accent-primary hover:bg-accent-primary/5"
                                            }`}
                                        title={pack.description}
                                    >
                                        {pack.name}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* New custom format */}
                    <div className="mt-2 pt-2 border-t border-border-primary">
                        {!showCustom ? (
                            <button
                                onClick={() => setShowCustom(true)}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-md)] hover:bg-bg-primary transition-colors cursor-pointer text-left text-[11px] text-accent-primary font-medium"
                            >
                                <Plus size={11} />
                                Свой формат
                            </button>
                        ) : (
                            <div className="space-y-2 px-1">
                                <input
                                    type="text"
                                    placeholder="Название"
                                    value={customName}
                                    onChange={(e) => setCustomName(e.target.value)}
                                    className="w-full h-7 px-2 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary text-[11px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border-focus"
                                />
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        placeholder="W"
                                        value={customWidth}
                                        onChange={(e) => setCustomWidth(e.target.value)}
                                        className="flex-1 h-7 px-2 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary text-[11px] text-text-primary text-center focus:outline-none"
                                    />
                                    <span className="text-[10px] text-text-tertiary">×</span>
                                    <input
                                        type="number"
                                        placeholder="H"
                                        value={customHeight}
                                        onChange={(e) => setCustomHeight(e.target.value)}
                                        className="flex-1 h-7 px-2 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary text-[11px] text-text-primary text-center focus:outline-none"
                                    />
                                </div>
                                <button
                                    onClick={handleAddCustom}
                                    className="w-full h-7 rounded-[var(--radius-md)] bg-accent-primary text-text-inverse text-[11px] font-medium hover:bg-accent-primary-hover transition-colors cursor-pointer"
                                >
                                    Добавить
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-2">
                {resizes.map((resize) => (
                    <button
                        key={resize.id}
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
                                {resize.id === "master" && (
                                    <span className="text-[8px] font-semibold bg-accent-primary text-white px-1.5 py-0.5 rounded-full">
                                        MASTER
                                    </span>
                                )}
                            </div>
                            <div className="text-[10px] text-text-tertiary font-light">{resize.label}</div>
                        </div>
                        {activeResizeId === resize.id && (
                            <Check size={12} className="text-accent-primary shrink-0" />
                        )}
                        {resize.id !== "master" && (
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
                    </button>
                ))}
            </div>

            {/* Bottom "Add Format" persistent button */}
            <div className="p-3 border-t border-border-primary">
                <button
                    onClick={() => { setShowPresets(true); setShowCustom(false); }}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-[var(--radius-lg)] border border-dashed border-border-secondary text-[11px] font-medium text-text-secondary hover:text-text-primary hover:border-border-primary hover:bg-bg-secondary transition-all cursor-pointer"
                >
                    <Plus size={13} />
                    Добавить формат
                </button>
            </div>
        </div>
    );
}
