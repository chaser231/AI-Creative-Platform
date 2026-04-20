"use client";

import { useState, useRef, useMemo } from "react";
import { Plus, Trash2, Pencil, Palette, Image as ImageIcon, Upload, X, Check } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import { uploadForAI } from "@/utils/imageUpload";
import type { Swatch, BackgroundSwatchValue } from "@/types";

type Tab = "colors" | "backgrounds";

/**
 * Right-panel tab that exposes the template palette:
 *  - Colors: hex swatches applied to layer fills/strokes
 *  - Backgrounds: solid or image swatches applied to the artboard
 *
 * Clicking a swatch applies it to the current selection (or artboard when
 * nothing is selected). Hovering exposes rename/delete affordances.
 */
export function SwatchesPanel() {
    const {
        palette,
        selectedLayerIds,
        layers,
        addSwatch,
        updateSwatch,
        removeSwatch,
        applyColorSwatchToLayer,
        applyBackgroundSwatchToArtboard,
        applyBackgroundSwatchToImageLayer,
    } = useCanvasStore(useShallow((s) => ({
        palette: s.palette,
        selectedLayerIds: s.selectedLayerIds,
        layers: s.layers,
        addSwatch: s.addSwatch,
        updateSwatch: s.updateSwatch,
        removeSwatch: s.removeSwatch,
        applyColorSwatchToLayer: s.applyColorSwatchToLayer,
        applyBackgroundSwatchToArtboard: s.applyBackgroundSwatchToArtboard,
        applyBackgroundSwatchToImageLayer: s.applyBackgroundSwatchToImageLayer,
    })));

    const [tab, setTab] = useState<Tab>("colors");
    const [adding, setAdding] = useState(false);
    const [newColor, setNewColor] = useState("#4F46E5");
    const [newName, setNewName] = useState("");
    const [newSolid, setNewSolid] = useState("#FFFFFF");
    const [newBgMode, setNewBgMode] = useState<"solid" | "image">("solid");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState("");
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const swatches = tab === "colors" ? palette.colors : palette.backgrounds;

    const hasSelection = selectedLayerIds.length > 0;
    const singleSelectedLayer = selectedLayerIds.length === 1
        ? layers.find((l) => l.id === selectedLayerIds[0])
        : null;

    const otherBackgrounds = useMemo(
        () => palette.backgrounds.filter((sw) => sw.id !== deletingId),
        [palette.backgrounds, deletingId],
    );
    const otherColors = useMemo(
        () => palette.colors.filter((sw) => sw.id !== deletingId),
        [palette.colors, deletingId],
    );

    const handleSwatchClick = (swatch: Swatch) => {
        if (swatch.type === "color") {
            if (!hasSelection) return;
            for (const id of selectedLayerIds) {
                applyColorSwatchToLayer(id, swatch.id, "fill");
            }
            return;
        }
        // Background swatch
        const v = swatch.value as BackgroundSwatchValue;
        if (singleSelectedLayer?.type === "image" && v.kind === "image") {
            // Apply to selected image layer with swatch link so future edits cascade.
            applyBackgroundSwatchToImageLayer(singleSelectedLayer.id, swatch.id);
            return;
        }
        applyBackgroundSwatchToArtboard(swatch.id);
    };

    const resetAddForm = () => {
        setAdding(false);
        setNewName("");
        setNewColor("#4F46E5");
        setNewSolid("#FFFFFF");
        setNewBgMode("solid");
    };

    const handleAddColor = () => {
        const name = newName.trim() || `Цвет ${palette.colors.length + 1}`;
        addSwatch({ type: "color", name, value: newColor });
        resetAddForm();
    };

    const handleAddBgSolid = () => {
        const name = newName.trim() || `Фон ${palette.backgrounds.length + 1}`;
        addSwatch({
            type: "background",
            name,
            value: { kind: "solid", color: newSolid },
        });
        resetAddForm();
    };

    const handleBgImagePick = async (file: File) => {
        setUploading(true);
        try {
            const reader = new FileReader();
            const base64: string = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });
            const src = await uploadForAI(base64, "swatch-bg");
            const name = newName.trim() || `Фон ${palette.backgrounds.length + 1}`;
            addSwatch({
                type: "background",
                name,
                value: { kind: "image", src, fit: "cover", focusX: 0.5, focusY: 0.5 },
            });
            resetAddForm();
        } catch (err) {
            console.error("[SwatchesPanel] upload failed", err);
        } finally {
            setUploading(false);
        }
    };

    const renderSwatch = (swatch: Swatch) => {
        const isEditing = editingId === swatch.id;
        const preview = renderSwatchPreview(swatch);

        return (
            <div
                key={swatch.id}
                className="group relative aspect-square"
            >
                <button
                    onClick={() => handleSwatchClick(swatch)}
                    onDoubleClick={() => {
                        setEditingId(swatch.id);
                        setEditingName(swatch.name);
                    }}
                    title={swatch.name}
                    className="w-full h-full rounded-[var(--radius-md)] overflow-hidden border border-border-primary hover:border-accent-primary transition-colors cursor-pointer"
                >
                    {preview}
                </button>
                <div className="absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(swatch.id);
                            setEditingName(swatch.name);
                        }}
                        title="Переименовать"
                        className="p-0.5 rounded-[var(--radius-sm)] bg-bg-surface/90 border border-border-primary hover:bg-bg-tertiary text-text-secondary hover:text-text-primary cursor-pointer"
                    >
                        <Pencil size={9} />
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setDeletingId(swatch.id);
                        }}
                        title="Удалить"
                        className="p-0.5 rounded-[var(--radius-sm)] bg-bg-surface/90 border border-border-primary hover:bg-red-500/10 hover:border-red-500/30 text-text-secondary hover:text-red-500 cursor-pointer"
                    >
                        <Trash2 size={9} />
                    </button>
                </div>
                {isEditing && (
                    <div className="absolute inset-x-0 -bottom-9 z-10">
                        <input
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={() => {
                                const name = editingName.trim();
                                if (name && name !== swatch.name) {
                                    updateSwatch(swatch.id, { name });
                                }
                                setEditingId(null);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    const name = editingName.trim();
                                    if (name && name !== swatch.name) {
                                        updateSwatch(swatch.id, { name });
                                    }
                                    setEditingId(null);
                                }
                                if (e.key === "Escape") setEditingId(null);
                                e.stopPropagation();
                            }}
                            className="w-full h-6 px-1.5 rounded-[var(--radius-sm)] border border-border-focus bg-bg-primary text-[10px] text-text-primary focus:outline-none"
                        />
                    </div>
                )}
            </div>
        );
    };

    const gridCols = tab === "colors" ? "grid-cols-8" : "grid-cols-4";

    return (
        <div className="w-[240px] min-w-[240px] h-full border border-border-primary rounded-[var(--radius-2xl)] shadow-[var(--shadow-md)] flex flex-col overflow-hidden backdrop-blur-xl bg-bg-surface/85">
            <div className="p-3 border-b border-border-primary flex items-center gap-1">
                <button
                    onClick={() => setTab("colors")}
                    className={`flex-1 flex items-center justify-center gap-1.5 h-7 rounded-[var(--radius-md)] text-[11px] font-medium transition-colors cursor-pointer ${tab === "colors"
                        ? "bg-bg-tertiary text-text-primary border border-border-primary"
                        : "text-text-tertiary hover:text-text-primary"
                        }`}
                >
                    <Palette size={11} />
                    Цвета
                </button>
                <button
                    onClick={() => setTab("backgrounds")}
                    className={`flex-1 flex items-center justify-center gap-1.5 h-7 rounded-[var(--radius-md)] text-[11px] font-medium transition-colors cursor-pointer ${tab === "backgrounds"
                        ? "bg-bg-tertiary text-text-primary border border-border-primary"
                        : "text-text-tertiary hover:text-text-primary"
                        }`}
                >
                    <ImageIcon size={11} />
                    Фоны
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
                {swatches.length === 0 && !adding && (
                    <div className="text-[11px] text-text-tertiary text-center py-4">
                        {tab === "colors" ? "Нет цветов в палитре" : "Нет фонов в палитре"}
                    </div>
                )}

                <div className={`grid ${gridCols} gap-1.5`}>
                    {swatches.map(renderSwatch)}
                    {!adding && (
                        <button
                            onClick={() => setAdding(true)}
                            title={tab === "colors" ? "Добавить цвет" : "Добавить фон"}
                            className="aspect-square flex items-center justify-center rounded-[var(--radius-md)] border border-dashed border-border-primary text-text-tertiary hover:text-text-primary hover:border-accent-primary hover:bg-bg-secondary transition-colors cursor-pointer"
                        >
                            <Plus size={14} />
                        </button>
                    )}
                </div>

                {adding && (
                    <div className="mt-3 p-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary space-y-2">
                        <input
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="Название (необязательно)"
                            className="w-full h-7 px-2 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary text-[11px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border-focus"
                        />

                        {tab === "colors" && (
                            <>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={newColor}
                                        onChange={(e) => setNewColor(e.target.value)}
                                        className="w-10 h-8 rounded-[var(--radius-sm)] border border-border-primary cursor-pointer"
                                    />
                                    <input
                                        value={newColor}
                                        onChange={(e) => setNewColor(e.target.value)}
                                        className="flex-1 h-8 px-2 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                                    />
                                </div>
                                <div className="flex gap-1.5">
                                    <button
                                        onClick={handleAddColor}
                                        className="flex-1 flex items-center justify-center gap-1 h-7 rounded-[var(--radius-md)] bg-accent-primary text-text-inverse text-[11px] font-medium hover:bg-accent-primary-hover transition-colors cursor-pointer"
                                    >
                                        <Check size={11} />
                                        Добавить
                                    </button>
                                    <button
                                        onClick={resetAddForm}
                                        className="h-7 px-2 rounded-[var(--radius-md)] border border-border-primary text-text-tertiary text-[11px] hover:bg-bg-tertiary hover:text-text-primary transition-colors cursor-pointer"
                                    >
                                        <X size={11} />
                                    </button>
                                </div>
                            </>
                        )}

                        {tab === "backgrounds" && (
                            <>
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => setNewBgMode("solid")}
                                        className={`flex-1 h-7 rounded-[var(--radius-sm)] text-[10px] font-medium cursor-pointer ${newBgMode === "solid"
                                            ? "bg-accent-primary text-text-inverse"
                                            : "border border-border-primary text-text-tertiary hover:text-text-primary"
                                            }`}
                                    >
                                        Цвет
                                    </button>
                                    <button
                                        onClick={() => setNewBgMode("image")}
                                        className={`flex-1 h-7 rounded-[var(--radius-sm)] text-[10px] font-medium cursor-pointer ${newBgMode === "image"
                                            ? "bg-accent-primary text-text-inverse"
                                            : "border border-border-primary text-text-tertiary hover:text-text-primary"
                                            }`}
                                    >
                                        Картинка
                                    </button>
                                </div>

                                {newBgMode === "solid" && (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="color"
                                                value={newSolid}
                                                onChange={(e) => setNewSolid(e.target.value)}
                                                className="w-10 h-8 rounded-[var(--radius-sm)] border border-border-primary cursor-pointer"
                                            />
                                            <input
                                                value={newSolid}
                                                onChange={(e) => setNewSolid(e.target.value)}
                                                className="flex-1 h-8 px-2 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                                            />
                                        </div>
                                        <div className="flex gap-1.5">
                                            <button
                                                onClick={handleAddBgSolid}
                                                className="flex-1 flex items-center justify-center gap-1 h-7 rounded-[var(--radius-md)] bg-accent-primary text-text-inverse text-[11px] font-medium hover:bg-accent-primary-hover transition-colors cursor-pointer"
                                            >
                                                <Check size={11} />
                                                Добавить
                                            </button>
                                            <button
                                                onClick={resetAddForm}
                                                className="h-7 px-2 rounded-[var(--radius-md)] border border-border-primary text-text-tertiary text-[11px] hover:bg-bg-tertiary hover:text-text-primary transition-colors cursor-pointer"
                                            >
                                                <X size={11} />
                                            </button>
                                        </div>
                                    </>
                                )}

                                {newBgMode === "image" && (
                                    <>
                                        <input
                                            ref={fileRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(e) => {
                                                const f = e.target.files?.[0];
                                                if (f) void handleBgImagePick(f);
                                                e.target.value = "";
                                            }}
                                        />
                                        <button
                                            disabled={uploading}
                                            onClick={() => fileRef.current?.click()}
                                            className="w-full flex items-center justify-center gap-1.5 h-8 rounded-[var(--radius-md)] border border-dashed border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-tertiary text-[11px] cursor-pointer disabled:opacity-50"
                                        >
                                            <Upload size={11} />
                                            {uploading ? "Загрузка..." : "Загрузить файл"}
                                        </button>
                                        <button
                                            onClick={resetAddForm}
                                            className="w-full h-7 rounded-[var(--radius-md)] border border-border-primary text-text-tertiary text-[11px] hover:bg-bg-tertiary hover:text-text-primary transition-colors cursor-pointer"
                                        >
                                            Отмена
                                        </button>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            {deletingId && (
                <DeleteSwatchModal
                    swatchId={deletingId}
                    swatch={
                        palette.colors.find((s) => s.id === deletingId)
                        ?? palette.backgrounds.find((s) => s.id === deletingId)
                    }
                    otherSwatches={tab === "colors" ? otherColors : otherBackgrounds}
                    onClose={() => setDeletingId(null)}
                    onConfirm={(mode, replaceWithId) => {
                        removeSwatch(deletingId, mode, replaceWithId);
                        setDeletingId(null);
                    }}
                />
            )}
        </div>
    );
}

// ─── Swatch Preview ──────────────────────────────────────────────────────

function renderSwatchPreview(swatch: Swatch) {
    if (swatch.type === "color") {
        const color = typeof swatch.value === "string" ? swatch.value : "#000000";
        return <div className="w-full h-full" style={{ background: color }} />;
    }
    const v = swatch.value as BackgroundSwatchValue;
    if (v.kind === "solid") {
        return <div className="w-full h-full" style={{ background: v.color }} />;
    }
    return (
        <div
            className="w-full h-full bg-cover bg-center"
            style={{ backgroundImage: `url(${v.src})` }}
        />
    );
}

// ─── Delete Modal ────────────────────────────────────────────────────────

interface DeleteSwatchModalProps {
    swatchId: string;
    swatch: Swatch | undefined;
    otherSwatches: Swatch[];
    onClose: () => void;
    onConfirm: (mode: "detach" | "replace", replaceWithId?: string) => void;
}

function DeleteSwatchModal({ swatch, otherSwatches, onClose, onConfirm }: DeleteSwatchModalProps) {
    const [mode, setMode] = useState<"detach" | "replace">("detach");
    const [replaceWithId, setReplaceWithId] = useState<string>(otherSwatches[0]?.id ?? "");

    if (!swatch) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div
                className="w-[360px] bg-bg-surface border border-border-primary rounded-[var(--radius-2xl)] shadow-[var(--shadow-xl)] p-5 space-y-4"
                onClick={(e) => e.stopPropagation()}
            >
                <div>
                    <h4 className="text-sm font-semibold text-text-primary">Удалить «{swatch.name}»?</h4>
                    <p className="text-[11px] text-text-tertiary mt-1">
                        Что сделать со слоями, которые используют этот образец?
                    </p>
                </div>

                <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="radio"
                            checked={mode === "detach"}
                            onChange={() => setMode("detach")}
                            className="accent-accent-primary"
                        />
                        <span className="text-[12px] text-text-primary">Отвязать (оставить текущие цвета)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="radio"
                            checked={mode === "replace"}
                            onChange={() => setMode("replace")}
                            disabled={otherSwatches.length === 0}
                            className="accent-accent-primary"
                        />
                        <span className={`text-[12px] ${otherSwatches.length === 0 ? "text-text-tertiary" : "text-text-primary"}`}>
                            Заменить другим образцом
                        </span>
                    </label>
                    {mode === "replace" && otherSwatches.length > 0 && (
                        <select
                            value={replaceWithId}
                            onChange={(e) => setReplaceWithId(e.target.value)}
                            className="w-full h-8 px-2 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
                        >
                            {otherSwatches.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    )}
                </div>

                <div className="flex gap-2 pt-2">
                    <button
                        onClick={() => onConfirm(mode, mode === "replace" ? replaceWithId : undefined)}
                        className="flex-1 h-9 rounded-[var(--radius-md)] bg-red-500 text-white text-[12px] font-medium hover:bg-red-600 transition-colors cursor-pointer"
                    >
                        Удалить
                    </button>
                    <button
                        onClick={onClose}
                        className="flex-1 h-9 rounded-[var(--radius-md)] border border-border-primary text-text-primary text-[12px] hover:bg-bg-tertiary transition-colors cursor-pointer"
                    >
                        Отмена
                    </button>
                </div>
            </div>
        </div>
    );
}

