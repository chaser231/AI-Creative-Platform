"use client";

import { useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Link2, Unlink2, Type, Palette, Move, Maximize2 } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import type { LayerBinding, Layer, ImageSyncMode } from "@/types";
import { migrateLegacyBinding } from "@/types";

interface BindToMasterModalProps {
    formatId: string;
    onClose: () => void;
}

/* ─── Sync Flag Definitions ───────────────────────────── */

interface SyncFlag {
    key: keyof Pick<LayerBinding, 'syncContent' | 'syncStyle' | 'syncSize' | 'syncPosition'>;
    label: string;
    shortLabel: string;
    icon: React.ReactNode;
    description: string;
}

const SYNC_FLAGS: SyncFlag[] = [
    { key: "syncContent",  label: "Содержимое", shortLabel: "Содерж.", icon: <Type size={10} />,     description: "Текст, изображения" },
    { key: "syncStyle",    label: "Стили",      shortLabel: "Стили",   icon: <Palette size={10} />,  description: "Цвета, шрифты" },
    { key: "syncSize",     label: "Размер",     shortLabel: "Размер",  icon: <Maximize2 size={10} />,description: "Ширина, высота" },
    { key: "syncPosition", label: "Позиция",    shortLabel: "Позиция", icon: <Move size={10} />,     description: "X, Y, поворот" },
];

/* ─── Quick Presets ────────────────────────────────────── */

interface SyncPreset {
    label: string;
    syncContent: boolean;
    syncStyle: boolean;
    syncSize: boolean;
    syncPosition: boolean;
}

const PRESETS: SyncPreset[] = [
    { label: "Содержимое",         syncContent: true,  syncStyle: false, syncSize: false, syncPosition: false },
    { label: "Содержимое + размер",syncContent: true,  syncStyle: false, syncSize: true,  syncPosition: false },
    { label: "Полная синхронизация",syncContent: true,  syncStyle: true,  syncSize: true,  syncPosition: true },
];

/* ─── Toggle Chip ──────────────────────────────────────── */

function SyncChip({
    flag,
    active,
    disabled,
    onToggle,
}: {
    flag: SyncFlag;
    active: boolean;
    disabled: boolean;
    onToggle: () => void;
}) {
    return (
        <button
            onClick={onToggle}
            disabled={disabled}
            title={`${flag.label}: ${flag.description}`}
            className={`
                inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[9px] font-medium
                transition-all duration-[var(--transition-fast)] cursor-pointer border
                ${disabled ? "opacity-30 pointer-events-none" : ""}
                ${active
                    ? "bg-accent-primary/10 border-accent-primary/30 text-accent-primary"
                    : "bg-bg-surface border-border-primary text-text-tertiary hover:border-border-secondary hover:text-text-secondary"
                }
            `}
        >
            <span className={active ? "text-accent-primary" : "text-text-quaternary"}>{flag.icon}</span>
            {flag.shortLabel}
        </button>
    );
}

/* ─── Main Component ───────────────────────────────────── */

