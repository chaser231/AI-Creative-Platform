"use client";

import { useState, useMemo } from "react";
import { ArrowRight, Check, AlertTriangle, Shuffle, X, Type, Image, Square, Tag, Layers } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import { autoMap, updateMapping, removeMapping } from "@/services/slotMappingService";
import type { MappingResult, SlotMapping } from "@/services/slotMappingService";
import type { TemplatePack } from "@/services/templateService";
import type { ComponentType } from "@/types";

interface SlotMappingModalProps {
    open: boolean;
    onClose: () => void;
    templatePack: TemplatePack;
    templateName: string;
}

/* ─── Type icon helper ───────────────────────────────────── */

function TypeIcon({ type, size = 12 }: { type: ComponentType; size?: number }) {
    switch (type) {
        case "text": return <Type size={size} />;
        case "image": return <Image size={size} />;
        case "badge": return <Tag size={size} />;
        case "frame": return <Layers size={size} />;
        default: return <Square size={size} />;
    }
}

function confidenceBadge(confidence: number) {
    if (confidence >= 0.9) return { label: "Точно", color: "text-green-600 bg-green-50 border-green-200" };
    if (confidence >= 0.6) return { label: "Похоже", color: "text-amber-600 bg-amber-50 border-amber-200" };
    return { label: "Возможно", color: "text-orange-600 bg-orange-50 border-orange-200" };
}

