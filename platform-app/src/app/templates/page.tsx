"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
    Search,
    SlidersHorizontal,
    LayoutTemplate,
    X,
    Filter,
    ArrowUpDown,
    Package,
    Star,
    Clock,
    Check,
} from "lucide-react";
import { Popover, PopoverButton } from "@/components/ui/Popover";
import { AppShell } from "@/components/layout/AppShell";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { useTemplateStore } from "@/store/templateStore";
import { searchPacks, getAllTags, type CatalogSearchParams } from "@/services/templateCatalogService";
import type { TemplatePackV2 } from "@/services/templateService";
import type { BusinessUnit, TemplateCategory, ContentType } from "@/types";

/* ─── Constants ──────────────────────────────────────── */

const BU_OPTIONS: { value: BusinessUnit; label: string }[] = [
    { value: "yandex-market", label: "Маркет" },
    { value: "yandex-go", label: "Go" },
    { value: "yandex-food", label: "Еда" },
    { value: "other", label: "Другое" },
];

const CATEGORY_OPTIONS: { value: TemplateCategory; label: string }[] = [
    { value: "in-app", label: "In-App" },
    { value: "performance", label: "Перформанс" },
    { value: "digital", label: "Диджитал" },
    { value: "offline", label: "Оффлайн" },
    { value: "smm", label: "SMM" },
    { value: "showcase", label: "Витрины" },
    { value: "email", label: "Email" },
    { value: "other", label: "Другое" },
];

const CONTENT_TYPE_OPTIONS: { value: ContentType; label: string; emoji: string }[] = [
    { value: "visual", label: "Визуальный", emoji: "🎨" },
    { value: "video", label: "Видео", emoji: "🎬" },
    { value: "audio", label: "Аудио", emoji: "🎵" },
    { value: "generative", label: "Генеративный", emoji: "✨" },
    { value: "mixed", label: "Смешанный", emoji: "📦" },
];

const SORT_OPTIONS = [
    { value: "popularity", label: "По популярности" },
    { value: "date", label: "По дате" },
    { value: "name", label: "По имени" },
] as const;

/* ─── Pack Card ──────────────────────────────────────── */

