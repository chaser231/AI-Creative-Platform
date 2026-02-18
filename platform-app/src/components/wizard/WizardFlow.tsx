"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, LayoutTemplate, FileText, ImagePlus, Sparkles } from "lucide-react";
import { useTemplateStore } from "@/store/templateStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useProjectStore } from "@/store/projectStore";
import { Button } from "@/components/ui/Button";
import { DEFAULT_PACKS, TemplatePackMeta } from "@/constants/defaultPacks";
import type { Template } from "@/types";

interface WizardFlowProps {
    projectId: string;
    onSwitchToStudio: () => void;
}

type WizardStep = "template" | "content" | "review";

export function WizardFlow({ projectId, onSwitchToStudio }: WizardFlowProps) {
    const { templates, savedPacks } = useTemplateStore();
    const { setCanvasSize, addTextLayer, addRectangleLayer, addBadgeLayer, resetCanvas, loadTemplatePack } = useCanvasStore();
    const [step, setStep] = useState<WizardStep>("template");
    const [templateMode, setTemplateMode] = useState<"single" | "pack">("single");
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
    const [headline, setHeadline] = useState("");
    const [ctaText, setCtaText] = useState("Shop Now");
    const [productDescription, setProductDescription] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);

    const handleGenerateContent = async () => {
        if (!productDescription) return;
        setIsGenerating(true);
        try {
            const { RemoteTextProvider } = await import("@/services/aiService");

            // Generate Headline
            const headlineParams = {
                model: "openai",
                context: "You are a marketing copywriter. Generate a short, punchy headline (2-3 words, CAPS) for a banner."
            };
            const headlineRes = await RemoteTextProvider.generate(
                `Create a headline for: ${productDescription}`,
                headlineParams
            );
            setHeadline(headlineRes.content.replace(/"/g, ''));

            // Generate CTA
            const ctaParams = {
                model: "openai",
                context: "Generate a short Call to Action button text (max 2 words)."
            };
            const ctaRes = await RemoteTextProvider.generate(
                `CTA for: ${productDescription}`,
                ctaParams
            );
            setCtaText(ctaRes.content.replace(/"/g, ''));

        } catch (err) {
            console.error("AI Generation failed", err);
            alert("Не удалось сгенерировать контент. Проверьте API.");
        } finally {
            setIsGenerating(false);
        }
    };

    const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleLoadPack = async (pack: any) => {
        try {
            const data = pack.data || pack;
            const { hydrateTemplate } = await import("@/services/templateService");
            const hydrated = hydrateTemplate(data);
            loadTemplatePack(hydrated);
            onSwitchToStudio();
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
                const { hydrateTemplate } = await import("@/services/templateService");
                const hydrated = hydrateTemplate(pack);

                loadTemplatePack(hydrated);
                // Skip to studio immediately as content filling is for single templates
                onSwitchToStudio();
            } catch (err) {
                console.error("Failed to load template pack", err);
                alert("Ошибка загрузки пакета шаблонов");
            }
        };
        reader.readAsText(file);
    };

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
                            <div className="flex justify-between items-start">
                                <div>
                                    <h2 className="text-lg font-semibold text-text-primary">Выберите основу</h2>
                                    <p className="text-sm text-text-secondary mt-1">
                                        Начните с готового шаблона или загрузите пакет.
                                    </p>
                                </div>
                                <div className="flex bg-bg-secondary rounded-[var(--radius-md)] p-1 border border-border-primary">
                                    <button
                                        onClick={() => setTemplateMode("single")}
                                        className={`px-3 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-all ${templateMode === "single" ? "bg-bg-surface shadow-[var(--shadow-sm)] text-text-primary" : "text-text-secondary"}`}
                                    >
                                        Шаблоны
                                    </button>
                                    <button
                                        onClick={() => setTemplateMode("pack")}
                                        className={`px-3 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-all ${templateMode === "pack" ? "bg-bg-surface shadow-[var(--shadow-sm)] text-text-primary" : "text-text-secondary"}`}
                                    >
                                        Пакеты
                                    </button>
                                </div>
                            </div>

                            {templateMode === "single" ? (
                                <>
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
                                </>
                            ) : (
                                <div className="space-y-6">
                                    {/* Saved Packs */}
                                    {savedPacks.length > 0 && (
                                        <div>
                                            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
                                                Мои пакеты
                                            </h3>
                                            <div className="grid grid-cols-2 gap-4">
                                                {savedPacks.map((pack) => (
                                                    <button
                                                        key={pack.id}
                                                        onClick={() => handleLoadPack(pack)}
                                                        className="relative p-4 rounded-[var(--radius-md)] border border-border-primary hover:border-border-secondary bg-bg-primary text-left transition-all cursor-pointer group hover:shadow-md"
                                                    >
                                                        <div
                                                            className="w-full h-32 rounded-[var(--radius-sm)] mb-4 relative overflow-hidden flex items-center justify-center bg-accent-primary/10"
                                                        >
                                                            <LayoutTemplate size={32} className="text-accent-primary" />
                                                        </div>
                                                        <div className="text-sm font-medium text-text-primary">{pack.name}</div>
                                                        <div className="text-xs text-text-tertiary mt-1 mb-3">
                                                            {pack.masterComponents.length} компонентов, {pack.resizes.length} макетов
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Default Packs */}
                                    <div>
                                        {savedPacks.length > 0 && (
                                            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
                                                Готовые пакеты
                                            </h3>
                                        )}
                                        <div className="grid grid-cols-2 gap-4">
                                            {DEFAULT_PACKS.map((pack) => (
                                                <button
                                                    key={pack.id}
                                                    onClick={() => handleLoadPack(pack)}
                                                    className="relative p-4 rounded-[var(--radius-md)] border border-border-primary hover:border-border-secondary bg-bg-primary text-left transition-all cursor-pointer group hover:shadow-md"
                                                >
                                                    <div
                                                        className="w-full h-32 rounded-[var(--radius-sm)] mb-4 relative overflow-hidden flex items-center justify-center"
                                                        style={{ backgroundColor: pack.thumbnailColor + "20" }}
                                                    >
                                                        <LayoutTemplate size={32} style={{ color: pack.thumbnailColor }} />
                                                    </div>
                                                    <div className="text-sm font-medium text-text-primary">{pack.name}</div>
                                                    <div className="text-xs text-text-tertiary mt-1 mb-3 line-clamp-2">
                                                        {pack.description}
                                                    </div>
                                                    <div className="flex gap-1.5 flex-wrap">
                                                        {pack.data.resizes.map(r => (
                                                            <span key={r.id} className="text-[10px] px-2 py-0.5 bg-bg-secondary rounded-full text-text-secondary border border-border-secondary">
                                                                {r.name}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="border-t border-border-primary pt-6">
                                        <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-border-primary rounded-[var(--radius-lg)] bg-bg-secondary/30">
                                            <h3 className="text-sm font-medium text-text-primary mb-2">Импорт своего пакета</h3>
                                            <p className="text-xs text-text-secondary mb-4 text-center max-w-xs">
                                                Если у вас уже есть сохраненный файл .json, вы можете загрузить его здесь.
                                            </p>
                                            <label className="cursor-pointer">
                                                <span className="px-4 py-2 bg-white border border-border-primary text-text-primary text-xs font-medium rounded-[var(--radius-md)] hover:bg-bg-secondary transition-colors shadow-sm">
                                                    Выбрать файл .json
                                                </span>
                                                <input
                                                    type="file"
                                                    accept=".json"
                                                    className="hidden"
                                                    onChange={handleImportPack}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            )}
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
                                <div>
                                    <label className="block text-xs font-medium text-text-secondary mb-1">
                                        Описание продукта / Тема
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder="Напр. Кофейня со свежей выпечкой"
                                            value={productDescription}
                                            onChange={(e) => setProductDescription(e.target.value)}
                                            className="flex-1 h-10 px-3 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
                                        />
                                        <Button
                                            onClick={handleGenerateContent}
                                            disabled={isGenerating || !productDescription}
                                            variant="ai"
                                            icon={isGenerating ? <div className="animate-spin text-white">⟳</div> : <Sparkles size={16} />}
                                            title="Сгенерировать варианты"
                                        >
                                            {isGenerating ? "..." : "Magically Fill"}
                                        </Button>
                                    </div>
                                    <p className="text-[11px] text-text-tertiary mt-1.5">
                                        ИИ придумает заголовок и кнопку на основе вашего описания.
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
