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
} from "lucide-react";
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
            className="relative group text-left p-4 rounded-2xl border border-border-primary bg-bg-surface hover:border-accent-primary/40 hover:shadow-lg transition-all duration-200 cursor-pointer"
        >
            {/* Preview area */}
            <div className="w-full h-32 rounded-xl mb-3 relative overflow-hidden flex items-center justify-center bg-gradient-to-br from-accent-primary/5 to-accent-primary/15">
                <LayoutTemplate size={32} className="text-accent-primary/60" />
                {pack.isOfficial && (
                    <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/20">
                        <Star size={10} className="text-amber-500 fill-amber-500" />
                        <span className="text-[9px] font-semibold text-amber-600">Official</span>
                    </div>
                )}
            </div>

            {/* Info */}
            <h3 className="text-sm font-semibold text-text-primary truncate">{pack.name}</h3>
            <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-2 leading-relaxed">
                {pack.description}
            </p>

            {/* BU badges */}
            {buLabels.length > 0 && (
                <div className="mt-2 flex gap-1 flex-wrap">
                    {buLabels.map(label => (
                        <span key={label} className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent-primary/10 text-accent-primary font-medium">
                            {label}
                        </span>
                    ))}
                </div>
            )}

            {/* Category + format count */}
            <div className="mt-2 flex items-center justify-between">
                <div className="flex gap-1 flex-wrap">
                    {categoryLabels.slice(0, 2).map(label => (
                        <span key={label} className="text-[9px] px-1.5 py-0.5 rounded bg-bg-secondary text-text-secondary">
                            {label}
                        </span>
                    ))}
                </div>
                <span className="text-[10px] text-text-tertiary">
                    {pack.resizes?.length || 0} {(pack.resizes?.length || 0) === 1 ? "формат" : "форматов"}
                </span>
            </div>

            {/* Tags */}
            {(pack.tags || []).length > 0 && (
                <div className="mt-2 flex gap-1 flex-wrap">
                    {(pack.tags || []).slice(0, 3).map((tag: any) => (
                        <span
                            key={tag.id}
                            className="text-[9px] px-1.5 py-0.5 rounded-full border border-border-primary text-text-tertiary"
                            style={tag.color ? { borderColor: tag.color + "40", color: tag.color } : undefined}
                        >
                            #{tag.label}
                        </span>
                    ))}
                </div>
            )}

            {/* Hover overlay */}
            <div className="absolute inset-0 rounded-2xl bg-accent-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        </button>
    );
}

/* ─── Filter Chip ────────────────────────────────────── */

function FilterChip({
    label,
    active,
    onClick,
}: {
    label: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all cursor-pointer border ${active
                ? "bg-accent-primary text-white border-accent-primary shadow-sm"
                : "bg-bg-surface text-text-secondary border-border-primary hover:border-accent-primary/30 hover:text-text-primary"
                }`}
        >
            {label}
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
    const [showFilters, setShowFilters] = useState(true);

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
        try {
            const { hydrateTemplate } = await import("@/services/templateService");
            const hydrated = hydrateTemplate(pack);
            const { useCanvasStore } = await import("@/store/canvasStore");
            useCanvasStore.getState().loadTemplatePack(hydrated);

            // Navigate to editor with the latest project
            const { useProjectStore } = await import("@/store/projectStore");
            const store = useProjectStore.getState();
            const project = store.createProject({
                name: pack.name,
                businessUnit: pack.businessUnits[0] || "other",
                goal: "banner",
            });
            store.setActiveProject(project.id);
            router.push(`/editor/${project.id}`);
        } catch (err) {
            console.error("Failed to load pack", err);
        }
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
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className={`flex items-center gap-1.5 h-10 px-4 rounded-xl border text-xs font-medium transition-all cursor-pointer ${showFilters
                                ? "bg-accent-primary/10 border-accent-primary/30 text-accent-primary"
                                : "bg-bg-surface border-border-primary text-text-secondary hover:text-text-primary"
                                }`}
                        >
                            <SlidersHorizontal size={14} />
                            Фильтры
                        </button>
                    </div>

                    {/* Filters */}
                    {showFilters && (
                        <div className="space-y-3 p-4 rounded-2xl border border-border-primary bg-bg-secondary/50 mb-4">
                            {/* BU filter */}
                            <div>
                                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2 block">
                                    Сервис
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                    {BU_OPTIONS.map(bu => (
                                        <FilterChip
                                            key={bu.value}
                                            label={bu.label}
                                            active={selectedBUs.includes(bu.value)}
                                            onClick={() => toggleBU(bu.value)}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Category filter */}
                            <div>
                                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2 block">
                                    Категория
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                    {CATEGORY_OPTIONS.map(cat => (
                                        <FilterChip
                                            key={cat.value}
                                            label={cat.label}
                                            active={selectedCategories.includes(cat.value)}
                                            onClick={() => toggleCategory(cat.value)}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Content type filter */}
                            <div>
                                <label className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2 block">
                                    Тип контента
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                    {CONTENT_TYPE_OPTIONS.map(ct => (
                                        <FilterChip
                                            key={ct.value}
                                            label={`${ct.emoji} ${ct.label}`}
                                            active={selectedContentType === ct.value}
                                            onClick={() => setSelectedContentType(selectedContentType === ct.value ? null : ct.value)}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Sort + Clear */}
                            <div className="flex items-center justify-between pt-2 border-t border-border-primary">
                                <div className="flex items-center gap-2">
                                    <ArrowUpDown size={12} className="text-text-tertiary" />
                                    <div className="flex gap-1">
                                        {SORT_OPTIONS.map(opt => (
                                            <button
                                                key={opt.value}
                                                onClick={() => setSortBy(opt.value)}
                                                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${sortBy === opt.value
                                                    ? "bg-bg-surface text-text-primary shadow-sm border border-border-primary"
                                                    : "text-text-tertiary hover:text-text-secondary"
                                                    }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                {hasFilters && (
                                    <button
                                        onClick={clearFilters}
                                        className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent-primary transition-colors cursor-pointer"
                                    >
                                        <X size={12} />
                                        Сбросить фильтры
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
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
