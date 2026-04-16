"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, LayoutTemplate, FileText, ImagePlus, Sparkles, Search, Star, X } from "lucide-react";
import { useTemplateStore } from "@/store/templateStore";
import { useTemplateListSync } from "@/hooks/useTemplateSync";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import { useProjectStore } from "@/store/projectStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { DEFAULT_PACKS, type TemplatePackMeta } from "@/constants/defaultPacks";
import { getRecommendedPacks, searchPacks } from "@/services/templateCatalogService";
import { type TemplatePackV2, extractSingleFormatFromPack } from "@/services/templateService";
import type { BusinessUnit, FrameLayer, Layer, TemplateTag } from "@/types";
import { TextContentBlock } from "@/components/wizard/blocks/TextContentBlock";
import { ImageContentBlock } from "@/components/wizard/blocks/ImageContentBlock";
import { BadgeContentBlock } from "@/components/wizard/blocks/BadgeContentBlock";
import { TextGroupSlot } from "@/components/wizard/blocks/TextGroupSlot";
import { PreviewCanvas } from "@/components/editor/PreviewCanvas";
import type { FrameComponentProps } from "@/types";

interface WizardFlowProps {
    projectId?: string;
    onSwitchToStudio: () => void;
    initialTemplateId?: string | null;
}

type WizardStep = "template" | "content" | "review";

