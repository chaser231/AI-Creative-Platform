"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Badge as BadgeIcon,
    ChevronDown,
    ChevronUp,
    Image as ImageIcon,
    Loader2,
    Expand,
    Paintbrush,
    Brush,
    Ratio,
    RotateCcw,
    Settings2,
    Sliders,
    Sparkles,
    Type,
    Upload,
    ZoomIn,
    ZoomOut,
    Maximize2,
    Eraser,
} from "lucide-react";
import { RefAutocompleteTextarea, type RefAutocompleteTextareaHandle } from "@/components/ui/RefAutocompleteTextarea";
import { ReferenceImageInput, ReferenceImagePreviewTray, getReferenceTrayReserveWidth } from "@/components/ui/ReferenceImageInput";
import { ImageStylePresetPicker, TextStylePresetPicker } from "@/components/ui/StylePresetPicker";
import { GeneratedImageStrip, type GeneratedImageVariant } from "@/components/ui/GeneratedImageStrip";
import { parseGenerationError } from "@/lib/parseGenerationError";
import {
    formatProjectQueueBadge,
    truncatePromptLabel,
    useGenerationQueueStore,
    useProjectQueueCounts,
} from "@/store/generationQueueStore";
import { SelectPill } from "@/components/ui/SelectPill";
import { LoraSelectorPicker } from "@/components/ui/LoraSelectorPicker";
import { LoraTriggerHint } from "@/components/ui/LoraTriggerHint";
import { ModelSettingsModal, type AdvancedAIParams } from "@/components/ui/ModelSettingsModal";
import { PreviewCanvas } from "@/components/editor/PreviewCanvas";
import { PaintInput } from "@/components/editor/properties/PaintInput";
import { ArtboardBackgroundControls } from "@/components/editor/properties/ArtboardBackgroundControls";
import { applyBackgroundSwatchToArtboardProps } from "@/lib/resolveWizardArtboardProps";
import { paintToCssBackground } from "@/utils/paint";
import type { ArtboardProps } from "@/store/canvas/types";
import { DEFAULT_PALETTE } from "@/types";
import type { BackgroundSwatchValue, Paint, Swatch } from "@/types";
import { trpc } from "@/lib/trpc";
import { useProjectLibrary } from "@/hooks/useProjectLibrary";
import { useStylePresets } from "@/hooks/useStylePresets";
import { getMaxRefs, getMaxOutputs, getModelById, getAspectRatios, getResolutions, getDefaultResolution, getLoraSpec, resolveRefTags } from "@/lib/ai-models";
import type { LoraWeight } from "@/lib/ai-providers";
import { getImagePresetPromptSuffixForModel } from "@/lib/stylePresets";
import { applyAllAutoLayouts } from "@/utils/layoutEngine";
import { compressImageFile, persistImageToS3, uploadForAI, uploadManyForAI } from "@/utils/imageUpload";
import { getOutpaintModel } from "@/utils/outpaintModel";
import { mapOutpaintStage, type OutpaintProgressState } from "@/utils/outpaintProgress";
import { OutpaintProgressIndicator } from "@/components/ui/OutpaintProgressIndicator";
import { InpaintProvider, useSharedInpaintMask } from "@/components/inpaint/InpaintContext";
import { InpaintActionBar, type InpaintAction } from "@/components/inpaint/InpaintActionBar";
import { DEFAULT_INPAINT_MODEL, PREFERRED_INPAINT_MODELS } from "@/lib/inpaintPrompts";
import { WizardPreviewInpaintOverlay } from "@/components/wizard/WizardPreviewInpaintOverlay";
import { AIScenariosModal } from "@/components/workflows/AIScenariosModal";
import type { WorkflowScenarioRunResult } from "@/hooks/workflow/useWorkflowScenarioRun";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { projectExpansionToResize, type LayerExpansionOverride } from "@/utils/wizardExpand";
import { computeWizardExpandGeometry } from "@/utils/wizardExpandGeometry";
import {
    computeGridUnionOutpaintPlan,
    computePackOutpaintPlan,
    findPackOutpaintTargetLayer,
    type PackOutpaintFormat,
    type PackOutpaintRect,
} from "@/utils/packOutpaintPlan";
import { outpaintWithGptImage2PackPlan } from "@/utils/gptImageOutpaint";
import { prepareWizardWorkingImage, type WizardWorkingImageLayer } from "@/utils/wizardImageDerivative";
import { cropToLayerAspect } from "@/utils/cropToLayerAspect";
import { useThemeStore } from "@/store/themeStore";
import type { BusinessUnit, ImageFitMode, ImageLayer, Layer, LayerBinding, MasterComponent, TextGenPreset } from "@/types";
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
type WizardResolvableLayer = {
    id?: string;
    type?: string;
    slotId?: string;
    masterId?: string;
};

export interface EditableLayerEntry {
    id: string;
    type: EditableLayerType;
    name: string;
    slotId?: string;
    slotOccurrence?: number;
    layerId?: string;
    masterComponentId?: string;
    source: "masterComponent" | "layer";
    props: Record<string, unknown>;
}

export interface PreviewFormatSource {
    id: string;
    name: string;
    label: string;
    isMaster: boolean;
    hidden?: boolean;
    layers: Layer[];
    width: number;
    height: number;
    layerBindings?: LayerBinding[];
}

export interface WizardImageViewOverride {
    objectFit?: ImageFitMode;
    focusX?: number;
    focusY?: number;
}

export interface WizardLayerStyleOverride {
    fill?: string;
    textColor?: string;
}

export interface WizardOutpaintHistoryEntry {
    src: string;
    rect: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    imageView?: WizardImageViewOverride;
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
    artboardProps: ArtboardProps;
    onArtboardPropsChange: React.Dispatch<React.SetStateAction<ArtboardProps>>;
    textValues: Record<string, string>;
    imageValues: Record<string, string>;
    imageViewOverrides: Record<string, WizardImageViewOverride>;
    layerStyleOverrides: Record<string, WizardLayerStyleOverride>;
    outpaintHistory: Record<string, WizardOutpaintHistoryEntry>;
    setTextValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    setImageValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    setImageViewOverride: (id: string, override: WizardImageViewOverride | null) => void;
    setLayerStyleOverride: (id: string, override: WizardLayerStyleOverride) => void;
    setOutpaintHistory: (id: string, entry: WizardOutpaintHistoryEntry) => void;
    clearOutpaintHistory: (id: string) => void;
    layerGeometryOverrides: Record<string, LayerExpansionOverride>;
    setLayerGeometry: (id: string, override: LayerExpansionOverride) => void;
    clearLayerGeometry: (id: string) => void;
    productDescription: string;
    projectBU: BusinessUnit;
    projectId?: string;
    onActivePreviewFormatChange?: (id: string) => void;
    /** Registers AI-scenarios open handler for the wizard page header. */
    onAiScenariosToolsChange?: (tools: { canOpen: boolean; onOpen: () => void } | null) => void;
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
    { id: "seedream-5", label: "Seedream 5" },
    { id: "seedream", label: "Seedream 4.5" },
    { id: "gpt-image-2", label: "GPT Image 2" },
    { id: "gpt-image", label: "GPT Image 1.5" },
    { id: "qwen-image", label: "Qwen Image" },
    { id: "flux-schnell", label: "Flux Schnell" },
    { id: "flux-dev", label: "Flux Dev" },
    { id: "flux-1.1-pro", label: "Flux 1.1 Pro" },
    { id: "dall-e-3", label: "DALL-E 3" },
    { id: "flux-lora", label: "FLUX.1 LoRA" },
    { id: "flux-2-lora", label: "FLUX.2 LoRA" },
    { id: "qwen-image-lora", label: "Qwen Image LoRA" },
];

const S3_PERSIST_HOST = "storage.yandexcloud.net";

async function callWizardRemoveBackground(sourceUrl: string, projectId: string): Promise<string> {
    const imageUrl = await uploadForAI(sourceUrl, projectId);
    const response = await fetch("/api/ai/image-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            action: "remove-bg",
            imageBase64: imageUrl,
            model: "bria-rmbg",
            projectId,
        }),
    });
    const data = await response.json();
    if (data.error) {
        throw new Error(
            data.requestId ? `${data.error} [request: ${data.requestId}]` : data.error,
        );
    }
    if (!data.content) {
        throw new Error("Сервер вернул пустой результат удаления фона");
    }
    return persistWizardImageUrl(data.content, projectId, 0);
}

async function persistWizardImageUrl(url: string, projectId: string, index: number): Promise<string> {
    let persisted = await persistImageToS3(url, projectId);
    if (!persisted.includes(S3_PERSIST_HOST)) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        persisted = await persistImageToS3(url, projectId);
    }
    if (!persisted.includes(S3_PERSIST_HOST)) {
        console.error(`[Wizard] persist failed index=${index}`);
        throw new Error("Не удалось сохранить сгенерированное изображение. Повторите попытку.");
    }
    return persisted;
}

const CONTENT_TYPES = ["text", "image", "badge"] as const;
type ImagePromptMode = "generate" | "edit" | "expand" | "inpaint";

/**
 * Per-axis canvas-pixel buffer added to the outpaint target on top of
 * the per-side aware growth from {@link computeWizardExpandGeometry}.
 *
 * Previously this was 700 px and was applied symmetrically on each
 * axis, which generated huge outpaint canvases (image-pixel finalH
 * over 10000 px for asymmetric sources like 2840×2600 in a 1192×300
 * layer slot) and consistently pushed the pipeline into the
 * multipass + bria fallback path.
 *
 * The new policy:
 *   - The geometry util only grows each axis as much as the *largest*
 *     pack format on that axis actually needs (per-side aware).
 *   - The wizard pre-crops the source to the layer aspect ratio first,
 *     which symmetrises pixelScale and removes the main amplifier.
 *   - This 100 px buffer just absorbs cascade rounding + small
 *     instance-vs-artboard mismatches; we no longer need it to
 *     compensate for the geometry policy itself.
 *
 * The buffer is applied per axis (not per side), so each side picks
 * up half of it via the asymmetric distribution in the geometry util.
 */
const EXPAND_SAFETY_BUFFER_PX = 200;
const TEXT_COLOR_SWATCHES = ["#000000", "#FFFFFF", "#1F2937", "#F9FAFB"];
const WIZARD_OUTPAINT_BLEED_PX = 32;
const WIZARD_OUTPAINT_TALL_TOP_RESERVE_RATIO = 0.16;
const WIZARD_OUTPAINT_ENGINE = process.env.NEXT_PUBLIC_WIZARD_OUTPAINT_ENGINE === "legacy"
    ? "legacy"
    : "gpt-image-2";
const WIZARD_OUTPAINT_DEBUG_ENV = process.env.NEXT_PUBLIC_WIZARD_OUTPAINT_DEBUG;
export type WizardOutpaintLayoutPlan = "padding" | "grid-union";
const WIZARD_OUTPAINT_LAYOUT_PLAN_ENV = process.env.NEXT_PUBLIC_WIZARD_OUTPAINT_LAYOUT_PLAN;
/**
 * Asymmetric padding bias for wizard expand. Banner layouts in our
 * design system typically anchor the product bottom-right and place
 * text/logos in the top-left, so we deliberately give the AI-generated
 * background more room on the left/top sides. 0.67 = roughly 2:1 split
 * (matching the user's stated preference: "немного вправо/вниз, раза в
 * 2 влево/вверх").
 */
const EXPAND_LEFT_BIAS = 0.67;
const EXPAND_TOP_BIAS = 0.67;
/**
 * Aspect tolerance for the wizard's source pre-crop. If the source and
 * layer aspect ratios already match within this delta, we skip the
 * crop entirely (cover-style centred crop would be a noop).
 */
const EXPAND_ASPECT_TOLERANCE = 0.05;
/**
 * Hard cap on the final outpaint canvas area for wizard expand
 * (width × height, in image pixels). The wizard renders the layer at
 * ≤ a few hundred CSS pixels and even retina × 2 display tops out
 * around ~1200 px tall, so the studio's default Infinity cap (which
 * targets full-resolution Topaz upscale back to ~38 MP for our
 * banner-pack scenarios) wastes 30-90 seconds of Topaz HF v2 time per
 * generation with no visible benefit. 8 MP keeps the bria/flux output
 * within ~1.4× of the final canvas — `outpaintImage` now collapses
 * that into a single skip-upscale pass on most wizard packs.
 *
 * Studio outpaint deliberately omits this prop so it keeps its
 * native-resolution recovery behaviour.
 */
const WIZARD_MAX_FINAL_PIXELS = 8_000_000;

