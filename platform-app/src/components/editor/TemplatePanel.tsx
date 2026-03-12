"use client";

import { useState, useMemo } from "react";
import { v4 as uuid } from "uuid";
import { LayoutTemplate, Plus, ArrowRight, Check, Search, X, Star, Download, Upload, Shuffle } from "lucide-react";
import { useTemplateStore } from "@/store/templateStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useProjectStore } from "@/store/projectStore";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { DEFAULT_PACKS, type TemplatePackMeta } from "@/constants/defaultPacks";
import { serializeTemplate } from "@/services/templateService";
import { searchPacks } from "@/services/templateCatalogService";
import type { TemplatePackV2, TemplatePack } from "@/services/templateService";
import type { BusinessUnit, TemplateCategory, ContentType } from "@/types";
import { SlotMappingModal } from "@/components/editor/SlotMappingModal";

interface TemplatePanelProps {
    open: boolean;
    onClose: () => void;
}

/* ─── Constants for save form ──────────────────────────── */

const BU_OPTIONS: { value: BusinessUnit; label: string }[] = [
    { value: "yandex-market", label: "Маркет" },
    { value: "yandex-go", label: "Go" },
    { value: "yandex-food", label: "Еда" },
    { value: "other", label: "Другое" },
];

const CATEGORY_OPTIONS: { value: TemplateCategory; label: string }[] = [
    { value: "in-app", label: "In-App" },
    { value: "performance", label: "Перформанс" },
    { value: "smm", label: "SMM" },
    { value: "digital", label: "Диджитал" },
    { value: "showcase", label: "Витрины" },
    { value: "email", label: "Email" },
    { value: "other", label: "Другое" },
];

const CONTENT_TYPE_OPTIONS: { value: ContentType; label: string }[] = [
    { value: "visual", label: "🎨 Визуальный" },
    { value: "video", label: "🎬 Видео" },
    { value: "generative", label: "✨ Генеративный" },
    { value: "mixed", label: "📦 Смешанный" },
];

/* ─── Filter Chip ──────────────────────────────────────── */

function Chip({
    label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`px-2 py-1 rounded-full text-[10px] font-medium transition-all cursor-pointer border ${active
                ? "bg-accent-primary text-white border-accent-primary"
                : "bg-bg-surface text-text-secondary border-border-primary hover:border-accent-primary/30"
                }`}
        >
            {label}
        </button>
    );
}

