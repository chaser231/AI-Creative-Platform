"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    Badge as BadgeIcon,
    ChevronDown,
    ChevronUp,
    Image as ImageIcon,
    Loader2,
    Expand,
    Paintbrush,
    Ratio,
    RotateCcw,
    Settings2,
    Sparkles,
    Type,
    Upload,
    ZoomIn,
    ZoomOut,
} from "lucide-react";
import { RefAutocompleteTextarea, type RefAutocompleteTextareaHandle } from "@/components/ui/RefAutocompleteTextarea";
import { ReferenceImageInput } from "@/components/ui/ReferenceImageInput";
import { ImageStylePresetPicker, TextStylePresetPicker } from "@/components/ui/StylePresetPicker";
import { PreviewCanvas } from "@/components/editor/PreviewCanvas";
import { trpc } from "@/lib/trpc";
import { useProjectLibrary } from "@/hooks/useProjectLibrary";
import { useStylePresets } from "@/hooks/useStylePresets";
import { getMaxRefs, getModelById, getAspectRatios, getResolutions, resolveRefTags } from "@/lib/ai-models";
import { getImagePresetPromptSuffix } from "@/lib/stylePresets";
import { applyAllAutoLayouts } from "@/utils/layoutEngine";
import { compressImageFile, uploadForAI, uploadManyForAI } from "@/utils/imageUpload";
import { useThemeStore } from "@/store/themeStore";
import type { BusinessUnit, Layer, MasterComponent, TextGenPreset } from "@/types";
import type { TemplatePackV2 } from "@/services/templateService";