export function BindToMasterModal({ formatId, onClose }: BindToMasterModalProps) {
    const {
        resizes,
        setFormatBindings,
        unbindFormat,
        layers: currentLayers,
        activeResizeId,
    } = useCanvasStore(useShallow((s) => ({
        resizes: s.resizes,
        setFormatBindings: s.setFormatBindings,
        unbindFormat: s.unbindFormat,
        layers: s.layers,
        activeResizeId: s.activeResizeId,
    })));

    const targetFormat = resizes.find(r => r.id === formatId);
    const masterFormat = resizes.find(r => r.isMaster);

    // Get master layers (from snapshot or current layers if master is active)
    const masterLayers = useMemo(() => {
        if (!masterFormat) return [];
        if (masterFormat.id === activeResizeId) return currentLayers;
        return masterFormat.layerSnapshot ?? [];
    }, [masterFormat, activeResizeId, currentLayers]);

    // Get target format layers
    const targetLayers = useMemo(() => {
        if (!targetFormat) return [];
        if (targetFormat.id === activeResizeId) return currentLayers;
        return targetFormat.layerSnapshot ?? [];
    }, [targetFormat, activeResizeId, currentLayers]);

    // Initialize bindings from existing or auto-map by name
    const initialBindings = useMemo(() => {
        if (targetFormat?.layerBindings && targetFormat.layerBindings.length > 0) {
            // Auto-migrate legacy bindings
            return targetFormat.layerBindings.map(b => migrateLegacyBinding(b));
        }
        // Auto-map by name
        return autoMapByName(masterLayers, targetLayers);
    }, [targetFormat, masterLayers, targetLayers]);

    interface BindingRow {
        masterLayerId: string;
        masterLayerName: string;
        masterLayerType: string;
        targetLayerId: string;
        syncContent: boolean;
        syncStyle: boolean;
        syncSize: boolean;
        syncPosition: boolean;
        imageSyncMode?: ImageSyncMode;
        enabled: boolean;
    }

    const [bindings, setBindings] = useState<BindingRow[]>(() =>
        masterLayers.map(ml => {
            const existing = initialBindings.find(b => b.masterLayerId === ml.id);
            return {
                masterLayerId: ml.id,
                masterLayerName: ml.name,
                masterLayerType: ml.type,
                targetLayerId: existing?.targetLayerId ?? "",
                syncContent: existing?.syncContent ?? true,
                syncStyle: existing?.syncStyle ?? false,
                syncSize: existing?.syncSize ?? false,
                syncPosition: existing?.syncPosition ?? false,
                imageSyncMode: existing?.imageSyncMode
                    ?? (existing?.syncImageProportional === true ? "relative_full" : undefined)
                    ?? (ml.type === "image" ? "relative_size" : undefined),
                enabled: !!existing?.targetLayerId,
            };
        })
    );

    const handleToggle = useCallback((masterLayerId: string) => {
        setBindings(prev => prev.map(b =>
            b.masterLayerId === masterLayerId
                ? { ...b, enabled: !b.enabled }
                : b
        ));
    }, []);

    const handleTargetChange = useCallback((masterLayerId: string, targetLayerId: string) => {
        setBindings(prev => prev.map(b =>
            b.masterLayerId === masterLayerId
                ? { ...b, targetLayerId, enabled: !!targetLayerId }
                : b
        ));
    }, []);

    const handleFlagToggle = useCallback((masterLayerId: string, flag: SyncFlag['key']) => {
        setBindings(prev => prev.map(b =>
            b.masterLayerId === masterLayerId
                ? { ...b, [flag]: !b[flag] }
                : b
        ));
    }, []);

    const handleApplyPreset = useCallback((preset: SyncPreset) => {
        setBindings(prev => prev.map(b =>
            b.enabled && b.targetLayerId
                ? {
                    ...b,
                    syncContent: preset.syncContent,
                    syncStyle: preset.syncStyle,
                    syncSize: preset.syncSize,
                    syncPosition: preset.syncPosition,
                }
                : b
        ));
    }, []);

    const handleImageSyncModeChange = useCallback((masterLayerId: string, mode: ImageSyncMode) => {
        setBindings(prev => prev.map(b =>
            b.masterLayerId === masterLayerId ? { ...b, imageSyncMode: mode } : b
        ));
    }, []);

    const handleApply = () => {
        const activeBindings: LayerBinding[] = bindings
            .filter(b => b.enabled && b.targetLayerId)
            .map(b => ({
                masterLayerId: b.masterLayerId,
                targetLayerId: b.targetLayerId,
                syncContent: b.syncContent,
                syncStyle: b.syncStyle,
                syncSize: b.syncSize,
                syncPosition: b.syncPosition,
                imageSyncMode: b.imageSyncMode,
            }));

        if (activeBindings.length > 0) {
            setFormatBindings(formatId, activeBindings);
        } else {
            unbindFormat(formatId);
        }
        onClose();
    };

    const handleUnbindAll = () => {
        unbindFormat(formatId);
        onClose();
    };

    if (!masterFormat || !targetFormat) {
        onClose();
        return null;
    }

    const enabledCount = bindings.filter(b => b.enabled && b.targetLayerId).length;

    return createPortal(
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="w-[640px] max-h-[80vh] bg-bg-primary rounded-[var(--radius-xl)] border border-border-primary shadow-[var(--shadow-lg)] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
                    <div>
                        <h3 className="text-[14px] font-semibold text-text-primary">
                            Привязка к мастер-макету
                        </h3>
                        <p className="text-[11px] text-text-tertiary mt-0.5">
                            {masterFormat.name} ({masterFormat.label}) → {targetFormat.name} ({targetFormat.label})
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-[var(--radius-sm)] hover:bg-bg-tertiary cursor-pointer"
                    >
                        <X size={14} className="text-text-tertiary" />
                    </button>
                </div>

                {/* Quick presets */}
                <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border-primary bg-bg-secondary/50">
                    <span className="text-[10px] text-text-tertiary font-medium mr-1">Пресеты:</span>
                    {PRESETS.map(preset => (
                        <Button
                            key={preset.label}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleApplyPreset(preset)}
                            className="!h-6 !px-2.5 !text-[10px] !rounded-[var(--radius-md)]"
                        >
                            {preset.label}
                        </Button>
                    ))}
                </div>

                {/* Bindings list */}
                <div className="flex-1 overflow-y-auto px-5 py-3">
                    {/* Column headers */}
                    <div className="flex items-center gap-3 px-2 py-1.5 text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">
                        <div className="w-5" />
                        <div className="flex-1">Слой мастера</div>
                        <div className="w-px h-3 bg-border-secondary" />
                        <div className="flex-1">Слой формата</div>
                        <div className="w-[180px] text-right">Синхронизация</div>
                    </div>

                    <div className="space-y-1">
                        {bindings.map((row) => (
                            <div
                                key={row.masterLayerId}
                                className={`flex items-center gap-3 px-2 py-2 rounded-[var(--radius-md)] transition-colors ${
                                    row.enabled ? "bg-bg-secondary" : "opacity-50"
                                }`}
                            >
                                {/* Toggle */}
                                <button
                                    onClick={() => handleToggle(row.masterLayerId)}
                                    className="w-5 h-5 flex items-center justify-center shrink-0 cursor-pointer"
                                >
                                    <div className={`w-3.5 h-3.5 rounded-[3px] border-2 flex items-center justify-center transition-all ${
                                        row.enabled
                                            ? "bg-accent-primary border-accent-primary"
                                            : "border-border-secondary bg-transparent"
                                    }`}>
                                        {row.enabled && (
                                            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                                                <path d="M1.5 4L3 5.5L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                            </svg>
                                        )}
                                    </div>
                                </button>

                                {/* Master layer name */}
                                <div className="flex-1 min-w-0">
                                    <div className="text-[11px] font-medium text-text-primary truncate flex items-center gap-1">
                                        <span className="text-[9px] text-text-tertiary uppercase">{row.masterLayerType}</span>
                                        {row.masterLayerName}
                                    </div>
                                </div>

                                <div className="text-text-tertiary">→</div>

                                {/* Target layer selector */}
                                <div className="flex-1 min-w-0">
                                    <Select
                                        size="xs"
                                        value={row.targetLayerId || "__none__"}
                                        onChange={(val) => handleTargetChange(row.masterLayerId, val === "__none__" ? "" : val)}
                                        disabled={!row.enabled}
                                        placeholder="— не привязан —"
                                        options={[
                                            { value: "__none__", label: "— не привязан —" },
                                            ...targetLayers
                                                .filter(tl => tl.type === row.masterLayerType || row.masterLayerType === tl.type)
                                                .map(tl => ({ value: tl.id, label: tl.name })),
                                        ]}
                                    />
                                </div>

                                {/* Sync flag chips */}
                                <div className="w-[180px] flex items-center gap-1 justify-end flex-wrap">
                                    {SYNC_FLAGS.map(flag => (
                                        <SyncChip
                                            key={flag.key}
                                            flag={flag}
                                            active={row[flag.key]}
                                            disabled={!row.enabled || !row.targetLayerId}
                                            onToggle={() => handleFlagToggle(row.masterLayerId, flag.key)}
                                        />
                                    ))}
                                    {row.masterLayerType === "image" && row.enabled && row.targetLayerId && (
                                        <Select
                                            size="xs"
                                            value={row.imageSyncMode ?? "relative_size"}
                                            onChange={(val) => handleImageSyncModeChange(row.masterLayerId, val as ImageSyncMode)}
                                            options={[
                                                { value: "content", label: "Содержимое" },
                                                { value: "relative_size", label: "Размер %" },
                                                { value: "relative_full", label: "Полная %" },
                                            ]}
                                        />
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {masterLayers.length === 0 && (
                        <div className="py-8 text-center text-[12px] text-text-tertiary">
                            Мастер-формат не содержит слоёв
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-5 py-3 border-t border-border-primary bg-bg-secondary/50">
                    <button
                        onClick={handleUnbindAll}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-[var(--radius-md)] text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
                    >
                        <Unlink2 size={11} />
                        Отвязать всё
                    </button>

                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-text-tertiary">
                            {enabledCount} из {bindings.length} связей
                        </span>
                        <Button variant="ghost" size="sm" onClick={onClose}>
                            Отмена
                        </Button>
                        <Button size="sm" onClick={handleApply} icon={<Link2 size={11} />}>
                            Применить
                        </Button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}

/** Auto-map master layers to target layers by name match */
function autoMapByName(masterLayers: Layer[], targetLayers: Layer[]): LayerBinding[] {
    const bindings: LayerBinding[] = [];
    const usedTargets = new Set<string>();

    for (const ml of masterLayers) {
        const baseBinding = {
            syncContent: true,
            syncStyle: false,
            syncSize: false,
            syncPosition: false,
            imageSyncMode: (ml.type === "image" ? "relative_size" : undefined) as ImageSyncMode | undefined,
        };

        const exactMatch = targetLayers.find(tl =>
            tl.name === ml.name && tl.type === ml.type && !usedTargets.has(tl.id)
        );
        if (exactMatch) {
            bindings.push({ masterLayerId: ml.id, targetLayerId: exactMatch.id, ...baseBinding });
            usedTargets.add(exactMatch.id);
            continue;
        }

        const partialMatch = targetLayers.find(tl =>
            tl.type === ml.type &&
            !usedTargets.has(tl.id) &&
            tl.name.toLowerCase().includes(ml.name.toLowerCase())
        );
        if (partialMatch) {
            bindings.push({ masterLayerId: ml.id, targetLayerId: partialMatch.id, ...baseBinding });
            usedTargets.add(partialMatch.id);
        }
    }

    return bindings;
}
