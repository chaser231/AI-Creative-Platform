"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, LayoutTemplate, FileText, ImagePlus, Sparkles } from "lucide-react";
import { useTemplateStore } from "@/store/templateStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useProjectStore } from "@/store/projectStore";
import { Button } from "@/components/ui/Button";
import type { Template } from "@/types";

interface WizardFlowProps {
    projectId: string;
    onSwitchToStudio: () => void;
}

type WizardStep = "template" | "content" | "review";

export function WizardFlow({ projectId, onSwitchToStudio }: WizardFlowProps) {
    const { templates } = useTemplateStore();
    const { setCanvasSize, addTextLayer, addRectangleLayer, addBadgeLayer, resetCanvas } = useCanvasStore();
    const [step, setStep] = useState<WizardStep>("template");
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
    const [headline, setHeadline] = useState("");
    const [ctaText, setCtaText] = useState("Shop Now");

    const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

    const handleApplyAndContinue = () => {
        if (!selectedTemplate) return;

        resetCanvas();
        setCanvasSize(selectedTemplate.baseWidth, selectedTemplate.baseHeight);

        // Populate slots with user content
        selectedTemplate.slots.forEach((slot) => {
            const dp = slot.defaultProps;
            const defaultType = slot.acceptTypes[0];

            switch (defaultType) {
                case "text":
                    addTextLayer({
                        name: slot.name,
                        x: dp.x ?? 0,
                        y: dp.y ?? 0,
                        width: dp.width ?? 300,
                        height: dp.height ?? 60,
                        text:
                            slot.name === "Headline" ? (headline || "Your Headline") :
                                slot.name === "CTA Button" ? (ctaText || "Shop Now") :
                                    slot.name,
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
                        fill: "#E0E7FF",
                        stroke: "#A5B4FC",
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

        setStep("review");
    };

    return (
        <div className="flex-1 flex items-center justify-center bg-bg-secondary p-8">
            <div className="w-full max-w-2xl bg-bg-primary rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] border border-border-primary overflow-hidden">
                {/* Progress bar */}
                <div className="flex items-center gap-0 border-b border-border-primary">
                    {(["template", "content", "review"] as WizardStep[]).map((s, i) => (
                        <div
                            key={s}
                            className={`
                                flex-1 flex items-center justify-center gap-2 px-4 py-3 text-xs font-medium
                                transition-colors border-b-2
                                ${step === s
                                    ? "border-accent-primary text-accent-primary bg-bg-active"
                                    : i < ["template", "content", "review"].indexOf(step)
                                        ? "border-green-400 text-green-600 bg-green-50"
                                        : "border-transparent text-text-tertiary"
                                }
                            `}
                        >
                            <span className="w-5 h-5 rounded-full bg-current/10 flex items-center justify-center text-[10px] font-bold">
                                {i + 1}
                            </span>
                            {s === "template" ? "Выбор шаблона" : s === "content" ? "Контент" : "Превью"}
                        </div>
                    ))}
                </div>

                <div className="p-6">
                    {/* Step 1: Template */}
                    {step === "template" && (
                        <div className="space-y-4">
                            <div>
                                <h2 className="text-lg font-semibold text-text-primary">Выберите шаблон</h2>
                                <p className="text-sm text-text-secondary mt-1">
                                    Выберите основу для вашего креатива.
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                {templates.map((template) => (
                                    <button
                                        key={template.id}
                                        onClick={() => setSelectedTemplateId(template.id)}
                                        className={`
                                            p-4 rounded-[var(--radius-md)] border text-left transition-all cursor-pointer
                                            ${selectedTemplateId === template.id
                                                ? "border-accent-primary bg-accent-primary/5 shadow-[var(--shadow-sm)]"
                                                : "border-border-primary hover:border-border-secondary"
                                            }
                                        `}
                                    >
                                        <div
                                            className="w-full bg-bg-secondary rounded-[var(--radius-sm)] mb-3 border border-border-primary"
                                            style={{ aspectRatio: `${template.baseWidth} / ${template.baseHeight}` }}
                                        />
                                        <div className="text-sm font-medium text-text-primary">{template.name}</div>
                                        <div className="text-xs text-text-tertiary mt-0.5">{template.description}</div>
                                    </button>
                                ))}
                            </div>
                            <div className="flex justify-end pt-2">
                                <Button
                                    disabled={!selectedTemplateId}
                                    icon={<ChevronRight size={14} />}
                                    onClick={() => setStep("content")}
                                >
                                    Продолжить
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Content */}
                    {step === "content" && selectedTemplate && (
                        <div className="space-y-4">
                            <div>
                                <h2 className="text-lg font-semibold text-text-primary">Заполните контент</h2>
                                <p className="text-sm text-text-secondary mt-1">
                                    Добавьте тексты и изображения для «{selectedTemplate.name}».
                                </p>
                            </div>
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-medium text-text-secondary mb-1">
                                        Заголовок
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="Напр. ЛЕТНЯЯ РАСПРОДАЖА"
                                        value={headline}
                                        onChange={(e) => setHeadline(e.target.value)}
                                        className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-text-secondary mb-1">
                                        Текст кнопки
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="Напр. Купить"
                                        value={ctaText}
                                        onChange={(e) => setCtaText(e.target.value)}
                                        className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
                                    />
                                </div>
                                <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-[var(--radius-md)] border border-blue-200">
                                    <Sparkles size={16} className="text-blue-500 shrink-0" />
                                    <p className="text-xs text-blue-700">
                                        ИИ-генерация текста будет доступна в следующем обновлении. Пока введите текст вручную.
                                    </p>
                                </div>
                            </div>
                            <div className="flex justify-between pt-2">
                                <Button variant="ghost" onClick={() => setStep("template")}>Назад</Button>
                                <Button
                                    icon={<ChevronRight size={14} />}
                                    onClick={handleApplyAndContinue}
                                >
                                    Сгенерировать
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Review */}
                    {step === "review" && (
                        <div className="space-y-4">
                            <div>
                                <h2 className="text-lg font-semibold text-text-primary">Ваш креатив готов!</h2>
                                <p className="text-sm text-text-secondary mt-1">
                                    Компоненты размещены на холсте. Переключитесь в режим Студии для тонкой настройки.
                                </p>
                            </div>
                            <div className="flex items-center justify-center py-8">
                                <div className="w-32 h-32 rounded-[var(--radius-lg)] bg-gradient-to-br from-accent-primary/20 to-accent-primary/5 border border-accent-primary/30 flex items-center justify-center">
                                    <LayoutTemplate size={40} className="text-accent-primary/60" />
                                </div>
                            </div>
                            <div className="flex justify-center gap-3 pt-2">
                                <Button variant="secondary" onClick={() => setStep("content")}>
                                    Изменить контент
                                </Button>
                                <Button onClick={onSwitchToStudio}>
                                    Открыть в Студии →
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