/** Resolves `system` the same way as ThemeProvider / editor canvas */
function useResolvedCanvasAppearance(): "light" | "dark" {
    const theme = useThemeStore((s) => s.theme);
    const [systemDark, setSystemDark] = useState(() => {
        if (typeof window === "undefined") return false;
        return window.matchMedia("(prefers-color-scheme: dark)").matches;
    });

    useEffect(() => {
        if (theme !== "system") return;
        if (typeof window === "undefined") return;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, [theme]);

    if (theme === "dark") return "dark";
    if (theme === "light") return "light";
    return systemDark ? "dark" : "light";
}

type EditableLayerType = "text" | "image" | "badge";
type SidebarTab = "layers" | "assets";

interface EditableLayerEntry {
    id: string;
    type: EditableLayerType;
    name: string;
    slotId?: string;
    layerId?: string;
    masterComponentId?: string;
    source: "masterComponent" | "layer";
    props: Record<string, unknown>;
}

interface PreviewFormatSource {
    id: string;
    name: string;
    label: string;
    isMaster: boolean;
    layers: Layer[];
    width: number;
    height: number;
}

interface AssetRow {
    id: string;
    url: string;
    filename: string;
    createdAt?: Date | string;
    metadata?: unknown;
}

interface WizardContentWorkspaceProps {
    selectedTemplate: TemplatePackV2;
    templateLoadError: string | null;
    textValues: Record<string, string>;
    imageValues: Record<string, string>;
    setTextValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    setImageValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    productDescription: string;
    projectBU: BusinessUnit;
    projectId?: string;
}

const TEXT_GEN_MODELS = [
    { id: "deepseek", label: "DeepSeek V3" },
    { id: "gemini-flash", label: "Gemini 2.5 Flash" },
];

const IMAGE_GEN_MODELS = [
    { id: "nano-banana-2", label: "Nano Banana 2" },
    { id: "nano-banana-pro", label: "Nano Banana Pro" },
    { id: "nano-banana", label: "Nano Banana" },
    { id: "flux-2-pro", label: "Flux 2 Pro" },
    { id: "seedream", label: "Seedream 4.5" },
    { id: "gpt-image", label: "GPT Image 1.5" },
    { id: "qwen-image", label: "Qwen Image" },
    { id: "flux-schnell", label: "Flux Schnell" },
    { id: "flux-dev", label: "Flux Dev" },
    { id: "flux-1.1-pro", label: "Flux 1.1 Pro" },
    { id: "dall-e-3", label: "DALL-E 3" },
];

const CONTENT_TYPES = ["text", "image", "badge"] as const;
type ImagePromptMode = "generate" | "edit" | "expand";

export function WizardContentWorkspace({
    selectedTemplate,
    templateLoadError,
    textValues,
    imageValues,
    setTextValues,
    setImageValues,
    productDescription,
    projectBU,
    projectId,
}: WizardContentWorkspaceProps) {
    const canvasAppearance = useResolvedCanvasAppearance();
    const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
    const previewFrameRef = useRef<HTMLDivElement | null>(null);
    const { registerFile } = useProjectLibrary();
    const previewFormats = useMemo(() => getPreviewFormatSources(selectedTemplate), [selectedTemplate]);
    const [activePreviewFormatId, setActivePreviewFormatId] = useState(previewFormats[0]?.id ?? "");
    const masterPreviewSource = previewFormats[0];
    const previewSource = previewFormats.find((format) => format.id === activePreviewFormatId) ?? masterPreviewSource;
    const entries = useMemo(
        () => getEditableLayerEntries(selectedTemplate, masterPreviewSource?.layers ?? []),
        [selectedTemplate, masterPreviewSource?.layers],
    );
    const [activeLayerId, setActiveLayerId] = useState(entries[0]?.id ?? "");
    const [sidebarTab, setSidebarTab] = useState<SidebarTab>("layers");
    const [previewZoom, setPreviewZoom] = useState(1);
    const [uploadingLayerId, setUploadingLayerId] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<{ layerId: string; message: string } | null>(null);
    const [previewSize, setPreviewSize] = useState({ width: 820, height: 520 });
    const [collapsedSections, setCollapsedSections] = useState<Record<EditableLayerType, boolean>>({
        text: false,
        image: false,
        badge: false,
    });

    useEffect(() => {
        setActivePreviewFormatId(previewFormats[0]?.id ?? "");
    }, [selectedTemplate.id, previewFormats]);

    useEffect(() => {
        if (previewFormats.length === 0) {
            setActivePreviewFormatId("");
            return;
        }
        if (!previewFormats.some((format) => format.id === activePreviewFormatId)) {
            setActivePreviewFormatId(previewFormats[0].id);
        }
    }, [activePreviewFormatId, previewFormats]);

    useEffect(() => {
        if (entries.length === 0) {
            setActiveLayerId("");
            return;
        }
        if (!entries.some((entry) => entry.id === activeLayerId)) {
            setActiveLayerId(entries[0].id);
        }
    }, [activeLayerId, entries]);

    useEffect(() => {
        const node = previewFrameRef.current;
        if (!node) return;

        const updateSize = () => {
            const rect = node.getBoundingClientRect();
            setPreviewSize({
                width: Math.max(320, Math.floor(rect.width)),
                height: Math.max(240, Math.floor(rect.height)),
            });
        };

        updateSize();
        const observer = new ResizeObserver(updateSize);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    const activeLayer = entries.find((entry) => entry.id === activeLayerId) ?? entries[0];
    const activeImageLayer = activeLayer?.type === "image" ? activeLayer : undefined;
    const assetsQuery = trpc.asset.listByProject.useQuery(
        { projectId: projectId ?? "", sortBy: "createdAt", sortOrder: "desc" },
        { enabled: !!projectId && sidebarTab === "assets", refetchOnWindowFocus: false },
    );
    const projectAssets = (assetsQuery.data ?? []) as AssetRow[];
    const draftPreviewLayers = useMemo(
        () => buildDraftPreviewLayers(previewSource.layers, entries, textValues, imageValues),
        [previewSource.layers, entries, textValues, imageValues],
    );

    const updateTextValue = (id: string, value: string) => {
        setTextValues((prev) => ({ ...prev, [id]: value }));
    };

    const updateImageValue = (id: string, value: string) => {
        setImageValues((prev) => ({ ...prev, [id]: value }));
    };

    const handleUploadImage = async (entry: EditableLayerEntry, file?: File) => {
        if (!file) return;
        setUploadError(null);
        setUploadingLayerId(entry.id);
        try {
            if (projectId) {
                const persistedUrl = await registerFile({
                    projectId,
                    file,
                    source: "wizard-upload",
                });
                if (persistedUrl) {
                    updateImageValue(entry.id, persistedUrl);
                    return;
                }
            }
            updateImageValue(entry.id, await compressImageFile(file));
        } catch (err) {
            console.error("Failed to upload image layer:", err);
            setUploadError({
                layerId: entry.id,
                message: "Не удалось загрузить изображение. Попробуйте другой файл.",
            });
        } finally {
            setUploadingLayerId(null);
            const input = fileInputRefs.current[entry.id];
            if (input) input.value = "";
        }
    };

    const handleApplyAssetToLayer = (asset: AssetRow) => {
        if (!activeImageLayer) return;
        updateImageValue(activeImageLayer.id, asset.url);
        setSidebarTab("layers");
    };

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {templateLoadError && (
                <div className="mx-6 mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                    {templateLoadError}
                </div>
            )}

            <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr] bg-bg-secondary">
                <aside className="min-h-0 overflow-y-auto border-r border-border-primary bg-bg-primary p-4">
                    <div className="mb-4 rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                            Мастер
                        </p>
                        <h2 className="mt-2 text-base font-semibold text-text-primary">Заполните контент</h2>
                        <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                            Выберите слой, внесите базовые правки и проверяйте изменения в live preview.
                        </p>
                    </div>

                    <div className="mb-3 grid grid-cols-2 gap-1 rounded-[var(--radius-lg)] border border-border-primary bg-bg-surface p-1">
                        <SidebarTabButton active={sidebarTab === "layers"} onClick={() => setSidebarTab("layers")}>
                            Слои
                        </SidebarTabButton>
                        <SidebarTabButton active={sidebarTab === "assets"} onClick={() => setSidebarTab("assets")}>
                            Ассеты
                        </SidebarTabButton>
                    </div>

                    {sidebarTab === "layers" ? (
                        <>
                            <LayerSection
                                type="text"
                                title="Тексты"
                                entries={entries.filter((entry) => entry.type === "text")}
                                activeLayerId={activeLayerId}
                                collapsed={collapsedSections.text}
                                onToggle={() => setCollapsedSections((prev) => ({ ...prev, text: !prev.text }))}
                                onSelect={setActiveLayerId}
                                renderEditor={(entry) => (
                                    <input
                                        value={textValues[entry.id] ?? String(entry.props.text ?? "")}
                                        onChange={(event) => updateTextValue(entry.id, event.target.value)}
                                        placeholder="Введите текст"
                                        className="h-9 w-full rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary px-3 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border-focus"
                                    />
                                )}
                            />

                            <LayerSection
                                type="image"
                                title="Фото"
                                entries={entries.filter((entry) => entry.type === "image")}
                                activeLayerId={activeLayerId}
                                collapsed={collapsedSections.image}
                                onToggle={() => setCollapsedSections((prev) => ({ ...prev, image: !prev.image }))}
                                onSelect={setActiveLayerId}
                                renderEditor={(entry) => (
                                    <div className="space-y-2">
                                        <input
                                            ref={(node) => { fileInputRefs.current[entry.id] = node; }}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(event) => void handleUploadImage(entry, event.target.files?.[0])}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => fileInputRefs.current[entry.id]?.click()}
                                            disabled={uploadingLayerId === entry.id}
                                            className="flex h-9 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-xs font-medium text-text-primary transition-colors hover:bg-bg-tertiary cursor-pointer"
                                        >
                                            {uploadingLayerId === entry.id ? (
                                                <Loader2 size={13} className="animate-spin text-text-secondary" />
                                            ) : (
                                                <Upload size={13} className="text-text-secondary" />
                                            )}
                                            {uploadingLayerId === entry.id ? "Загружаю..." : "Загрузить фото"}
                                        </button>
                                        {uploadError?.layerId === entry.id && (
                                            <p className="text-[10px] font-medium leading-snug text-text-error">
                                                {uploadError.message}
                                            </p>
                                        )}
                                        {Boolean(imageValues[entry.id] || entry.props.src) && (
                                            <div className="h-16 overflow-hidden rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary">
                                                <img
                                                    src={imageValues[entry.id] ?? String(entry.props.src)}
                                                    alt={entry.name}
                                                    className="h-full w-full object-cover"
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}
                            />

                            <LayerSection
                                type="badge"
                                title="Бейджи"
                                entries={entries.filter((entry) => entry.type === "badge")}
                                activeLayerId={activeLayerId}
                                collapsed={collapsedSections.badge}
                                onToggle={() => setCollapsedSections((prev) => ({ ...prev, badge: !prev.badge }))}
                                onSelect={setActiveLayerId}
                                renderEditor={(entry) => (
                                    <input
                                        value={textValues[entry.id] ?? String(entry.props.label ?? "")}
                                        onChange={(event) => updateTextValue(entry.id, event.target.value)}
                                        placeholder="Введите бейдж"
                                        className="h-9 w-full rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary px-3 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border-focus"
                                    />
                                )}
                            />
                        </>
                    ) : (
                        <WizardAssetPanel
                            assets={projectAssets}
                            isLoading={assetsQuery.isLoading}
                            canApply={!!activeImageLayer}
                            activeLayerName={activeImageLayer?.name}
                            onApply={handleApplyAssetToLayer}
                        />
                    )}
                </aside>

                <main className="relative min-h-0 overflow-hidden p-4">
                    <div className="absolute left-6 top-6 z-10 rounded-full border border-accent-lime-hover/50 bg-accent-lime/15 px-3 py-1.5 text-xs font-medium text-text-primary shadow-sm">
                        {activeLayer ? `Выбран слой: ${activeLayer.name}` : "Выберите слой"}
                    </div>
                    <div className="absolute right-6 top-6 z-10 flex items-center gap-1 rounded-full border border-border-primary bg-bg-surface/90 p-1 shadow-[var(--shadow-sm)] backdrop-blur">
                        <ZoomButton label="Уменьшить" onClick={() => setPreviewZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))))}>
                            <ZoomOut size={14} />
                        </ZoomButton>
                        <button
                            type="button"
                            onClick={() => setPreviewZoom(1)}
                            className="flex h-7 min-w-12 items-center justify-center rounded-full px-2 text-[11px] font-semibold text-text-secondary hover:bg-bg-tertiary hover:text-text-primary cursor-pointer"
                            title="Сбросить масштаб"
                        >
                            {Math.round(previewZoom * 100)}%
                        </button>
                        <ZoomButton label="Увеличить" onClick={() => setPreviewZoom((value) => Math.min(3, Number((value + 0.25).toFixed(2))))}>
                            <ZoomIn size={14} />
                        </ZoomButton>
                        <ZoomButton label="100%" onClick={() => setPreviewZoom(1)}>
                            <RotateCcw size={13} />
                        </ZoomButton>
                    </div>
                    <div
                        ref={previewFrameRef}
                        className={`flex h-full items-center justify-center rounded-[var(--radius-xl)] border border-border-primary bg-bg-canvas ${previewFormats.length > 1 ? "pr-20" : ""}`}
                        style={{
                            backgroundImage:
                                "radial-gradient(circle, var(--border-primary) 1px, transparent 1px)",
                            backgroundSize: "20px 20px",
                        }}
                    >
                        {draftPreviewLayers.length > 0 ? (
                            <PreviewCanvas
                                layers={draftPreviewLayers}
                                artboardWidth={previewSource.width}
                                artboardHeight={previewSource.height}
                                containerWidth={previewFormats.length > 1 ? Math.max(320, previewSize.width - 80) : previewSize.width}
                                containerHeight={previewSize.height}
                                zoom={previewZoom}
                                appearance={canvasAppearance}
                            />
                        ) : (
                            <div className="text-sm text-text-tertiary">Нет слоёв для предпросмотра</div>
                        )}
                    </div>

                    {previewFormats.length > 1 && (
                        <FormatThumbnailRail
                            formats={previewFormats}
                            activeFormatId={previewSource.id}
                            onSelect={setActivePreviewFormatId}
                        />
                    )}

                    <WizardLayerPromptBar
                        activeLayer={activeLayer}
                        textValues={textValues}
                        imageValues={imageValues}
                        projectBU={projectBU}
                        projectId={projectId}
                        productDescription={productDescription}
                        onTextChange={updateTextValue}
                        onImageChange={updateImageValue}
                    />
                </main>
            </div>
        </div>
    );
}