export function SlotMappingModal({ open, onClose, templatePack, templateName }: SlotMappingModalProps) {
    const { masterComponents, applySmartResize } = useCanvasStore(useShallow((s) => ({
        masterComponents: s.masterComponents, applySmartResize: s.applySmartResize,
    })));

    const [mappingResult, setMappingResult] = useState<MappingResult>(() =>
        autoMap(masterComponents, templatePack)
    );

    // For manual mapping dropdown
    const [editingMasterId, setEditingMasterId] = useState<string | null>(null);

    const resizeCount = (templatePack.resizes || []).filter(r => r.id !== "master").length;

    const handleApply = () => {
        const { unmappedSlotNames } = applySmartResize(templatePack, mappingResult.mappings);
        onClose();

        // Notify about unmapped slots after a small delay for UI to settle
        if (unmappedSlotNames.length > 0) {
            setTimeout(() => {
                alert(`⚠️ ${unmappedSlotNames.length} слот(ов) из шаблона не были заполнены:\n\n${unmappedSlotNames.join(", ")}\n\nПожалуйста, заполните их вручную в каждом ресайзе.`);
            }, 300);
        }
    };

    const handleManualMap = (masterId: string, templateMasterId: string) => {
        setMappingResult(
            updateMapping(mappingResult, masterId, templateMasterId, masterComponents, templatePack.masterComponents)
        );
        setEditingMasterId(null);
    };

    const handleRemoveMapping = (masterId: string) => {
        setMappingResult(
            removeMapping(mappingResult, masterId, masterComponents, templatePack.masterComponents)
        );
    };

    const handleReAutoMap = () => {
        setMappingResult(autoMap(masterComponents, templatePack));
    };

    return (
        <Modal open={open} onClose={onClose} title="Smart Resize" maxWidth="max-w-xl">
            <div className="space-y-5">
                {/* Header info */}
                <div className="p-3 rounded-xl bg-accent-primary/5 border border-accent-primary/15">
                    <p className="text-xs text-text-secondary">
                        Сопоставьте элементы вашего мастера со слотами шаблона <strong>«{templateName}»</strong>.
                        Будет создано <strong>{resizeCount}</strong> ресайз{resizeCount === 1 ? "" : resizeCount < 5 ? "а" : "ов"} с позициями из шаблона и контентом из мастера.
                    </p>
                </div>

                {/* Mapping table */}
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h4 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">
                            Маппинг ({mappingResult.mappings.length} из {masterComponents.length})
                        </h4>
                        <button
                            onClick={handleReAutoMap}
                            className="flex items-center gap-1 text-[10px] text-accent-primary hover:underline cursor-pointer"
                        >
                            <Shuffle size={10} />
                            Авто-маппинг
                        </button>
                    </div>

                    <div className="space-y-2">
                        {mappingResult.mappings.map((mapping) => {
                            const badge = confidenceBadge(mapping.confidence);
                            return (
                                <div
                                    key={mapping.masterId}
                                    className="flex items-center gap-2 p-2.5 rounded-lg border border-border-primary bg-bg-primary"
                                >
                                    {/* Master side */}
                                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                        <TypeIcon type={mapping.masterType} />
                                        <span className="text-[11px] font-medium text-text-primary truncate">
                                            {mapping.masterName}
                                        </span>
                                    </div>

                                    {/* Arrow */}
                                    <ArrowRight size={12} className="text-text-tertiary shrink-0" />

                                    {/* Template side */}
                                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                        <span className="text-[11px] text-text-secondary truncate">
                                            {mapping.templateMasterName}
                                        </span>
                                    </div>

                                    {/* Confidence badge */}
                                    <span className={`text-[8px] px-1.5 py-0.5 rounded-full border font-medium shrink-0 ${badge.color}`}>
                                        {badge.label}
                                    </span>

                                    {/* Remove button */}
                                    <button
                                        onClick={() => handleRemoveMapping(mapping.masterId)}
                                        className="p-0.5 text-text-tertiary hover:text-red-500 cursor-pointer shrink-0"
                                        title="Убрать связь"
                                    >
                                        <X size={10} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Unmapped master elements */}
                {mappingResult.unmappedMaster.length > 0 && (
                    <div>
                        <h4 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">
                            Без пары (ваш мастер)
                        </h4>
                        <div className="space-y-1.5">
                            {mappingResult.unmappedMaster.map(um => (
                                <div key={um.id} className="flex items-center gap-2 p-2 rounded-lg border border-dashed border-border-primary bg-bg-secondary/50">
                                    <TypeIcon type={um.type} />
                                    <span className="text-[11px] text-text-secondary flex-1 truncate">{um.name}</span>

                                    {editingMasterId === um.id ? (
                                        <div className="flex gap-1 flex-wrap">
                                            {mappingResult.unmappedTemplate
                                                .filter(ut => ut.type === um.type)
                                                .map(ut => (
                                                    <button
                                                        key={ut.id}
                                                        onClick={() => handleManualMap(um.id, ut.id)}
                                                        className="text-[9px] px-2 py-0.5 rounded bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 cursor-pointer transition-colors"
                                                    >
                                                        → {ut.name}
                                                    </button>
                                                ))
                                            }
                                            {mappingResult.unmappedTemplate.filter(ut => ut.type !== um.type).length > 0 && (
                                                <div className="w-px h-4 bg-border-primary mx-0.5" />
                                            )}
                                            {mappingResult.unmappedTemplate
                                                .filter(ut => ut.type !== um.type)
                                                .map(ut => (
                                                    <button
                                                        key={ut.id}
                                                        onClick={() => handleManualMap(um.id, ut.id)}
                                                        className="text-[9px] px-2 py-0.5 rounded bg-bg-secondary text-text-tertiary hover:bg-bg-tertiary cursor-pointer transition-colors"
                                                    >
                                                        → {ut.name} ({ut.type})
                                                    </button>
                                                ))
                                            }
                                            <button
                                                onClick={() => setEditingMasterId(null)}
                                                className="text-[9px] px-1 text-text-tertiary hover:text-text-primary cursor-pointer"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setEditingMasterId(um.id)}
                                            disabled={mappingResult.unmappedTemplate.length === 0}
                                            className="text-[9px] px-2 py-0.5 rounded bg-bg-secondary text-text-secondary hover:text-accent-primary cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            Привязать →
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Unmapped template slots — warning */}
                {mappingResult.unmappedTemplate.length > 0 && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                        <div className="flex items-start gap-2">
                            <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                            <div>
                                <p className="text-[11px] font-medium text-amber-700">
                                    {mappingResult.unmappedTemplate.length} слот(ов) шаблона без пары
                                </p>
                                <p className="text-[10px] text-amber-600 mt-0.5">
                                    Эти слоты останутся пустыми в ресайзах. Заполните их вручную после создания.
                                </p>
                                <div className="flex gap-1.5 mt-2 flex-wrap">
                                    {mappingResult.unmappedTemplate.map(ut => (
                                        <span key={ut.id} className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 bg-amber-100 rounded text-amber-700">
                                            <TypeIcon type={ut.type} size={9} />
                                            {ut.name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-border-primary">
                <span className="text-[10px] text-text-tertiary">
                    {mappingResult.mappings.length} связей · {resizeCount} ресайз{resizeCount === 1 ? "" : resizeCount < 5 ? "а" : "ов"}
                </span>
                <div className="flex gap-2">
                    <Button variant="ghost" onClick={onClose}>Отмена</Button>
                    <Button
                        onClick={handleApply}
                        disabled={mappingResult.mappings.length === 0}
                        icon={<Check size={14} />}
                    >
                        Создать ресайзы
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
