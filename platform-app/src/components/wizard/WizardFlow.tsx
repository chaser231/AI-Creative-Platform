"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, LayoutTemplate, FileText, ImagePlus, Sparkles, Search, Star, X } from "lucide-react";
import { useTemplateStore } from "@/store/templateStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useProjectStore } from "@/store/projectStore";
import { Button } from "@/components/ui/Button";
import { DEFAULT_PACKS, type TemplatePackMeta } from "@/constants/defaultPacks";
import { getRecommendedPacks, searchPacks } from "@/services/templateCatalogService";
import type { TemplatePackV2 } from "@/services/templateService";
import type { BusinessUnit } from "@/types";

interface WizardFlowProps {
    projectId: string;
    onSwitchToStudio: () => void;
}

type WizardStep = "template" | "content" | "review";

export function WizardFlow({ projectId, onSwitchToStudio }: WizardFlowProps) {
    const { savedPacks } = useTemplateStore();
    const { resetCanvas } = useCanvasStore();
    const { projects } = useProjectStore();
    const [step, setStep] = useState<WizardStep>("template");
    const [templateMode, setTemplateMode] = useState<"single" | "pack" | "manual">("single");
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
    const [manualSizes, setManualSizes] = useState<{width: number; height: number; id: string}[]>([]);
    const [manualW, setManualW] = useState("1080");
    const [manualH, setManualH] = useState("1080");
    const [headline, setHeadline] = useState("");
    const [ctaText, setCtaText] = useState("Shop Now");
    const [productDescription, setProductDescription] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [packSearch, setPackSearch] = useState("");

    // Get project BU for recommendations
    const activeProject = projects.find(p => p.id === projectId);
    const projectBU: BusinessUnit = activeProject?.businessUnit || "yandex-market";

    // Recommended packs for this project's BU
    const recommended = useMemo(
        () => getRecommendedPacks(projectBU, savedPacks, 4),
        [projectBU, savedPacks]
    );

    // Search results (all packs filtered by search query)
    const searchResults = useMemo(() => {
        if (!packSearch) return null;
        return searchPacks({
            query: packSearch,
            sortBy: "popularity",
            sortOrder: "desc",
        }, savedPacks);
    }, [packSearch, savedPacks]);

    const handleGenerateContent = async () => {
        if (!productDescription) return;
        setIsGenerating(true);
        try {
            const { RemoteTextProvider } = await import("@/services/aiService");

            const headlineParams = {
                model: "openai",
                context: "You are a marketing copywriter. Generate a short, punchy headline (2-3 words, CAPS) for a banner."
            };
            const headlineRes = await RemoteTextProvider.generate(
                `Create a headline for: ${productDescription}`,
                headlineParams
            );
            setHeadline(headlineRes.content.replace(/"/g, ''));

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

    const selectedTemplate = savedPacks.find(p => p.id === selectedTemplateId) || DEFAULT_PACKS.find(p => p.id === selectedTemplateId)?.data;

    const handleApplyAndContinue = async () => {
        if (templateMode !== "manual" && !selectedTemplateId) return;

        let packToApply: TemplatePackV2;

        if (templateMode === "manual") {
            if (manualSizes.length === 0) return;
            const masterSize = manualSizes[0];
            
            packToApply = {
                id: "manual_" + Date.now(),
                name: "Свой пакет форматов",
                description: "Собранные вручную форматы",
                isOfficial: false,
                baseWidth: masterSize.width,
                baseHeight: masterSize.height,
                masterComponents: [],
                componentInstances: [],
                resizes: manualSizes.map((sz, i) => ({
                     id: i === 0 ? "master" : `resize_${i}`,
                     name: `Формат ${sz.width}x${sz.height}`,
                     label: `${sz.width}×${sz.height}`,
                     width: sz.width,
                     height: sz.height,
                     instancesEnabled: i !== 0
                }))
            } as unknown as TemplatePackV2;
        } else {
            let selectedPack = savedPacks.find(p => p.id === selectedTemplateId);
            if (!selectedPack) {
                const meta = DEFAULT_PACKS.find(p => p.id === selectedTemplateId);
                if (meta) selectedPack = meta.data;
            }

            if (!selectedPack) return;
            
            // Deep clone to avoid mutating store state
            packToApply = JSON.parse(JSON.stringify(selectedPack));
        }

        const { applyTemplatePack } = await import("@/services/templateService");

        // Basic AI text mapping
        if (headline || ctaText) {
            packToApply.masterComponents = packToApply.masterComponents.map(mc => {
                if (mc.type === "text") {
                    const name = mc.name.toLowerCase();
                    if ((name.includes("head") || name.includes("заголовок") || name.includes("title")) && headline) {
                        return { ...mc, props: { ...mc.props, text: headline } };
                    }
                    if ((name.includes("cta") || name.includes("кнопк") || name.includes("button")) && ctaText) {
                        return { ...mc, props: { ...mc.props, text: ctaText } };
                    }
                }
                return mc;
            });
        }

        applyTemplatePack(packToApply, {
            onSuccess: () => {
                onSwitchToStudio();
            }
        });
    };

    /* ─── Pack Card (V2 enhanced) ───────────────────────── */
    const PackCard = ({ pack, color }: { pack: TemplatePackV2 | TemplatePackMeta; color?: string }) => {
        const isMeta = "data" in pack;
        const v2 = isMeta ? (pack as TemplatePackMeta).data : (pack as TemplatePackV2);

        if (!v2) return null;

        const displayColor = color || (isMeta ? (pack as TemplatePackMeta).thumbnailColor : "#6366F1");

        return (
            <button
                onClick={() => setSelectedTemplateId(v2.id)}
                className={`relative p-3 rounded-xl border transition-all cursor-pointer group hover:shadow-md text-left
                    ${selectedTemplateId === v2.id ? "border-accent-primary bg-accent-primary/5 ring-1 ring-accent-primary" : "border-border-primary hover:border-accent-primary/40 bg-bg-primary"}
                `}
            >
                <div
                    className="w-full h-24 rounded-lg mb-3 relative overflow-hidden flex items-center justify-center"
                    style={{ backgroundColor: displayColor + "15" }}
                >
                    <LayoutTemplate size={28} style={{ color: displayColor }} />
                    {v2.isOfficial && (
                        <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/20">
                            <Star size={8} className="text-amber-500 fill-amber-500" />
                            <span className="text-[8px] font-semibold text-amber-600">Official</span>
                        </div>
                    )}
                </div>
                <div className="text-xs font-semibold text-text-primary truncate">{v2.name}</div>
                <div className="text-[10px] text-text-tertiary mt-0.5 line-clamp-1">
                    {v2.description}
                </div>
                <div className="flex items-center justify-between mt-2">
                    <div className="flex gap-1 flex-wrap">
                        {(v2.categories || []).slice(0, 2).map((c: string) => (
                            <span key={c} className="text-[8px] px-1.5 py-0.5 rounded bg-bg-secondary text-text-secondary">
                                {c}
                            </span>
                        ))}
                    </div>
                    <span className="text-[9px] text-text-tertiary">
                        {v2.resizes?.length || 0} фмт
                    </span>
                </div>
                {(v2.tags || []).length > 0 && (
                    <div className="flex gap-1 mt-1.5 flex-wrap">
                        {(v2.tags || []).slice(0, 2).map((tag: any) => (
                            <span
                                key={tag.id}
                                className="text-[8px] px-1 py-0.5 rounded-full border border-border-primary text-text-tertiary"
                                style={tag.color ? { borderColor: tag.color + "40", color: tag.color } : undefined}
                            >
                                #{tag.label}
                            </span>
                        ))}
                    </div>
                )}
            </button>
        );
    };

    const BU_LABELS: Record<string, string> = {
        "yandex-market": "Маркет",
        "yandex-go": "Go",
        "yandex-food": "Еда",
        "yandex-lavka": "Лавка",
        "other": "Другое",
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
                                        className={`px-3 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-all cursor-pointer ${templateMode === "single" ? "bg-bg-surface shadow-[var(--shadow-sm)] text-text-primary" : "text-text-secondary"}`}
                                    >
                                        Шаблоны
                                    </button>
                                    <button
                                        onClick={() => setTemplateMode("pack")}
                                        className={`px-3 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-all cursor-pointer ${templateMode === "pack" ? "bg-bg-surface shadow-[var(--shadow-sm)] text-text-primary" : "text-text-secondary"}`}
                                    >
                                        Пакеты
                                    </button>
                                    <button
                                        onClick={() => setTemplateMode("manual")}
                                        className={`px-3 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-all cursor-pointer ${templateMode === "manual" ? "bg-bg-surface shadow-[var(--shadow-sm)] text-text-primary" : "text-text-secondary"}`}
                                    >
                                        Вручную
                                    </button>
                                </div>
                            </div>

                            {templateMode === "single" ? (
                                <>
                                    <div className="grid grid-cols-2 gap-4">
                                        {savedPacks.filter(p => !p.resizes || p.resizes.length === 0).map((pack) => (
                                            <PackCard key={pack.id} pack={pack} />
                                        ))}
                                    </div>
                                    {savedPacks.filter(p => !p.resizes || p.resizes.length === 0).length === 0 && (
                                        <div className="text-center py-6 text-xs text-text-tertiary">
                                            Нет одиночных шаблонов.<br />Используйте вкладку "Пакеты" или редактор для их создания.
                                        </div>
                                    )}
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
                            ) : templateMode === "pack" ? (
                                <div className="space-y-5">
                                    {/* Pack search */}
                                    <div className="relative">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                                        <input
                                            type="text"
                                            value={packSearch}
                                            onChange={(e) => setPackSearch(e.target.value)}
                                            placeholder="Найти пакет..."
                                            className="w-full h-9 pl-9 pr-8 rounded-lg border border-border-primary bg-bg-secondary text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/40 transition-all"
                                        />
                                        {packSearch && (
                                            <button
                                                onClick={() => setPackSearch("")}
                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary cursor-pointer"
                                            >
                                                <X size={12} />
                                            </button>
                                        )}
                                    </div>

                                    {packSearch && searchResults ? (
                                        /* Search results */
                                        <div>
                                            <h3 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">
                                                Результаты ({searchResults.total})
                                            </h3>
                                            {searchResults.items.length > 0 ? (
                                                <div className="grid grid-cols-2 gap-3">
                                                    {searchResults.items.map(pack => (
                                                        <PackCard key={pack.id} pack={pack} />
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-center py-8 text-xs text-text-tertiary">
                                                    Ничего не найдено по запросу «{packSearch}»
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <>
                                            {/* Recommended for project BU */}
                                            {recommended.length > 0 && (
                                                <div>
                                                    <h3 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">
                                                        📌 Рекомендовано для {BU_LABELS[projectBU] || projectBU}
                                                    </h3>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        {recommended.map(pack => (
                                                            <PackCard key={pack.id} pack={pack} />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Saved Packs */}
                                            {savedPacks.length > 0 && (
                                                <div>
                                                    <h3 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">
                                                        Мои пакеты
                                                    </h3>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        {savedPacks.map((pack) => (
                                                            <PackCard key={pack.id} pack={pack} />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Default Packs */}
                                            <div>
                                                <h3 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">
                                                    Готовые пакеты
                                                </h3>
                                                <div className="grid grid-cols-2 gap-3">
                                                    {DEFAULT_PACKS.map((pack) => (
                                                        <PackCard
                                                            key={pack.id}
                                                            pack={pack}
                                                            color={pack.thumbnailColor}
                                                        />
                                                    ))}
                                                </div>
                                            </div>

                                        </>
                                    )}
                                    <div className="flex justify-end pt-2 border-t border-border-primary">
                                        <Button
                                            disabled={!selectedTemplateId}
                                            icon={<ChevronRight size={14} />}
                                            onClick={() => setStep("content")}
                                        >
                                            Продолжить
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                     <p className="text-sm text-text-secondary">Укажите список форматов (ширина × высота), для которых вы хотите собрать креативы с нуля.</p>
                                     <div className="flex gap-2 items-center">
                                         <input type="number" value={manualW} onChange={e => setManualW(e.target.value)} className="w-24 h-9 px-3 text-sm rounded-lg border border-border-primary bg-bg-secondary text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/20" placeholder="W" />
                                         <span className="text-text-tertiary">×</span>
                                         <input type="number" value={manualH} onChange={e => setManualH(e.target.value)} className="w-24 h-9 px-3 text-sm rounded-lg border border-border-primary bg-bg-secondary text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/20" placeholder="H" />
                                         <Button variant="secondary" onClick={() => {
                                             const w = parseInt(manualW);
                                             const h = parseInt(manualH);
                                             if (w > 0 && h > 0) {
                                                setManualSizes(prev => [...prev, { width: w, height: h, id: Math.random().toString(36).substr(2, 9) }]);
                                             }
                                         }}>Добавить</Button>
                                     </div>
                                     <div className="flex flex-wrap gap-2 mt-4 min-h-8">
                                        {manualSizes.map(sz => (
                                             <div key={sz.id} className="flex items-center gap-1.5 bg-bg-secondary px-2.5 py-1.5 rounded-[var(--radius-md)] border border-border-primary text-xs text-text-secondary font-medium shadow-sm">
                                                  {sz.width} × {sz.height}
                                                  <button className="text-text-tertiary hover:text-text-primary cursor-pointer transition-colors" onClick={() => setManualSizes(prev => prev.filter(s => s.id !== sz.id))}><X size={12} /></button>
                                             </div>
                                        ))}
                                        {manualSizes.length === 0 && <span className="text-xs text-text-tertiary">Форматы не добавлены. Добавьте хотя бы один.</span>}
                                     </div>
                                     <div className="flex justify-end pt-2 border-t border-border-primary">
                                        <Button
                                            disabled={manualSizes.length === 0}
                                            icon={<ChevronRight size={14} />}
                                            onClick={handleApplyAndContinue}
                                        >
                                            Собрать форматы
                                        </Button>
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
