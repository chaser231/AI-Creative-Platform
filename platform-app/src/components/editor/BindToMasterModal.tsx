"use client";

import { useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Link2, Unlink2, ChevronDown } from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import type { LayerBinding, SyncMode, Layer } from "@/types";

interface BindToMasterModalProps {
    formatId: string;
    onClose: () => void;
}

const SYNC_MODES: { value: SyncMode; label: string; description: string }[] = [
    { value: "content_only", label: "Содержимое", description: "Текст, изображения" },
    { value: "content_and_style", label: "Содержимое + стили", description: "Текст, цвета, шрифты" },
    { value: "all", label: "Все свойства", description: "Содержимое, стили, позиция, размер" },
    { value: "none", label: "Не синхронизировать", description: "Полностью независимый" },
];

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
            return targetFormat.layerBindings;
        }
        // Auto-map by name
        return autoMapByName(masterLayers, targetLayers);
    }, [targetFormat, masterLayers, targetLayers]);

    const [bindings, setBindings] = useState<BindingRow[]>(() =>
        masterLayers.map(ml => {
            const existing = initialBindings.find(b => b.masterLayerId === ml.id);
            return {
                masterLayerId: ml.id,
                masterLayerName: ml.name,
                masterLayerType: ml.type,
                targetLayerId: existing?.targetLayerId ?? "",
                syncMode: existing?.syncMode ?? "content_only",
                enabled: !!existing?.targetLayerId,
            };
        })
    );

    interface BindingRow {
        masterLayerId: string;
        masterLayerName: string;
        masterLayerType: string;
        targetLayerId: string;
        syncMode: SyncMode;
        enabled: boolean;
    }

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

    const handleSyncModeChange = useCallback((masterLayerId: string, syncMode: SyncMode) => {
        setBindings(prev => prev.map(b =>
            b.masterLayerId === masterLayerId
                ? { ...b, syncMode }
                : b
        ));
    }, []);

    const handleApply = () => {
        const activeBindings: LayerBinding[] = bindings
            .filter(b => b.enabled && b.targetLayerId)
            .map(b => ({
                masterLayerId: b.masterLayerId,
                targetLayerId: b.targetLayerId,
                syncMode: b.syncMode,
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
            <div className="w-[560px] max-h-[80vh] bg-bg-primary rounded-[var(--radius-xl)] border border-border-primary shadow-[var(--shadow-lg)] flex flex-col overflow-hidden">
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

                {/* Bindings list */}
                <div className="flex-1 overflow-y-auto px-5 py-3">
                    {/* Column headers */}
                    <div className="flex items-center gap-3 px-2 py-1.5 text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">
                        <div className="w-5" />
                        <div className="flex-1">Слой мастера</div>
                        <div className="w-px h-3 bg-border-secondary" />
                        <div className="flex-1">Слой формата</div>
                        <div className="w-[130px] text-right">Синхронизация</div>
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
                                    <select
                                        value={row.targetLayerId}
                                        onChange={(e) => handleTargetChange(row.masterLayerId, e.target.value)}
                                        disabled={!row.enabled}
                                        className="w-full h-6 px-1.5 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus disabled:opacity-40 cursor-pointer appearance-none"
                                    >
                                        <option value="">— не привязан —</option>
                                        {targetLayers
                                            .filter(tl => tl.type === row.masterLayerType || row.masterLayerType === tl.type)
                                            .map(tl => (
                                                <option key={tl.id} value={tl.id}>
                                                    {tl.name}
                                                </option>
                                            ))}
                                    </select>
                                </div>

                                {/* Sync mode selector */}
                                <div className="w-[130px]">
                                    <select
                                        value={row.syncMode}
                                        onChange={(e) => handleSyncModeChange(row.masterLayerId, e.target.value as SyncMode)}
                                        disabled={!row.enabled || !row.targetLayerId}
                                        className="w-full h-6 px-1.5 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary text-[10px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus disabled:opacity-40 cursor-pointer appearance-none"
                                    >
                                        {SYNC_MODES.map(sm => (
                                            <option key={sm.value} value={sm.value}>
                                                {sm.label}
                                            </option>
                                        ))}
                                    </select>
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
                        <button
                            onClick={onClose}
                            className="px-4 py-1.5 rounded-[var(--radius-md)] border border-border-primary text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
                        >
                            Отмена
                        </button>
                        <button
                            onClick={handleApply}
                            className="px-4 py-1.5 rounded-[var(--radius-md)] bg-accent-primary text-text-inverse text-[11px] font-medium hover:bg-accent-primary-hover transition-colors cursor-pointer"
                        >
                            <span className="flex items-center gap-1">
                                <Link2 size={11} />
                                Применить
                            </span>
                        </button>
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
        // Try exact name match first
        const exactMatch = targetLayers.find(tl =>
            tl.name === ml.name && tl.type === ml.type && !usedTargets.has(tl.id)
        );
        if (exactMatch) {
            bindings.push({
                masterLayerId: ml.id,
                targetLayerId: exactMatch.id,
                syncMode: "content_only",
            });
            usedTargets.add(exactMatch.id);
            continue;
        }
        // Try partial name match (case-insensitive)
        const partialMatch = targetLayers.find(tl =>
            tl.type === ml.type &&
            !usedTargets.has(tl.id) &&
            tl.name.toLowerCase().includes(ml.name.toLowerCase())
        );
        if (partialMatch) {
            bindings.push({
                masterLayerId: ml.id,
                targetLayerId: partialMatch.id,
                syncMode: "content_only",
            });
            usedTargets.add(partialMatch.id);
        }
    }

    return bindings;
}