export function TemplatePanel({ open, onClose }: TemplatePanelProps) {
    const { savedPacks, addPack, deletePack } = useTemplateStore();
    const { masterComponents, componentInstances, resizes, layers, resetCanvas, setCanvasSize } = useCanvasStore();
    const { projects, activeProjectId } = useProjectStore();
    const [activeTab, setActiveTab] = useState<"single" | "pack">("single");
    const [packToApply, setPackToApply] = useState<TemplatePackV2 | null>(null);

    // Pack tab state
    const [packSearch, setPackSearch] = useState("");

    // Save form state
    const [showSaveForm, setShowSaveForm] = useState(false);
    const [saveName, setSaveName] = useState("");
    const [saveDescription, setSaveDescription] = useState("");
    const [saveBUs, setSaveBUs] = useState<BusinessUnit[]>([]);
    const [saveCategories, setSaveCategories] = useState<TemplateCategory[]>([]);
    const [saveContentType, setSaveContentType] = useState<ContentType>("visual");
    const [saveTagInput, setSaveTagInput] = useState("");
    const [saveTags, setSaveTags] = useState<string[]>([]);

    // Smart Resize state
    const [smartResizePack, setSmartResizePack] = useState<TemplatePack | null>(null);
    const [smartResizePackName, setSmartResizePackName] = useState("");

    // Search results
    const searchResults = useMemo(() => {
        if (!packSearch) return null;
        return searchPacks({ query: packSearch, sortBy: "popularity", sortOrder: "desc" }, savedPacks);
    }, [packSearch, savedPacks]);

    const handleApplyPackDestructive = async () => {
        if (!packToApply) return;
        const { applyTemplatePack } = await import("@/services/templateService");
        applyTemplatePack(packToApply, {
            onSuccess: () => {
                setPackToApply(null);
                onClose();
            }
        });
    };

    const handleApplyPackSmart = () => {
        if (!packToApply) return;
        setSmartResizePack(packToApply);
        setSmartResizePackName(packToApply.name);
        setPackToApply(null);
    };

    const handleSaveAsTemplate = () => {
        const state = useCanvasStore.getState();
        const activeProject = projects.find((p) => p.id === activeProjectId);
        const projectData = activeProject || { name: "Новый шаблон" };

        const newPack = serializeTemplate(
            { ...projectData, name: "Мой одиночный шаблон" },
            state.masterComponents,
            [], // Empty resizes implies single template
            [], // No instances
            state.layers
        );

        const meta: Partial<TemplatePackV2> = {
            description: "Создан из текущего холста",
            businessUnits: ["other"],
            categories: ["other"],
            contentType: "visual",
            author: "user",
            isOfficial: false,
        };

        addPack(newPack, meta);
    };

    const handleSaveAsPack = () => {
        if (!saveName.trim()) return;

        const activeProject = projects.find((p) => p.id === activeProjectId);
        const projectData = activeProject || { name: saveName };

        const newPack = serializeTemplate(
            { ...projectData, name: saveName },
            masterComponents,
            resizes,
            componentInstances,
            layers
        );

        const meta: Partial<TemplatePackV2> = {
            description: saveDescription || "Пользовательский пакет",
            businessUnits: saveBUs.length > 0 ? saveBUs : ["other"],
            categories: saveCategories.length > 0 ? saveCategories : ["other"],
            contentType: saveContentType,
            tags: saveTags.map(t => ({ id: `tag-${t.toLowerCase().replace(/\s+/g, "-")}`, label: t })),
            author: "user",
            isOfficial: false,
        };

        addPack(newPack, meta);
        setShowSaveForm(false);
        resetSaveForm();
        setActiveTab("pack");
    };

    const resetSaveForm = () => {
        setSaveName("");
        setSaveDescription("");
        setSaveBUs([]);
        setSaveCategories([]);
        setSaveContentType("visual");
        setSaveTags([]);
        setSaveTagInput("");
    };

    const handleAddTag = () => {
        const tag = saveTagInput.trim();
        if (tag && !saveTags.includes(tag)) {
            setSaveTags(prev => [...prev, tag]);
            setSaveTagInput("");
        }
    };

    const handleExportPack = (pack: TemplatePackV2) => {
        const json = JSON.stringify(pack, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${pack.name.replace(/\s+/g, "_")}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleLoadPack = (pack: any) => {
        setPackToApply(pack);
    };

    const handleImportPack = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const json = event.target?.result as string;
                const pack = JSON.parse(json);
                const { applyTemplatePack } = await import("@/services/templateService");

                applyTemplatePack(pack, {
                    onSuccess: () => {
                        onClose();
                        resetSaveForm();
                    },
                    onError: () => alert("Ошибка загрузки пакета шаблонов")
                });
            } catch (err) {
                console.error("Failed to parse template pack", err);
                alert("Ошибка структуры файла: неверный JSON");
            }
        };
        reader.readAsText(file);
    };

    if (!open) return null;

    /* ─── V2 Pack Card ──────────────────────────────────── */
    const PackCard = ({ pack, color, onDelete }: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pack: any;
        color?: string;
        onDelete?: () => void;
    }) => {
        const isMeta = "data" in pack;
        const v2 = isMeta ? pack.data : pack;

        if (!v2) return null;

        const displayColor = color || (isMeta ? pack.thumbnailColor : "#6366F1");

        return (
            <div className="relative group">
                <button
                    onClick={() => handleLoadPack(v2)}
                    className="w-full relative p-3 rounded-xl border border-border-primary hover:border-accent-primary/40 bg-bg-primary text-left transition-all cursor-pointer hover:shadow-md"
                >
                    <div
                        className="w-full h-20 rounded-lg mb-2 relative overflow-hidden flex items-center justify-center"
                        style={{ backgroundColor: displayColor + "15" }}
                    >
                        <LayoutTemplate size={22} style={{ color: displayColor }} />
                        {v2.isOfficial && (
                            <div className="absolute top-1 right-1 flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/20">
                                <Star size={7} className="text-amber-500 fill-amber-500" />
                                <span className="text-[7px] font-semibold text-amber-600">Official</span>
                            </div>
                        )}
                    </div>
                    <div className="text-[11px] font-semibold text-text-primary truncate">{v2.name || "Без названия"}</div>
                    <div className="text-[9px] text-text-tertiary mt-0.5 line-clamp-1">{v2.description || ""}</div>
                    <div className="flex items-center justify-between mt-1.5">
                        <div className="flex gap-0.5 flex-wrap">
                            {(v2.categories || []).slice(0, 2).map((c: string) => (
                                <span key={c} className="text-[7px] px-1 py-0.5 rounded bg-bg-secondary text-text-secondary">{c}</span>
                            ))}
                        </div>
                        <span className="text-[8px] text-text-tertiary">{v2.resizes?.length || 0} фмт</span>
                    </div>
                    {(v2.tags || []).length > 0 && (
                        <div className="flex gap-0.5 mt-1 flex-wrap">
                            {(v2.tags || []).slice(0, 2).map((tag: any) => (
                                <span
                                    key={tag.id}
                                    className="text-[7px] px-1 py-0.5 rounded-full border border-border-primary text-text-tertiary"
                                    style={tag.color ? { borderColor: tag.color + "40", color: tag.color } : undefined}
                                >
                                    #{tag.label}
                                </span>
                            ))}
                        </div>
                    )}
                </button>
                {/* Action buttons — top-left on hover */}
                <div className="absolute top-1.5 left-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* Smart Resize button — only when master has components */}
                    {masterComponents.length > 0 && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const rawPack = isMeta ? pack.data : pack;
                                setSmartResizePack(rawPack);
                                setSmartResizePackName(v2.name || "Без названия");
                            }}
                            className="p-1 bg-accent-primary/10 border border-accent-primary/20 rounded hover:bg-accent-primary/20 transition-colors cursor-pointer"
                            title="С текущим мастером"
                        >
                            <Shuffle size={10} className="text-accent-primary" />
                        </button>
                    )}
                    {!isMeta && (
                        <button
                            onClick={(e) => { e.stopPropagation(); handleExportPack(v2); }}
                            className="p-1 bg-bg-surface/90 border border-border-primary rounded hover:bg-bg-secondary transition-colors cursor-pointer"
                            title="Экспорт .json"
                        >
                            <Download size={10} className="text-text-secondary" />
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onDelete(); }}
                            className="p-1 bg-bg-error/10 hover:bg-bg-error/20 rounded text-text-error transition-colors cursor-pointer"
                            title="Удалить"
                        >
                            <Plus size={10} className="rotate-45" />
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <>
            <Modal open={open} title="Шаблоны" onClose={onClose}>
                <div className="space-y-4">
                    {/* Tabs */}
                    <div className="flex gap-1 p-1 bg-bg-secondary rounded-xl border border-border-primary mb-2">
                        <button
                            onClick={() => setActiveTab("single")}
                            className={`flex-1 flex items-center justify-center h-8 rounded-lg text-xs font-medium transition-all cursor-pointer ${activeTab === "single"
                                ? "bg-bg-surface text-text-primary shadow-sm border border-border-primary"
                                : "text-text-secondary hover:text-text-primary"
                                }`}
                        >
                            Одиночные
                        </button>
                        <button
                            onClick={() => setActiveTab("pack")}
                            className={`flex-1 flex items-center justify-center h-8 rounded-lg text-xs font-medium transition-all cursor-pointer ${activeTab === "pack"
                                ? "bg-bg-surface text-text-primary shadow-sm border border-border-primary"
                                : "text-text-secondary hover:text-text-primary"
                                }`}
                        >
                            Пакеты
                        </button>
                    </div>

                    {activeTab === "single" ? (
                        <>
                            {/* Save current as template */}
                            {masterComponents.length > 0 && (
                                <div className="p-3 bg-bg-secondary rounded-xl border border-border-primary">
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

                            <div>
                                <h4 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">
                                    Сохраненные одиночные шаблоны
                                </h4>
                                <div className="grid grid-cols-2 gap-3">
                                    {savedPacks.filter(p => !p.resizes || p.resizes.length === 0).map((pack) => (
                                        <PackCard
                                            key={pack.id}
                                            pack={pack}
                                            onDelete={() => deletePack(pack.id)}
                                        />
                                    ))}
                                </div>
                                {savedPacks.filter(p => !p.resizes || p.resizes.length === 0).length === 0 && (
                                    <div className="col-span-2 text-center py-6 text-xs text-text-tertiary">
                                        Нет сохраненных одиночных шаблонов.<br />Сохраните текущий холст для быстрого старта!
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="space-y-4">
                            {/* Search */}
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

                            {/* Save Pack (extended form) */}
                            {masterComponents.length > 0 && (
                                <div className="p-3 bg-bg-secondary rounded-xl border border-border-primary">
                                    {!showSaveForm ? (
                                        <>
                                            <div className="flex items-center gap-2 mb-2">
                                                <Plus size={14} className="text-accent-primary" />
                                                <span className="text-xs font-medium text-text-primary">Создать свой пакет</span>
                                            </div>
                                            <p className="text-[11px] text-text-tertiary mb-2">
                                                Сохранить текущий проект как пакет с метаданными.
                                            </p>
                                            <Button size="sm" variant="secondary" onClick={() => setShowSaveForm(true)}>
                                                Сохранить этот проект
                                            </Button>
                                        </>
                                    ) : (
                                        <div className="space-y-3">
                                            <h4 className="text-xs font-semibold text-text-primary">Сохранить пакет</h4>

                                            {/* Name */}
                                            <div>
                                                <label className="block text-[10px] font-medium text-text-secondary mb-1">Название *</label>
                                                <input
                                                    type="text"
                                                    value={saveName}
                                                    onChange={(e) => setSaveName(e.target.value)}
                                                    placeholder="Напр. Промо-набор Q1"
                                                    className="w-full h-8 px-2.5 rounded-lg border border-border-primary bg-bg-surface text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/20 transition-all"
                                                />
                                            </div>

                                            {/* Description */}
                                            <div>
                                                <label className="block text-[10px] font-medium text-text-secondary mb-1">Описание</label>
                                                <input
                                                    type="text"
                                                    value={saveDescription}
                                                    onChange={(e) => setSaveDescription(e.target.value)}
                                                    placeholder="Краткое описание пакета"
                                                    className="w-full h-8 px-2.5 rounded-lg border border-border-primary bg-bg-surface text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/20 transition-all"
                                                />
                                            </div>

                                            {/* BU */}
                                            <div>
                                                <label className="block text-[10px] font-medium text-text-secondary mb-1">Сервис</label>
                                                <div className="flex flex-wrap gap-1">
                                                    {BU_OPTIONS.map(bu => (
                                                        <Chip
                                                            key={bu.value}
                                                            label={bu.label}
                                                            active={saveBUs.includes(bu.value)}
                                                            onClick={() => setSaveBUs(prev =>
                                                                prev.includes(bu.value)
                                                                    ? prev.filter(b => b !== bu.value)
                                                                    : [...prev, bu.value]
                                                            )}
                                                        />
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Category */}
                                            <div>
                                                <label className="block text-[10px] font-medium text-text-secondary mb-1">Категория</label>
                                                <div className="flex flex-wrap gap-1">
                                                    {CATEGORY_OPTIONS.map(cat => (
                                                        <Chip
                                                            key={cat.value}
                                                            label={cat.label}
                                                            active={saveCategories.includes(cat.value)}
                                                            onClick={() => setSaveCategories(prev =>
                                                                prev.includes(cat.value)
                                                                    ? prev.filter(c => c !== cat.value)
                                                                    : [...prev, cat.value]
                                                            )}
                                                        />
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Content type */}
                                            <div>
                                                <label className="block text-[10px] font-medium text-text-secondary mb-1">Тип контента</label>
                                                <div className="flex flex-wrap gap-1">
                                                    {CONTENT_TYPE_OPTIONS.map(ct => (
                                                        <Chip
                                                            key={ct.value}
                                                            label={ct.label}
                                                            active={saveContentType === ct.value}
                                                            onClick={() => setSaveContentType(ct.value)}
                                                        />
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Tags */}
                                            <div>
                                                <label className="block text-[10px] font-medium text-text-secondary mb-1">Теги</label>
                                                <div className="flex gap-1.5">
                                                    <input
                                                        type="text"
                                                        value={saveTagInput}
                                                        onChange={(e) => setSaveTagInput(e.target.value)}
                                                        onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                                                        placeholder="Введите тег..."
                                                        className="flex-1 h-7 px-2 rounded-md border border-border-primary bg-bg-surface text-[10px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary/20 transition-all"
                                                    />
                                                    <button
                                                        onClick={handleAddTag}
                                                        className="px-2 h-7 rounded-md bg-bg-surface border border-border-primary text-[10px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                                                    >
                                                        +
                                                    </button>
                                                </div>
                                                {saveTags.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                                        {saveTags.map(tag => (
                                                            <span
                                                                key={tag}
                                                                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent-primary/10 text-accent-primary text-[9px] font-medium"
                                                            >
                                                                #{tag}
                                                                <button
                                                                    onClick={() => setSaveTags(prev => prev.filter(t => t !== tag))}
                                                                    className="cursor-pointer hover:text-red-500"
                                                                >
                                                                    <X size={8} />
                                                                </button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Actions */}
                                            <div className="flex gap-2 pt-1">
                                                <Button size="sm" variant="ghost" onClick={() => { setShowSaveForm(false); resetSaveForm(); }}>
                                                    Отмена
                                                </Button>
                                                <Button size="sm" disabled={!saveName.trim()} onClick={handleSaveAsPack}>
                                                    Сохранить пакет
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Search results or browse */}
                            {packSearch && searchResults ? (
                                <div>
                                    <h4 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">
                                        Результаты ({searchResults.total})
                                    </h4>
                                    {searchResults.items.length > 0 ? (
                                        <div className="grid grid-cols-2 gap-3">
                                            {searchResults.items.map(pack => (
                                                <PackCard key={pack.id} pack={pack} />
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-center py-6 text-xs text-text-tertiary">
                                            Ничего не найдено
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <>
                                    {/* Saved Packs */}
                                    {savedPacks.length > 0 && (
                                        <div>
                                            <h4 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">
                                                Мои пакеты
                                            </h4>
                                            <div className="grid grid-cols-2 gap-3">
                                                {savedPacks.filter(p => p.resizes && p.resizes.length > 0).map((pack) => (
                                                    <PackCard
                                                        key={pack.id}
                                                        pack={pack}
                                                        onDelete={() => deletePack(pack.id)}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Default Packs */}
                                    <div>
                                        <h4 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">
                                            Готовые пакеты
                                        </h4>
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

                                    {/* Import */}
                                    <div className="pt-3 border-t border-border-primary">
                                        <div className="flex items-center justify-between p-3 border-2 border-dashed border-border-primary rounded-xl bg-bg-secondary/30">
                                            <div className="flex items-center gap-2">
                                                <Upload size={14} className="text-text-tertiary" />
                                                <span className="text-[11px] text-text-primary font-medium">Импорт .json</span>
                                            </div>
                                            <label className="cursor-pointer">
                                                <span className="px-3 py-1.5 bg-bg-surface border border-border-primary text-text-primary text-[10px] font-medium rounded-lg hover:bg-bg-tertiary transition-colors">
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
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Application Options Modal */}
                <Modal open={!!packToApply} title="Применение шаблона" onClose={() => setPackToApply(null)}>
                    <div className="space-y-4">
                        <p className="text-[13px] text-text-secondary">
                            Как вы хотите применить шаблон <strong className="text-text-primary">{packToApply?.name}</strong>?
                        </p>
                        <div className="grid grid-cols-1 gap-3 mt-4">
                            <button
                                onClick={handleApplyPackDestructive}
                                className="p-4 border border-border-primary bg-bg-secondary rounded-xl text-left hover:border-accent-primary focus:outline-none transition-colors group cursor-pointer"
                            >
                                <div className="text-sm font-semibold text-text-primary group-hover:text-accent-primary flex items-center gap-2 mb-1">
                                    <ArrowRight size={14} />
                                    Заменить текущий проект
                                </div>
                                <div className="text-[11px] text-text-tertiary">
                                    Очистит холст и текущие форматы, загрузив шаблон с нуля. Подходит для старта нового проекта.
                                </div>
                            </button>
                            <button
                                onClick={handleApplyPackSmart}
                                className="p-4 border border-border-primary bg-bg-secondary rounded-xl text-left hover:border-accent-primary focus:outline-none transition-colors group cursor-pointer"
                            >
                                <div className="text-sm font-semibold text-text-primary group-hover:text-accent-primary flex items-center gap-2 mb-1">
                                    <Plus size={14} />
                                    Добавить как новый формат
                                </div>
                                <div className="text-[11px] text-text-tertiary">
                                    Сохранит ваш проект и добавит этот шаблон как новую вкладку ресайза, позволяя интеллектуально перенести в него текущий контент.
                                </div>
                            </button>
                        </div>
                        <div className="flex justify-end pt-2 mt-4">
                            <Button variant="ghost" onClick={() => setPackToApply(null)}>Отмена</Button>
                        </div>
                    </div>
                </Modal>
            </Modal>

            {/* Smart Resize Modal */}
            {
                smartResizePack && (
                    <SlotMappingModal
                        open={!!smartResizePack}
                        onClose={() => { setSmartResizePack(null); setSmartResizePackName(""); }}
                        templatePack={smartResizePack}
                        templateName={smartResizePackName}
                    />
                )
            }
        </>
    );
}