function PackCard({ pack, onLoad }: { pack: TemplatePackV2; onLoad: (pack: TemplatePackV2) => void }) {
    const categoryLabels = (pack.categories || [])
        .map(c => CATEGORY_OPTIONS.find(o => o.value === c)?.label)
        .filter(Boolean);

    const buLabels = (pack.businessUnits || [])
        .map(bu => BU_OPTIONS.find(o => o.value === bu)?.label)
        .filter(Boolean);

    return (
        <button
            onClick={() => onLoad(pack)}
            className="group flex flex-col bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] overflow-hidden hover:shadow-[var(--shadow-lg)] hover:border-border-secondary transition-all duration-[var(--transition-base)] cursor-pointer text-left relative"
        >
            {/* Thumbnail */}
            <div className="relative w-full aspect-[4/3] bg-bg-tertiary flex items-center justify-center overflow-hidden shrink-0">
                <LayoutTemplate
                    size={40}
                    className="text-text-tertiary/50 group-hover:scale-110 transition-transform duration-[var(--transition-slow)]"
                />
                {pack.isOfficial && (
                    <div className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/20">
                        <Star size={10} className="text-amber-500 fill-amber-500" />
                        <span className="text-[9px] font-semibold text-amber-600">Official</span>
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="flex flex-col p-3.5 gap-2 w-full">
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-text-primary truncate">{pack.name}</h3>
                    <p className="text-[11px] text-text-tertiary mt-1 truncate">
                        {pack.description || "Без описания"}
                    </p>
                </div>

                <div className="flex flex-wrap gap-1 mt-1 shrink-0">
                    {buLabels.length > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-bg-secondary border border-border-primary text-text-secondary whitespace-nowrap">
                            {buLabels[0]}
                        </span>
                    )}
                    {categoryLabels.slice(0, 1).map(label => (
                        <span key={label} className="text-[9px] px-1.5 py-0.5 rounded-md bg-bg-secondary border border-border-primary text-text-secondary whitespace-nowrap">
                            {label}
                        </span>
                    ))}
                    {(pack.tags || []).slice(0, 1).map((tag: any) => (
                        <span
                            key={tag.id}
                            className="text-[9px] px-1.5 py-0.5 rounded-md border border-border-primary text-text-tertiary whitespace-nowrap"
                            style={tag.color ? { borderColor: tag.color + "40", color: tag.color } : undefined}
                        >
                            #{tag.label}
                        </span>
                    ))}
                </div>

                <div className="flex items-center justify-end w-full mt-auto pt-1 border-t border-border-primary/50">
                    <span className="text-[10px] text-text-tertiary font-medium">
                        {pack.resizes?.length || 0} {(pack.resizes?.length || 0) === 1 ? "формат" : "форматов"}
                    </span>
                </div>
            </div>

            {/* Hover overlay */}
            <div className="absolute inset-0 bg-accent-primary/0 group-hover:bg-accent-primary/5 transition-colors pointer-events-none" />
        </button>
    );
}

/* ─── Main Catalog Page ──────────────────────────────── */

export default function TemplateCatalogPage() {
    const router = useRouter();
    const { savedPacks } = useTemplateStore();
    const [search, setSearch] = useState("");
    const [selectedBUs, setSelectedBUs] = useState<BusinessUnit[]>([]);
    const [selectedCategories, setSelectedCategories] = useState<TemplateCategory[]>([]);
    const [selectedContentType, setSelectedContentType] = useState<ContentType | null>(null);
    const [sortBy, setSortBy] = useState<"popularity" | "date" | "name">("popularity");
    const [activePopover, setActivePopover] = useState<string | null>(null);

    const togglePopover = (name: string) => {
        setActivePopover((prev) => (prev === name ? null : name));
    };

    const toggleBU = (bu: BusinessUnit) => {
        setSelectedBUs(prev =>
            prev.includes(bu) ? prev.filter(b => b !== bu) : [...prev, bu]
        );
    };

    const toggleCategory = (cat: TemplateCategory) => {
        setSelectedCategories(prev =>
            prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
        );
    };

    const clearFilters = () => {
        setSelectedBUs([]);
        setSelectedCategories([]);
        setSelectedContentType(null);
        setSearch("");
    };

    const hasFilters = selectedBUs.length > 0 || selectedCategories.length > 0 || selectedContentType !== null || search !== "";

    // Search results
    const results = useMemo(() => {
        const params: CatalogSearchParams = {
            query: search || undefined,
            businessUnits: selectedBUs.length > 0 ? selectedBUs : undefined,
            categories: selectedCategories.length > 0 ? selectedCategories : undefined,
            contentType: selectedContentType || undefined,
            sortBy,
            sortOrder: sortBy === "name" ? "asc" : "desc",
        };
        return searchPacks(params, savedPacks);
    }, [search, selectedBUs, selectedCategories, selectedContentType, sortBy, savedPacks]);

    const tags = useMemo(() => getAllTags(savedPacks), [savedPacks]);

    const handleLoadPack = async (pack: TemplatePackV2) => {
        const { applyTemplatePack } = await import("@/services/templateService");

        applyTemplatePack(pack, {
            onSuccess: async () => {
                // Navigate to editor with the latest project
                const { useProjectStore } = await import("@/store/projectStore");
                const store = useProjectStore.getState();
                const project = store.createProject({
                    name: pack.name,
                    businessUnit: pack.businessUnits?.[0] || "other",
                    goal: "banner",
                });
                store.setActiveProject(project.id);
                router.push(`/editor/${project.id}`);
            }
        });
    };

    return (
        <AppShell>
            <TopBar
                breadcrumbs={[{ label: "Каталог шаблонов" }]}
                showBackToProjects={false}
                showHistoryNavigation={true}
            />

            <div className="flex-1 overflow-y-auto">
                {/* Header */}
                <div className="px-6 pt-6 pb-4">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h1 className="text-2xl font-semibold text-text-primary">Каталог шаблонов</h1>
                            <p className="text-sm text-text-tertiary mt-1">
                                Готовые пакеты для быстрого старта — фильтруйте по сервису, категории или типу контента
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-text-tertiary">
                                {results.total} {results.total === 1 ? "шаблон" : "шаблонов"}
                            </span>
                        </div>
                    </div>

                    {/* Search bar */}
                    <div className="flex items-center gap-3 mb-4">
                        <div className="flex-1 relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Поиск по названию, описанию или тегам..."
                                className="w-full h-10 pl-10 pr-4 rounded-xl border border-border-primary bg-bg-surface text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary/40 transition-all"
                            />
                            {search && (
                                <button
                                    onClick={() => setSearch("")}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary cursor-pointer"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2 relative">
                            {/* BU Filter */}
                            <div className="relative">
                                <PopoverButton
                                    label={`Сервис${selectedBUs.length ? ` (${selectedBUs.length})` : ""}`}
                                    isActive={activePopover === "bu"}
                                    onClick={() => togglePopover("bu")}
                                />
                                <Popover isOpen={activePopover === "bu"} onClose={() => setActivePopover(null)} className="w-[200px]">
                                    <div className="flex flex-col gap-1">
                                        {BU_OPTIONS.map(bu => {
                                            const isActive = selectedBUs.includes(bu.value);
                                            return (
                                                <button
                                                    key={bu.value}
                                                    onClick={() => toggleBU(bu.value)}
                                                    className={`flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors cursor-pointer ${isActive ? "bg-accent-primary/10 text-accent-primary font-medium" : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary"}`}
                                                >
                                                    <span>{bu.label}</span>
                                                    {isActive && <Check size={14} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </Popover>
                            </div>

                            {/* Category Filter */}
                            <div className="relative">
                                <PopoverButton
                                    label={`Категория${selectedCategories.length ? ` (${selectedCategories.length})` : ""}`}
                                    isActive={activePopover === "category"}
                                    onClick={() => togglePopover("category")}
                                />
                                <Popover isOpen={activePopover === "category"} onClose={() => setActivePopover(null)} className="w-[200px]">
                                    <div className="flex flex-col gap-1">
                                        {CATEGORY_OPTIONS.map(cat => {
                                            const isActive = selectedCategories.includes(cat.value);
                                            return (
                                                <button
                                                    key={cat.value}
                                                    onClick={() => toggleCategory(cat.value)}
                                                    className={`flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors cursor-pointer ${isActive ? "bg-accent-primary/10 text-accent-primary font-medium" : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary"}`}
                                                >
                                                    <span>{cat.label}</span>
                                                    {isActive && <Check size={14} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </Popover>
                            </div>

                            {/* Content Type Filter */}
                            <div className="relative">
                                <PopoverButton
                                    label={selectedContentType ? `Тип: ${CONTENT_TYPE_OPTIONS.find(o => o.value === selectedContentType)?.label}` : "Тип контента"}
                                    isActive={activePopover === "contentType"}
                                    onClick={() => togglePopover("contentType")}
                                />
                                <Popover isOpen={activePopover === "contentType"} onClose={() => setActivePopover(null)} className="w-[200px]">
                                    <div className="flex flex-col gap-1">
                                        {CONTENT_TYPE_OPTIONS.map(ct => {
                                            const isActive = selectedContentType === ct.value;
                                            return (
                                                <button
                                                    key={ct.value}
                                                    onClick={() => {
                                                        setSelectedContentType(isActive ? null : ct.value);
                                                        setActivePopover(null);
                                                    }}
                                                    className={`flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors cursor-pointer ${isActive ? "bg-accent-primary/10 text-accent-primary font-medium" : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary"}`}
                                                >
                                                    <span>{ct.emoji} {ct.label}</span>
                                                    {isActive && <Check size={14} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </Popover>
                            </div>

                            <div className="w-px h-5 bg-border-primary mx-1"></div>

                            {/* Sort Filter */}
                            <div className="relative">
                                <PopoverButton
                                    icon={<ArrowUpDown size={12} />}
                                    label={SORT_OPTIONS.find(o => o.value === sortBy)?.label || "Сортировка"}
                                    isActive={activePopover === "sort"}
                                    onClick={() => togglePopover("sort")}
                                />
                                <Popover isOpen={activePopover === "sort"} onClose={() => setActivePopover(null)} className="w-[180px]">
                                    <div className="flex flex-col gap-1">
                                        {SORT_OPTIONS.map(opt => {
                                            const isActive = sortBy === opt.value;
                                            return (
                                                <button
                                                    key={opt.value}
                                                    onClick={() => {
                                                        setSortBy(opt.value);
                                                        setActivePopover(null);
                                                    }}
                                                    className={`flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors cursor-pointer ${isActive ? "bg-bg-surface text-text-primary font-medium border border-border-primary" : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary border border-transparent"}`}
                                                >
                                                    <span>{opt.label}</span>
                                                    {isActive && <Check size={14} className="text-text-primary" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </Popover>
                            </div>

                            {hasFilters && (
                                <button
                                    onClick={clearFilters}
                                    className="ml-auto flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent-primary transition-colors cursor-pointer"
                                    title="Сбросить все фильтры"
                                >
                                    <X size={12} />
                                    Сбросить
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Results grid */}
                <div className="px-6 pb-8">
                    {results.items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <div className="w-16 h-16 rounded-2xl bg-bg-secondary flex items-center justify-center mb-4">
                                <Package size={28} className="text-text-tertiary" />
                            </div>
                            <h3 className="text-sm font-medium text-text-primary mb-1">Ничего не найдено</h3>
                            <p className="text-xs text-text-tertiary max-w-[300px]">
                                Попробуйте изменить фильтры или поисковый запрос
                            </p>
                            {hasFilters && (
                                <Button variant="ghost" size="sm" onClick={clearFilters} className="mt-3">
                                    Сбросить фильтры
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {results.items.map(pack => (
                                <PackCard key={pack.id} pack={pack} onLoad={handleLoadPack} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </AppShell>
    );
}