function LayerSection({
    type,
    title,
    entries,
    activeLayerId,
    collapsed,
    onToggle,
    onSelect,
    renderEditor,
}: {
    type: EditableLayerType;
    title: string;
    entries: EditableLayerEntry[];
    activeLayerId: string;
    collapsed: boolean;
    onToggle: () => void;
    onSelect: (id: string) => void;
    renderEditor: (entry: EditableLayerEntry) => React.ReactNode;
}) {
    const Icon = type === "text" ? Type : type === "image" ? ImageIcon : BadgeIcon;

    if (entries.length === 0) return null;

    return (
        <section className="mb-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-surface">
            <button
                onClick={onToggle}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left cursor-pointer"
            >
                <span className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                    <Icon size={14} className="text-text-secondary" />
                    {title}
                    <span className="text-[10px] font-normal text-text-tertiary">{entries.length}</span>
                </span>
                <ChevronDown
                    size={14}
                    className={`text-text-tertiary transition-transform ${collapsed ? "-rotate-90" : ""}`}
                />
            </button>
            {!collapsed && (
                <div className="space-y-2 border-t border-border-primary p-2">
                    {entries.map((entry) => {
                            const active = entry.id === activeLayerId;
                            return (
                                <div
                                    key={entry.id}
                                    className={`rounded-[var(--radius-md)] border p-2 transition-all ${
                                        active
                                            ? "border-accent-lime-hover bg-accent-lime/10 shadow-[var(--shadow-sm)]"
                                            : "border-border-primary bg-bg-primary hover:border-border-secondary"
                                    }`}
                                >
                                    <button
                                        onClick={() => onSelect(entry.id)}
                                        className="mb-2 flex w-full items-center gap-2 text-left cursor-pointer"
                                    >
                                        <span className={`h-3 w-3 rounded-full border ${active ? "border-accent-lime-hover bg-accent-lime" : "border-border-secondary"}`} />
                                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
                                            {entry.name}
                                        </span>
                                    </button>
                                    {active && renderEditor(entry)}
                                </div>
                            );
                    })}
                </div>
            )}
        </section>
    );
}

function SidebarTabButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-[var(--radius-md)] px-3 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                active
                    ? "bg-bg-primary text-text-primary shadow-[var(--shadow-sm)]"
                    : "text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
            }`}
        >
            {children}
        </button>
    );
}

function WizardAssetPanel({
    assets,
    isLoading,
    canApply,
    activeLayerName,
    onApply,
}: {
    assets: AssetRow[];
    isLoading: boolean;
    canApply: boolean;
    activeLayerName?: string;
    onApply: (asset: AssetRow) => void;
}) {
    if (isLoading) {
        return (
            <div className="flex items-center justify-center rounded-[var(--radius-lg)] border border-border-primary bg-bg-surface py-10">
                <Loader2 size={16} className="animate-spin text-text-tertiary" />
            </div>
        );
    }

    if (assets.length === 0) {
        return (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-border-primary bg-bg-surface px-4 py-8 text-center">
                <ImageIcon size={22} className="mx-auto mb-2 text-text-tertiary" />
                <p className="text-xs font-medium text-text-primary">История ассетов пуста</p>
                <p className="mt-1 text-[11px] leading-relaxed text-text-tertiary">
                    Сгенерируйте или загрузите изображение — оно появится здесь для отката.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="rounded-[var(--radius-lg)] border border-border-primary bg-bg-surface px-3 py-2">
                <p className="text-[11px] font-medium text-text-primary">
                    {canApply ? `Применить к слою: ${activeLayerName}` : "Выберите image-слой"}
                </p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-text-tertiary">
                    Нажмите на ассет, чтобы заменить выбранное изображение.
                </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
                {assets.map((asset) => (
                    <button
                        key={asset.id}
                        type="button"
                        disabled={!canApply}
                        onClick={() => onApply(asset)}
                        className="group relative aspect-square overflow-hidden rounded-[var(--radius-md)] border border-border-primary bg-bg-tertiary text-left transition-all hover:border-accent-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
                        title={canApply ? "Применить ассет к выбранному слою" : "Сначала выберите image-слой"}
                    >
                        <img
                            src={asset.url}
                            alt={asset.filename || "asset"}
                            className="h-full w-full object-cover"
                            draggable={false}
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <p className="truncate text-[10px] font-medium text-white">
                                {asset.filename || "asset"}
                            </p>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}

function ZoomButton({
    label,
    onClick,
    children,
}: {
    label: string;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            className="flex h-7 w-7 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer"
        >
            {children}
        </button>
    );
}

function FormatThumbnailRail({
    formats,
    activeFormatId,
    onSelect,
}: {
    formats: PreviewFormatSource[];
    activeFormatId: string;
    onSelect: (id: string) => void;
}) {
    const railRef = useRef<HTMLDivElement | null>(null);
    const [scrollIndex, setScrollIndex] = useState(0);
    const [visibleCount, setVisibleCount] = useState(6);

    useEffect(() => {
        const node = railRef.current;
        if (!node) return;

        const updateVisibleCount = () => {
            const rect = node.getBoundingClientRect();
            // ~72px item height + 8px gap, with space reserved for arrow controls.
            setVisibleCount(Math.max(1, Math.floor((rect.height - 64) / 80)));
        };

        updateVisibleCount();
        const observer = new ResizeObserver(updateVisibleCount);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        setScrollIndex((value) => Math.min(value, Math.max(0, formats.length - visibleCount)));
    }, [formats.length, visibleCount]);

    useEffect(() => {
        const activeIndex = formats.findIndex((format) => format.id === activeFormatId);
        if (activeIndex < 0) return;
        setScrollIndex((value) => {
            if (activeIndex < value) return activeIndex;
            if (activeIndex >= value + visibleCount) {
                return Math.min(activeIndex, Math.max(0, formats.length - visibleCount));
            }
            return value;
        });
    }, [activeFormatId, formats, visibleCount]);

    const canScrollUp = scrollIndex > 0;
    const canScrollDown = scrollIndex + visibleCount < formats.length;
    const visibleFormats = formats.slice(scrollIndex, scrollIndex + visibleCount);

    const scrollByPage = (direction: 1 | -1) => {
        setScrollIndex((value) => {
            const maxIndex = Math.max(0, formats.length - visibleCount);
            return Math.min(maxIndex, Math.max(0, value + direction * Math.max(1, visibleCount - 1)));
        });
    };

    return (
        <div
            ref={railRef}
            className="absolute bottom-24 right-5 top-20 z-20 flex w-16 flex-col items-center gap-2"
            aria-label="Форматы шаблон-пакета"
            role="listbox"
        >
            {canScrollUp && (
                <button
                    type="button"
                    onClick={() => scrollByPage(-1)}
                    className="flex h-7 w-14 items-center justify-center rounded-[var(--radius-sm)] border border-border-primary bg-bg-surface/90 text-text-secondary shadow-[var(--shadow-sm)] backdrop-blur transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer"
                    aria-label="Показать предыдущие форматы"
                >
                    <ChevronUp size={14} />
                </button>
            )}

            <div className="flex min-h-0 flex-col gap-3">
                {visibleFormats.map((format) => {
                    const active = format.id === activeFormatId;
                    const aspectScale = Math.min(34 / format.width, 34 / format.height);
                    const thumbWidth = Math.max(10, Math.round(format.width * aspectScale));
                    const thumbHeight = Math.max(10, Math.round(format.height * aspectScale));

                    return (
                        <div key={format.id} className="flex flex-col items-center gap-1">
                            <button
                                type="button"
                                role="option"
                                onClick={() => onSelect(format.id)}
                                aria-label={`Показать формат ${format.label}`}
                                aria-selected={active}
                                aria-current={active ? "true" : undefined}
                                title={`${format.name} · ${format.label}`}
                                className={`group flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--radius-md)] border bg-bg-surface/90 shadow-[var(--shadow-sm)] backdrop-blur transition-all cursor-pointer ${
                                    active
                                        ? "border-accent-lime-hover ring-2 ring-accent-lime/35"
                                        : "border-border-primary hover:border-border-secondary hover:bg-bg-tertiary"
                                }`}
                            >
                                <span
                                    className={`relative flex items-center justify-center rounded-[6px] border transition-colors ${
                                        active
                                            ? "border-accent-lime-hover bg-accent-lime/20"
                                            : "border-border-secondary bg-bg-secondary group-hover:border-border-primary"
                                    }`}
                                    style={{ width: thumbWidth, height: thumbHeight }}
                                >
                                    <span className="absolute left-[18%] top-[20%] h-[12%] w-[48%] rounded-full bg-text-tertiary/35" />
                                    <span className="absolute bottom-[18%] left-[18%] h-[18%] w-[64%] rounded-sm bg-text-tertiary/20" />
                                </span>
                            </button>
                            <span className="w-full truncate text-center text-[9px] font-medium text-text-tertiary" title={format.label}>
                                {format.label.replace(/\s/g, "")}
                            </span>
                        </div>
                    );
                })}
            </div>

            {canScrollDown && (
                <button
                    type="button"
                    onClick={() => scrollByPage(1)}
                    className="flex h-7 w-14 items-center justify-center rounded-[var(--radius-sm)] border border-border-primary bg-bg-surface/90 text-text-secondary shadow-[var(--shadow-sm)] backdrop-blur transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer"
                    aria-label="Показать следующие форматы"
                >
                    <ChevronDown size={14} />
                </button>
            )}
        </div>
    );
}

function WizardLayerPromptBar({
    activeLayer,
    textValues,
    imageValues,
    projectBU,
    projectId,
    productDescription,
    onTextChange,
    onImageChange,
}: {
    activeLayer?: EditableLayerEntry;
    textValues: Record<string, string>;
    imageValues: Record<string, string>;
    projectBU: BusinessUnit;
    projectId?: string;
    productDescription: string;
    onTextChange: (id: string, value: string) => void;
    onImageChange: (id: string, value: string) => void;
}) {
    const promptRef = useRef<RefAutocompleteTextareaHandle>(null);
    const { registerUrl } = useProjectLibrary();
    const { imagePresets, textPresets } = useStylePresets();
    const [prompt, setPrompt] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedModel, setSelectedModel] = useState("flux-dev");
    const [textModel, setTextModel] = useState("deepseek");
    const [aspectRatio, setAspectRatio] = useState("1:1");
    const [imageStyleId, setImageStyleId] = useState("none");
    const [textStyleId, setTextStyleId] = useState<TextGenPreset | "none">("none");
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const [scale, setScale] = useState("");
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [imageMode, setImageMode] = useState<ImagePromptMode>("generate");
    const modelAspectRatios = getAspectRatios(selectedModel);
    const modelResolutions = getResolutions(selectedModel);
    const supportsVision = getModelById(selectedModel)?.caps.includes("vision") ?? false;

    useEffect(() => {
        setPrompt("");
        setError(null);
        setReferenceImages([]);
        setShowAdvanced(false);
        setImageMode("generate");
    }, [activeLayer?.id]);

    const handleGenerate = async () => {
        if (!activeLayer) return;
        const isImageLayer = activeLayer.type === "image";
        const currentImage = isImageLayer ? imageValues[activeLayer.id] ?? String(activeLayer.props.src ?? "") : "";
        const basePrompt = prompt.trim() || (!isImageLayer ? productDescription.trim() : "");
        if (!basePrompt && (!isImageLayer || imageMode !== "expand")) {
            setError("Введите промпт для выбранного слоя");
            return;
        }

        setError(null);
        setIsGenerating(true);
        try {
            if (activeLayer.type === "text" || activeLayer.type === "badge") {
                const { generateTextVariants } = await import("@/services/aiService");
                const [result] = await generateTextVariants(
                    basePrompt,
                    activeLayer.name,
                    1,
                    projectBU,
                    textStyleId === "none" ? undefined : (textStyleId as TextGenPreset),
                    textModel
                );
                if (result) onTextChange(activeLayer.id, result);
                return;
            }

            if (imageMode !== "generate") {
                if (!currentImage) {
                    setError("Для редактирования сначала загрузите или сгенерируйте изображение слоя");
                    return;
                }

                const [imageUrl, refUrls] = await Promise.all([
                    uploadForAI(currentImage, projectId || "ai-tmp"),
                    referenceImages.length > 0
                        ? uploadManyForAI(referenceImages, projectId || "ai-tmp")
                        : Promise.resolve(undefined),
                ]);
                const layerWidth = Number(activeLayer.props.width ?? 1024);
                const layerHeight = Number(activeLayer.props.height ?? 1024);
                const expandPadding = {
                    top: Math.round(layerHeight * 0.2),
                    right: Math.round(layerWidth * 0.2),
                    bottom: Math.round(layerHeight * 0.2),
                    left: Math.round(layerWidth * 0.2),
                };
                const editModel = getModelById(selectedModel)?.caps.includes("edit")
                    ? selectedModel
                    : "nano-banana-2";
                const response = await fetch("/api/ai/image-edit", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: imageMode === "expand" ? "outpaint" : "text-edit",
                        prompt: imageMode === "expand" ? basePrompt || "Extend the background seamlessly" : basePrompt,
                        imageBase64: imageUrl,
                        model: imageMode === "expand" ? "bria-expand" : editModel,
                        referenceImages: refUrls,
                        expandPadding: imageMode === "expand" ? expandPadding : undefined,
                        projectId,
                    }),
                });
                const data = await response.json();
                if (data.error) throw new Error(data.requestId ? `${data.error} [request: ${data.requestId}]` : data.error);
                if (data.content) {
                    const persisted = projectId
                        ? await registerUrl({
                            projectId,
                            url: data.content,
                            source: imageMode === "expand" ? "wizard-edit-expand" : "wizard-edit",
                        })
                        : null;
                    onImageChange(activeLayer.id, persisted ?? data.content);
                }
                return;
            }

            const styleSuffix = getImagePresetPromptSuffix(imageStyleId, imagePresets);
            const styleContext = styleSuffix ? `. Style: ${styleSuffix}` : "";
            const finalPrompt = `${basePrompt}${styleContext}`;
            const refUrls = referenceImages.length > 0
                ? await uploadManyForAI(referenceImages, projectId || "ai-tmp")
                : undefined;
            const response = await fetch("/api/ai/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: resolveRefTags(finalPrompt, selectedModel),
                    type: "image",
                    model: selectedModel,
                    aspectRatio,
                    scale: scale || undefined,
                    count: 1,
                    referenceImages: refUrls,
                    projectId,
                }),
            });
            const data = await response.json();
            if (data.error) throw new Error(data.requestId ? `${data.error} [request: ${data.requestId}]` : data.error);
            if (data.content) {
                const persisted = projectId
                    ? await registerUrl({
                        projectId,
                        url: data.content,
                        source: "wizard-generation",
                    })
                    : null;
                onImageChange(activeLayer.id, persisted ?? data.content);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Не удалось выполнить генерацию");
        } finally {
            setIsGenerating(false);
        }
    };

    if (!activeLayer) {
        return null;
    }

    const isImage = activeLayer.type === "image";
    const currentImage = isImage ? imageValues[activeLayer.id] ?? String(activeLayer.props.src ?? "") : "";
    const selectedLabel = activeLayer.type === "text" ? "текстом" : activeLayer.type === "badge" ? "бейджем" : "фото";

    return (
        <div className="absolute bottom-6 left-1/2 z-20 w-[760px] max-w-[calc(100%-32px)] -translate-x-1/2 rounded-[20px] border border-border-primary bg-bg-surface/95 shadow-[var(--shadow-lg)] backdrop-blur-xl">
            <div className="flex items-center gap-2 border-b border-border-primary px-4 py-2">
                <span className="rounded-full bg-accent-lime/20 px-2 py-1 text-[11px] font-medium text-text-primary">
                    Работаем с {selectedLabel}: {activeLayer.name}
                </span>
                {currentImage && (
                    <span className="truncate text-[11px] text-text-tertiary">
                        {imageMode === "generate"
                            ? "Текущее изображение будет заменено результатом генерации"
                            : imageMode === "expand"
                                ? "Фон будет расширен AI и заменит изображение слоя"
                                : "AI отредактирует текущее изображение слоя"}
                    </span>
                )}
            </div>

            <div className="px-4 pt-3">
                <RefAutocompleteTextarea
                    ref={promptRef}
                    value={prompt}
                    onChange={(value) => { setPrompt(value); setError(null); }}
                    referenceImages={referenceImages}
                    placeholder={isImage
                        ? imageMode === "edit"
                            ? "Опишите правку: заменить фон, добавить тень, изменить освещение..."
                            : imageMode === "expand"
                                ? "Описание расширенной области (опционально)..."
                                : "Опишите изображение для выбранного слоя..."
                        : "Опишите, какой текст сгенерировать..."}
                    className="h-12 w-full resize-none bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
                />
            </div>

            {error && (
                <div className="mx-4 mb-2 rounded-[var(--radius-md)] border border-text-error/20 bg-text-error/10 px-3 py-2">
                    <p className="text-[11px] font-medium text-text-error">{error}</p>
                </div>
            )}

            <div className="flex items-center gap-2 px-4 pb-3 pt-1">
                {isImage && (
                    <>
                        <div className="flex h-8 rounded-[10px] border border-border-primary/60 bg-bg-primary p-0.5">
                            <ImageModeButton
                                active={imageMode === "generate"}
                                label="Генерация"
                                icon={<Sparkles size={14} />}
                                onClick={() => setImageMode("generate")}
                            />
                            <ImageModeButton
                                active={imageMode === "edit"}
                                label="Правка"
                                icon={<Paintbrush size={14} />}
                                onClick={() => setImageMode("edit")}
                            />
                            <ImageModeButton
                                active={imageMode === "expand"}
                                label="Расширить фон"
                                icon={<Expand size={14} />}
                                onClick={() => setImageMode("expand")}
                            />
                        </div>
                        <OutlinedSelector icon={<Settings2 size={13} />}>
                            <select
                                value={selectedModel}
                                onChange={(event) => setSelectedModel(event.target.value)}
                                className="max-w-[150px] appearance-none bg-transparent text-[12px] font-medium text-text-secondary focus:outline-none cursor-pointer"
                            >
                                {IMAGE_GEN_MODELS.map((model) => (
                                    <option key={model.id} value={model.id}>{model.label}</option>
                                ))}
                            </select>
                        </OutlinedSelector>
                        {imageMode === "generate" && (
                            <>
                                <OutlinedSelector icon={<Ratio size={13} />}>
                                    <select
                                        value={aspectRatio}
                                        onChange={(event) => setAspectRatio(event.target.value)}
                                        className="appearance-none bg-transparent text-[12px] font-medium text-text-secondary focus:outline-none cursor-pointer"
                                    >
                                        {modelAspectRatios.map((ratio) => (
                                            <option key={ratio} value={ratio}>{ratio}</option>
                                        ))}
                                    </select>
                                </OutlinedSelector>
                                <ImageStylePresetPicker
                                    presets={imagePresets}
                                    selectedId={imageStyleId}
                                    onChange={setImageStyleId}
                                    variant="compact"
                                />
                            </>
                        )}
                        {supportsVision && (
                            <ReferenceImageInput
                                images={referenceImages}
                                onChange={setReferenceImages}
                                max={getMaxRefs(selectedModel)}
                                label="Референс"
                                onTagClick={(tag) => promptRef.current?.insertAtCursor(tag)}
                            />
                        )}
                        {imageMode === "generate" && modelResolutions.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setShowAdvanced((value) => !value)}
                                aria-label="Дополнительные настройки генерации"
                                className={`flex h-8 items-center gap-1.5 rounded-[10px] border px-2.5 text-[12px] font-medium transition-colors cursor-pointer ${
                                    showAdvanced
                                        ? "border-accent-primary/40 bg-accent-primary/10 text-accent-primary"
                                        : "border-border-primary/60 text-text-secondary hover:border-border-secondary"
                                }`}
                            >
                                <Settings2 size={13} />
                            </button>
                        )}
                    </>
                )}

                {!isImage && (
                    <>
                        <OutlinedSelector icon={<Settings2 size={13} />}>
                            <select
                                value={textModel}
                                onChange={(event) => setTextModel(event.target.value)}
                                className="max-w-[150px] appearance-none bg-transparent text-[12px] font-medium text-text-secondary focus:outline-none cursor-pointer"
                            >
                                {TEXT_GEN_MODELS.map((model) => (
                                    <option key={model.id} value={model.id}>{model.label}</option>
                                ))}
                            </select>
                        </OutlinedSelector>
                        <TextStylePresetPicker
                            presets={textPresets}
                            selectedId={textStyleId}
                            onChange={(val) => setTextStyleId((val as TextGenPreset) || "none")}
                            variant="compact"
                        />
                    </>
                )}

                <div className="flex-1" />

                <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-lime-hover text-accent-lime-text shadow-sm transition-all duration-200 cursor-pointer hover:bg-accent-lime hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Сгенерировать для выбранного слоя"
                >
                    {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                </button>
            </div>

            {isImage && showAdvanced && modelResolutions.length > 0 && (
                <div className="border-t border-border-primary bg-bg-secondary/50 px-4 py-3">
                    <label className="flex items-center gap-2 text-[11px] text-text-secondary">
                        Разрешение
                        <select
                            value={scale}
                            onChange={(event) => setScale(event.target.value)}
                            className="h-8 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary px-2 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
                        >
                            <option value="">Авто</option>
                            {modelResolutions.map((resolution) => (
                                <option key={resolution.id} value={resolution.id}>
                                    {resolution.label}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            )}
        </div>
    );
}

function ImageModeButton({
    active,
    label,
    icon,
    onClick,
}: {
    active: boolean;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            className={`flex h-7 w-7 items-center justify-center rounded-[8px] transition-colors cursor-pointer ${
                active
                    ? "bg-accent-primary/10 text-accent-primary"
                    : "text-text-secondary hover:bg-bg-tertiary"
            }`}
        >
            {icon}
            <span className="sr-only">{label}</span>
        </button>
    );
}

function OutlinedSelector({
    icon,
    children,
}: {
    icon?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="flex h-8 items-center gap-1.5 rounded-[10px] border border-border-primary/60 px-2.5 text-text-secondary transition-colors hover:border-border-secondary hover:bg-bg-tertiary/30">
            {icon && <span className="text-text-tertiary">{icon}</span>}
            {children}
        </div>
    );
}

function getPreviewFormatSources(template: TemplatePackV2): PreviewFormatSource[] {
    const data = template as TemplatePackV2 & {
        layers?: Layer[];
        canvasWidth?: number;
        canvasHeight?: number;
    };
    const resizes = template.resizes ?? [];
    const masterResize = resizes.find((resize) => resize.isMaster) ?? resizes[0];
    const fallbackLayers =
        data.layers?.length
            ? data.layers
            : template.masterComponents.map(masterComponentToLayer).filter(Boolean) as Layer[];
    const fallbackWidth = data.canvasWidth ?? masterResize?.width ?? template.baseWidth ?? 1080;
    const fallbackHeight = data.canvasHeight ?? masterResize?.height ?? template.baseHeight ?? 1080;
    const sources: PreviewFormatSource[] = [];

    const pushSource = (source: PreviewFormatSource) => {
        if (sources.some((existing) => existing.id === source.id)) return;
        sources.push(source);
    };

    if (masterResize?.layerSnapshot?.length) {
        pushSource(resizeToPreviewSource(masterResize, true));
    } else {
        pushSource({
            id: masterResize?.id ?? "master",
            name: masterResize?.name ?? "Мастер",
            label: masterResize?.label ?? `${fallbackWidth} × ${fallbackHeight}`,
            isMaster: true,
            layers: fallbackLayers,
            width: fallbackWidth,
            height: fallbackHeight,
        });
    }

    for (const resize of resizes) {
        if (!resize.layerSnapshot?.length) continue;
        pushSource(resizeToPreviewSource(resize, resize.id === masterResize?.id || resize.isMaster === true));
    }

    return sources.length > 0
        ? sources
        : [{
            id: "master",
            name: "Мастер",
            label: `${fallbackWidth} × ${fallbackHeight}`,
            isMaster: true,
            layers: fallbackLayers,
            width: fallbackWidth,
            height: fallbackHeight,
        }];
}

function resizeToPreviewSource(
    resize: NonNullable<TemplatePackV2["resizes"]>[number],
    isMaster: boolean,
): PreviewFormatSource {
    return {
        id: resize.id,
        name: isMaster ? (resize.name || "Мастер") : (resize.name || "Формат"),
        label: resize.label ?? `${resize.width} × ${resize.height}`,
        isMaster,
        layers: resize.layerSnapshot ?? [],
        width: resize.width,
        height: resize.height,
    };
}

function getEditableLayerEntries(template: TemplatePackV2, masterLayers: Layer[]): EditableLayerEntry[] {
    const rawEntries = new Map<string, EditableLayerEntry>();

    for (const layer of masterLayers) {
        if (!CONTENT_TYPES.includes(layer.type as EditableLayerType)) continue;
        if (layer.type === "image" && layer.isFixedAsset) continue;
        if (!layer.slotId || layer.slotId === "none") continue;

        rawEntries.set(`${layer.type}:${layer.slotId}`, {
            id: layer.id,
            type: layer.type as EditableLayerType,
            name: layer.name,
            slotId: layer.slotId,
            layerId: layer.id,
            source: "layer",
            props: layer as unknown as Record<string, unknown>,
        });
    }

    const entries = new Map(rawEntries);

    for (const mc of template.masterComponents) {
        if (!CONTENT_TYPES.includes(mc.type as EditableLayerType)) continue;
        if (((mc.props as unknown as Record<string, unknown>).isFixedAsset) && mc.type === "image") continue;

        const entry = masterComponentToEntry(mc);
        if (!entry.slotId || entry.slotId === "none") continue;

        const key = `${entry.type}:${entry.slotId}`;
        const matchingLayer = rawEntries.get(key);
        entries.set(key, {
            ...entry,
            layerId: matchingLayer?.layerId,
            props: { ...(matchingLayer?.props ?? {}), ...entry.props },
        });
    }

    return [...entries.values()];
}

function masterComponentToEntry(mc: MasterComponent): EditableLayerEntry {
    return {
        id: mc.id,
        type: mc.type as EditableLayerType,
        name: mc.name,
        slotId: mc.slotId ?? (mc.props as unknown as Record<string, unknown>).slotId as string | undefined,
        masterComponentId: mc.id,
        source: "masterComponent",
        props: mc.props as unknown as Record<string, unknown>,
    };
}

function masterComponentToLayer(mc: MasterComponent): Layer | null {
    if (!["text", "image", "badge", "rectangle", "frame"].includes(mc.type)) return null;
    return {
        ...(mc.props as unknown as Record<string, unknown>),
        id: mc.id,
        type: mc.type,
        name: mc.name,
        visible: (mc.props as unknown as Record<string, unknown>).visible ?? true,
        locked: (mc.props as unknown as Record<string, unknown>).locked ?? false,
    } as Layer;
}

function buildDraftPreviewLayers(
    layers: Layer[],
    entries: EditableLayerEntry[],
    textValues: Record<string, string>,
    imageValues: Record<string, string>,
): Layer[] {
    const entryBySlot = new Map(entries.filter((entry) => entry.slotId).map((entry) => [entry.slotId, entry]));
    const nextLayers = layers.map((layer) => {
        const slotEntry = layer.slotId ? entryBySlot.get(layer.slotId) : undefined;
        const candidateIds = [
            layer.id,
            layer.masterId,
            slotEntry?.id,
            slotEntry?.layerId,
            slotEntry?.masterComponentId,
        ].filter(Boolean) as string[];
        const textValue = candidateIds.map((id) => textValues[id]).find((value) => value !== undefined);
        const imageValue = candidateIds.map((id) => imageValues[id]).find((value) => value !== undefined);

        if (layer.type === "text" && textValue !== undefined) {
            return { ...layer, text: textValue };
        }
        if (layer.type === "badge" && textValue !== undefined) {
            return { ...layer, label: textValue };
        }
        if (layer.type === "image" && imageValue !== undefined && !layer.isFixedAsset) {
            return { ...layer, src: imageValue };
        }
        return { ...layer };
    });

    return applyAllAutoLayouts(nextLayers);
}