export function WizardContentWorkspace({
    selectedTemplate,
    templateLoadError,
    artboardProps,
    onArtboardPropsChange,
    textValues,
    imageValues,
    imageViewOverrides,
    layerStyleOverrides,
    outpaintHistory,
    setTextValues,
    setImageValues,
    setImageViewOverride,
    setLayerStyleOverride,
    setOutpaintHistory,
    clearOutpaintHistory,
    layerGeometryOverrides,
    setLayerGeometry,
    clearLayerGeometry,
    productDescription,
    projectBU,
    projectId,
    onActivePreviewFormatChange,
    onAiScenariosToolsChange,
}: WizardContentWorkspaceProps) {
    const { currentWorkspace } = useWorkspace();
    const canvasAppearance = useResolvedCanvasAppearance();
    const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
    const previewFrameRef = useRef<HTMLDivElement | null>(null);
    const { registerFile, registerUrl } = useProjectLibrary();
    const previewFormats = useMemo(() => getPreviewFormatSources(selectedTemplate), [selectedTemplate]);
    const visiblePreviewFormats = useMemo(
        () => previewFormats.filter((format) => !format.hidden),
        [previewFormats],
    );
    const packOutpaintFormats = useMemo(
        () => getPackOutpaintFormatsFromPreviewSources(previewFormats),
        [previewFormats],
    );
    const [activePreviewFormatIdState, setActivePreviewFormatIdState] = useState(visiblePreviewFormats[0]?.id ?? previewFormats[0]?.id ?? "");
    const setActivePreviewFormatId = (id: string) => {
        setActivePreviewFormatIdState(id);
        onActivePreviewFormatChange?.(id);
    };
    const activePreviewFormatId = activePreviewFormatIdState;
    const masterPreviewSource = previewFormats.find((format) => format.isMaster) ?? previewFormats[0];
    const previewSource = visiblePreviewFormats.find((format) => format.id === activePreviewFormatId)
        ?? visiblePreviewFormats[0]
        ?? masterPreviewSource;
    /**
     * The largest width and tallest height across the pack — these are the
     * target dimensions for the wizard's "expand background" generation.
     * Width and height are picked independently so a pack containing
     * 1920×1080 + 1080×1920 yields 1920×1920 (covers any format with no crop).
     */
    const packMaxSize = useMemo(() => {
        if (visiblePreviewFormats.length === 0) return { width: 0, height: 0 };
        let maxW = 0;
        let maxH = 0;
        for (const format of visiblePreviewFormats) {
            if (format.width > maxW) maxW = format.width;
            if (format.height > maxH) maxH = format.height;
        }
        return { width: maxW, height: maxH };
    }, [visiblePreviewFormats]);
    const masterCanvasSize = useMemo(
        () => ({
            width: masterPreviewSource?.width ?? 0,
            height: masterPreviewSource?.height ?? 0,
        }),
        [masterPreviewSource?.width, masterPreviewSource?.height],
    );
    const entries = useMemo(
        () => getEditableLayerEntries(selectedTemplate, masterPreviewSource?.layers ?? []),
        [selectedTemplate, masterPreviewSource?.layers],
    );
    const [activeLayerId, setActiveLayerId] = useState(entries[0]?.id ?? "");
    const [sidebarTab, setSidebarTab] = useState<SidebarTab>("layers");
    const [previewZoom, setPreviewZoom] = useState(1);
    const [wizardImageMode, setWizardImageMode] = useState<ImagePromptMode>("generate");
    const [wizardInpaintBusy, setWizardInpaintBusy] = useState(false);
    const [aiScenariosOpen, setAiScenariosOpen] = useState(false);
    const [removingBgLayerId, setRemovingBgLayerId] = useState<string | null>(null);
    const [layerEditError, setLayerEditError] = useState<string | null>(null);
    const [uploadingLayerId, setUploadingLayerId] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<{ layerId: string; message: string } | null>(null);
    const [previewSize, setPreviewSize] = useState({ width: 820, height: 520 });
    const [collapsedSections, setCollapsedSections] = useState<Record<EditableLayerType, boolean>>({
        text: false,
        image: false,
        badge: false,
    });
    const [artboardSectionCollapsed, setArtboardSectionCollapsed] = useState(false);
    const templatePalette = selectedTemplate.palette ?? DEFAULT_PALETTE;

    useEffect(() => {
        const nextId = visiblePreviewFormats[0]?.id ?? previewFormats[0]?.id ?? "";
        setActivePreviewFormatIdState(nextId);
        onActivePreviewFormatChange?.(nextId);
    }, [onActivePreviewFormatChange, selectedTemplate.id, previewFormats, visiblePreviewFormats]);

    useEffect(() => {
        if (visiblePreviewFormats.length === 0) {
            setActivePreviewFormatId("");
            return;
        }
        if (!visiblePreviewFormats.some((format) => format.id === activePreviewFormatId)) {
            setActivePreviewFormatId(visiblePreviewFormats[0].id);
        }
    }, [activePreviewFormatId, visiblePreviewFormats]);

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

    useEffect(() => {
        setLayerEditError(null);
    }, [activeLayerId]);
    const assetsQuery = trpc.asset.listByProject.useQuery(
        { projectId: projectId ?? "", sortBy: "createdAt", sortOrder: "desc" },
        { enabled: !!projectId && sidebarTab === "assets", refetchOnWindowFocus: false },
    );
    const projectAssets = (assetsQuery.data ?? []) as AssetRow[];
    /**
     * Apply expand overrides to the active preview format through the same
     * projection path Studio uses. In particular, `fillInstanceArtboard`
     * must also affect the master preview; applying `next` directly makes
     * the wizard show an overhanging, cover-cropped master while Studio
     * correctly renders the bitmap inside the artboard.
     */
    const draftPreviewLayers = useMemo(() => {
        const overridesForActive = Object.keys(layerGeometryOverrides).length === 0
            ? undefined
            : layerGeometryOverrides;

        if (!overridesForActive) {
            return buildDraftPreviewLayers(
                previewSource.layers,
                entries,
                textValues,
                imageValues,
                imageViewOverrides,
                layerStyleOverrides,
                undefined,
                previewSource.layerBindings,
            );
        }

        const projected = projectExpansionToResize({
            resizeLayers: previewSource.layers,
            resizeBindings: previewSource.layerBindings,
            resizeArtboard: { width: previewSource.width, height: previewSource.height },
            resizeFormatId: previewSource.id,
            masterArtboard: masterCanvasSize,
            overrides: overridesForActive,
            imageViewOverrides,
        });

        return buildDraftPreviewLayers(
            projected,
            entries,
            textValues,
            imageValues,
            imageViewOverrides,
            layerStyleOverrides,
            undefined,
            previewSource.layerBindings,
        );
    }, [
        previewSource.id,
        previewSource.layers,
        previewSource.layerBindings,
        previewSource.width,
        previewSource.height,
        masterPreviewSource?.id,
        masterCanvasSize,
        entries,
        textValues,
        imageValues,
        imageViewOverrides,
        layerStyleOverrides,
        layerGeometryOverrides,
    ]);

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
            // A fresh upload invalidates any prior expand geometry — the new
            // image is its own canvas, not an extension of the previous one.
            clearLayerGeometry(entry.id);
            clearOutpaintHistory(entry.id);
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
        clearLayerGeometry(activeImageLayer.id);
        clearOutpaintHistory(activeImageLayer.id);
        updateImageValue(activeImageLayer.id, asset.url);
        setSidebarTab("layers");
    };

    const handleRemoveBackgroundForLayer = async (entry: EditableLayerEntry) => {
        if (!projectId) {
            setLayerEditError("Не указан проект для AI-правки");
            return;
        }
        const sourceUrl = imageValues[entry.id] ?? String(entry.props.src ?? "");
        if (!sourceUrl) {
            setLayerEditError("Сначала загрузите изображение слоя");
            return;
        }
        setLayerEditError(null);
        setRemovingBgLayerId(entry.id);
        try {
            let persisted = await callWizardRemoveBackground(sourceUrl, projectId);
            try {
                const registered = await registerUrl({
                    projectId,
                    url: persisted,
                    source: "wizard-remove-bg",
                });
                if (registered) persisted = registered;
            } catch (e) {
                console.warn("[Wizard] remove-bg register failed", e);
            }
            clearLayerGeometry(entry.id);
            clearOutpaintHistory(entry.id);
            updateImageValue(entry.id, persisted);
        } catch (err) {
            setLayerEditError(parseGenerationError(err));
        } finally {
            setRemovingBgLayerId(null);
        }
    };

    const handleWizardScenarioResult = useCallback(
        async (result: WorkflowScenarioRunResult) => {
            if (!result.imageUrl || !activeImageLayer) return;
            const behavior = result.scenarioConfig.output.behavior;

            if (behavior === "open-banner") {
                setLayerEditError("Сценарий «новый баннер» доступен только в студии");
                return;
            }

            let persisted = result.imageUrl;
            if (projectId) {
                if (!persisted.includes(S3_PERSIST_HOST)) {
                    persisted = await persistWizardImageUrl(persisted, projectId, 0);
                }
                try {
                    const registered = await registerUrl({
                        projectId,
                        url: persisted,
                        source: "workflow-scenario",
                    });
                    if (registered) persisted = registered;
                } catch (e) {
                    console.warn("[Wizard] scenario register failed", e);
                }
            }

            clearLayerGeometry(activeImageLayer.id);
            clearOutpaintHistory(activeImageLayer.id);
            updateImageValue(activeImageLayer.id, persisted);
        },
        [
            activeImageLayer,
            projectId,
            registerUrl,
            clearLayerGeometry,
            clearOutpaintHistory,
            updateImageValue,
        ],
    );

    const scenarioInputImageUrl = activeImageLayer
        ? (imageValues[activeImageLayer.id] ?? String(activeImageLayer.props.src ?? ""))
        : "";

    const openAiScenarios = useCallback(() => {
        setAiScenariosOpen(true);
    }, []);

    useEffect(() => {
        if (!onAiScenariosToolsChange) return;
        const canOpen = Boolean(
            currentWorkspace?.id
            && activeImageLayer
            && scenarioInputImageUrl,
        );
        onAiScenariosToolsChange({ canOpen, onOpen: openAiScenarios });
        return () => onAiScenariosToolsChange(null);
    }, [
        onAiScenariosToolsChange,
        currentWorkspace?.id,
        activeImageLayer,
        scenarioInputImageUrl,
        openAiScenarios,
    ]);

    const previewContainerWidth = previewFormats.length > 1
        ? Math.max(320, previewSize.width - 80)
        : previewSize.width;

    const activePreviewImageLayer = useMemo((): ImageLayer | undefined => {
        if (wizardImageMode !== "inpaint" || !activeLayer || activeLayer.type !== "image") {
            return undefined;
        }
        const layer = draftPreviewLayers.find((entry) => entry.id === activeLayer.id);
        return layer?.type === "image" ? layer : undefined;
    }, [wizardImageMode, activeLayer, draftPreviewLayers]);

    const resetOutpaintForLayer = (entry: EditableLayerEntry) => {
        const history = outpaintHistory[entry.id];
        if (!history) return;
        updateImageValue(entry.id, history.src);
        clearLayerGeometry(entry.id);
        setImageViewOverride(entry.id, history.imageView ?? null);
        clearOutpaintHistory(entry.id);
    };

    return (
        <InpaintProvider>
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
                            <WizardArtboardSection
                                collapsed={artboardSectionCollapsed}
                                onToggle={() => setArtboardSectionCollapsed((value) => !value)}
                                artboardProps={artboardProps}
                                palette={templatePalette}
                                projectId={projectId}
                                onUpdate={(updates) => onArtboardPropsChange((prev) => ({ ...prev, ...updates }))}
                                onApplyFill={(fill) => onArtboardPropsChange((prev) => ({
                                    ...prev,
                                    fill,
                                    fillSwatchRef: undefined,
                                }))}
                                onApplyBackgroundSwatch={(swatchId) => {
                                    onArtboardPropsChange((prev) => applyBackgroundSwatchToArtboardProps(
                                        prev,
                                        templatePalette,
                                        swatchId,
                                    ));
                                }}
                            />

                            <LayerSection
                                type="text"
                                title="Тексты"
                                entries={entries.filter((entry) => entry.type === "text")}
                                activeLayerId={activeLayerId}
                                collapsed={collapsedSections.text}
                                onToggle={() => setCollapsedSections((prev) => ({ ...prev, text: !prev.text }))}
                                onSelect={setActiveLayerId}
                                renderEditor={(entry) => (
                                    <div className="space-y-2">
                                        <input
                                            value={textValues[entry.id] ?? String(entry.props.text ?? "")}
                                            onChange={(event) => updateTextValue(entry.id, event.target.value)}
                                            placeholder="Введите текст"
                                            className="h-9 w-full rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary px-3 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border-focus"
                                        />
                                        <ColorSwatches
                                            label="Цвет текста"
                                            value={layerStyleOverrides[entry.id]?.fill ?? String(entry.props.fill ?? "#000000")}
                                            templateValue={String(entry.props.fill ?? "")}
                                            onChange={(fill) => setLayerStyleOverride(entry.id, { fill })}
                                        />
                                    </div>
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
                                        <ImageAlignmentControls
                                            value={imageViewOverrides[entry.id]?.focusX ?? Number(entry.props.focusX ?? 0.5)}
                                            onChange={(focusX) => setImageViewOverride(entry.id, {
                                                ...imageViewOverrides[entry.id],
                                                objectFit: "cover",
                                                focusX,
                                            })}
                                        />
                                        {Boolean(imageValues[entry.id] || entry.props.src) && projectId && (
                                            <button
                                                type="button"
                                                disabled={removingBgLayerId === entry.id}
                                                onClick={() => void handleRemoveBackgroundForLayer(entry)}
                                                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer disabled:opacity-50"
                                            >
                                                {removingBgLayerId === entry.id ? (
                                                    <Loader2 size={12} className="animate-spin" />
                                                ) : (
                                                    <Eraser size={12} />
                                                )}
                                                {removingBgLayerId === entry.id ? "Удаляю фон..." : "Удалить фон"}
                                            </button>
                                        )}
                                        {layerEditError && entry.id === activeLayerId && (
                                            <p className="text-[10px] font-medium leading-snug text-text-error">
                                                {layerEditError}
                                            </p>
                                        )}
                                        {outpaintHistory[entry.id] && (
                                            <button
                                                type="button"
                                                onClick={() => resetOutpaintForLayer(entry)}
                                                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer"
                                            >
                                                <RotateCcw size={12} />
                                                Сбросить расширение
                                            </button>
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
                                    <div className="space-y-2">
                                        <input
                                            value={textValues[entry.id] ?? String(entry.props.label ?? "")}
                                            onChange={(event) => updateTextValue(entry.id, event.target.value)}
                                            placeholder="Введите бейдж"
                                            className="h-9 w-full rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary px-3 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border-focus"
                                        />
                                        <ColorSwatches
                                            label="Цвет текста"
                                            value={layerStyleOverrides[entry.id]?.textColor ?? String(entry.props.textColor ?? "#FFFFFF")}
                                            templateValue={String(entry.props.textColor ?? "")}
                                            onChange={(textColor) => setLayerStyleOverride(entry.id, { textColor })}
                                        />
                                    </div>
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
                            <div
                                className="relative shrink-0"
                                style={{ width: previewContainerWidth, height: previewSize.height }}
                            >
                                <PreviewCanvas
                                    layers={draftPreviewLayers}
                                    artboardWidth={previewSource.width}
                                    artboardHeight={previewSource.height}
                                    containerWidth={previewContainerWidth}
                                    containerHeight={previewSize.height}
                                    zoom={previewZoom}
                                    appearance={canvasAppearance}
                                    artboardFill={artboardProps.fill}
                                    artboardFillEnabled={artboardProps.fillEnabled !== false}
                                    artboardBackgroundImage={artboardProps.backgroundImage}
                                    artboardCornerRadius={artboardProps.cornerRadius}
                                    artboardStroke={artboardProps.stroke}
                                    artboardStrokeMode={artboardProps.strokeMode}
                                    artboardStrokeImage={artboardProps.strokeImage}
                                    artboardStrokeWidth={artboardProps.strokeWidth}
                                    artboardStrokeAlign={artboardProps.strokeAlign}
                                    artboardStrokeJoin={artboardProps.strokeJoin}
                                />
                                {wizardImageMode === "inpaint" && activePreviewImageLayer && (
                                    <WizardPreviewInpaintOverlay
                                        layer={activePreviewImageLayer}
                                        artboardWidth={previewSource.width}
                                        artboardHeight={previewSource.height}
                                        containerWidth={previewContainerWidth}
                                        containerHeight={previewSize.height}
                                        zoom={previewZoom}
                                        appearance={canvasAppearance}
                                        disabled={wizardInpaintBusy}
                                    />
                                )}
                            </div>
                        ) : (
                            <div className="text-sm text-text-tertiary">Нет слоёв для предпросмотра</div>
                        )}
                    </div>

                    {visiblePreviewFormats.length > 1 && (
                        <FormatThumbnailRail
                            formats={visiblePreviewFormats}
                            activeFormatId={previewSource.id}
                            onSelect={setActivePreviewFormatId}
                        />
                    )}

                    <WizardLayerPromptBar
                        activeLayer={activeLayer}
                        textValues={textValues}
                        imageValues={imageValues}
                        activeImageViewOverride={activeLayer ? imageViewOverrides[activeLayer.id] : undefined}
                        activePreviewLayer={activePreviewImageLayer}
                        previewZoom={previewZoom}
                        imageMode={wizardImageMode}
                        onImageModeChange={setWizardImageMode}
                        onInpaintBusyChange={setWizardInpaintBusy}
                        projectBU={projectBU}
                        projectId={projectId}
                        productDescription={productDescription}
                        packMaxSize={packMaxSize}
                        packFormats={previewFormats.map((f) => ({ width: f.width, height: f.height }))}
                        packOutpaintFormats={packOutpaintFormats}
                        masterCanvasSize={masterCanvasSize}
                        masterLayers={masterPreviewSource?.layers ?? []}
                        onTextChange={updateTextValue}
                        onImageChange={updateImageValue}
                        onImageViewChange={setImageViewOverride}
                        onOutpaintHistorySave={setOutpaintHistory}
                        onOutpaintHistoryClear={clearOutpaintHistory}
                        onLayerGeometryChange={setLayerGeometry}
                        onLayerGeometryReset={clearLayerGeometry}
                    />
                </main>
            </div>
        </div>

            <AIScenariosModal
                open={aiScenariosOpen}
                onClose={() => setAiScenariosOpen(false)}
                workspaceId={currentWorkspace?.id}
                projectId={projectId}
                surface="banner"
                input={
                    activeImageLayer && scenarioInputImageUrl
                        ? {
                              kind: "image",
                              imageUrl: scenarioInputImageUrl,
                              selectedLayerId: activeImageLayer.id,
                          }
                        : undefined
                }
                onResult={handleWizardScenarioResult}
            />
        </InpaintProvider>
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

function ImageAlignmentControls({
    value,
    onChange,
}: {
    value: number;
    onChange: (focusX: number) => void;
}) {
    const options = [
        { label: "Лево", value: 0 },
        { label: "Центр", value: 0.5 },
        { label: "Право", value: 1 },
    ];

    return (
        <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-text-tertiary">Выравнивание кадра</p>
            <div className="grid grid-cols-3 gap-1 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary p-1">
                {options.map((option) => {
                    const active = Math.abs(value - option.value) < 0.01;
                    return (
                        <button
                            key={option.label}
                            type="button"
                            onClick={() => onChange(option.value)}
                            className={`h-7 rounded-[var(--radius-sm)] text-[10px] font-medium transition-colors cursor-pointer ${
                                active
                                    ? "bg-bg-surface text-text-primary shadow-[var(--shadow-sm)]"
                                    : "text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
                            }`}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function WizardArtboardSection({
    collapsed,
    onToggle,
    artboardProps,
    palette,
    projectId,
    onUpdate,
    onApplyFill,
    onApplyBackgroundSwatch,
}: {
    collapsed: boolean;
    onToggle: () => void;
    artboardProps: ArtboardProps;
    palette: typeof DEFAULT_PALETTE;
    projectId?: string;
    onUpdate: (updates: Partial<ArtboardProps>) => void;
    onApplyFill: (fill: Paint) => void;
    onApplyBackgroundSwatch: (swatchId: string) => void;
}) {
    const handleBgUpload = async (file: File) => {
        const reader = new FileReader();
        const base64: string = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
        const url = await uploadForAI(base64, projectId ?? "wizard-artboard-bg");
        onUpdate({
            backgroundImage: {
                src: url,
                fit: artboardProps.backgroundImage?.fit ?? "cover",
                opacity: artboardProps.backgroundImage?.opacity ?? 1,
                focusX: 0.5,
                focusY: 0.5,
            },
        });
    };

    const fillBackgroundSwatches = palette.backgrounds.filter((swatch) => {
        const value = swatch.value as string | BackgroundSwatchValue;
        return typeof value === "object" && value.kind !== "image";
    });

    return (
        <section className="mb-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-surface">
            <button
                type="button"
                onClick={onToggle}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left cursor-pointer"
            >
                <span className="text-xs font-semibold text-text-primary">Фон артборда</span>
                {collapsed ? <ChevronDown size={14} className="text-text-tertiary" /> : <ChevronUp size={14} className="text-text-tertiary" />}
            </button>
            {!collapsed && (
                <div className="space-y-3 border-t border-border-primary px-3 py-3">
                    <div className="space-y-1.5">
                        <p className="text-[10px] font-medium text-text-tertiary">Цвет / градиент</p>
                        <PaintInput
                            value={artboardProps.fill}
                            onChange={(fill) => onApplyFill(fill)}
                        />
                    </div>
                    {palette.colors.length > 0 && (
                        <PalettePaintGrid
                            label="Палитра"
                            swatches={palette.colors}
                            onSelect={(paint) => onApplyFill(paint)}
                        />
                    )}
                    {fillBackgroundSwatches.length > 0 && (
                        <PalettePaintGrid
                            label="Фоны палитры"
                            swatches={fillBackgroundSwatches}
                            onSelect={(_, swatchId) => onApplyBackgroundSwatch(swatchId)}
                        />
                    )}
                    <ArtboardBackgroundControls
                        variant="sidebar"
                        artboardProps={artboardProps}
                        onUpdate={onUpdate}
                        paletteBackgrounds={palette.backgrounds}
                        onApplyBackgroundSwatch={onApplyBackgroundSwatch}
                        onUploadFile={handleBgUpload}
                    />
                </div>
            )}
        </section>
    );
}

function swatchPreviewStyle(value: Swatch["value"]): string {
    if (typeof value === "string") return value;
    if (typeof value === "object" && value && "kind" in value) {
        const bg = value as BackgroundSwatchValue;
        if (bg.kind === "solid") return bg.color;
        if (bg.kind === "gradient") return paintToCssBackground(bg.paint);
        if (bg.kind === "image") return `url(${bg.src}) center / cover no-repeat`;
    }
    return paintToCssBackground(value as Paint);
}

function PalettePaintGrid({
    label,
    swatches,
    onSelect,
}: {
    label: string;
    swatches: Swatch[];
    onSelect: (paint: Paint, swatchId: string) => void;
}) {
    return (
        <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-text-tertiary">{label}</p>
            <div className="flex flex-wrap gap-1.5">
                {swatches.map((swatch) => (
                    <button
                        key={swatch.id}
                        type="button"
                        title={swatch.name}
                        onClick={() => {
                            const value = swatch.value;
                            if (typeof value === "string" || (typeof value === "object" && value !== null)) {
                                if (typeof value === "object" && "kind" in value) {
                                    const bg = value as BackgroundSwatchValue;
                                    if (bg.kind === "solid") onSelect(bg.color, swatch.id);
                                    else if (bg.kind === "gradient") onSelect(bg.paint, swatch.id);
                                    else onSelect(value as Paint, swatch.id);
                                } else {
                                    onSelect(value as Paint, swatch.id);
                                }
                            }
                        }}
                        className="h-6 w-6 overflow-hidden rounded-full border border-border-primary transition-all hover:scale-105 cursor-pointer"
                        style={{ background: swatchPreviewStyle(swatch.value) }}
                    />
                ))}
            </div>
        </div>
    );
}

function ColorSwatches({
    label,
    value,
    templateValue,
    onChange,
}: {
    label: string;
    value: string;
    templateValue?: string;
    onChange: (value: string) => void;
}) {
    const swatches = Array.from(
        new Set([templateValue, ...TEXT_COLOR_SWATCHES].filter((color): color is string => Boolean(color))),
    );
    const colorInputValue = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";

    return (
        <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-text-tertiary">{label}</p>
            <div className="flex flex-wrap items-center gap-1.5">
                {swatches.map((color) => (
                    <button
                        key={color}
                        type="button"
                        onClick={() => onChange(color)}
                        aria-label={`Выбрать цвет ${color}`}
                        className={`h-6 w-6 rounded-full border transition-all cursor-pointer ${
                            value.toLowerCase() === color.toLowerCase()
                                ? "scale-110 border-text-primary shadow-[var(--shadow-sm)]"
                                : "border-border-primary hover:scale-105"
                        }`}
                        style={{ backgroundColor: color }}
                    />
                ))}
                <input
                    type="color"
                    value={colorInputValue}
                    onChange={(event) => onChange(event.target.value)}
                    className="h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
                    aria-label="Выбрать произвольный цвет"
                />
            </div>
        </div>
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

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function numberProp(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalNumberProp(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampUnit(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function isMainOutpaintLayer(layer: Layer, masterLayer: Pick<PackOutpaintRect, "id" | "slotId" | "masterId">): boolean {
    if (layer.id === masterLayer.id) return true;
    if (masterLayer.slotId && layer.slotId === masterLayer.slotId && layer.type === "image" && !(layer as { isFixedAsset?: boolean }).isFixedAsset) {
        return true;
    }
    if (masterLayer.masterId && layer.masterId === masterLayer.masterId) return true;
    return false;
}

function isForegroundAnchorLayer(layer: Layer): boolean {
    if (layer.visible === false) return false;
    if (layer.type === "text" || layer.type === "badge") return true;
    if (layer.type === "image") {
        const fixed = (layer as { isFixedAsset?: boolean }).isFixedAsset === true;
        const name = typeof layer.name === "string" ? layer.name.toLowerCase() : "";
        return fixed || name.includes("logo") || name.includes("логотип");
    }
    return false;
}

export function inferOutpaintProductFocusX(
    layers: Layer[],
    masterLayer: Pick<PackOutpaintRect, "id" | "slotId" | "masterId">,
    masterArtboard: { width: number; height: number },
    fallbackFocusX = 0.5,
): number {
    const fallback = clampUnit(fallbackFocusX);
    if (masterArtboard.width <= 0 || layers.length === 0) return fallback;

    let weightedCenter = 0;
    let totalWeight = 0;

    for (const layer of layers) {
        if (isMainOutpaintLayer(layer, masterLayer)) continue;
        if (!isForegroundAnchorLayer(layer)) continue;

        const x = optionalNumberProp(layer.x) ?? 0;
        const width = optionalNumberProp(layer.width) ?? 0;
        const height = optionalNumberProp(layer.height) ?? 0;
        if (width <= 0 || height <= 0) continue;

        const centerX = clampUnit((x + width / 2) / masterArtboard.width);
        const weight = Math.max(1, Math.min(width * height, masterArtboard.width * masterArtboard.height));
        weightedCenter += centerX * weight;
        totalWeight += weight;
    }

    if (totalWeight <= 0) return fallback;

    const foregroundCenterX = weightedCenter / totalWeight;
    if (foregroundCenterX <= 0.5) return Math.max(fallback, 0.88);
    if (foregroundCenterX >= 0.58) return Math.min(fallback, 0.12);
    return fallback;
}

function imageFitProp(value: unknown): ImageFitMode | undefined {
    return value === "cover" || value === "contain" || value === "fill" || value === "crop"
        ? value
        : undefined;
}

function layerToPackOutpaintRect(layer: Layer): PackOutpaintRect {
    return {
        id: layer.id,
        x: numberProp(layer.x),
        y: numberProp(layer.y),
        width: numberProp(layer.width),
        height: numberProp(layer.height),
        slotId: layer.slotId,
        masterId: layer.masterId,
        type: layer.type,
        objectFit: layer.type === "image" ? imageFitProp(layer.objectFit) : undefined,
        focusX: layer.type === "image" ? optionalNumberProp(layer.focusX) : undefined,
        focusY: layer.type === "image" ? optionalNumberProp(layer.focusY) : undefined,
    };
}

function previewFormatToPackOutpaintFormat(format: PreviewFormatSource): PackOutpaintFormat {
    return {
        id: format.id,
        width: format.width,
        height: format.height,
        isMaster: format.isMaster,
        layers: format.layers.map(layerToPackOutpaintRect),
        layerBindings: format.layerBindings,
    };
}

export function getPackOutpaintFormatsFromPreviewSources(
    formats: PreviewFormatSource[],
): PackOutpaintFormat[] {
    // Hidden master formats are intentionally excluded from the visible rail
    // and export picker, but the outpaint planner still needs them as the
    // source geometry anchor. Dropping them makes selected-only packs plan
    // from an instance format and can reintroduce scaled/stretched products.
    return formats.map(previewFormatToPackOutpaintFormat);
}

function entryToPackOutpaintRect(entry: EditableLayerEntry): PackOutpaintRect {
    const props = entry.props;
    const propsMasterId = typeof props.masterId === "string" ? props.masterId : undefined;
    return {
        id: entry.layerId ?? entry.id,
        x: numberProp(props.x),
        y: numberProp(props.y),
        width: numberProp(props.width),
        height: numberProp(props.height),
        slotId: entry.slotId,
        masterId: propsMasterId ?? entry.masterComponentId,
        type: entry.type,
        objectFit: imageFitProp(props.objectFit),
        focusX: optionalNumberProp(props.focusX),
        focusY: optionalNumberProp(props.focusY),
    };
}

function entryToWorkingImageLayer(
    entry: EditableLayerEntry,
    viewOverride?: WizardImageViewOverride,
): WizardWorkingImageLayer {
    const props = entry.props;
    return {
        width: numberProp(props.width),
        height: numberProp(props.height),
        objectFit: viewOverride?.objectFit ?? imageFitProp(props.objectFit),
        focusX: viewOverride?.focusX ?? optionalNumberProp(props.focusX),
        focusY: viewOverride?.focusY ?? optionalNumberProp(props.focusY),
    };
}

function collectPackImageUsageSizes(
    masterLayer: PackOutpaintRect,
    formats: PackOutpaintFormat[],
): Array<{ width: number; height: number }> {
    const sizes: Array<{ width: number; height: number }> = [];
    const push = (rect: { width: number; height: number } | undefined) => {
        if (!rect || rect.width <= 0 || rect.height <= 0) return;
        sizes.push({ width: rect.width, height: rect.height });
    };

    push(masterLayer);
    for (const format of formats) {
        push(format.isMaster ? masterLayer : findPackOutpaintTargetLayer(masterLayer, format));
    }
    return sizes;
}

function applyPackOutpaintImageViewOverride(
    formats: PackOutpaintFormat[],
    masterLayer: PackOutpaintRect,
    viewOverride: WizardImageViewOverride | undefined,
): PackOutpaintFormat[] {
    if (!viewOverride) return formats;
    return formats.map((format) => {
        const target = format.isMaster
            ? masterLayer
            : findPackOutpaintTargetLayer(masterLayer, format);
        if (!target || !format.layers || format.layers.length === 0) return format;
        return {
            ...format,
            layers: format.layers.map((layer) => (
                layer.id === target.id
                    ? {
                        ...layer,
                        objectFit: viewOverride.objectFit ?? layer.objectFit,
                        focusX: viewOverride.focusX ?? layer.focusX,
                        focusY: viewOverride.focusY ?? layer.focusY,
                    }
                    : layer
            )),
        };
    });
}

function shouldPrepareWorkingDerivative(model: string, scale: string): boolean {
    return model === "nano-banana-2" && (scale === "2K" || scale === "4K");
}

function isWizardOutpaintDebugEnabled(): boolean {
    if (process.env.NODE_ENV === "production") return false;
    if (WIZARD_OUTPAINT_DEBUG_ENV === "1") return true;
    try {
        return typeof window !== "undefined"
            && window.localStorage?.getItem("wizardOutpaintDebug") === "1";
    } catch {
        return false;
    }
}

export function resolveWizardOutpaintLayoutPlan(
    envValue?: string,
    localValue?: string | null,
): WizardOutpaintLayoutPlan {
    if (localValue === "grid-union" || localValue === "padding") return localValue;
    return envValue === "grid-union" ? "grid-union" : "padding";
}

function getWizardOutpaintLayoutPlan(): WizardOutpaintLayoutPlan {
    try {
        const localValue = typeof window !== "undefined"
            ? window.localStorage?.getItem("wizardOutpaintLayoutPlan")
            : undefined;
        return resolveWizardOutpaintLayoutPlan(WIZARD_OUTPAINT_LAYOUT_PLAN_ENV, localValue);
    } catch {
        return resolveWizardOutpaintLayoutPlan(WIZARD_OUTPAINT_LAYOUT_PLAN_ENV);
    }
}

async function prepareAndRegisterWizardDerivative({
    imageSrc,
    layer,
    usageSizes,
    projectId,
    registerUrl,
}: {
    imageSrc: string;
    layer: WizardWorkingImageLayer;
    usageSizes: Array<{ width: number; height: number }>;
    projectId: string;
    registerUrl: (opts: {
        projectId: string;
        url: string;
        source?: string;
        mimeType?: string;
        width?: number;
        height?: number;
    }) => Promise<string | null>;
}): Promise<{ src: string; width: number; height: number; changed: boolean }> {
    const working = await prepareWizardWorkingImage(imageSrc, layer, usageSizes);
    if (!working.changed) {
        return {
            src: imageSrc,
            width: working.nativeW || layer.width,
            height: working.nativeH || layer.height,
            changed: false,
        };
    }

    const persisted = await persistWizardImageUrl(working.src, projectId, 0);
    const registered = await registerUrl({
        projectId,
        url: persisted,
        source: "wizard-working-derivative",
        mimeType: "image/webp",
        width: working.nativeW,
        height: working.nativeH,
    });

    return {
        src: registered ?? persisted,
        width: working.nativeW,
        height: working.nativeH,
        changed: true,
    };
}

function WizardLayerPromptBar({
    activeLayer,
    textValues,
    imageValues,
    activeImageViewOverride,
    activePreviewLayer,
    previewZoom,
    imageMode,
    onImageModeChange,
    onInpaintBusyChange,
    projectBU,
    projectId,
    productDescription,
    packMaxSize,
    packFormats,
    packOutpaintFormats,
    masterCanvasSize,
    masterLayers,
    onTextChange,
    onImageChange,
    onImageViewChange,
    onOutpaintHistorySave,
    onOutpaintHistoryClear,
    onLayerGeometryChange,
    onLayerGeometryReset,
}: {
    activeLayer?: EditableLayerEntry;
    textValues: Record<string, string>;
    imageValues: Record<string, string>;
    activeImageViewOverride?: WizardImageViewOverride;
    activePreviewLayer?: ImageLayer;
    previewZoom: number;
    imageMode: ImagePromptMode;
    onImageModeChange: (mode: ImagePromptMode) => void;
    onInpaintBusyChange?: (busy: boolean) => void;
    projectBU: BusinessUnit;
    projectId?: string;
    productDescription: string;
    packMaxSize: { width: number; height: number };
    /**
     * Full list of preview format dimensions (width × height). Drives
     * the per-side aware target size in {@link computeWizardExpandGeometry}.
     * `packMaxSize` is kept as a separate prop because the UI also shows
     * it as a "Цель: WxH" badge, but the geometry math needs the full list.
     */
    packFormats: Array<{ width: number; height: number }>;
    packOutpaintFormats: PackOutpaintFormat[];
    masterCanvasSize: { width: number; height: number };
    masterLayers: Layer[];
    onTextChange: (id: string, value: string) => void;
    onImageChange: (id: string, value: string) => void;
    onImageViewChange: (id: string, override: WizardImageViewOverride | null) => void;
    onOutpaintHistorySave: (id: string, entry: WizardOutpaintHistoryEntry) => void;
    onOutpaintHistoryClear: (id: string) => void;
    onLayerGeometryChange: (id: string, override: LayerExpansionOverride) => void;
    onLayerGeometryReset: (id: string) => void;
}) {
    const promptRef = useRef<RefAutocompleteTextareaHandle>(null);
    const inpaintMask = useSharedInpaintMask();
    const inpaintMaskRef = useRef(inpaintMask);
    inpaintMaskRef.current = inpaintMask;
    const { registerUrl } = useProjectLibrary();
    const { imagePresets, textPresets } = useStylePresets();
    const [prompt, setPrompt] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    // Outpaint pipeline progress (only set during imageMode === "expand";
    // null otherwise so the indicator collapses out of the layout).
    const [outpaintProgress, setOutpaintProgress] = useState<OutpaintProgressState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedModel, setSelectedModel] = useState("nano-banana-2");
    const [textModel, setTextModel] = useState("deepseek");
    const [aspectRatio, setAspectRatio] = useState("1:1");
    const [imageStyleId, setImageStyleId] = useState("none");
    const [textStyleId, setTextStyleId] = useState<TextGenPreset | "none">("none");
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const [scale, setScale] = useState(() => getDefaultResolution("nano-banana-2"));
    const [imageCount, setImageCount] = useState(1);
    const [variantsByLayer, setVariantsByLayer] = useState<Record<string, GeneratedImageVariant[]>>({});
    const [selectedGeneratedVariantId, setSelectedGeneratedVariantId] = useState<string | undefined>(undefined);
    const enqueueJob = useGenerationQueueStore((s) => s.enqueue);
    const queueCounts = useProjectQueueCounts(projectId);
    const [loras, setLoras] = useState<LoraWeight[]>([]);
    const [advancedParams, setAdvancedParams] = useState<AdvancedAIParams>({});
    const [settingsOpen, setSettingsOpen] = useState(false);
    const modelAspectRatios = getAspectRatios(selectedModel);
    const modelResolutions = getResolutions(selectedModel);
    const maxImageOutputs = imageMode === "generate" ? getMaxOutputs(selectedModel) : 1;
    const inpaintModelOptions = useMemo(
        () =>
            PREFERRED_INPAINT_MODELS.map((id) => {
                const entry = getModelById(id);
                return entry ? { value: id, label: entry.label } : null;
            }).filter((m): m is { value: string; label: string } => !!m),
        [],
    );
    const imageModelOptions = imageMode === "inpaint" && inpaintModelOptions.length > 0
        ? inpaintModelOptions
        : IMAGE_GEN_MODELS.map((model) => ({ value: model.id, label: model.label }));
    const supportsVision = getModelById(selectedModel)?.caps.includes("vision") ?? false;
    const loraSpec = getLoraSpec(selectedModel);
    const loraRequestFields = loraSpec
        ? {
            loras: loras.length > 0 ? loras : undefined,
            guidanceScale: advancedParams.guidanceScale,
            numInferenceSteps: advancedParams.numInferenceSteps,
            negativePrompt: advancedParams.negativePrompt,
            acceleration: advancedParams.acceleration,
        }
        : {};

    const clearGeneratedVariants = (layerId?: string) => {
        if (layerId) {
            setVariantsByLayer((prev) => {
                const next = { ...prev };
                delete next[layerId];
                return next;
            });
        } else {
            setVariantsByLayer({});
        }
        setSelectedGeneratedVariantId(undefined);
    };

    const appendLoadingVariants = (
        layerKey: string,
        count: number,
        promptLabel: string,
        batchId: string,
    ) => {
        setVariantsByLayer((prev) => {
            const existing = prev[layerKey] ?? [];
            const slots = Array.from({ length: count }, (_, index) => ({
                id: `${batchId}-${index}`,
                status: "loading" as const,
                promptLabel,
            }));
            return { ...prev, [layerKey]: [...existing, ...slots] };
        });
    };

    const resolveBatchVariants = (
        layerKey: string,
        batchId: string,
        urls: string[],
        promptLabel: string,
        status: "ready" | "error",
    ) => {
        setVariantsByLayer((prev) => {
            const kept = (prev[layerKey] ?? []).filter((v) => !v.id.startsWith(`${batchId}-`));
            const resolved =
                status === "ready"
                    ? urls.map((url, index) => ({
                        id: `${batchId}-${index}-${url}`,
                        url,
                        status: "ready" as const,
                        promptLabel,
                    }))
                    : [{ id: `${batchId}-error`, status: "error" as const, promptLabel }];
            return { ...prev, [layerKey]: [...kept, ...resolved] };
        });
    };

    const activeLayerKey = activeLayer?.id ?? null;
    const activeVariants = activeLayerKey ? (variantsByLayer[activeLayerKey] ?? []) : [];

    const queueBadge = formatProjectQueueBadge(queueCounts);

    useEffect(() => {
        setPrompt("");
        setError(null);
        setReferenceImages([]);
        onImageModeChange("generate");
        inpaintMaskRef.current.clear();
        setLoras([]);
        setAdvancedParams({});
        setImageCount(1);
        clearGeneratedVariants();
        // Only reset when the selected layer changes — not when inpaintMask
        // re-renders (its API object is a new reference every paint).
    }, [activeLayer?.id, onImageModeChange]);

    useEffect(() => {
        if (imageMode !== "inpaint") {
            inpaintMaskRef.current.clear();
        }
    }, [imageMode]);

    useEffect(() => {
        if (imageCount > maxImageOutputs) setImageCount(maxImageOutputs);
    }, [imageCount, maxImageOutputs]);

    useEffect(() => {
        if (imageMode !== "generate" || activeLayer?.type !== "image") {
            clearGeneratedVariants();
        }
    }, [activeLayer?.type, imageMode]);

    useEffect(() => {
        if (imageMode === "expand") return;
        if (!scale || !modelResolutions.some((r) => r.id === scale)) {
            setScale(getDefaultResolution(selectedModel));
        }
    }, [imageMode, selectedModel, scale, modelResolutions]);

    const handleGeneratedVariantSelect = (variant: GeneratedImageVariant) => {
        if (!activeLayer || activeLayer.type !== "image" || !variant.url) return;
        onImageChange(activeLayer.id, variant.url);
        setSelectedGeneratedVariantId(variant.id);
    };

    const handleInpaintApply = useCallback(async (intent: InpaintAction) => {
        if (!projectId || !activeLayer || activeLayer.type !== "image" || !activePreviewLayer) {
            setError("Выберите слой-картинку с изображением для inpaint.");
            return;
        }
        if (!inpaintMask || !inpaintMask.hasMask) {
            setError("Сначала нарисуйте маску по области редактирования на превью.");
            return;
        }

        const currentImage = imageValues[activeLayer.id] ?? String(activeLayer.props.src ?? "");
        if (!currentImage) {
            setError("Для inpaint сначала загрузите или сгенерируйте изображение слоя");
            return;
        }

        let naturalWidth = activePreviewLayer.width;
        let naturalHeight = activePreviewLayer.height;
        try {
            const img = new window.Image();
            img.crossOrigin = "anonymous";
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = reject;
                img.src = currentImage;
            });
            naturalWidth = img.naturalWidth;
            naturalHeight = img.naturalHeight;
        } catch (e) {
            console.warn("[WizardInpaint] could not measure source image, using layer dims", e);
        }

        const modelEntry = getModelById(selectedModel);
        const blob = await inpaintMask.exportMaskBlob(
            {
                naturalWidth,
                naturalHeight,
                layerWidth: activePreviewLayer.width,
                layerHeight: activePreviewLayer.height,
                objectFit: activePreviewLayer.objectFit,
                viewIntent: { focusX: activePreviewLayer.focusX, focusY: activePreviewLayer.focusY },
                zoom: previewZoom,
            },
            modelEntry?.slug,
        );
        if (!blob) {
            setError("Маска пуста — нарисуйте кистью область для inpaint.");
            return;
        }

        const editPrompt = intent === "edit" ? prompt.trim() : "";
        const promptLabel = truncatePromptLabel(
            intent === "edit" ? (editPrompt || "Inpaint") : "Удалить объект",
        );
        const layerId = activeLayer.id;
        const batchId = `wiz-inpaint-${Date.now()}`;

        appendLoadingVariants(layerId, 1, promptLabel, batchId);
        setError(null);
        onInpaintBusyChange?.(true);
        setIsGenerating(true);

        enqueueJob(
            {
                id: batchId,
                projectId,
                surface: "wizard",
                layerId,
                prompt: promptLabel,
                imageCount: 1,
            },
            async () => {
                try {
                    const maskFile = new File([blob], "inpaint-mask.png", { type: "image/png" });
                    const maskBase64 = await blobToDataUrl(maskFile);
                    const [imageUrl, maskUrl] = await Promise.all([
                        uploadForAI(currentImage, projectId),
                        uploadForAI(maskBase64, projectId),
                    ]);

                    const styleSuffix = getImagePresetPromptSuffixForModel(imageStyleId, selectedModel, imagePresets);
                    const styledPrompt = styleSuffix && editPrompt ? `${editPrompt}. Style: ${styleSuffix}` : editPrompt;
                    const resolvedPrompt = resolveRefTags(styledPrompt, selectedModel);

                    const response = await fetch("/api/ai/image-edit", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            action: "inpaint",
                            intent,
                            prompt: resolvedPrompt,
                            imageBase64: imageUrl,
                            maskBase64: maskUrl,
                            model: selectedModel,
                            projectId,
                            scale: scale || "high",
                            ...loraRequestFields,
                        }),
                    });
                    const data = await response.json();
                    if (data.error) {
                        throw new Error(
                            data.requestId
                                ? `${data.error} [request: ${data.requestId}]`
                                : data.error,
                        );
                    }
                    if (!data.content) {
                        throw new Error("Сервер вернул пустой результат inpaint");
                    }

                    let persisted = data.content as string;
                    if (!persisted.includes(S3_PERSIST_HOST)) {
                        persisted = await persistWizardImageUrl(persisted, projectId, 0);
                    }
                    try {
                        const registered = await registerUrl({
                            projectId,
                            url: persisted,
                            source: intent === "remove" ? "wizard-inpaint-remove" : "wizard-inpaint",
                        });
                        if (registered) persisted = registered;
                    } catch (e) {
                        console.warn("[WizardInpaint] register failed", e);
                    }

                    onImageChange(layerId, persisted);
                    resolveBatchVariants(layerId, batchId, [persisted], promptLabel, "ready");
                    setSelectedGeneratedVariantId(`${batchId}-0-${persisted}`);
                    inpaintMask.clear();
                    onImageModeChange("edit");
                } catch (err) {
                    setError(parseGenerationError(err));
                    resolveBatchVariants(layerId, batchId, [], promptLabel, "error");
                    throw err;
                } finally {
                    setIsGenerating(false);
                    onInpaintBusyChange?.(false);
                }
            },
        );
    }, [
        projectId,
        activeLayer,
        activePreviewLayer,
        inpaintMask,
        imageValues,
        prompt,
        selectedModel,
        previewZoom,
        imageStyleId,
        imagePresets,
        scale,
        loraRequestFields,
        onImageChange,
        onImageModeChange,
        onInpaintBusyChange,
        registerUrl,
        enqueueJob,
    ]);

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

        if (activeLayer.type === "text" || activeLayer.type === "badge") {
            setIsGenerating(true);
            try {
                const { generateTextVariants } = await import("@/services/aiService");
                const [result] = await generateTextVariants(
                    basePrompt,
                    activeLayer.name,
                    1,
                    projectBU,
                    textStyleId === "none" ? undefined : (textStyleId as TextGenPreset),
                    textModel,
                );
                if (result) onTextChange(activeLayer.id, result);
            } catch (err) {
                setError(parseGenerationError(err));
            } finally {
                setIsGenerating(false);
            }
            return;
        }

        if (!projectId) {
            setError("Не указан проект для генерации");
            return;
        }

        const layerId = activeLayer.id;
        const batchId = `wiz-${Date.now()}`;
        const promptLabel = truncatePromptLabel(basePrompt);
        const requestedImageCount =
            imageMode === "generate" ? Math.min(imageCount, maxImageOutputs) : 1;

        if (imageMode === "edit" && !currentImage) {
            setError("Для редактирования сначала загрузите или сгенерируйте изображение слоя");
            return;
        }

        let expandSnapshot: {
            layerWidth: number;
            layerHeight: number;
            layerX: number;
            layerY: number;
            slotId?: string;
            masterId?: string;
            masterLayer: PackOutpaintRect;
            workingLayer: WizardWorkingImageLayer;
            usageSizes: Array<{ width: number; height: number }>;
            packOutpaintFormats: PackOutpaintFormat[];
            masterArtboard: { width: number; height: number };
            legacyPadding?: {
                top: number;
                right: number;
                bottom: number;
                left: number;
            };
        } | null = null;

        if (imageMode === "expand") {
            if (!currentImage) {
                setError("Для расширения фона сначала загрузите или сгенерируйте изображение слоя");
                return;
            }

            const layerWidth = Number(activeLayer.props.width ?? 0);
            const layerHeight = Number(activeLayer.props.height ?? 0);
            const layerX = Number(activeLayer.props.x ?? 0);
            const layerY = Number(activeLayer.props.y ?? 0);

            if (layerWidth <= 0 || layerHeight <= 0) {
                setError("Не удалось определить размеры слоя для расширения");
                return;
            }

            const masterLayerDraft = entryToPackOutpaintRect(activeLayer);
            const masterLayer = {
                ...masterLayerDraft,
                objectFit: activeImageViewOverride?.objectFit ?? masterLayerDraft.objectFit,
                focusX: activeImageViewOverride?.focusX ?? masterLayerDraft.focusX,
                focusY: activeImageViewOverride?.focusY ?? masterLayerDraft.focusY,
            };
            const outpaintFormats = applyPackOutpaintImageViewOverride(
                packOutpaintFormats,
                masterLayer,
                activeImageViewOverride,
            );
            const usageSizes = collectPackImageUsageSizes(masterLayer, outpaintFormats);
            let legacyPadding: { top: number; right: number; bottom: number; left: number } | undefined;

            if (WIZARD_OUTPAINT_ENGINE === "legacy") {
                const geometry = computeWizardExpandGeometry(
                    { width: layerWidth, height: layerHeight },
                    packFormats,
                    {
                        buffer: EXPAND_SAFETY_BUFFER_PX,
                        leftBias: EXPAND_LEFT_BIAS,
                        topBias: EXPAND_TOP_BIAS,
                    },
                );
                const { padTop, padRight, padBottom, padLeft } = geometry;
                const hPad = padLeft + padRight;
                const vPad = padTop + padBottom;

                if (hPad === 0 && vPad === 0) {
                    setError("Изображение уже покрывает максимальный формат пакета — расширение не требуется");
                    return;
                }

                legacyPadding = {
                    top: padTop,
                    right: padRight,
                    bottom: padBottom,
                    left: padLeft,
                };
            }

            expandSnapshot = {
                layerWidth,
                layerHeight,
                layerX,
                layerY,
                slotId: activeLayer.slotId,
                masterId: masterLayer.masterId,
                masterLayer,
                workingLayer: entryToWorkingImageLayer(activeLayer, activeImageViewOverride),
                usageSizes,
                packOutpaintFormats: outpaintFormats,
                masterArtboard: masterCanvasSize,
                legacyPadding,
            };
        }

        const workingSnapshot = activeLayer.type === "image"
            ? (() => {
                const masterLayer = expandSnapshot?.masterLayer ?? entryToPackOutpaintRect(activeLayer);
                return {
                    layer: expandSnapshot?.workingLayer ?? entryToWorkingImageLayer(activeLayer, activeImageViewOverride),
                    usageSizes: expandSnapshot?.usageSizes ?? collectPackImageUsageSizes(masterLayer, packOutpaintFormats),
                };
            })()
            : null;
        const outpaintDebug = imageMode === "expand" && isWizardOutpaintDebugEnabled();
        const outpaintLayoutPlan = imageMode === "expand"
            ? getWizardOutpaintLayoutPlan()
            : "padding";

        if (imageMode === "expand") {
            console.log("[Wizard/Expand/start]", {
                engine: WIZARD_OUTPAINT_ENGINE,
                layoutPlan: outpaintLayoutPlan,
                env: process.env.NEXT_PUBLIC_WIZARD_OUTPAINT_ENGINE ?? "",
                layoutEnv: process.env.NEXT_PUBLIC_WIZARD_OUTPAINT_LAYOUT_PLAN ?? "",
                debug: outpaintDebug,
                layerId,
                targetFormats: packOutpaintFormats.map((format) => ({
                    id: format.id,
                    width: format.width,
                    height: format.height,
                    isMaster: Boolean(format.isMaster),
                })),
            });
        }

        appendLoadingVariants(layerId, requestedImageCount, promptLabel, batchId);

        const jobSnapshot = {
            imageMode,
            basePrompt,
            currentImage,
            expandSnapshot,
            selectedModel,
            aspectRatio,
            scale,
            imageStyleId,
            referenceImages: referenceImages.length > 0 ? [...referenceImages] : [],
            loraRequestFields: { ...loraRequestFields },
            activeImageViewOverride,
            workingSnapshot,
            outpaintDebug,
            outpaintLayoutPlan,
        };

        enqueueJob(
            {
                id: batchId,
                projectId,
                surface: "wizard",
                layerId,
                prompt: basePrompt,
                imageCount: requestedImageCount,
            },
            async () => {
                try {
                    if (jobSnapshot.imageMode === "expand" && jobSnapshot.expandSnapshot) {
                        const {
                            layerWidth,
                            layerHeight,
                            layerX,
                            layerY,
                            masterLayer,
                            workingLayer,
                            usageSizes,
                            packOutpaintFormats: outpaintFormats,
                            masterArtboard,
                            legacyPadding,
                            slotId,
                            masterId,
                        } = jobSnapshot.expandSnapshot;

                        setOutpaintProgress({ label: "Подготавливаем изображение", percent: 5 });

                        let expandUrl: string;
                        let nextRect: { x: number; y: number; width: number; height: number };
                        let nextImageView: WizardImageViewOverride | null = null;
                        let usedGridUnionPlan = false;
                        let gridUnionFormatRects: LayerExpansionOverride["formatRects"] | undefined;

                        if (WIZARD_OUTPAINT_ENGINE === "legacy") {
                            if (!legacyPadding) {
                                throw new Error("Не удалось подготовить legacy-параметры расширения");
                            }

                            const layerAspect = layerWidth / layerHeight;
                            const cropResult = await cropToLayerAspect(jobSnapshot.currentImage, layerAspect, {
                                tolerance: EXPAND_ASPECT_TOLERANCE,
                            });
                            console.log("[Wizard/Expand/pre-crop]", {
                                cropped: cropResult.cropped,
                                layerAspect: Math.round(layerAspect * 100) / 100,
                                nativeW: cropResult.nativeW,
                                nativeH: cropResult.nativeH,
                            });

                            const { outpaintImage } = await import("@/utils/outpaintPipeline");
                            const expandResult = await outpaintImage({
                                imageSrc: cropResult.src,
                                canvasPadding: legacyPadding,
                                layerSize: { width: layerWidth, height: layerHeight },
                                prompt: jobSnapshot.basePrompt || undefined,
                                projectId,
                                model: getOutpaintModel(),
                                upscaleModel: "seedvr",
                                maxFinalPixels: WIZARD_MAX_FINAL_PIXELS,
                                minFluxDownscaleRatio: 0.25,
                                enableMultipass: false,
                                onProgress: (stage, info) => {
                                    console.log(`[Wizard/Expand/${stage}]`, info ?? "");
                                    const next = mapOutpaintStage(stage);
                                    if (next) setOutpaintProgress(next);
                                },
                            });

                            const registered = await registerUrl({
                                projectId,
                                url: expandResult.src,
                                source: "wizard-edit-expand",
                            });
                            expandUrl = registered ?? expandResult.src;
                            nextRect = {
                                x: layerX - legacyPadding.left,
                                y: layerY - legacyPadding.top,
                                width: layerWidth + legacyPadding.left + legacyPadding.right,
                                height: layerHeight + legacyPadding.top + legacyPadding.bottom,
                            };
                        } else {
                            const derivative = await prepareAndRegisterWizardDerivative({
                                imageSrc: jobSnapshot.currentImage,
                                layer: workingLayer,
                                usageSizes,
                                projectId,
                                registerUrl,
                            });
                            const commonPlanInput = {
                                masterLayer,
                                masterArtboard,
                                formats: outpaintFormats,
                                sourceSizePx: { width: derivative.width, height: derivative.height },
                            };
                            const paddingPlanOptions = {
                                bleedPx: WIZARD_OUTPAINT_BLEED_PX,
                                exportScale: 2,
                                // delivery-crop keeps outputSizePx and the
                                // layer rect exactly equal to the pack
                                // requirement. Aspect-cap padding lives
                                // only in the GPT request canvas and is
                                // cropped out after the call, so the
                                // product never moves and the bitmap is
                                // never letterboxed for ultra-wide /
                                // ultra-tall packs.
                                aspectCapStrategy: "delivery-crop" as const,
                                tallFormatTopReserveRatio: WIZARD_OUTPAINT_TALL_TOP_RESERVE_RATIO,
                            };
                            let plan = computePackOutpaintPlan({
                                ...commonPlanInput,
                                options: paddingPlanOptions,
                            });
                            if (jobSnapshot.outpaintLayoutPlan === "grid-union") {
                                const grid = computeGridUnionOutpaintPlan({
                                    ...commonPlanInput,
                                    options: {
                                        bleedPx: WIZARD_OUTPAINT_BLEED_PX,
                                        exportScale: 2,
                                        aspectCapStrategy: "delivery-crop",
                                    },
                                });
                                if (grid.plan) {
                                    plan = grid.plan;
                                    usedGridUnionPlan = true;
                                    gridUnionFormatRects = grid.plan.formatLayerRects;
                                } else {
                                    console.warn("[Wizard/GPTOutpaint/grid-union-fallback]", {
                                        diagnostics: grid.diagnostics,
                                    });
                                }
                            }
                            if (jobSnapshot.outpaintDebug) {
                                console.log("[Wizard/GPTOutpaint/debug-plan]", {
                                    derivative,
                                    layoutPlan: usedGridUnionPlan ? "grid-union" : "padding",
                                    plan,
                                    diagnostics: plan.diagnostics,
                                });
                            }

                            const p = plan.canvasPadding;
                            if (p.top + p.right + p.bottom + p.left === 0) {
                                throw new Error("Изображение уже покрывает максимальный формат пакета — расширение не требуется");
                            }

                            const expandResult = await outpaintWithGptImage2PackPlan({
                                imageSrc: derivative.src,
                                plan,
                                prompt: jobSnapshot.basePrompt || undefined,
                                projectId,
                                debug: jobSnapshot.outpaintDebug,
                                onProgress: (stage, info) => {
                                    console.log(`[Wizard/GPTOutpaint/${stage}]`, info ?? "");
                                    if (stage === "outpaint-canvas-start") {
                                        setOutpaintProgress({ label: "Собираем canvas и маску", percent: 18 });
                                    } else if (stage === "outpaint-api-start") {
                                        setOutpaintProgress({ label: "Расширяем фон через GPT Image 2", percent: 42 });
                                    } else if (stage === "outpaint-api-done") {
                                        setOutpaintProgress({ label: "Сохраняем результат", percent: 88 });
                                    }
                                },
                            });
                            const registered = await registerUrl({
                                projectId,
                                url: expandResult.src,
                                source: "wizard-edit-expand",
                            });
                            expandUrl = registered ?? expandResult.src;
                            // Render the freshly generated bitmap with
                            // objectFit: "cover" + a focus that tracks
                            // the source product centre inside the bitmap.
                            // When bitmap aspect matches the layer aspect
                            // (the master case under delivery-crop) cover
                            // degenerates to fill — no scale, no crop. For
                            // instance layers (vertical / top-banner)
                            // whose aspects differ after the bindings
                            // cascade, cover preserves the bitmap aspect
                            // and crops only the background, never
                            // deforming the product.
                            const planned = plan.nextMasterRect;
                            const bitmapAspect = expandResult.outputSizePx.width / expandResult.outputSizePx.height;
                            const plannedAspect = planned.width / planned.height;
                            const aspectDrift = Math.abs(bitmapAspect - plannedAspect)
                                / Math.max(bitmapAspect, plannedAspect);
                            if (usedGridUnionPlan || aspectDrift <= 0.005) {
                                nextRect = planned;
                            } else {
                                const cx = planned.x + planned.width / 2;
                                const cy = planned.y + planned.height / 2;
                                let w = planned.width;
                                let h = planned.height;
                                if (bitmapAspect > plannedAspect) {
                                    h = w / bitmapAspect;
                                } else {
                                    w = h * bitmapAspect;
                                }
                                nextRect = {
                                    x: Math.round(cx - w / 2),
                                    y: Math.round(cy - h / 2),
                                    width: Math.round(w),
                                    height: Math.round(h),
                                };
                                console.warn("[Wizard/GPTOutpaint/rect-adjusted-to-bitmap]", {
                                    outputSizePx: expandResult.outputSizePx,
                                    planned,
                                    adjusted: nextRect,
                                    aspectDrift,
                                });
                            }
                            if (usedGridUnionPlan) {
                                nextImageView = { objectFit: "fill", focusX: 0.5, focusY: 0.5 };
                            } else {
                                const sourcePlacement = plan.sourcePlacementPx;
                                const outputW = Math.max(1, plan.outputSizePx.width);
                                const outputH = Math.max(1, plan.outputSizePx.height);
                                // Anchor focus so the source product never gets
                                // cropped off the top of the bitmap when
                                // `cover` chops vertically (master/top-banner)
                                // and so the full vertical extension below the
                                // product remains visible in tall instance
                                // artboards (Feed, vertical). Horizontally we
                                // preserve an explicit user focus; otherwise
                                // infer the product side from foreground layout
                                // (text/logo on the left usually means product
                                // on the right).
                                const sourceFocusX = (sourcePlacement.x + sourcePlacement.width / 2) / outputW;
                                const explicitFocusX = typeof jobSnapshot.activeImageViewOverride?.focusX === "number"
                                    && Math.abs(jobSnapshot.activeImageViewOverride.focusX - 0.5) > 0.01
                                    ? jobSnapshot.activeImageViewOverride.focusX
                                    : undefined;
                                const focusX = explicitFocusX ?? inferOutpaintProductFocusX(
                                    masterLayers,
                                    masterLayer,
                                    masterArtboard,
                                    sourceFocusX,
                                );
                                const focusY = sourcePlacement.y / outputH;
                                nextImageView = {
                                    objectFit: "cover",
                                    focusX: clampUnit(focusX),
                                    focusY: clampUnit(focusY),
                                };
                            }
                        }

                        onOutpaintHistorySave(layerId, {
                            src: jobSnapshot.currentImage,
                            rect: { x: layerX, y: layerY, width: layerWidth, height: layerHeight },
                            imageView: jobSnapshot.activeImageViewOverride,
                        });
                        onImageChange(layerId, expandUrl);
                        if (nextImageView) {
                            onImageViewChange(layerId, nextImageView);
                        }
                        onLayerGeometryChange(layerId, {
                            prev: { x: layerX, y: layerY, width: layerWidth, height: layerHeight },
                            next: nextRect,
                            slotId,
                            slotOccurrence: activeLayer.slotOccurrence,
                            masterId,
                            // Single-pass pack outpaint: instance image
                            // layers are forced to the resize artboard
                            // (cover-fit shows full bitmap including
                            // vertical extension), the master keeps the
                            // pack-extended rect (cover degenerates to
                            // 1:1 fill since aspects match).
                            fillInstanceArtboard: usedGridUnionPlan ? undefined : true,
                            formatRects: usedGridUnionPlan ? gridUnionFormatRects : undefined,
                        });
                        resolveBatchVariants(layerId, batchId, [expandUrl], promptLabel, "ready");
                    } else if (jobSnapshot.imageMode === "edit") {
                        const [imageUrl, refUrls] = await Promise.all([
                            uploadForAI(jobSnapshot.currentImage, projectId),
                            jobSnapshot.referenceImages.length > 0
                                ? uploadManyForAI(jobSnapshot.referenceImages, projectId)
                                : Promise.resolve(undefined),
                        ]);
                        const editModel = getModelById(jobSnapshot.selectedModel)?.caps.includes("edit")
                            ? jobSnapshot.selectedModel
                            : "nano-banana-2";
                        const response = await fetch("/api/ai/image-edit", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                action: "text-edit",
                                prompt: jobSnapshot.basePrompt,
                                imageBase64: imageUrl,
                                model: editModel,
                                referenceImages: refUrls,
                                projectId,
                                scale: jobSnapshot.scale || undefined,
                                ...jobSnapshot.loraRequestFields,
                            }),
                        });
                        const data = await response.json();
                        if (data.error) {
                            throw new Error(
                                data.requestId
                                    ? `${data.error} [request: ${data.requestId}]`
                                    : data.error,
                            );
                        }
                        if (!data.content) throw new Error("Пустой ответ от модели");
                        let persisted: string = data.content;
                        persisted = await persistWizardImageUrl(data.content, projectId, 0);
                        void registerUrl({
                            projectId,
                            url: persisted,
                            source: "wizard-edit",
                        }).catch((e) => console.warn("[Wizard] registerUrl failed:", e));
                        onLayerGeometryReset(layerId);
                        onOutpaintHistoryClear(layerId);
                        onImageChange(layerId, persisted);
                        resolveBatchVariants(layerId, batchId, [persisted], promptLabel, "ready");
                        setSelectedGeneratedVariantId(`${batchId}-0-${persisted}`);
                    } else {
                        const styleSuffix = getImagePresetPromptSuffixForModel(
                            jobSnapshot.imageStyleId,
                            jobSnapshot.selectedModel,
                            imagePresets,
                        );
                        const styleContext = styleSuffix ? `. Style: ${styleSuffix}` : "";
                        const finalPrompt = `${jobSnapshot.basePrompt}${styleContext}`;
                        const refUrls =
                            jobSnapshot.referenceImages.length > 0
                                ? await uploadManyForAI(jobSnapshot.referenceImages, projectId)
                                : undefined;
                        const response = await fetch("/api/ai/generate", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                prompt: resolveRefTags(finalPrompt, jobSnapshot.selectedModel),
                                type: "image",
                                model: jobSnapshot.selectedModel,
                                aspectRatio: jobSnapshot.aspectRatio,
                                scale: jobSnapshot.scale || undefined,
                                count: requestedImageCount,
                                referenceImages: refUrls,
                                projectId,
                                ...jobSnapshot.loraRequestFields,
                            }),
                        });
                        const data = await response.json();
                        if (data.error) {
                            throw new Error(
                                data.requestId
                                    ? `${data.error} [request: ${data.requestId}]`
                                    : data.error,
                            );
                        }
                        if (!data.content) throw new Error("Пустой ответ от модели");
                        const rawUrls: string[] = Array.from(
                            new Set(
                                (
                                    (Array.isArray(data.contents) && data.contents.length > 0
                                        ? data.contents
                                        : [data.content]) as unknown[]
                                ).filter(
                                    (url): url is string =>
                                        typeof url === "string" && url.length > 0,
                                ),
                            ),
                        );
                        const persistedUrls: string[] = [];
                        for (let i = 0; i < rawUrls.length; i++) {
                            if (i > 0) {
                                await new Promise((resolve) => setTimeout(resolve, 150));
                            }
                            const sourcePersisted = await persistWizardImageUrl(rawUrls[i], projectId, i);
                            let layerUrl = sourcePersisted;

                            if (
                                jobSnapshot.workingSnapshot
                                && shouldPrepareWorkingDerivative(jobSnapshot.selectedModel, jobSnapshot.scale)
                            ) {
                                void registerUrl({
                                    projectId,
                                    url: sourcePersisted,
                                    source: "wizard-generation-source",
                                }).catch((e) => console.warn("[Wizard] source registerUrl failed:", e));

                                const derivative = await prepareAndRegisterWizardDerivative({
                                    imageSrc: sourcePersisted,
                                    layer: jobSnapshot.workingSnapshot.layer,
                                    usageSizes: jobSnapshot.workingSnapshot.usageSizes,
                                    projectId,
                                    registerUrl,
                                });
                                layerUrl = derivative.src;
                            } else {
                                void registerUrl({
                                    projectId,
                                    url: sourcePersisted,
                                    source: "wizard-generation",
                                }).catch((e) => console.warn("[Wizard] registerUrl failed:", e));
                            }

                            persistedUrls.push(layerUrl);
                        }
                        if (persistedUrls.length === 0) {
                            throw new Error(
                                "Не удалось сохранить сгенерированное изображение. Повторите попытку.",
                            );
                        }
                        onLayerGeometryReset(layerId);
                        onOutpaintHistoryClear(layerId);
                        onImageChange(layerId, persistedUrls[0]);
                        resolveBatchVariants(layerId, batchId, persistedUrls, promptLabel, "ready");
                        setSelectedGeneratedVariantId(`${batchId}-0-${persistedUrls[0]}`);
                    }
                } catch (err) {
                    setError(parseGenerationError(err));
                    resolveBatchVariants(layerId, batchId, [], promptLabel, "error");
                    throw err;
                } finally {
                    setOutpaintProgress(null);
                }
            },
        );
    };

    if (!activeLayer) {
        return null;
    }

    const isImage = activeLayer.type === "image";
    const currentImage = isImage ? imageValues[activeLayer.id] ?? String(activeLayer.props.src ?? "") : "";
    const selectedLabel = activeLayer.type === "text" ? "текстом" : activeLayer.type === "badge" ? "бейджем" : "фото";
    const showVariantStrip =
        isImage
        && activeVariants.length > 0
        && (activeVariants.length > 1 || activeVariants.some((v) => v.status === "loading"));

    return (
        <div className="absolute bottom-6 left-1/2 z-20 flex w-[760px] max-w-[calc(100%-32px)] -translate-x-1/2 flex-col items-center gap-2">
            {showVariantStrip && (
                <GeneratedImageStrip
                    variants={activeVariants}
                    selectedId={selectedGeneratedVariantId}
                    onSelect={handleGeneratedVariantSelect}
                />
            )}

            <div className="relative w-full rounded-[20px] border border-border-primary bg-bg-surface/95 shadow-[var(--shadow-lg)] backdrop-blur-xl">
            {isImage && imageMode !== "expand" && referenceImages.length > 0 && (
                <div className="absolute right-4 top-12 z-10">
                    <ReferenceImagePreviewTray
                        images={referenceImages}
                        onChange={setReferenceImages}
                        onTagClick={(tag) => promptRef.current?.insertAtCursor(tag)}
                    />
                </div>
            )}
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
                                : imageMode === "inpaint"
                                    ? "Нарисуйте маску на превью и укажите промпт внизу"
                                    : "AI отредактирует текущее изображение слоя"}
                    </span>
                )}
                {isImage && imageMode === "expand" && packMaxSize.width > 0 && packMaxSize.height > 0 && (
                    <span className="ml-auto rounded-full border border-border-primary bg-bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                        Цель: {packMaxSize.width} × {packMaxSize.height}
                    </span>
                )}
            </div>

            <div
                className="px-4 pt-3"
                style={
                    isImage && imageMode !== "expand" && referenceImages.length > 0
                        ? { paddingRight: getReferenceTrayReserveWidth(referenceImages.length) }
                        : undefined
                }
            >
                <RefAutocompleteTextarea
                    ref={promptRef}
                    value={prompt}
                    onChange={(value) => { setPrompt(value); setError(null); }}
                    referenceImages={referenceImages}
                    dropdownPlacement="auto"
                    placeholder={isImage
                        ? imageMode === "edit"
                            ? "Опишите правку: заменить фон, добавить тень, изменить освещение..."
                            : imageMode === "inpaint"
                                ? "Что нарисовать в выделенной области? Например: голубое небо, текстура дерева..."
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

            {/* Outpaint progress: only rendered while imageMode === "expand"
                is in flight. Collapses out of layout when null so the
                regular generate/edit flows aren't pushed down. */}
            {outpaintProgress && (
                <div className="px-4 pb-2">
                    <OutpaintProgressIndicator
                        label={outpaintProgress.label}
                        percent={outpaintProgress.percent}
                    />
                </div>
            )}

            {isImage && imageMode === "inpaint" && inpaintMask && (
                <div className="px-4 pb-2">
                    <InpaintActionBar
                        mask={inpaintMask}
                        disabled={isGenerating}
                        editDisabled={!prompt.trim()}
                        editDisabledHint="Введите промпт сверху, чтобы Правка стала активной"
                        onAction={(action) => void handleInpaintApply(action)}
                        onCancel={() => {
                            inpaintMask.clear();
                            onImageModeChange("edit");
                        }}
                    />
                </div>
            )}

            <div className="flex min-w-0 items-center gap-2 px-4 pb-3 pt-1">
                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {isImage && (
                        <>
                        <div className="flex h-8 items-center rounded-[10px] border border-border-primary/60 bg-bg-primary p-0.5">
                            <ImageModeButton
                                active={imageMode === "generate"}
                                label="Генерация"
                                icon={<Sparkles size={14} />}
                                onClick={() => onImageModeChange("generate")}
                            />
                            <ImageModeButton
                                active={imageMode === "edit"}
                                label="Правка"
                                icon={<Paintbrush size={14} />}
                                onClick={() => onImageModeChange("edit")}
                            />
                            <ImageModeButton
                                active={imageMode === "inpaint"}
                                label="Inpaint"
                                icon={<Brush size={14} />}
                                onClick={() => {
                                    onImageModeChange("inpaint");
                                    if (!getModelById(selectedModel)?.caps.includes("inpaint")) {
                                        setSelectedModel(DEFAULT_INPAINT_MODEL);
                                    }
                                }}
                            />
                            <ImageModeButton
                                active={imageMode === "expand"}
                                label="Расширить фон"
                                icon={<Expand size={14} />}
                                onClick={() => onImageModeChange("expand")}
                            />
                        </div>
                        {imageMode !== "expand" && (
                            <SelectPill
                                icon={<Settings2 size={13} />}
                                label="Модель"
                                value={selectedModel}
                                onChange={(value) => {
                                    setSelectedModel(value);
                                    setImageCount(1);
                                    setScale(getDefaultResolution(value));
                                    setLoras([]);
                                    setAdvancedParams({});
                                    if (!getModelById(value)?.caps.includes("vision")) {
                                        setReferenceImages([]);
                                    }
                                    clearGeneratedVariants();
                                }}
                                options={imageModelOptions}
                                className="min-w-[150px] max-w-[190px]"
                            />
                        )}
                        {imageMode === "generate" && (
                            <>
                                <SelectPill
                                    icon={<Ratio size={13} />}
                                    label="Соотношение сторон"
                                    value={aspectRatio}
                                    onChange={setAspectRatio}
                                    options={modelAspectRatios.map((ratio) => ({ value: ratio, label: ratio }))}
                                    className="w-[86px]"
                                />
                                {!loraSpec && (
                                    <ImageStylePresetPicker
                                        presets={imagePresets}
                                        selectedId={imageStyleId}
                                        onChange={setImageStyleId}
                                        variant="compact"
                                    />
                                )}
                                {maxImageOutputs > 1 && (
                                    <SelectPill
                                        icon={<Sparkles size={13} />}
                                        label="Количество изображений"
                                        value={imageCount}
                                        onChange={(value) => setImageCount(Number(value))}
                                        options={Array.from({ length: maxImageOutputs }, (_, index) => {
                                            const count = index + 1;
                                            return { value: String(count), label: String(count) };
                                        })}
                                        className="w-[64px]"
                                    />
                                )}
                            </>
                        )}
                        {(imageMode === "generate" || imageMode === "edit" || imageMode === "inpaint") && modelResolutions.length > 0 && (
                            <SelectPill
                                icon={<Maximize2 size={13} />}
                                label="Разрешение"
                                value={scale}
                                onChange={setScale}
                                options={modelResolutions.map((resolution) => ({
                                    value: resolution.id,
                                    label: resolution.label,
                                }))}
                                className="w-[74px]"
                            />
                        )}
                        {loraSpec && imageMode !== "expand" && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setSettingsOpen(true)}
                                    title="Параметры модели"
                                    className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-border-primary/60 text-text-tertiary transition-all cursor-pointer hover:text-text-primary hover:bg-bg-tertiary/30"
                                >
                                    <Sliders size={12} />
                                </button>
                                <LoraSelectorPicker
                                    family={loraSpec.family}
                                    maxCount={loraSpec.maxCount ?? 1}
                                    value={loras}
                                    onChange={setLoras}
                                />
                            </>
                        )}
                        {imageMode !== "expand" && supportsVision && (
                            <ReferenceImageInput
                                images={referenceImages}
                                onChange={setReferenceImages}
                                max={getMaxRefs(selectedModel)}
                                label="Референс"
                                previewMode="none"
                                onTagClick={(tag) => promptRef.current?.insertAtCursor(tag)}
                            />
                        )}
                        </>
                    )}

                    {!isImage && (
                        <>
                        <SelectPill
                            icon={<Settings2 size={13} />}
                            label="Модель текста"
                            value={textModel}
                            onChange={setTextModel}
                            options={TEXT_GEN_MODELS.map((model) => ({ value: model.id, label: model.label }))}
                            className="min-w-[150px] max-w-[190px]"
                        />
                        <TextStylePresetPicker
                            presets={textPresets}
                            selectedId={textStyleId}
                            onChange={(val) => setTextStyleId((val as TextGenPreset) || "none")}
                            variant="compact"
                        />
                        </>
                    )}
                </div>

                {queueBadge && (
                    <span className="shrink-0 rounded-full border border-border-primary bg-bg-tertiary/60 px-2 py-0.5 text-[10px] font-medium text-text-secondary">
                        {queueBadge}
                    </span>
                )}

                {!(isImage && imageMode === "inpaint") && (
                <button
                    onClick={handleGenerate}
                    disabled={(activeLayer.type !== "image" && isGenerating) || isGenerating}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-lime-hover text-accent-lime-text shadow-sm transition-all duration-200 cursor-pointer hover:bg-accent-lime hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Сгенерировать для выбранного слоя"
                >
                    {activeLayer.type !== "image" && isGenerating ? (
                        <Loader2 size={18} className="animate-spin" />
                    ) : (
                        <Sparkles size={18} />
                    )}
                </button>
                )}
            </div>

            {isImage && loraSpec && imageMode !== "expand" && (
                <div className="px-4 pb-1">
                    <LoraTriggerHint family={loraSpec.family} loras={loras} />
                </div>
            )}
            {loraSpec && (
                <ModelSettingsModal
                    open={settingsOpen}
                    onClose={() => setSettingsOpen(false)}
                    spec={loraSpec}
                    value={advancedParams}
                    onChange={setAdvancedParams}
                />
            )}
            </div>
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
        </button>
    );
}

