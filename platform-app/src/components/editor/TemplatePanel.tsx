"use client";

import { useState } from "react";
import { v4 as uuid } from "uuid";
import { LayoutTemplate, Plus, ArrowRight, Check } from "lucide-react";
import { useTemplateStore } from "@/store/templateStore";
import { useCanvasStore } from "@/store/canvasStore";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { Template } from "@/types";

interface TemplatePanelProps {
    open: boolean;
    onClose: () => void;
}

export function TemplatePanel({ open, onClose }: TemplatePanelProps) {
    const { templates } = useTemplateStore();
    const { masterComponents, resetCanvas, setCanvasSize } = useCanvasStore();
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

    const handleApplyTemplate = () => {
        if (!selectedTemplate) return;
        const template = templates.find((t) => t.id === selectedTemplate);
        if (!template) return;

        // Reset canvas and apply template dimensions
        resetCanvas();
        setCanvasSize(template.baseWidth, template.baseHeight);

        // Create layers from template slots with default positions
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
                    // Create a placeholder rectangle for image slots
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

    if (!open) return null;

    return (
        <Modal open={open} title="Шаблоны" onClose={onClose}>
            <div className="space-y-4">
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
            </div>

            {/* Footer */}
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
        </Modal>
    );
}