export function WizardFlow({ projectId, onSwitchToStudio, initialTemplateId }: WizardFlowProps) {
    const { savedPacks } = useTemplateStore();
    const { backendTemplates } = useTemplateListSync();

    // Merge backend + local templates, backend takes priority
    const allPacks = useMemo(() => {
        const backendIds = new Set(backendTemplates.map(t => t.id));
        const uniqueLocal = savedPacks.filter(p => !backendIds.has(p.id));
        return [...backendTemplates, ...uniqueLocal];
    }, [backendTemplates, savedPacks]);
    const { resetCanvas, previewLayers, previewCanvasWidth, previewCanvasHeight } = useCanvasStore(useShallow((s) => ({
        resetCanvas: s.resetCanvas,
        previewLayers: s.layers,
        previewCanvasWidth: s.canvasWidth,
        previewCanvasHeight: s.canvasHeight,
    })));
    const { projects } = useProjectStore();
    const [step, setStep] = useState<WizardStep>(initialTemplateId ? "content" : "template");
    const [templateMode, setTemplateMode] = useState<"single" | "pack" | "manual">("single");
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(initialTemplateId || null);
    const [fullSelectedTemplate, setFullSelectedTemplate] = useState<TemplatePackV2 | null>(null);
    const [templateLoadError, setTemplateLoadError] = useState<string | null>(null);
    const [manualSizes, setManualSizes] = useState<{width: number; height: number; id: string}[]>([]);
    const [manualW, setManualW] = useState("1080");
    const [manualH, setManualH] = useState("1080");
    const [textValues, setTextValues] = useState<Record<string, string>>({});
    const [imageValues, setImageValues] = useState<Record<string, string>>({});
    const [productDescription, setProductDescription] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [packSearch, setPackSearch] = useState("");

    // Get project BU for recommendations
    const activeProject = projects.find(p => p.id === projectId);
    const projectBU: BusinessUnit = activeProject?.businessUnit || "yandex-market";

    // Recommended packs for this project's BU
    const recommended = useMemo(
        () => getRecommendedPacks(projectBU, allPacks, 4),
        [projectBU, allPacks]
    );

    // Search results (all packs filtered by search query)
    const searchResults = useMemo(() => {
        if (!packSearch) return null;
        return searchPacks({
            query: packSearch,
            sortBy: "popularity",
            sortOrder: "desc",
        }, allPacks);
    }, [packSearch, allPacks]);

    // Search results (all packs filtered by search query)
    const singlePacks = useMemo(() => {
        const list: (TemplatePackV2 & { _originalId?: string; _sourceResizeId?: string })[] = [];
        allPacks.forEach(pack => {
            if (!pack.resizes || pack.resizes.length === 0) {
                list.push(pack);
            } else {
                pack.resizes.forEach(resize => {
                    list.push({
                        ...pack,
                        id: `${pack.id}_${resize.id}`,
                        name: resize.name || `${resize.width}×${resize.height}`,
                        description: pack.name,
                        _originalId: pack.id,
                        _sourceResizeId: resize.id,
                    });
                });
            }
        });
        return list;
    }, [allPacks]);

    const allPacksRef = { current: allPacks };
    const singlePacksRef = { current: singlePacks };

    // Fetch full template data when user selects a template
    useEffect(() => {
        if (!selectedTemplateId) { setFullSelectedTemplate(null); return; }

        let fetchId = selectedTemplateId;
        const vPack = singlePacksRef.current.find(p => p.id === selectedTemplateId);
        if (vPack && vPack._originalId) {
            fetchId = vPack._originalId;
        } else if (selectedTemplateId && !vPack) {
            // Check if it's already a regular pack ID not mapped to single
            fetchId = selectedTemplateId;
        }

        const applyExtract = (pack: any) => {
            if (vPack && vPack._sourceResizeId) {
                return extractSingleFormatFromPack(pack as TemplatePackV2, vPack._sourceResizeId);
            }
            return pack;
        };

        // Check if it's a DEFAULT_PACK (already has full data)
        const defaultPack = DEFAULT_PACKS.find(p => p.id === fetchId || p.data.id === fetchId);
        if (defaultPack) { setFullSelectedTemplate(applyExtract(defaultPack.data)); return; }

        // Check if it's a local pack (has masterComponents)
        const localPack = savedPacks.find(p => p.id === fetchId);
        if (localPack && localPack.masterComponents?.length > 0) { setFullSelectedTemplate(applyExtract(localPack)); return; }

        // Fetch full data from backend REST endpoint
        let cancelled = false;
        setTemplateLoadError(null);
        (async () => {
            try {
                const res = await fetch(`/api/template/${fetchId}`);
                if (cancelled) return;
                if (!res.ok) {
                    console.warn(`[Wizard] Template fetch failed: HTTP ${res.status}`);
                    setTemplateLoadError(`Не удалось загрузить шаблон (HTTP ${res.status}). Попробуйте другой шаблон или обновите страницу.`);
                    const listingPack = allPacksRef.current.find(p => p.id === fetchId);
                    if (listingPack) setFullSelectedTemplate(applyExtract(listingPack));
                    return;
                }
                const template = await res.json();
                if (template?.data) {
                    setFullSelectedTemplate(applyExtract(template.data as TemplatePackV2));
                    return;
                }
                setTemplateLoadError("Шаблон не содержит данных. Попробуйте другой шаблон.");
            } catch (err) {
                if (!cancelled) {
                    console.warn("[Wizard] Template fetch error:", err);
                    setTemplateLoadError("Ошибка загрузки шаблона. Возможно, он слишком большой.");
                    const listingPack = allPacksRef.current.find(p => p.id === fetchId);
                    if (listingPack) setFullSelectedTemplate(applyExtract(listingPack));
                }
            }
        })();
        return () => { cancelled = true; };
    }, [selectedTemplateId, savedPacks]);

    const selectedTemplate = fullSelectedTemplate;

    const handleGenerateContent = async () => {
        if (!productDescription || !selectedTemplate) return;
        setIsGenerating(true);
        try {
            const { RemoteTextProvider } = await import("@/services/aiService");
            const newValues = { ...textValues };

            for (const mc of selectedTemplate.masterComponents) {
                if (mc.type !== "text") continue;
                const name = mc.name.toLowerCase();
                
                if (name.includes("head") || name.includes("заголовок") || name.includes("title")) {
                    const params = { model: "openai", context: "You are a marketing copywriter. Generate a short, punchy headline (2-3 words, CAPS) for a banner." };
                    const res = await RemoteTextProvider.generate(`Create a headline for: ${productDescription}`, params);
                    newValues[mc.id] = res.content.replace(/"/g, '').trim();
                } else if (name.includes("cta") || name.includes("кнопк") || name.includes("button")) {
                    const params = { model: "openai", context: "Generate a short Call to Action button text (max 2 words, no quotes)." };
                    const res = await RemoteTextProvider.generate(`CTA for: ${productDescription}`, params);
                    newValues[mc.id] = res.content.replace(/"/g, '').trim();
                } else if (name.includes("subhead") || name.includes("подзаголовок") || name.includes("desc") || name.includes("описан")) {
                    const params = { model: "openai", context: "Generate a short subtitle/description (5-7 words)." };
                    const res = await RemoteTextProvider.generate(`Subtitle for: ${productDescription}`, params);
                    newValues[mc.id] = res.content.replace(/"/g, '').trim();
                }
            }
            setTextValues(newValues);
        } catch (err) {
            console.error("AI Generation failed", err);
            alert("Не удалось сгенерировать контент. Проверьте API.");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, id: string) => {
        const file = e.target.files?.[0];
        if (!file) return;
        import("@/utils/imageUpload").then(({ compressImageFile }) => {
            compressImageFile(file).then((compressedBase64) => {
                setImageValues(prev => ({ ...prev, [id]: compressedBase64 }));
            });
        });
    };

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
            if (!fullSelectedTemplate) return;
            packToApply = JSON.parse(JSON.stringify(fullSelectedTemplate));
        }

        const { applyTemplatePack } = await import("@/services/templateService");

        // Build contentOverrides map: slotId → value
        const contentOverrides: Record<string, string> = {};

        // Source 1: masterComponents (for legacy + post-fix templates where MC IDs match layer IDs)
        for (const mc of packToApply.masterComponents) {
            const sid = mc.slotId || (mc.props as any).slotId;
            if (!sid) continue;

            if ((mc.type === "text" || mc.type === "badge") && textValues[mc.id] !== undefined) {
                contentOverrides[sid] = textValues[mc.id];
            }
            if (mc.type === "image" && imageValues[mc.id] !== undefined) {
                contentOverrides[sid] = imageValues[mc.id];
            }
        }

        // Source 2: Scan layers[] directly for raw canvas state (covers pre-fix templates
        // where MC IDs may not match, and ensures layers[] gets overrides applied)
        const dataAny = packToApply as any;
        if (dataAny.layers && Array.isArray(dataAny.layers)) {
            for (const layer of dataAny.layers) {
                const sid = layer.slotId;
                if (!sid || sid === "none") continue;

                if ((layer.type === "text" || layer.type === "badge") && textValues[layer.id] !== undefined) {
                    contentOverrides[sid] = textValues[layer.id];
                    // Also mutate layer directly for raw canvas state path
                    layer[layer.type === "text" ? "text" : "label"] = textValues[layer.id];
                }
                if (layer.type === "image" && imageValues[layer.id] !== undefined && !layer.isFixedAsset) {
                    contentOverrides[sid] = imageValues[layer.id];
                    layer.src = imageValues[layer.id];
                }
            }

            // Also apply to all format snapshots in resizes
            if (dataAny.resizes && Array.isArray(dataAny.resizes)) {
                for (const resize of dataAny.resizes) {
                    if (resize.layerSnapshot && Array.isArray(resize.layerSnapshot)) {
                        for (const layer of resize.layerSnapshot) {
                            if (layer.isFixedAsset) continue;
                            const sid = layer.slotId;
                            if (!sid || sid === "none" || !contentOverrides[sid]) continue;
                            const val = contentOverrides[sid];
                            if (layer.type === "text") layer.text = val;
                            else if (layer.type === "image") layer.src = val;
                            else if (layer.type === "badge") layer.label = val;
                        }
                    }
                }
            }
        }

        // Also apply content by mc.id directly to masterComponents (for hydration path)
        packToApply.masterComponents = packToApply.masterComponents.map(mc => {
            if ((mc.type === "text" || mc.type === "badge") && textValues[mc.id] !== undefined) {
                return { 
                    ...mc, 
                    props: { 
                        ...mc.props, 
                        [mc.type === "text" ? "text" : "label"]: textValues[mc.id] 
                    } 
                };
            }
            if (mc.type === "image" && imageValues[mc.id] !== undefined && !(mc.props as any).isFixedAsset) {
                return { ...mc, props: { ...mc.props, src: imageValues[mc.id] } };
            }
            return mc;
        });

        applyTemplatePack(packToApply, {
            contentOverrides: Object.keys(contentOverrides).length > 0 ? contentOverrides : undefined,
            onSuccess: () => {
                if (templateMode === "manual") {
                    onSwitchToStudio();
                } else {
                    setStep("review");
                }
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
                        {(v2.tags || []).slice(0, 2).map((tag: TemplateTag) => (
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
        <div className="flex-1 flex items-center justify-center bg-bg-secondary p-8 overflow-hidden">
            <div className="w-full max-w-5xl bg-bg-primary rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] border border-border-primary overflow-hidden flex flex-col max-h-full">
                {/* Progress bar */}
                <div className="flex items-center gap-0 border-b border-border-primary shrink-0">
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

                <div className="p-6 overflow-y-auto flex-1">
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
                                        {singlePacks.map((pack) => (
                                            <PackCard key={pack.id} pack={pack} />
                                        ))}
                                    </div>
                                    {singlePacks.length === 0 && (
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
                                        <Input
                                            value={packSearch}
                                            onChange={(e) => setPackSearch(e.target.value)}
                                            placeholder="Найти пакет..."
                                            icon={<Search size={14} />}
                                            className="h-9 text-xs pr-8"
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
                                            {allPacks.length > 0 && (
                                                <div>
                                                    <h3 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">
                                                        Мои пакеты
                                                    </h3>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        {allPacks.map((pack) => (
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
                            {templateLoadError && (
                                <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 text-sm">
                                    {templateLoadError}
                                </div>
                            )}
                            <div className="space-y-3">
                                {(() => {
                                    // ── Resolve master format layers ──
                                    // Only show content fields for the master format;
                                    // instance formats inherit content via bindings
                                    const dataAny = selectedTemplate as any;
                                    const getMasterLayers = (): Layer[] => {
                                        if (dataAny.resizes && Array.isArray(dataAny.resizes)) {
                                            const masterResize = dataAny.resizes.find((r: any) => r.isMaster);
                                            if (masterResize?.layerSnapshot && Array.isArray(masterResize.layerSnapshot)) {
                                                return masterResize.layerSnapshot as Layer[];
                                            }
                                            // Fallback: first resize with layerSnapshot
                                            const anyResize = dataAny.resizes.find((r: any) => Array.isArray(r.layerSnapshot) && r.layerSnapshot.length > 0);
                                            if (anyResize) {
                                                return anyResize.layerSnapshot as Layer[];
                                            }
                                        }
                                        if (dataAny.layers && Array.isArray(dataAny.layers)) {
                                            return dataAny.layers as Layer[];
                                        }
                                        return [];
                                    };
                                    const masterLayers = getMasterLayers();

                                    // ── Determine data source ──
                                    // masterComponents is rebuilt from layers on each save (post-fix),
                                    // but for pre-fix templates it may be stale. Check if MC has content entries.
                                    const CONTENT_TYPES = ["text", "image", "badge"];
                                    const mcContentEntries = selectedTemplate.masterComponents.filter(
                                        mc => CONTENT_TYPES.includes(mc.type)
                                    );
                                    const useMC = mcContentEntries.length > 0;

                                    const groupedIds = new Set<string>();
                                    const groups: { groupId: string; members: typeof selectedTemplate.masterComponents }[] = [];

                                    if (useMC) {
                                        // ── MC-based path (legacy + post-fix) ──
                                        const frameMCs = selectedTemplate.masterComponents.filter(
                                            mc => mc.type === "frame" && (mc.props as FrameComponentProps).groupSlotId
                                        );

                                        for (const frame of frameMCs) {
                                            const frameProps = frame.props as FrameComponentProps;
                                            let childIds = new Set<string>();

                                            // Discover children via layerTree, fallback to childIds
                                            if (selectedTemplate.layerTree && selectedTemplate.layerTree.length > 0) {
                                                interface TreeNode { masterId?: string; layer?: { masterId?: string }; children?: TreeNode[] }
                                                const findNode = (nodes: TreeNode[], mId: string): TreeNode | null => {
                                                    for (const n of nodes) {
                                                        if (n.masterId === mId || n.layer?.masterId === mId) return n;
                                                        if (n.children) { const f = findNode(n.children, mId); if (f) return f; }
                                                    }
                                                    return null;
                                                };
                                                const frameNode = findNode(selectedTemplate.layerTree, frame.id);
                                                if (frameNode?.children) {
                                                    frameNode.children.forEach((c: TreeNode) => {
                                                        if (c.masterId) childIds.add(c.masterId);
                                                        if (c.layer?.masterId) childIds.add(c.layer.masterId);
                                                    });
                                                }
                                            } else {
                                                (frameProps.childIds || []).forEach((cid: string) => childIds.add(cid));
                                            }

                                            const textMembers = selectedTemplate.masterComponents.filter(mc => {
                                                if (mc.type !== "text") return false;
                                                return childIds.has(mc.id) || (mc.slotId && childIds.has(mc.slotId));
                                            });

                                            if (textMembers.length > 0) {
                                                groups.push({ groupId: frameProps.groupSlotId!, members: textMembers });
                                                textMembers.forEach(tm => groupedIds.add(tm.id));
                                            }
                                        }
                                    } else if (masterLayers.length > 0) {
                                        // ── Layers-based path (pre-fix raw canvas state) ──
                                        const frameLayers = masterLayers.filter(
                                            (l: any) => l.type === "frame" && l.groupSlotId
                                        );

                                        for (const fl of frameLayers) {
                                            const fProps = fl as FrameLayer;
                                            const cIds = fProps.childIds || [];
                                            const textChildren = masterLayers.filter(
                                                (l: Layer) => cIds.includes(l.id) && l.type === "text"
                                            );
                                            if (textChildren.length > 0) {
                                                const syntheticMembers = textChildren.map((tl: any) => ({
                                                    id: tl.id, type: "text" as const, name: tl.name,
                                                    slotId: tl.slotId, props: tl,
                                                }));
                                                groups.push({ groupId: fProps.groupSlotId!, members: syntheticMembers as any });
                                                textChildren.forEach((tl: Layer) => groupedIds.add(tl.id));
                                            }
                                        }
                                    }

                                    // ── Build ungrouped content ──
                                    let ungrouped: typeof selectedTemplate.masterComponents;
                                    if (useMC) {
                                        ungrouped = selectedTemplate.masterComponents.filter(
                                            mc => CONTENT_TYPES.includes(mc.type) && !groupedIds.has(mc.id)
                                        );
                                    } else {
                                        // Build from masterLayers
                                        const layerUngrouped = masterLayers.filter(
                                            (l: Layer) => CONTENT_TYPES.includes(l.type)
                                                && !groupedIds.has(l.id)
                                                && l.slotId && l.slotId !== "none"
                                        );
                                        ungrouped = layerUngrouped.map((l: any) => ({
                                            id: l.id, type: l.type, name: l.name,
                                            slotId: l.slotId, props: l,
                                        })) as any;
                                    }

                                    return (
                                        <>
                                            {groups.map(group => (
                                                <TextGroupSlot
                                                    key={group.groupId}
                                                        groupId={group.groupId}
                                                        members={group.members}
                                                        textValues={textValues}
                                                        onTextChange={(mcId, val) => setTextValues(prev => ({ ...prev, [mcId]: val }))}
                                                        onBatchTextChange={(updates) => setTextValues(prev => ({ ...prev, ...updates }))}
                                                        businessUnit={projectBU}
                                                        productDescription={productDescription}
                                                    />
                                            ))}

                                            {/* Render ungrouped content blocks */}
                                            {ungrouped.map(mc => {
                                                if (mc.type === "text") {
                                                    return (
                                                        <TextContentBlock
                                                            key={mc.id}
                                                            id={mc.id}
                                                            name={mc.name}
                                                            props={mc.props as any}
                                                            value={textValues[mc.id] ?? ""}
                                                            onChange={(val) => setTextValues(prev => ({ ...prev, [mc.id]: val }))}
                                                            businessUnit={projectBU}
                                                            productDescription={productDescription}
                                                        />
                                                    );
                                                }
                                                if (mc.type === "badge") {
                                                    return (
                                                        <BadgeContentBlock
                                                            key={mc.id}
                                                            id={mc.id}
                                                            name={mc.name}
                                                            props={mc.props as any}
                                                            value={textValues[mc.id] ?? ""}
                                                            onChange={(val) => setTextValues(prev => ({ ...prev, [mc.id]: val }))}
                                                            businessUnit={projectBU}
                                                        />
                                                    );
                                                }
                                                if (mc.type === "image") {
                                                    return (
                                                        <ImageContentBlock
                                                            key={mc.id}
                                                            id={mc.id}
                                                            name={mc.name}
                                                            props={mc.props as any}
                                                            value={imageValues[mc.id] ?? ""}
                                                            onChange={(val) => setImageValues(prev => ({ ...prev, [mc.id]: val }))}
                                                            businessUnit={projectBU}
                                                            productDescription={productDescription}
                                                            projectId={projectId}
                                                        />
                                                    );
                                                }
                                                return null;
                                            })}
                                        </>
                                    );
                                })()}
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
                        <div className="space-y-4 h-full flex flex-col">
                            <div>
                                <h2 className="text-lg font-semibold text-text-primary">Ваш креатив готов!</h2>
                                <p className="text-sm text-text-secondary mt-1">
                                    Мастер-баннер сгенерирован. Проверьте результат перед переходом в Студию.
                                </p>
                            </div>
                            
                            <div className="flex-1 min-h-[400px] w-full bg-bg-secondary rounded-[var(--radius-lg)] border border-border-primary overflow-hidden relative">
                                <PreviewCanvas
                                    layers={previewLayers}
                                    artboardWidth={previewCanvasWidth}
                                    artboardHeight={previewCanvasHeight}
                                    containerWidth={800} // Approximate width, could be dynamic but fixed is ok for a modal
                                    containerHeight={400} // Approximate height
                                />
                            </div>

                            <div className="flex justify-between pt-2">
                                <Button variant="secondary" onClick={() => setStep("content")}>
                                    Назад к контенту
                                </Button>
                                <Button onClick={onSwitchToStudio}>
                                    Редактировать в Студии →
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