export function getPreviewFormatSources(template: TemplatePackV2): PreviewFormatSource[] {
    const data = template as TemplatePackV2 & {
        layers?: Layer[];
        canvasWidth?: number;
        canvasHeight?: number;
    };
    const resizes = (template.resizes ?? []) as WizardPreviewResize[];
    const isHiddenMaster = (resize: WizardPreviewResize | undefined): boolean => Boolean(resize?._wizardHidden);
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
            hidden: isHiddenMaster(masterResize),
        });
    }

    for (const resize of resizes) {
        if (!resize.layerSnapshot?.length) continue;
        const isMaster = resize.isMaster === true
            || isHiddenMaster(resize)
            || resize.id === masterResize?.id;
        pushSource(resizeToPreviewSource(resize, isMaster));
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

type WizardPreviewResize = NonNullable<TemplatePackV2["resizes"]>[number] & { _wizardHidden?: boolean };

function resizeToPreviewSource(
    resize: WizardPreviewResize,
    isMaster: boolean,
): PreviewFormatSource {
    return {
        id: resize.id,
        name: isMaster ? (resize.name || "Мастер") : (resize.name || "Формат"),
        label: resize.label ?? `${resize.width} × ${resize.height}`,
        isMaster,
        hidden: resize._wizardHidden,
        layers: resize.layerSnapshot ?? [],
        width: resize.width,
        height: resize.height,
        layerBindings: resize.layerBindings,
    };
}

function editableSlotKey(type: unknown, slotId: unknown): string | null {
    if (typeof type !== "string" || typeof slotId !== "string" || slotId === "none") return null;
    if (!CONTENT_TYPES.includes(type as EditableLayerType)) return null;
    return `${type}:${slotId}`;
}

function assignSlotOccurrences(entries: EditableLayerEntry[]): EditableLayerEntry[] {
    const counts = new Map<string, number>();
    return entries.map((entry) => {
        const key = editableSlotKey(entry.type, entry.slotId);
        if (!key) return entry;
        const slotOccurrence = counts.get(key) ?? 0;
        counts.set(key, slotOccurrence + 1);
        return { ...entry, slotOccurrence };
    });
}

export function getEditableLayerEntries(template: TemplatePackV2, masterLayers: Layer[]): EditableLayerEntry[] {
    const masterById = new Map(template.masterComponents.map((mc) => [mc.id, mc]));
    const layerEntries: EditableLayerEntry[] = [];

    for (const layer of masterLayers) {
        if (!CONTENT_TYPES.includes(layer.type as EditableLayerType)) continue;
        if (layer.type === "image" && layer.isFixedAsset) continue;
        if (!layer.slotId || layer.slotId === "none") continue;

        const matchingMaster = layer.masterId ? masterById.get(layer.masterId) : masterById.get(layer.id);
        layerEntries.push({
            id: layer.id,
            type: layer.type as EditableLayerType,
            name: layer.name,
            slotId: layer.slotId,
            layerId: layer.id,
            masterComponentId: matchingMaster?.id ?? layer.masterId,
            source: "layer",
            props: {
                ...(matchingMaster?.props as unknown as Record<string, unknown> | undefined),
                ...(layer as unknown as Record<string, unknown>),
            },
        });
    }

    if (layerEntries.length > 0) {
        return assignSlotOccurrences(layerEntries);
    }

    const legacyEntries: EditableLayerEntry[] = [];
    for (const mc of template.masterComponents) {
        if (!CONTENT_TYPES.includes(mc.type as EditableLayerType)) continue;
        if (((mc.props as unknown as Record<string, unknown>).isFixedAsset) && mc.type === "image") continue;

        const entry = masterComponentToEntry(mc);
        if (!entry.slotId || entry.slotId === "none") continue;
        legacyEntries.push(entry);
    }

    return assignSlotOccurrences(legacyEntries);
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

export function buildDraftPreviewLayers(
    layers: Layer[],
    entries: EditableLayerEntry[],
    textValues: Record<string, string>,
    imageValues: Record<string, string>,
    imageViewOverrides: Record<string, WizardImageViewOverride> = {},
    layerStyleOverrides: Record<string, WizardLayerStyleOverride> = {},
    layerGeometryOverrides?: Record<string, LayerExpansionOverride>,
    layerBindings?: LayerBinding[],
): Layer[] {
    const resolver = createWizardLayerEntryResolver(entries, layers, layerBindings);
    const nextLayers = layers.map((layer) => {
        const candidateIds = resolver.getCandidateIds(layer);
        const textValue = candidateIds.map((id) => textValues[id]).find((value) => value !== undefined);
        const imageValue = candidateIds.map((id) => imageValues[id]).find((value) => value !== undefined);
        const imageViewOverride = candidateIds.map((id) => imageViewOverrides[id]).find((value) => value !== undefined);
        const styleOverride = candidateIds.map((id) => layerStyleOverrides[id]).find((value) => value !== undefined);
        const geometryOverride = layerGeometryOverrides
            ? candidateIds.map((id) => layerGeometryOverrides[id]).find((value) => value !== undefined)
            : undefined;

        if (layer.type === "text") {
            const next = { ...layer } as typeof layer;
            if (textValue !== undefined) next.text = textValue;
            if (styleOverride?.fill) next.fill = styleOverride.fill;
            return next;
        }
        if (layer.type === "badge") {
            const next = { ...layer } as typeof layer;
            if (textValue !== undefined) next.label = textValue;
            if (styleOverride?.textColor) next.textColor = styleOverride.textColor;
            return next;
        }
        if (layer.type === "image" && !layer.isFixedAsset) {
            const next = { ...layer } as typeof layer;
            if (imageValue !== undefined) next.src = imageValue;
            if (imageViewOverride) {
                next.objectFit = imageViewOverride.objectFit ?? next.objectFit;
                next.focusX = imageViewOverride.focusX ?? next.focusX;
                next.focusY = imageViewOverride.focusY ?? next.focusY;
            }
            if (geometryOverride) {
                next.x = geometryOverride.next.x;
                next.y = geometryOverride.next.y;
                next.width = geometryOverride.next.width;
                next.height = geometryOverride.next.height;
            }
            return next;
        }
        return { ...layer };
    });

    return applyAllAutoLayouts(nextLayers);
}

export function createWizardLayerEntryResolver(
    entries: EditableLayerEntry[],
    layers: WizardResolvableLayer[],
    layerBindings?: LayerBinding[],
): {
    getEntryForLayer: (layer: WizardResolvableLayer) => EditableLayerEntry | undefined;
    getCandidateIds: (layer: WizardResolvableLayer) => string[];
} {
    const entryById = new Map<string, EditableLayerEntry>();
    const entriesByGroup = new Map<string, EditableLayerEntry[]>();
    for (const entry of entries) {
        for (const id of [entry.id, entry.layerId, entry.masterComponentId]) {
            if (id && !entryById.has(id)) entryById.set(id, entry);
        }

        const key = editableSlotKey(entry.type, entry.slotId);
        if (!key) continue;
        const group = entriesByGroup.get(key) ?? [];
        group.push(entry);
        entriesByGroup.set(key, group);
    }

    const layerOccurrenceById = new Map<string, number>();
    const layerOccurrenceCounts = new Map<string, number>();
    for (const layer of layers) {
        const key = editableSlotKey(layer.type, layer.slotId);
        const id = typeof layer.id === "string" ? layer.id : undefined;
        if (!key || !id) continue;
        const occurrence = layerOccurrenceCounts.get(key) ?? 0;
        layerOccurrenceCounts.set(key, occurrence + 1);
        layerOccurrenceById.set(id, occurrence);
    }

    const bindingByTargetId = new Map(
        (layerBindings ?? []).map((binding) => [binding.targetLayerId, binding]),
    );

    const getEntryForLayer = (layer: WizardResolvableLayer): EditableLayerEntry | undefined => {
        const id = typeof layer.id === "string" ? layer.id : undefined;
        const masterId = typeof layer.masterId === "string" ? layer.masterId : undefined;

        if (id) {
            const direct = entryById.get(id);
            if (direct) return direct;
        }

        if (masterId) {
            const byMaster = entryById.get(masterId);
            if (byMaster) return byMaster;
        }

        if (id) {
            const binding = bindingByTargetId.get(id);
            if (binding) {
                const byBinding = entryById.get(binding.masterLayerId);
                if (byBinding) return byBinding;
            }
        }

        const key = editableSlotKey(layer.type, layer.slotId);
        const group = key ? entriesByGroup.get(key) : undefined;
        if (!group || group.length === 0) return undefined;
        if (group.length === 1) return group[0];

        const occurrence = id ? layerOccurrenceById.get(id) : undefined;
        if (occurrence !== undefined) {
            return group.find((entry) => entry.slotOccurrence === occurrence);
        }

        return undefined;
    };

    const getCandidateIds = (layer: WizardResolvableLayer): string[] => {
        const entry = getEntryForLayer(layer);
        const ids = [
            typeof layer.id === "string" ? layer.id : undefined,
            typeof layer.masterId === "string" ? layer.masterId : undefined,
            entry?.id,
            entry?.layerId,
            entry?.masterComponentId,
        ].filter((id): id is string => Boolean(id));
        return Array.from(new Set(ids));
    };

    return { getEntryForLayer, getCandidateIds };
}
