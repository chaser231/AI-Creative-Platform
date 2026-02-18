"use client";

import { useState } from "react";
import { v4 as uuid } from "uuid";
import { LayoutTemplate, Plus, ArrowRight, Check } from "lucide-react";
import { useTemplateStore } from "@/store/templateStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useProjectStore } from "@/store/projectStore";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { DEFAULT_PACKS, TemplatePackMeta } from "@/constants/defaultPacks";
import { serializeTemplate } from "@/services/templateService";
import type { Template } from "@/types";

interface TemplatePanelProps {
    open: boolean;
    onClose: () => void;
}

export function TemplatePanel({ open, onClose }: TemplatePanelProps) {
    const { templates, savedPacks, addPack, deletePack } = useTemplateStore();
    const { masterComponents, componentInstances, resizes, resetCanvas, setCanvasSize } = useCanvasStore();
    const { projects, activeProjectId } = useProjectStore();
    const [activeTab, setActiveTab] = useState<"single" | "pack">("single");
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

    const handleApplyTemplate = () => {
        if (!selectedTemplate) return;
        const template = templates.find((t) => t.id === selectedTemplate);
        if (!template) return;

        resetCanvas();
        setCanvasSize(template.baseWidth, template.baseHeight);

        const { addTextLayer, addRectangleLayer, addBadgeLayer } = useCanvasStore.getState();

        template.slots.forEach((slot) => {
            const defaultType = slot.acceptTypes[0];
            const dp = slot.defaultProps;

            switch (defaultType) {
                case "text":
                    addTextLayer({
                        name: slot.name,
                        x: dp.x ?? 0,
                        y: dp.y ?? 0,
                        width: dp.width ?? 300,
                        height: dp.height ?? 60,
                        text: slot.name,
                    });
                    break;
                case "rectangle":
                    addRectangleLayer({
                        name: slot.name,
                        x: dp.x ?? 0,
                        y: dp.y ?? 0,
                        width: dp.width ?? 200,
                        height: dp.height ?? 200,
                        fill: slot.name === "Background" ? "#F3F4F6" : "#E5E7EB",
                    });
                    break;
                case "image":
                    addRectangleLayer({
                        name: slot.name,
                        x: dp.x ?? 0,
                        y: dp.y ?? 0,
                        width: dp.width ?? 400,
                        height: dp.height ?? 300,
                        fill: "#E5E7EB",
                        stroke: "#D1D5DB",
                        strokeWidth: 2,
                    });
                    break;
                case "badge":
                    addBadgeLayer({
                        name: slot.name,
                        x: dp.x ?? 0,
                        y: dp.y ?? 0,
                        width: dp.width ?? 120,
                        height: dp.height ?? 36,
                    });
                    break;
            }
        });

        onClose();
    };

    const handleSaveAsTemplate = () => {
        const state = useCanvasStore.getState();
        const { addTemplate } = useTemplateStore.getState();

        const slots = state.masterComponents.map((mc) => ({
            id: uuid(),
            name: mc.name,
            acceptTypes: [mc.type] as Template["slots"][0]["acceptTypes"],
            defaultProps: {
                x: mc.props.x,
                y: mc.props.y,
                width: mc.props.width,
                height: mc.props.height,
                rotation: mc.props.rotation,
                visible: mc.props.visible,
                locked: mc.props.locked,
            },
        }));

        addTemplate({
            name: "Мой шаблон",
            description: "Создан из текущего холста",
            baseWidth: state.canvasWidth,
            baseHeight: state.canvasHeight,
            slots,
        });
    };

    const handleSaveAsPack = () => {
        const activeProject = projects.find((p) => p.id === activeProjectId);
        const projectData = activeProject || { name: "My Custom Pack" };

        // Ensure we pass only serializable data
        const newPack = serializeTemplate(
            projectData,
            masterComponents,
            resizes,
            componentInstances
        );

        addPack(newPack);
        setActiveTab("pack");
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleLoadPack = async (pack: any) => {
        try {
            // Default packs are wrapped in 'data', saved packs are direct
            const data = pack.data || pack;

            const { hydrateTemplate } = await import("@/services/templateService");
            const hydrated = hydrateTemplate(data);
            useCanvasStore.getState().loadTemplatePack(hydrated);
            onClose();
        } catch (err) {
            console.error("Failed to load pack", err);
        }
    };

    const handleImportPack = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const json = event.target?.result as string;
                const pack = JSON.parse(json);
                // Dynamic import to avoid circular dependency if any (though unlikely here)
                const { hydrateTemplate } = await import("@/services/templateService");
                const hydrated = hydrateTemplate(pack);

                useCanvasStore.getState().loadTemplatePack(hydrated);
                onClose();
            } catch (err) {
                console.error("Failed to load template pack", err);
                alert("Ошибка загрузки пакета шаблонов");
            }
        };
        reader.readAsText(file);
    };

    if (!open) return null;

    return (
        <Modal open={open} title="Шаблоны" onClose={onClose}>
            <div className="space-y-4">
                {/* Tabs */}
                <div className="flex gap-1 p-1 bg-bg-secondary rounded-[var(--radius-lg)] border border-border-primary mb-2">
                    <button
                        onClick={() => setActiveTab("single")}
                        className={`
                            flex-1 flex items-center justify-center h-8 rounded-[var(--radius-md)] text-xs font-medium transition-all cursor-pointer
                            ${activeTab === "single"
                                ? "bg-bg-surface text-text-primary shadow-[var(--shadow-sm)] border border-border-primary"
                                : "text-text-secondary hover:text-text-primary"
                            }
                        `}
                    >
                        Одиночные
                    </button>
                    <button
                        onClick={() => setActiveTab("pack")}
                        className={`
                            flex-1 flex items-center justify-center h-8 rounded-[var(--radius-md)] text-xs font-medium transition-all cursor-pointer
                            ${activeTab === "pack"
                                ? "bg-bg-surface text-text-primary shadow-[var(--shadow-sm)] border border-border-primary"
                                : "text-text-secondary hover:text-text-primary"
                            }
                        `}
                    >
                        Пакеты
                    </button>
                </div>

                {activeTab === "single" ? (
                    <>
                        {/* Save current as template */}
                        {masterComponents.length > 0 && (
                            <div className="p-3 bg-bg-secondary rounded-[var(--radius-md)] border border-border-primary">
                                <div className="flex items-center gap-2 mb-2">
                                    <Plus size={14} className="text-accent-primary" />
                                    <span className="text-xs font-medium text-text-primary">Сохранить холст как шаблон</span>
                                </div>
                                <p className="text-[11px] text-text-tertiary mb-2">
                                    Создаст шаблон из {masterComponents.length} компонент{masterComponents.length !== 1 ? "ов" : "а"}.
                                </p>
                                <Button size="sm" variant="secondary" onClick={handleSaveAsTemplate}>
                                    Сохранить как шаблон
                                </Button>
                            </div>
                        )}

                        {/* Template grid */}
                        <div>
                            <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
                                Доступные шаблоны
                            </h4>
                            <div className="grid grid-cols-2 gap-3">
                                {templates.map((template) => (
                                    <button
                                        key={template.id}
                                        onClick={() => setSelectedTemplate(
                                            selectedTemplate === template.id ? null : template.id
                                        )}
                                        className={`
                                            relative p-3 rounded-[var(--radius-md)] border text-left
                                            transition-all cursor-pointer group
                                            ${selectedTemplate === template.id
                                                ? "border-accent-primary bg-bg-active shadow-[var(--shadow-sm)]"
                                                : "border-border-primary hover:border-border-secondary bg-bg-primary"
                                            }
                                        `}
                                    >
                                        {/* Preview */}
                                        <div
                                            className="w-full bg-bg-secondary rounded-[var(--radius-sm)] mb-2 border border-border-primary relative overflow-hidden"
                                            style={{ aspectRatio: `${template.baseWidth} / ${template.baseHeight}` }}
                                        >
                                            {/* Slots visualization */}
                                            {template.slots.map((slot) => {
                                                const dp = slot.defaultProps;
                                                if (!dp.width || !dp.height) return null;
                                                const scaleX = 100 / template.baseWidth;
                                                const scaleY = 100 / template.baseHeight;
                                                return (
                                                    <div
                                                        key={slot.id}
                                                        className="absolute border border-dashed border-text-tertiary/30 rounded-[1px]"
                                                        style={{
                                                            left: `${(dp.x || 0) * scaleX}%`,
                                                            top: `${(dp.y || 0) * scaleY}%`,
                                                            width: `${dp.width * scaleX}%`,
                                                            height: `${dp.height * scaleY}%`,
                                                        }}
                                                    />
                                                );
                                            })}
                                        </div>

                                        {/* Info */}
                                        <div className="text-xs font-medium text-text-primary">{template.name}</div>
                                        <div className="text-[10px] text-text-tertiary mt-0.5">
                                            {template.slots.length} слотов · {template.baseWidth}×{template.baseHeight}
                                        </div>

                                        {/* Selection indicator */}
                                        {selectedTemplate === template.id && (
                                            <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent-primary flex items-center justify-center">
                                                <Check size={12} className="text-white" />
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="space-y-4">
                        {/* Save Pack Action */}
                        <div className="p-3 bg-bg-secondary rounded-[var(--radius-md)] border border-border-primary">
                            <div className="flex items-center gap-2 mb-2">
                                <Plus size={14} className="text-accent-primary" />
                                <span className="text-xs font-medium text-text-primary">Создать свой пакет</span>
                            </div>
                            <p className="text-[11px] text-text-tertiary mb-2">
                                Сохранить текущий проект как пакет шаблонов.
                            </p>
                            <Button size="sm" variant="secondary" onClick={handleSaveAsPack} disabled={masterComponents.length === 0}>
                                Сохранить этот проект
                            </Button>
                        </div>

                        {/* Saved Packs */}
                        {savedPacks.length > 0 && (
                            <div>
                                <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
                                    Мои пакеты
                                </h4>
                                <div className="grid grid-cols-2 gap-3">
                                    {savedPacks.map((pack) => (
                                        <div key={pack.id} className="relative group">
                                            <button
                                                onClick={() => handleLoadPack(pack)}
                                                className="w-full relative p-3 rounded-[var(--radius-md)] border border-border-primary hover:border-border-secondary bg-bg-primary text-left transition-all cursor-pointer hover:shadow-sm"
                                            >
                                                <div
                                                    className="w-full h-24 rounded-[var(--radius-sm)] mb-2 relative overflow-hidden flex items-center justify-center bg-accent-primary/10"
                                                >
                                                    <LayoutTemplate size={24} className="text-accent-primary" />
                                                </div>
                                                <div className="text-xs font-medium text-text-primary truncate">{pack.name}</div>
                                                <div className="text-[10px] text-text-tertiary mt-0.5" title={`${pack.masterComponents.length} master · ${pack.resizes.length} sizes`}>
                                                    {pack.masterComponents.length} master · {pack.resizes.length} sizes
                                                </div>
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deletePack(pack.id);
                                                }}
                                                className="absolute top-1 right-1 p-1 bg-bg-error/10 hover:bg-bg-error/20 rounded text-text-error opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="Удалить"
                                            >
                                                <Plus size={12} className="rotate-45" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Default Packs Grid */}
                        <div>
                            <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
                                Готовые пакеты
                            </h4>
                            <div className="grid grid-cols-2 gap-3">
                                {DEFAULT_PACKS.map((pack) => (
                                    <button
                                        key={pack.id}
                                        onClick={() => handleLoadPack(pack)}
                                        className="relative p-3 rounded-[var(--radius-md)] border border-border-primary hover:border-border-secondary bg-bg-primary text-left transition-all cursor-pointer group hover:shadow-sm"
                                    >
                                        <div
                                            className="w-full h-24 rounded-[var(--radius-sm)] mb-2 relative overflow-hidden flex items-center justify-center"
                                            style={{ backgroundColor: pack.thumbnailColor + "20" }}
                                        >
                                            <LayoutTemplate size={24} style={{ color: pack.thumbnailColor }} />
                                        </div>
                                        <div className="text-xs font-medium text-text-primary">{pack.name}</div>
                                        <div className="text-[10px] text-text-tertiary mt-0.5 line-clamp-2">
                                            {pack.description}
                                        </div>
                                        <div className="mt-2 flex gap-1 flex-wrap">
                                            {pack.data.resizes.slice(0, 3).map(r => (
                                                <span key={r.id} className="text-[9px] px-1.5 py-0.5 bg-bg-secondary rounded text-text-secondary">
                                                    {r.name}
                                                </span>
                                            ))}
                                            {pack.data.resizes.length > 3 && (
                                                <span className="text-[9px] px-1.5 py-0.5 bg-bg-secondary rounded text-text-secondary">
                                                    +{pack.data.resizes.length - 3}
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Import Section */}
                        <div className="pt-4 border-t border-border-primary">
                            <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
                                Импорт
                            </h4>
                            <div className="p-4 border-2 border-dashed border-border-primary rounded-[var(--radius-lg)] bg-bg-secondary flex flex-col items-center justify-center text-center">
                                <LayoutTemplate size={24} className="text-text-tertiary mb-2" />
                                <h3 className="text-xs font-medium text-text-primary">Импорт .json</h3>
                                <label className="cursor-pointer mt-2">
                                    <span className="px-3 py-1.5 bg-bg-surface border border-border-primary text-text-primary text-xs font-medium rounded-[var(--radius-md)] hover:bg-bg-tertiary transition-colors">
                                        Выбрать файл
                                    </span>
                                    <input
                                        type="file"
                                        accept=".json"
                                        className="hidden"
                                        onChange={handleImportPack}
                                    />
                                </label>
                            </div>

                            <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-[var(--radius-md)]">
                                <p className="text-xs text-blue-600">
                                    💡 Пакеты шаблонов сохраняют полную структуру проекта, включая привязки слотов и правила ресайзов.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

            </div>

            {/* Footer */}
            {activeTab === "single" && (
                <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border-primary">
                    <Button variant="ghost" onClick={onClose}>Отмена</Button>
                    <Button
                        disabled={!selectedTemplate}
                        icon={<ArrowRight size={14} />}
                        onClick={handleApplyTemplate}
                    >
                        Применить шаблон
                    </Button>
                </div>
            )}
        </Modal>
    );
}
