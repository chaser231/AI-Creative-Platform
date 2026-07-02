import { useState, useRef, useEffect, useCallback } from "react";
import { Sparkles, Wand2, Image as ImageIcon, Send, MessageCircle, Settings2, Ratio, Type, Grip, CheckCircle2, Circle, X, ChevronDown, Eraser, Paintbrush, Expand, Loader2, Sliders, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ReferenceImageInput, ReferenceImagePreviewTray, getReferenceTrayReserveWidth } from "@/components/ui/ReferenceImageInput";
import { RefAutocompleteTextarea, type RefAutocompleteTextareaHandle } from "@/components/ui/RefAutocompleteTextarea";
import { ImageStylePresetPicker, TextStylePresetPicker } from "@/components/ui/StylePresetPicker";
import { LoraSelectorPicker } from "@/components/ui/LoraSelectorPicker";
import { LoraTriggerHint } from "@/components/ui/LoraTriggerHint";
import { ModelSettingsModal, type AdvancedAIParams } from "@/components/ui/ModelSettingsModal";
import { GeneratedImageStrip, type GeneratedImageVariant } from "@/components/ui/GeneratedImageStrip";
import { capLayerVariants } from "@/lib/generationVariantUtils";
import { SelectPill } from "@/components/ui/SelectPill";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import { RemoteTextProvider, RemoteImageProvider } from "@/services/aiService";
import { getModelById, getMaxRefs, getMaxOutputs, getAspectRatios, getResolutions, getDefaultResolution, resolveRefTags, getLoraSpec, getModelsForCaps, getImageGenerationPickerOptions, getImageEditPickerOptions } from "@/lib/ai-models";
import { InpaintActionBar, type InpaintAction } from "@/components/inpaint/InpaintActionBar";
import { useOptionalSharedInpaintMask } from "@/components/inpaint/InpaintContext";
import { useCanvasEditMode } from "@/hooks/useCanvasEditMode";
import { DEFAULT_INPAINT_MODEL, PREFERRED_INPAINT_MODELS } from "@/lib/inpaintPrompts";
import type { LoraWeight } from "@/lib/ai-providers";
import { getImagePresetPromptSuffixForModel, getTextPresetInstruction } from "@/lib/stylePresets";
import { useStylePresets } from "@/hooks/useStylePresets";
import { persistImageToS3, uploadForAI, uploadManyForAI } from "@/utils/imageUpload";
import { type OutpaintProgressState } from "@/utils/outpaintProgress";
import {
    runStudioBriaOutpaint,
    type StudioBriaOutpaintStage,
    type StudioBriaPromptEnhancement,
} from "@/utils/studioBriaOutpaint";
import { OutpaintProgressIndicator } from "@/components/ui/OutpaintProgressIndicator";
import { useProjectLibrary } from "@/hooks/useProjectLibrary";
import { trpc } from "@/lib/trpc";
import type { ImageLayer } from "@/types";
import { parseGenerationError } from "@/lib/parseGenerationError";
import {
    formatProjectQueueBadge,
    truncatePromptLabel,
    useGenerationQueueStore,
    useProjectQueueCounts,
} from "@/store/generationQueueStore";

// Helper models lists
const TEXT_MODELS = [
    { id: "deepseek", name: "DeepSeek V3" },
    { id: "gemini-flash", name: "Gemini 2.5 Flash" },
];

const IMAGE_MODELS = getImageGenerationPickerOptions().map((model) => ({
    id: model.id,
    name: model.label,
}));

// Models available for AI image editing (with "edit" cap or specialized tools)
const EDIT_MODELS = getImageEditPickerOptions().map((model) => ({
    id: model.id,
    name: model.label,
}));

// LoRA-aware models usable in the edit (img2img) tab. These take an uploaded
// source image plus a LoRA stack and keep the LoRA picker visible in that tab.
const EDIT_LORA_MODELS = new Set([
    "qwen-image-edit-lora",
    "flux-lora",
    "flux-kontext-lora",
    "flux-2-lora",
]);

// Outpaint target aspect ratios (used within the edit tab's "Expand" action)
const OUTPAINT_RATIOS = [
    { id: "16:9", label: "16:9" },
    { id: "9:16", label: "9:16" },
    { id: "4:3", label: "4:3" },
    { id: "3:4", label: "3:4" },
    { id: "1:1", label: "1:1" },
    { id: "21:9", label: "21:9" },
];

function mapStudioBriaOutpaintStage(stage: StudioBriaOutpaintStage): OutpaintProgressState {
    switch (stage) {
        case "source-persist-start":
        case "source-persist-done":
            return { label: "Подготавливаем изображение", percent: 10 };
        case "source-rasterized":
            return { label: "Собираем видимый растр слоя", percent: 20 };
        case "prepared-source-persisted":
            return { label: "Сохраняем подготовленный растр", percent: 30 };
        case "prompt-enhance-start":
            return { label: "Анализируем сцену", percent: 35 };
        case "prompt-enhance-done":
            return { label: "Анализируем сцену", percent: 40 };
        case "outpaint-api-start":
            return { label: "Расширяем фон через Bria Expand", percent: 45 };
        case "outpaint-api-done":
            return { label: "Совмещаем с оригиналом", percent: 85 };
        case "composite-start":
            return { label: "Сглаживаем швы", percent: 90 };
        case "composite-done":
            return { label: "Готово", percent: 100 };
    }
}

// Aspect ratios and resolutions are now dynamic per model — see ai-models.ts

export interface AIPromptBarProps {
    open: boolean;
    onClose: () => void;
    onToggleChat: () => void;
    isChatOpen: boolean;
    onResult: (result: { type: string; content: string; contents?: string[]; prompt: string; model?: string }) => void;
    /** Project ID for S3 image persistence */
    projectId?: string;
}

interface StudioOutpaintRetryState {
    layer: ImageLayer;
    padding: { top: number; right: number; bottom: number; left: number };
    prompt: string;
    rawPrompt: string;
    promptLabel: string;
    promptEnhancement: StudioBriaPromptEnhancement;
}

const S3_PERSIST_HOST = "storage.yandexcloud.net";

/**
 * Read a Blob as a base64 data URL. Used by the inpaint pipeline to feed
 * the mask Blob through `uploadForAI` (which expects base64), since we
 * always upload masks to S3 before sending the inpaint request — fal.ai's
 * flux-pro/v1/fill rejects data: URIs for the `mask_url` field.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
        reader.readAsDataURL(blob);
    });
}

async function persistGeneratedUrl(url: string, projectId: string, index: number): Promise<string> {
    let persisted = await persistImageToS3(url, projectId);
    if (!persisted.includes(S3_PERSIST_HOST)) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        persisted = await persistImageToS3(url, projectId);
    }
    if (!persisted.includes(S3_PERSIST_HOST)) {
        console.error(`[AIPromptBar] persist failed index=${index}`);
        throw new Error("Не удалось сохранить сгенерированное изображение. Повторите попытку.");
    }
    return persisted;
}

function EditActionIconButton({
    icon,
    label,
    active,
    disabled,
    loading,
    onClick,
}: {
    icon: React.ReactNode;
    label: string;
    active?: boolean;
    disabled?: boolean;
    loading?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled || loading}
            aria-label={label}
            title={label}
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                active
                    ? "border-accent-lime-hover/50 bg-accent-lime/20 text-accent-primary"
                    : "border-border-primary/60 bg-bg-tertiary/40 text-text-secondary hover:border-border-secondary hover:bg-bg-tertiary hover:text-text-primary"
            }`}
        >
            {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
        </button>
    );
}

export function AIPromptBar({ open, onClose, onToggleChat, isChatOpen, onResult, projectId }: AIPromptBarProps) {
    const { addTextLayer, addImageLayer, selectedLayerIds, updateLayer, layers, canvasWidth, canvasHeight } = useCanvasStore(useShallow((s) => ({
        addTextLayer: s.addTextLayer, addImageLayer: s.addImageLayer,
        selectedLayerIds: s.selectedLayerIds, updateLayer: s.updateLayer, layers: s.layers,
        canvasWidth: s.canvasWidth, canvasHeight: s.canvasHeight,
    })));

    // Expand mode from canvas store
    const expandMode = useCanvasStore((s) => s.expandMode);
    const expandPadding = useCanvasStore((s) => s.expandPadding);
    const setExpandMode = useCanvasStore((s) => s.setExpandMode);
    const resetExpandMode = useCanvasStore((s) => s.resetExpandMode);

    // Inpaint mode — UI flag in store, brush strokes in InpaintProvider.
    // useOptionalSharedInpaintMask returns null when the page didn't wrap us
    // in <InpaintProvider> (template/standalone mode), so we keep the bar
    // functional even without the inpaint hook.
    const inpaintMode = useCanvasStore((s) => s.inpaintMode);
    const setInpaintMode = useCanvasStore((s) => s.setInpaintMode);
    const resetInpaintMode = useCanvasStore((s) => s.resetInpaintMode);
    const expandTargetLayerId = useCanvasStore((s) => s.expandTargetLayerId);
    const inpaintTargetLayerId = useCanvasStore((s) => s.inpaintTargetLayerId);
    const inpaintMask = useOptionalSharedInpaintMask();
    const { exitCanvasEditMode } = useCanvasEditMode();
    const [activeTab, setActiveTab] = useState<"text" | "image" | "edit">("text");
    const [prompt, setPrompt] = useState("");
    const [selectedModel, setSelectedModel] = useState(TEXT_MODELS[0].id);
    const [aspectRatio, setAspectRatio] = useState("1:1");
    const [scale, setScale] = useState("");
    const [imageCount, setImageCount] = useState(1);
    const [applyToSelection, setApplyToSelection] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [variantsByLayer, setVariantsByLayer] = useState<Record<string, GeneratedImageVariant[]>>({});
    const [selectedGeneratedVariantId, setSelectedGeneratedVariantId] = useState<string | undefined>(undefined);
    const [generatedTargetLayerId, setGeneratedTargetLayerId] = useState<string | null>(null);
    const [lastOutpaintRetry, setLastOutpaintRetry] = useState<StudioOutpaintRetryState | null>(null);
    const enqueueJob = useGenerationQueueStore((s) => s.enqueue);
    const queueCounts = useProjectQueueCounts(projectId);
    // Outpaint pipeline progress (only set during action === "outpaint";
    // null otherwise so the indicator collapses out of the layout).
    const [outpaintProgress, setOutpaintProgress] = useState<OutpaintProgressState | null>(null);
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const [imageStyleId, setImageStyleId] = useState("none");
    const [textStyleId, setTextStyleId] = useState<string | undefined>(undefined);
    // LoRA selection + advanced model knobs (guidance/steps/negative/etc).
    // Both are model-scoped — clearing on every model swap keeps them
    // honest (a Qwen LoRA path silently passed to FLUX would error out).
    const [loras, setLoras] = useState<LoraWeight[]>([]);
    const [advancedParams, setAdvancedParams] = useState<AdvancedAIParams>({});
    const [settingsOpen, setSettingsOpen] = useState(false);
    const promptRef = useRef<RefAutocompleteTextareaHandle>(null);

    // ── Edit tab state ──
    const [editAction, setEditAction] = useState<"prompt" | "remove-bg" | "inpaint" | "expand" | null>(null);
    const [editError, setEditError] = useState<string | null>(null);
    const [outpaintRatio, setOutpaintRatio] = useState("16:9");

    // Persist edit/expand results as a project asset so they appear in the library
    const trpcUtils = trpc.useUtils();
    const saveGeneratedAssetMutation = trpc.asset.saveGeneratedImage.useMutation();
    const { registerFile } = useProjectLibrary();

    // Workspace-aware presets (system + custom from DB)
    const { imagePresets, textPresets } = useStylePresets();

    // Check if current model supports vision (reference images)
    const supportsVision = activeTab !== "text" &&
        (getModelById(selectedModel)?.caps.includes("vision") ?? false);

    // Get selected image layer (if any)
    const selectedImageLayer = selectedLayerIds.length > 0
        ? layers.find(l => l.id === selectedLayerIds[0] && l.type === "image") as ImageLayer | undefined
        : undefined;

    const expandTargetLayer = expandTargetLayerId
        ? layers.find((l) => l.id === expandTargetLayerId && l.type === "image") as ImageLayer | undefined
        : undefined;

    const inpaintTargetLayer = inpaintTargetLayerId
        ? layers.find((l) => l.id === inpaintTargetLayerId && l.type === "image") as ImageLayer | undefined
        : undefined;

    // Keep local editAction in sync when store modes exit via selection change,
    // prompt bar close, etc.
    useEffect(() => {
        if (!expandMode && editAction === "expand") {
            setEditAction(null);
        }
    }, [expandMode, editAction]);

    useEffect(() => {
        if (!inpaintMode && editAction === "inpaint") {
            setEditAction(null);
        }
    }, [inpaintMode, editAction]);

    // Reset model on tab change
    const handleTabChange = (tab: "text" | "image" | "edit") => {
        setActiveTab(tab);
        const models = tab === "text" ? TEXT_MODELS : tab === "image" ? IMAGE_MODELS : EDIT_MODELS;
        setSelectedModel(models[0].id);
        setImageCount(1);
        clearGeneratedVariants();
        // Clear reference images when switching to text tab
        if (tab === "text") setReferenceImages([]);
        if (tab === "image" || tab === "edit") {
            setScale(getDefaultResolution(models[0].id));
        } else {
            setScale("");
        }
        // Reset edit-specific state
        if (tab === "edit") {
            setEditAction(null);
            setEditError(null);
        }
        // Always reset exclusive canvas edit modes when leaving the edit tab.
        if (tab !== "edit") {
            exitCanvasEditMode();
        }
    };

    // When model changes, clear refs if new model has no vision + reset aspect/resolution
    const handleModelChange = (modelId: string) => {
        setSelectedModel(modelId);
        const model = getModelById(modelId);
        if (!(model?.caps.includes("vision") ?? false)) setReferenceImages([]);
        // Reset aspect ratio if current one is not supported by new model
        const ratios = getAspectRatios(modelId);
        if (!ratios.includes(aspectRatio)) setAspectRatio(ratios[0] || "1:1");
        setScale(getDefaultResolution(modelId));
        setImageCount(1);
        clearGeneratedVariants();
        // LoRA paths and advanced overrides are scoped to the previous model.
        // Carrying them across switches would silently send invalid weights
        // (or use a guidance value outside the new spec's range).
        setLoras([]);
        setAdvancedParams({});
    };

    // Current model's dynamic options
    const modelAspectRatios = getAspectRatios(selectedModel);
    const modelResolutions = getResolutions(selectedModel);
    const maxImageOutputs = activeTab === "image" ? getMaxOutputs(selectedModel) : 1;

    const clearGeneratedVariants = useCallback((layerId?: string) => {
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
        if (!layerId) setGeneratedTargetLayerId(null);
    }, []);

    const appendLoadingVariants = useCallback(
        (layerKey: string, count: number, promptLabel: string, batchId: string) => {
            setVariantsByLayer((prev) => {
                const existing = prev[layerKey] ?? [];
                const slots = Array.from({ length: count }, (_, index) => ({
                    id: `${batchId}-${index}`,
                    status: "loading" as const,
                    promptLabel,
                }));
                return { ...prev, [layerKey]: [...existing, ...slots] };
            });
        },
        [],
    );

    const resolveBatchVariants = useCallback(
        (
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
                return { ...prev, [layerKey]: capLayerVariants([...kept, ...resolved]) };
            });
        },
        [],
    );

    const activeLayerKey = selectedLayerIds[0] ?? generatedTargetLayerId ?? null;
    const activeVariants = activeLayerKey ? (variantsByLayer[activeLayerKey] ?? []) : [];
    const canRetryActiveOutpaint = Boolean(
        activeLayerKey
        && lastOutpaintRetry
        && lastOutpaintRetry.layer.id === activeLayerKey
        && projectId,
    );
    const hasActiveVariantLoading = activeVariants.some((v) => (v.status ?? (v.url ? "ready" : "loading")) === "loading");
    const showVariantStrip =
        (activeTab === "image" || activeTab === "edit")
        && activeVariants.length > 0
        && (activeVariants.length > 1 || hasActiveVariantLoading || canRetryActiveOutpaint);

    const queueBadge = formatProjectQueueBadge(queueCounts);

    useEffect(() => {
        if (imageCount > maxImageOutputs) {
            setImageCount(maxImageOutputs);
        }
    }, [imageCount, maxImageOutputs]);

    useEffect(() => {
        if (!open || (activeTab !== "image" && activeTab !== "edit")) return;
        if (!scale || !modelResolutions.some((r) => r.id === scale)) {
            setScale(getDefaultResolution(selectedModel));
        }
    }, [open, activeTab, selectedModel, scale, modelResolutions]);

    useEffect(() => {
        if (activeTab !== "image" || !open) {
            clearGeneratedVariants();
        }
    }, [activeTab, clearGeneratedVariants, open]);

    // LoRA capabilities — drive picker visibility / disabled state and the
    // gear chip that opens advanced model settings.
    const loraSpec = getLoraSpec(selectedModel);
    const supportsLoraInTab =
        !!loraSpec &&
        (activeTab === "image" ||
            (activeTab === "edit" && EDIT_LORA_MODELS.has(selectedModel)));

    // Bundle the LoRA-aware request fields into a single object so each
    // generate/edit fetch site doesn't have to enumerate them.
    const loraRequestFields = supportsLoraInTab
        ? {
            loras: loras.length > 0 ? loras : undefined,
            guidanceScale: advancedParams.guidanceScale,
            numInferenceSteps: advancedParams.numInferenceSteps,
            negativePrompt: advancedParams.negativePrompt,
            acceleration: advancedParams.acceleration,
        }
        : {};

    // ── Parse AI errors into user-friendly messages ──
    const parseAiError = (e: Error) => {
        const msg = String(e.message || "");
        if (msg.includes("E003") || msg.includes("high demand") || msg.includes("fetch failed")) {
            return "Слишком много запросов к модели. Подождите 10-15 секунд и попробуйте снова.";
        }
        if (msg.includes("prompt is required")) {
            return "Для этой функции необходимо ввести текстовый запрос (prompt).";
        }
        if (msg.includes("timed out")) {
            return "Генерация заняла слишком много времени. Попробуйте снова или выберите более быструю модель.";
        }
        if (msg.includes("Replicate error (429)")) {
            return "Слишком много запросов. Попробуйте через 10 секунд.";
        }
        const requestId = msg.match(/\[request:\s*([^\]]+)\]/i)?.[1];
        if (requestId) {
            return `Ошибка AI. requestId: ${requestId}`;
        }
        return `Ошибка: ${msg}`;
    };

    // ── Apply edited image to the selected layer on canvas ──
    const applyEditedImageToLayer = useCallback(async (
        layer: ImageLayer,
        editedSrc: string,
        opts?: { action?: string; padding?: { top: number; right: number; bottom: number; left: number } },
    ) => {
        if (!layer) return;

        // Persist to S3
        let persistedSrc = editedSrc;
        if (projectId) {
            try {
                persistedSrc = await persistImageToS3(editedSrc, projectId);
            } catch (e) {
                console.warn("Failed to persist edited image to S3:", e);
            }
        }

        // ── Outpaint: use expand padding for sizing (not pixel ratio) ──
        if (opts?.action === "outpaint" && opts.padding) {
            const pad = opts.padding;
            const newWidth = layer.width + pad.left + pad.right;
            const newHeight = layer.height + pad.top + pad.bottom;
            const newX = layer.x - pad.left;
            const newY = layer.y - pad.top;

            updateLayer(layer.id, {
                src: persistedSrc,
                width: newWidth,
                height: newHeight,
                x: newX,
                y: newY,
                objectFit: "fill",
                focusX: 0.5,
                focusY: 0.5,
            } as any);
            return;
        }

        updateLayer(layer.id, { src: persistedSrc } as any);
    }, [projectId, updateLayer]);

    const saveEditedAsset = useCallback(async (
        layerId: string,
        content: string,
        assetPrompt: string,
        model: string | undefined,
        source: string,
    ) => {
        if (!projectId) return;
        try {
            const storeLayer = useCanvasStore
                .getState()
                .layers.find((l) => l.id === layerId) as ImageLayer | undefined;
            let persistedUrl = storeLayer?.src ?? content;
            if (!persistedUrl.startsWith("https://storage.yandexcloud.net")) {
                persistedUrl = await persistImageToS3(persistedUrl, projectId);
            }
            await saveGeneratedAssetMutation.mutateAsync({
                projectId,
                url: persistedUrl,
                prompt: assetPrompt,
                model,
                source,
            });
            await Promise.all([
                trpcUtils.asset.listByProject.invalidate({ projectId }),
                trpcUtils.asset.listByWorkspace.invalidate().catch(() => undefined),
            ]);
        } catch (saveErr) {
            console.warn("[AIPromptBar] Asset save failed:", saveErr);
        }
    }, [projectId, saveGeneratedAssetMutation, trpcUtils]);

    // ── Image edit API call (shared by all edit actions) ──
    const callImageEdit = useCallback(async (action: string, editPrompt?: string) => {
        const targetLayer = action === "outpaint"
            ? expandTargetLayer
            : (inpaintTargetLayer ?? selectedImageLayer);
        if (!targetLayer || !projectId) return;
        const layerId = targetLayer.id;
        const batchId = `edit-${Date.now()}`;
        const promptLabel = truncatePromptLabel(editPrompt || action);
        appendLoadingVariants(layerId, 1, promptLabel, batchId);

        enqueueJob(
            {
                id: batchId,
                projectId,
                surface: "studio",
                layerId,
                prompt: promptLabel,
                imageCount: 1,
            },
            async () => {
        setEditError(null);

        try {
            const styleSuffix = getImagePresetPromptSuffixForModel(imageStyleId, selectedModel, imagePresets);
            const rawPrompt = editPrompt || "";
            const styledPrompt = styleSuffix && rawPrompt ? `${rawPrompt}. Style: ${styleSuffix}` : rawPrompt;
            const resolvedPrompt = resolveRefTags(styledPrompt, selectedModel);

            // ── Studio manual outpaint: Bria-only, one-pass path.
            // Wizard expand keeps its own pipeline and is intentionally not
            // routed through this branch.
            if (action === "outpaint") {
                const currentExpandPadding = { ...expandPadding };
                const sourceLayerSnapshot = { ...targetLayer, src: targetLayer.src } as ImageLayer;
                setOutpaintProgress({ label: "Подготавливаем изображение", percent: 5 });
                const outpaintResult = await runStudioBriaOutpaint({
                    imageSrc: sourceLayerSnapshot.src,
                    layer: sourceLayerSnapshot,
                    canvasPadding: currentExpandPadding,
                    prompt: resolvedPrompt,
                    projectId,
                    onProgress: (stage, info) => {
                        console.log(`[Outpaint/StudioBria/${stage}]`, info ?? "");
                        setOutpaintProgress(mapStudioBriaOutpaintStage(stage));
                    },
                });

                await applyEditedImageToLayer(sourceLayerSnapshot, outpaintResult.src, {
                    action: "outpaint",
                    padding: currentExpandPadding,
                });
                resetExpandMode();
                setEditAction(null);
                setLastOutpaintRetry({
                    layer: sourceLayerSnapshot,
                    padding: currentExpandPadding,
                    prompt: resolvedPrompt,
                    rawPrompt: rawPrompt || action,
                    promptLabel,
                    promptEnhancement: outpaintResult.promptEnhancement,
                });

                await saveEditedAsset(
                    sourceLayerSnapshot.id,
                    outpaintResult.src,
                    rawPrompt || action,
                    outpaintResult.model,
                    "banner-edit-expand",
                );

                onResult({
                    type: "edit",
                    content: outpaintResult.src,
                    prompt: rawPrompt || action,
                    model: outpaintResult.model,
                });
                const outpaintLayer = useCanvasStore
                    .getState()
                    .layers.find((l) => l.id === layerId) as ImageLayer | undefined;
                resolveBatchVariants(
                    layerId,
                    batchId,
                    [outpaintLayer?.src ?? outpaintResult.src],
                    promptLabel,
                    "ready",
                );
                return;
            }

            let finalImageBase64 = targetLayer.src;
            let editDownscaleRatio = 1;

            try {
                const img = new window.Image();
                img.crossOrigin = "anonymous"; // Prevents tainted canvas error
                await new Promise<void>((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = reject;
                    img.src = targetLayer.src;
                });

                let realW = img.naturalWidth;
                let realH = img.naturalHeight;

                const MAX_DIMENSION = 2048;
                if (realW > MAX_DIMENSION || realH > MAX_DIMENSION) {
                    editDownscaleRatio = Math.min(MAX_DIMENSION / realW, MAX_DIMENSION / realH);
                    realW = Math.round(realW * editDownscaleRatio);
                    realH = Math.round(realH * editDownscaleRatio);

                    const canvas = document.createElement("canvas");
                    canvas.width = realW;
                    canvas.height = realH;
                    const ctx = canvas.getContext("2d");
                    if (ctx) {
                        ctx.drawImage(img, 0, 0, realW, realH);
                        finalImageBase64 = canvas.toDataURL("image/png");
                        console.log(`[Image Edit] Downscaled base image to ${realW}×${realH} (ratio=${editDownscaleRatio.toFixed(3)})`);
                    }
                }
            } catch (e) {
                console.error("Downscaling image failed, using original base64", e);
            }

            // Pre-upload images to S3 to avoid sending multi-MB base64 through the server
            const [imageUrl, refUrls] = await Promise.all([
                uploadForAI(finalImageBase64, projectId),
                referenceImages.length > 0 ? uploadManyForAI(referenceImages, projectId) : Promise.resolve(undefined),
            ]);

            const response = await fetch("/api/ai/image-edit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action,
                    prompt: resolvedPrompt,
                    imageBase64: imageUrl,
                    model: action === "remove-bg" ? "bria-rmbg" : selectedModel,
                    referenceImages: refUrls,
                    projectId,
                    // LoRA + advanced knobs only meaningful for inpaint/text-edit
                    // on a LoRA-aware model. The server filters per action too.
                    scale: scale || undefined,
                    ...(action === "inpaint" || action === "text-edit"
                        ? loraRequestFields
                        : {}),
                }),
            });
            const data = await response.json();
            if (data.error) throw new Error(data.requestId ? `${data.error} [request: ${data.requestId}]` : data.error);
            if (data.content) {
                let finalContent = data.content;

                // ── Restore resolution for edit/inpaint/text-edit ──
                // When the image was downscaled to fit API limits, upscale the
                // result back to approximately the original resolution.
                if (editDownscaleRatio < 1) {
                    console.log(`[Edit/Upscale] Image was downscaled (ratio=${editDownscaleRatio.toFixed(3)}), restoring resolution...`);
                    try {
                        const upscaleScale = Math.min(Math.ceil(1 / editDownscaleRatio), 4);
                        const editUpscaleUrl = await uploadForAI(finalContent, projectId);
                        const upscaleRes = await fetch("/api/ai/image-edit", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                action: "upscale",
                                imageBase64: editUpscaleUrl,
                                model: "seedvr",
                                upscaleScale,
                                projectId,
                            }),
                        });
                        const upscaleData = await upscaleRes.json();

                        if (upscaleData.content && !upscaleData.error) {
                            finalContent = upscaleData.content;
                            console.log(`[Edit/Upscale] Resolution restored (scale=${upscaleScale}×)`);
                        } else {
                            console.warn(`[Edit/Upscale] Upscale failed, using lower-res result:`, upscaleData.error);
                        }
                    } catch (upscaleErr) {
                        console.warn(`[Edit/Upscale] Upscale failed, using lower-res result:`, upscaleErr);
                    }
                }

                await applyEditedImageToLayer(targetLayer, finalContent);

                // ── Persist as workspace asset so the result shows up in the library ──
                // applyEditedImageToLayer already uploaded the content to S3 and called
                // updateLayer with the permanent URL. We pull it from the fresh store
                // state to avoid a race with the in-flight S3 upload.
                if (projectId) {
                    try {
                        const storeLayer = useCanvasStore
                            .getState()
                            .layers.find((l) => l.id === targetLayer.id) as ImageLayer | undefined;
                        let persistedUrl = storeLayer?.src ?? finalContent;
                        if (!persistedUrl.startsWith("https://storage.yandexcloud.net")) {
                            persistedUrl = await persistImageToS3(persistedUrl, projectId);
                        }
                        const sourceTag =
                            action === "inpaint" ? "banner-edit-inpaint"
                            : action === "remove-bg" ? "banner-edit-removebg"
                            : "banner-edit-textedit";
                        await saveGeneratedAssetMutation.mutateAsync({
                            projectId,
                            url: persistedUrl,
                            prompt: rawPrompt || action,
                            model: data.model ?? selectedModel,
                            source: sourceTag,
                        });
                        await Promise.all([
                            trpcUtils.asset.listByProject.invalidate({ projectId }),
                            trpcUtils.asset.listByWorkspace.invalidate().catch(() => undefined),
                        ]);
                    } catch (saveErr) {
                        console.warn("[AIPromptBar] Asset save failed:", saveErr);
                    }
                }

                onResult({
                    type: "edit",
                    content: finalContent,
                    prompt: rawPrompt || action,
                    model: data.model,
                });

                const storeLayer = useCanvasStore
                    .getState()
                    .layers.find((l) => l.id === layerId) as ImageLayer | undefined;
                const resultUrl = storeLayer?.src ?? finalContent;
                resolveBatchVariants(layerId, batchId, [resultUrl], promptLabel, "ready");
            }
        } catch (e: unknown) {
            const error = e as Error;
            console.error(`Image edit (${action}) failed:`, error);
            setEditError(parseGenerationError(error));
            if (action === "outpaint") {
                resetExpandMode();
                setEditAction(null);
            }
            resolveBatchVariants(layerId, batchId, [], promptLabel, "error");
            throw error;
        } finally {
            setOutpaintProgress(null);
        }
            },
        );
    }, [selectedImageLayer, expandTargetLayer, inpaintTargetLayer, selectedModel, scale, imageStyleId, imagePresets, referenceImages, expandPadding, projectId, applyEditedImageToLayer, saveEditedAsset, onResult, resetExpandMode, saveGeneratedAssetMutation, trpcUtils, loraRequestFields, appendLoadingVariants, enqueueJob, resolveBatchVariants]);

    const handleOutpaintRetry = useCallback(() => {
        if (!lastOutpaintRetry || !projectId) return;

        const { layer, padding, prompt: retryPrompt, rawPrompt, promptLabel, promptEnhancement } = lastOutpaintRetry;
        const batchId = `edit-${Date.now()}`;
        appendLoadingVariants(layer.id, 1, promptLabel, batchId);

        enqueueJob(
            {
                id: batchId,
                projectId,
                surface: "studio",
                layerId: layer.id,
                prompt: promptLabel,
                imageCount: 1,
            },
            async () => {
                setEditError(null);
                setOutpaintProgress({ label: "Подготавливаем изображение", percent: 5 });

                try {
                    const outpaintResult = await runStudioBriaOutpaint({
                        imageSrc: layer.src,
                        layer,
                        canvasPadding: padding,
                        prompt: retryPrompt,
                        promptEnhancement,
                        projectId,
                        onProgress: (stage, info) => {
                            console.log(`[Outpaint/StudioBria/retry/${stage}]`, info ?? "");
                            setOutpaintProgress(mapStudioBriaOutpaintStage(stage));
                        },
                    });

                    await applyEditedImageToLayer(layer, outpaintResult.src, {
                        action: "outpaint",
                        padding,
                    });

                    await saveEditedAsset(
                        layer.id,
                        outpaintResult.src,
                        rawPrompt,
                        outpaintResult.model,
                        "banner-edit-expand",
                    );

                    onResult({
                        type: "edit",
                        content: outpaintResult.src,
                        prompt: rawPrompt,
                        model: outpaintResult.model,
                    });

                    const storeLayer = useCanvasStore
                        .getState()
                        .layers.find((l) => l.id === layer.id) as ImageLayer | undefined;
                    resolveBatchVariants(
                        layer.id,
                        batchId,
                        [storeLayer?.src ?? outpaintResult.src],
                        promptLabel,
                        "ready",
                    );
                } catch (e: unknown) {
                    const error = e as Error;
                    console.error("Outpaint retry failed:", error);
                    setEditError(parseGenerationError(error));
                    resolveBatchVariants(layer.id, batchId, [], promptLabel, "error");
                    throw error;
                } finally {
                    setOutpaintProgress(null);
                }
            },
        );
    }, [
        lastOutpaintRetry,
        projectId,
        appendLoadingVariants,
        enqueueJob,
        applyEditedImageToLayer,
        saveEditedAsset,
        onResult,
        resolveBatchVariants,
    ]);

    // ── Edit tab handlers ──
    const handleRemoveBg = () => callImageEdit("remove-bg");

    // ── Inpaint apply (mask-aware) ──
    // Replaces the placeholder handleInpaint: exports the live brush mask,
    // uploads it to S3 (fal.ai's flux-pro/v1/fill requires URL masks), and
    // calls /api/ai/image-edit with action="inpaint" + intent.
    //
    // intent="edit"   → uses the user prompt + per-model style suffix
    // intent="remove" → uses the fixed object-removal instruction (server)
    const handleInpaintApply = useCallback(async (intent: InpaintAction) => {
        const targetLayer = inpaintTargetLayer ?? selectedImageLayer;
        if (!targetLayer || !projectId) {
            setEditError("Выберите слой-картинку на канвасе.");
            return;
        }
        if (!inpaintMask || !inpaintMask.hasMask) {
            setEditError("Сначала нарисуйте маску по области редактирования.");
            return;
        }

        // Load the source image to learn its natural pixel dimensions —
        // needed for the UV projection in exportMaskBlob.
        let naturalWidth = targetLayer.width;
        let naturalHeight = targetLayer.height;
        try {
            const img = new window.Image();
            img.crossOrigin = "anonymous";
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = reject;
                img.src = targetLayer.src;
            });
            naturalWidth = img.naturalWidth;
            naturalHeight = img.naturalHeight;
        } catch (e) {
            console.warn("[Inpaint] could not measure source image, falling back to layer dims", e);
        }

        const zoom = useCanvasStore.getState().zoom;
        const modelEntry = getModelById(selectedModel);
        const blob = await inpaintMask.exportMaskBlob(
            {
                naturalWidth,
                naturalHeight,
                layerWidth: targetLayer.width,
                layerHeight: targetLayer.height,
                objectFit: targetLayer.objectFit,
                viewIntent: { focusX: targetLayer.focusX, focusY: targetLayer.focusY },
                zoom,
            },
            modelEntry?.slug,
        );
        if (!blob) {
            setEditError("Маска пуста — нарисуйте кистью область для inpaint.");
            return;
        }

        const batchId = `inpaint-${Date.now()}`;
        const layerId = targetLayer.id;
        const editPrompt = intent === "edit" ? prompt : "";
        const promptLabel = truncatePromptLabel(
            intent === "edit"
                ? (editPrompt || "Inpaint")
                : "Удалить объект",
        );
        appendLoadingVariants(layerId, 1, promptLabel, batchId);

        enqueueJob(
            {
                id: batchId,
                projectId,
                surface: "studio",
                layerId,
                prompt: promptLabel,
                imageCount: 1,
            },
            async () => {
                setEditError(null);
                try {
                    // Upload source + mask to S3 in parallel. fal.ai's
                    // flux-pro/v1/fill rejects data: URIs and demands real
                    // URLs for both fields, so we always go through uploadForAI.
                    const maskFile = new File([blob], "inpaint-mask.png", { type: "image/png" });
                    const maskBase64 = await blobToDataUrl(maskFile);
                    const [imageUrl, maskUrl] = await Promise.all([
                        uploadForAI(targetLayer.src, projectId),
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

                    await applyEditedImageToLayer(targetLayer, data.content);

                    // Persist to library so the inpainted result shows up in the
                    // workspace asset library (same as text-edit/inpaint paths).
                    try {
                        const storeLayer = useCanvasStore
                            .getState()
                            .layers.find((l) => l.id === layerId) as ImageLayer | undefined;
                        let persistedUrl = storeLayer?.src ?? data.content;
                        if (!persistedUrl.startsWith("https://storage.yandexcloud.net")) {
                            persistedUrl = await persistImageToS3(persistedUrl, projectId);
                        }
                        await saveGeneratedAssetMutation.mutateAsync({
                            projectId,
                            url: persistedUrl,
                            prompt: editPrompt || (intent === "remove" ? "remove" : "inpaint"),
                            model: data.model ?? selectedModel,
                            source: intent === "remove" ? "banner-edit-inpaint-remove" : "banner-edit-inpaint",
                        });
                        await Promise.all([
                            trpcUtils.asset.listByProject.invalidate({ projectId }),
                            trpcUtils.asset.listByWorkspace.invalidate().catch(() => undefined),
                        ]);
                    } catch (saveErr) {
                        console.warn("[AIPromptBar] Asset save (inpaint) failed:", saveErr);
                    }

                    onResult({
                        type: "edit",
                        content: data.content,
                        prompt: editPrompt || (intent === "remove" ? "Удалить объект" : "Inpaint"),
                        model: data.model,
                    });

                    const storeLayer = useCanvasStore
                        .getState()
                        .layers.find((l) => l.id === layerId) as ImageLayer | undefined;
                    const resultUrl = storeLayer?.src ?? data.content;
                    resolveBatchVariants(layerId, batchId, [resultUrl], promptLabel, "ready");

                    // Clear the mask so the next inpaint starts fresh and
                    // the action bar collapses Edit/Remove buttons.
                    inpaintMask.clear();
                } catch (e: unknown) {
                    const error = e as Error;
                    console.error(`[Inpaint] apply failed:`, error);
                    setEditError(parseGenerationError(error));
                    resolveBatchVariants(layerId, batchId, [], promptLabel, "error");
                    throw error;
                }
            },
        );
    }, [
        selectedImageLayer, projectId, inpaintMask, selectedModel, prompt,
        imageStyleId, imagePresets, scale, loraRequestFields,
        applyEditedImageToLayer, onResult, saveGeneratedAssetMutation, trpcUtils,
        appendLoadingVariants, enqueueJob, resolveBatchVariants,
    ]);

    const handleInpaint = () => {
        if (!prompt.trim()) return;
        void handleInpaintApply("edit");
    };
    const handleTextEdit = () => {
        if (!prompt.trim()) return;
        callImageEdit("text-edit", prompt);
    };
    const handleExpand = () => {
        const hasPadding = expandPadding.top > 0 || expandPadding.right > 0 || expandPadding.bottom > 0 || expandPadding.left > 0;
        if (!hasPadding) return; // nothing to expand
        callImageEdit("outpaint", prompt || "Fill seamlessly");
    };

    const addImageLayerFromUrl = (src: string): Promise<string> => new Promise((resolve) => {
        const img = new window.Image();
        img.onload = () => {
            let w = img.naturalWidth;
            let h = img.naturalHeight;
            if (w > canvasWidth || h > canvasHeight) {
                const scaleFactor = Math.min(canvasWidth / w, canvasHeight / h);
                w = Math.round(w * scaleFactor);
                h = Math.round(h * scaleFactor);
            }
            resolve(addImageLayer(src, w, h));
        };
        img.onerror = () => resolve(addImageLayer(src, 512, 512));
        img.src = src;
    });

    const handleGeneratedVariantSelect = (variant: GeneratedImageVariant) => {
        const layerId = activeLayerKey ?? generatedTargetLayerId;
        if (!variant.url || !layerId) return;
        updateLayer(layerId, { src: variant.url } as Partial<ImageLayer>);
        setSelectedGeneratedVariantId(variant.id);
        setGeneratedTargetLayerId(layerId);
    };

    // ── Standard text/image generation (non-edit tabs) ──
    const handleGenerate = async () => {
        if (activeTab === "edit") {
            if (editAction === "remove-bg") return handleRemoveBg();
            if (editAction === "inpaint") return handleInpaint();
            if (editAction === "expand") return handleExpand();
            return handleTextEdit();
        }

        if (!prompt) return;

        if (activeTab === "text") {
            setIsGenerating(true);
            try {
                const textInstruction = textStyleId
                    ? getTextPresetInstruction(textStyleId, textPresets)
                    : "";
                const textPromptWithStyle = textInstruction
                    ? `${textInstruction}\n\n${prompt}`
                    : prompt;
                const res = await RemoteTextProvider.generate(textPromptWithStyle, {
                    model: selectedModel,
                    projectId,
                });
                const persistedContent = res.content;
                if (applyToSelection && selectedLayerIds.length > 0) {
                    updateLayer(selectedLayerIds[0], { text: persistedContent });
                } else {
                    addTextLayer({
                        text: persistedContent,
                        fontSize: 40,
                        x: 100,
                        y: 100,
                        width: 600,
                    });
                }
                onResult({
                    type: "text",
                    content: persistedContent,
                    prompt,
                    model: res.model,
                });
            } catch (err: unknown) {
                alert(`Ошибка генерации: ${parseGenerationError(err)}`);
            } finally {
                setIsGenerating(false);
            }
            return;
        }

        if (activeTab !== "image" || !projectId) return;

        const submittedPrompt = prompt;
        const promptLabel = truncatePromptLabel(submittedPrompt);
        const requestedImageCount = Math.min(imageCount, maxImageOutputs);
        const batchId = `img-${Date.now()}`;
        const layerKey = selectedLayerIds[0] ?? `draft-${batchId}`;

        const snapshot = {
            model: selectedModel,
            aspectRatio,
            scale,
            imageStyleId,
            referenceImages: referenceImages.length > 0 ? [...referenceImages] : undefined,
            applyToSelection,
            selectedLayerId: selectedLayerIds[0],
            loraRequestFields: { ...loraRequestFields },
        };

        appendLoadingVariants(layerKey, requestedImageCount, promptLabel, batchId);
        setSelectedGeneratedVariantId(undefined);

        enqueueJob(
            {
                id: batchId,
                projectId,
                surface: "studio",
                layerId: selectedLayerIds[0],
                prompt: submittedPrompt,
                imageCount: requestedImageCount,
            },
            async () => {
                try {
                    const styleSuffix = getImagePresetPromptSuffixForModel(
                        snapshot.imageStyleId,
                        snapshot.model,
                        imagePresets,
                    );
                    const styledPrompt = styleSuffix
                        ? `${submittedPrompt}. Style: ${styleSuffix}`
                        : submittedPrompt;
                    const resolvedPrompt = resolveRefTags(styledPrompt, snapshot.model);

                    const res = await RemoteImageProvider.generate(resolvedPrompt, {
                        model: snapshot.model,
                        aspectRatio: snapshot.aspectRatio,
                        scale: snapshot.scale || undefined,
                        count: requestedImageCount,
                        referenceImages: snapshot.referenceImages,
                        projectId,
                        ...snapshot.loraRequestFields,
                    });

                    const rawContents = Array.from(
                        new Set(
                            (res.contents?.length ? res.contents : [res.content]).filter(Boolean),
                        ),
                    );
                    const persistedList: string[] = [];
                    for (let i = 0; i < rawContents.length; i++) {
                        if (i > 0) {
                            await new Promise((resolve) => setTimeout(resolve, 150));
                        }
                        try {
                            const persisted = await persistGeneratedUrl(rawContents[i], projectId, i);
                            await saveGeneratedAssetMutation.mutateAsync({
                                projectId,
                                url: persisted,
                                prompt: submittedPrompt,
                                model: res.model ?? snapshot.model,
                                source: "banner-generation",
                            });
                            persistedList.push(persisted);
                        } catch (persistErr) {
                            console.error(`[AIPromptBar] batch persist index=${i}`, persistErr);
                        }
                    }
                    if (persistedList.length === 0) {
                        throw new Error(
                            "Не удалось сохранить сгенерированное изображение. Повторите попытку.",
                        );
                    }

                    await Promise.all([
                        trpcUtils.asset.listByProject.invalidate({ projectId }),
                        trpcUtils.asset.listByWorkspace.invalidate().catch(() => undefined),
                    ]);

                    const persistedContent = persistedList[0];
                    let targetLayerId: string | null = snapshot.selectedLayerId ?? null;

                    if (snapshot.applyToSelection && snapshot.selectedLayerId) {
                        updateLayer(snapshot.selectedLayerId, { src: persistedContent } as Partial<ImageLayer>);
                    } else {
                        targetLayerId = await addImageLayerFromUrl(persistedContent);
                    }

                    const finalLayerKey = targetLayerId ?? layerKey;
                    if (finalLayerKey !== layerKey) {
                        setVariantsByLayer((prev) => {
                            const draft = prev[layerKey] ?? [];
                            const { [layerKey]: _, ...rest } = prev;
                            return { ...rest, [finalLayerKey]: draft };
                        });
                    }

                    resolveBatchVariants(finalLayerKey, batchId, persistedList, promptLabel, "ready");
                    setSelectedGeneratedVariantId(`${batchId}-0-${persistedList[0]}`);
                    setGeneratedTargetLayerId(finalLayerKey);

                    onResult({
                        type: "image",
                        content: persistedContent,
                        contents: persistedList,
                        prompt: submittedPrompt,
                        model: res.model,
                    });
                } catch (err: unknown) {
                    resolveBatchVariants(layerKey, batchId, [], promptLabel, "error");
                    alert(`Ошибка генерации: ${parseGenerationError(err)}`);
                    throw err;
                }
            },
        );
    };

    if (!open) return null;

    // While inpaint is active, restrict the model picker to models with the
    // "inpaint" capability so users don't accidentally route the request
    // through an edit-only model that would silently drop the mask.
    const inpaintModels = inpaintMode
        ? PREFERRED_INPAINT_MODELS
            .map((id) => {
                const entry = getModelById(id);
                return entry ? { id, name: entry.label } : null;
            })
            .filter((m): m is { id: string; name: string } => !!m)
        : [];
    const baseModels = activeTab === "text"
        ? TEXT_MODELS
        : activeTab === "image"
            ? IMAGE_MODELS
            : EDIT_MODELS;
    const currentModels = inpaintMode && inpaintModels.length > 0
        ? inpaintModels
        : baseModels;

    const hasSelection = selectedLayerIds.length > 0;

    // In edit tab, determine placeholder and whether prompt is required for the generate button
    const editPromptPlaceholder = editAction === "inpaint"
        ? "Что нарисовать в этой области? Например: голубое небо, текстура дерева..."
        : editAction === "expand"
            ? "Описание расширенной области (опционально)..."
            : "Опишите изменения: добавь тень, сделай фон синим, измени освещение...";

    const promptPlaceholder = activeTab === "text"
        ? "Например: Заголовок для распродажи кроссовок..."
        : activeTab === "image"
            ? "Например: Футуристичный город в неоновых тонах..."
            : editPromptPlaceholder;

    // In edit mode, the generate button should be enabled for remove-bg (no prompt needed)
    // and expand (prompt is optional). For inpaint and default text-edit, prompt is required.
    const isEditGenerateDisabled =
        activeTab === "edit"
            ? editAction !== "remove-bg" && editAction !== "expand" && !prompt.trim()
            : activeTab === "text"
                ? isGenerating || !prompt
                : !prompt;

    return (
        <div className="flex flex-col items-center gap-2">
            {showVariantStrip && (
                <div className="flex items-center justify-center gap-2 self-center">
                    <GeneratedImageStrip
                        variants={activeVariants}
                        selectedId={selectedGeneratedVariantId}
                        onSelect={handleGeneratedVariantSelect}
                    />
                    {canRetryActiveOutpaint && (
                        <button
                            type="button"
                            onClick={handleOutpaintRetry}
                            disabled={hasActiveVariantLoading}
                            title="Повторить аутпеинт с теми же параметрами"
                            aria-label="Повторить аутпеинт с теми же параметрами"
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-border-primary/70 bg-bg-primary/85 text-text-secondary shadow-lg backdrop-blur-md transition-all hover:border-border-secondary hover:text-text-primary disabled:cursor-wait disabled:opacity-50"
                        >
                            <RefreshCw size={16} className={hasActiveVariantLoading ? "animate-spin" : ""} />
                        </button>
                    )}
                </div>
            )}

            {/* ── MAIN BAR ── */}
            <div className="relative flex w-[820px] max-w-[95vw] flex-col rounded-[20px] border border-border-primary bg-bg-surface/95 shadow-[var(--shadow-lg)] backdrop-blur-xl animate-in slide-in-from-bottom-6 duration-300">
                {supportsVision && referenceImages.length > 0 && (
                    <div className="absolute right-4 top-11 z-10">
                        <ReferenceImagePreviewTray
                            images={referenceImages}
                            onChange={setReferenceImages}
                            onTagClick={(tag) => promptRef.current?.insertAtCursor(tag)}
                        />
                    </div>
                )}
                {/* ── TOP BAR: Horizontal tabs + AI-chat + Close ── */}
                <div className="flex items-center gap-1 px-2 pt-2 pb-0">
                    {/* Mode Tabs */}
                    <div className="flex items-center gap-0.5 bg-bg-tertiary/60 rounded-[12px] p-0.5">
                        <button
                            onClick={() => handleTabChange("text")}
                            title="Генерация текста"
                            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-[10px] text-[12px] font-medium transition-all cursor-pointer whitespace-nowrap ${
                                activeTab === "text"
                                    ? "bg-bg-surface text-text-primary shadow-sm"
                                    : "text-text-tertiary hover:text-text-secondary"
                            }`}
                        >
                            <Type size={13} strokeWidth={activeTab === "text" ? 2.5 : 2} />
                            AI-текст
                        </button>
                        <button
                            onClick={() => handleTabChange("image")}
                            title="Генерация изображения"
                            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-[10px] text-[12px] font-medium transition-all cursor-pointer whitespace-nowrap ${
                                activeTab === "image"
                                    ? "bg-bg-surface text-text-primary shadow-sm"
                                    : "text-text-tertiary hover:text-text-secondary"
                            }`}
                        >
                            <ImageIcon size={13} strokeWidth={activeTab === "image" ? 2.5 : 2} />
                            AI-фото
                        </button>
                        <button
                            onClick={() => {
                                if (selectedImageLayer) {
                                    handleTabChange("edit");
                                } else {
                                    alert("Выделите изображение на канвасе для AI-редактирования");
                                }
                            }}
                            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-[10px] text-[12px] font-medium transition-all cursor-pointer whitespace-nowrap ${
                                activeTab === "edit"
                                    ? "bg-bg-surface text-text-primary shadow-sm"
                                    : selectedImageLayer
                                        ? "text-text-tertiary hover:text-text-secondary"
                                        : "text-text-tertiary/30 cursor-not-allowed"
                            }`}
                            disabled={!selectedImageLayer && activeTab !== "edit"}
                            title={selectedImageLayer ? "AI-редактирование выбранного изображения" : "Выберите изображение на канвасе"}
                        >
                            <Wand2 size={13} strokeWidth={activeTab === "edit" ? 2.5 : 2} />
                            AI-правка
                        </button>
                    </div>

                    {hasSelection && activeTab !== "edit" && (
                        <button
                            type="button"
                            className={`
                                ml-1 inline-flex h-8 items-center gap-1.5 rounded-[10px] border px-2.5
                                text-[11px] font-medium transition-all cursor-pointer
                                ${applyToSelection
                                    ? "border-emerald-300/60 bg-emerald-500/15 text-emerald-600"
                                    : "border-border-primary/60 bg-bg-surface/80 text-text-secondary hover:border-border-secondary hover:bg-bg-tertiary/30"
                                }
                            `}
                            onClick={() => setApplyToSelection(!applyToSelection)}
                        >
                            {applyToSelection ? <CheckCircle2 size={13} /> : <Circle size={13} />}
                            <span>Применить к выделению</span>
                        </button>
                    )}

                    <div className="flex-1" />

                    {/* AI Chat Toggle — outlined button style */}
                    <button
                        onClick={onToggleChat}
                        className={`
                            flex items-center gap-1.5 px-3 py-1.5 rounded-[10px]
                            text-[12px] font-medium transition-all cursor-pointer
                            border
                            ${isChatOpen
                                ? "bg-accent-primary/10 text-accent-primary border-accent-primary/30"
                                : "text-text-tertiary border-border-primary/60 hover:text-text-secondary hover:border-border-secondary hover:bg-bg-tertiary/30"
                            }
                        `}
                        title="История"
                    >
                        <MessageCircle size={14} />
                        AI-чат
                    </button>

                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        className="p-1.5 text-text-tertiary hover:text-text-primary rounded-full hover:bg-bg-secondary transition-colors"
                    >
                        <X size={15} />
                    </button>
                </div>

                {/* ── PROMPT AREA ── */}
                <div
                    className="flex-1 px-4 py-2.5 min-h-[80px]"
                    style={
                        supportsVision && referenceImages.length > 0
                            ? { paddingRight: getReferenceTrayReserveWidth(referenceImages.length) }
                            : undefined
                    }
                >
                    <RefAutocompleteTextarea
                        ref={promptRef}
                        value={prompt}
                        onChange={setPrompt}
                        referenceImages={referenceImages}
                        dropdownPlacement="auto"
                        placeholder={promptPlaceholder}
                        className="w-full h-full min-h-[70px] bg-transparent text-[15px] text-text-primary placeholder:text-text-tertiary/50 focus:outline-none resize-none leading-relaxed"
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleGenerate();
                            }
                        }}
                    />
                </div>

                {/* ── Inpaint Mask Action Bar — brush controls + Edit/Remove ── */}
                {inpaintMode && inpaintMask && (
                    <div className="px-4 pb-2">
                        <InpaintActionBar
                            mask={inpaintMask}
                            disabled={false}
                            editDisabled={!prompt.trim()}
                            editDisabledHint="Введите промпт сверху, чтобы Правка стала активной"
                            onAction={(action) => void handleInpaintApply(action)}
                            onCancel={() => {
                                setEditAction(null);
                                exitCanvasEditMode();
                            }}
                        />
                    </div>
                )}

                {/* ── LoRA Trigger Hint — mirrors server-side auto-injection ── */}
                {(activeTab === "image" || activeTab === "edit") && (
                    <div className="px-4 pb-1">
                        <LoraTriggerHint
                            family={loraSpec?.family ?? null}
                            loras={loras}
                        />
                    </div>
                )}

                {/* ── Outpaint progress: only rendered while a flux/bria
                    pipeline run is in flight. The indicator collapses to
                    null when outpaintProgress === null so it doesn't
                    take up layout space outside of expand-mode runs. */}
                {outpaintProgress && (
                    <div className="px-4 pb-2">
                        <OutpaintProgressIndicator
                            label={outpaintProgress.label}
                            percent={outpaintProgress.percent}
                        />
                    </div>
                )}

                {/* ── BOTTOM BAR: Outlined selectors + Reference + Generate ── */}
                <div className="flex min-w-0 items-center gap-2 px-4 pb-3 pt-1">
                    {/* LEFT: Outlined selector pills with proper spacing */}
                    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {activeTab === "edit" && (
                            <>
                                <EditActionIconButton
                                    icon={<Eraser size={14} />}
                                    label="Удалить фон"
                                    active={editAction === "remove-bg"}
                                    loading={false}
                                    disabled={!selectedImageLayer}
                                    onClick={() => {
                                        if (editAction === "remove-bg") {
                                            setEditAction(null);
                                        } else {
                                            exitCanvasEditMode();
                                            setEditAction("remove-bg");
                                            handleRemoveBg();
                                        }
                                    }}
                                />
                                <EditActionIconButton
                                    icon={<Paintbrush size={14} />}
                                    label="Inpaint — кисть + промпт"
                                    active={editAction === "inpaint"}
                                    disabled={!selectedImageLayer}
                                    onClick={() => {
                                        if (editAction === "inpaint") {
                                            setEditAction(null);
                                            resetInpaintMode();
                                            inpaintMask?.clear();
                                        } else {
                                            if (!selectedImageLayer) return;
                                            resetExpandMode();
                                            setEditAction("inpaint");
                                            setInpaintMode(true);
                                            const entry = getModelById(selectedModel);
                                            if (!entry?.caps.includes("inpaint")) {
                                                setSelectedModel(DEFAULT_INPAINT_MODEL);
                                            }
                                        }
                                    }}
                                />
                                <EditActionIconButton
                                    icon={<Expand size={14} />}
                                    label="Расширить фон"
                                    active={editAction === "expand"}
                                    disabled={!selectedImageLayer}
                                    onClick={() => {
                                        if (editAction === "expand") {
                                            setEditAction(null);
                                            resetExpandMode();
                                        } else {
                                            if (!selectedImageLayer) return;
                                            resetInpaintMode();
                                            inpaintMask?.clear();
                                            setEditAction("expand");
                                            setExpandMode(true);
                                        }
                                    }}
                                />
                                {editAction === "expand" && (
                                    <span className="max-w-[140px] truncate text-[10px] font-medium text-accent-primary">
                                        Потяните за ручки на canvas
                                    </span>
                                )}
                                {editError && (
                                    <span className="max-w-[200px] truncate text-[10px] font-medium text-red-500" title={editError}>
                                        {editError}
                                    </span>
                                )}
                                {modelResolutions.length > 0 && (
                                    <SelectPill
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
                            </>
                        )}

                        {/* Model Select */}
                        <SelectPill
                            icon={<Settings2 size={13} />}
                            label="Модель"
                            value={selectedModel}
                            onChange={handleModelChange}
                            options={currentModels.map((model) => ({ value: model.id, label: model.name }))}
                            className="min-w-[150px] max-w-[190px]"
                        />

                        {/* Advanced model settings — only visible for LoRA-aware models. */}
                        {loraSpec && (activeTab === "image" || activeTab === "edit") && (
                            <button
                                onClick={() => setSettingsOpen(true)}
                                title="Параметры модели"
                                className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-border-primary/60 text-text-tertiary transition-all cursor-pointer hover:text-text-primary hover:bg-bg-tertiary/30"
                            >
                                <Sliders size={12} />
                            </button>
                        )}

                        {/* Aspect Ratio (Image tab only) */}
                        {activeTab === "image" && (
                            <SelectPill
                                icon={<Ratio size={13} />}
                                label="Соотношение сторон"
                                value={aspectRatio}
                                onChange={setAspectRatio}
                                options={modelAspectRatios.map((ratio) => ({ value: ratio, label: ratio }))}
                                className="w-[86px]"
                            />
                        )}

                        {/* Resolution (Image tab only, if model supports) */}
                        {activeTab === "image" && modelResolutions.length > 0 && (
                            <SelectPill
                                label="Разрешение"
                                value={scale}
                                onChange={setScale}
                                options={modelResolutions.map((resolution) => ({ value: resolution.id, label: resolution.label }))}
                                className="w-[74px]"
                            />
                        )}

                        {activeTab === "image" && maxImageOutputs > 1 && (
                            <SelectPill
                                icon={<Sparkles size={13} />}
                                label="Количество изображений"
                                value={imageCount}
                                onChange={(value) => setImageCount(Number(value))}
                                options={Array.from({ length: maxImageOutputs }, (_, i) => {
                                    const count = i + 1;
                                    return { value: String(count), label: String(count) };
                                })}
                                className="w-[64px]"
                            />
                        )}

                        {/* Style preset — hidden for LoRA models (style is in weights, not prompt suffix). */}
                        {(activeTab === "image" || activeTab === "edit") && !loraSpec && (
                            <ImageStylePresetPicker
                                presets={imagePresets}
                                selectedId={imageStyleId}
                                onChange={setImageStyleId}
                                variant="compact"
                            />
                        )}

                        {/* LoRA picker — disabled when current model has no loraSpec.
                            Sits next to Style on purpose: the two are complementary
                            (preset = prompt suffix, LoRA = model weights). */}
                        {loraSpec && (activeTab === "image" || activeTab === "edit") && (
                            <LoraSelectorPicker
                                family={loraSpec?.family ?? null}
                                maxCount={loraSpec?.maxCount ?? 1}
                                value={loras}
                                onChange={setLoras}
                            />
                        )}

                        {/* Style Preset (Text mode) */}
                        {activeTab === "text" && (
                            <TextStylePresetPicker
                                presets={textPresets}
                                selectedId={textStyleId}
                                onChange={setTextStyleId}
                                variant="compact"
                            />
                        )}
                    </div>

                    {/* RIGHT: Reference + Generate */}
                    <div className="flex flex-shrink-0 items-center gap-2">
                        {/* Reference Images (vision-capable models, image or edit tab) */}
                        {supportsVision && (
                            <ReferenceImageInput
                                images={referenceImages}
                                onChange={setReferenceImages}
                                max={getMaxRefs(selectedModel)}
                                previewMode="none"
                                onTagClick={(tag) => promptRef.current?.insertAtCursor(tag)}
                                onFilesAdded={(files) => {
                                    if (!projectId) return;
                                    // Fire and forget — mirror refs into the
                                    // project's library so they persist.
                                    for (const file of files) {
                                        void registerFile({
                                            projectId,
                                            file,
                                            source: "ai-reference",
                                        });
                                    }
                                }}
                            />
                        )}

                        {queueBadge && (
                            <span className="shrink-0 rounded-full border border-border-primary bg-bg-tertiary/60 px-2 py-0.5 text-[10px] font-medium text-text-secondary">
                                {queueBadge}
                            </span>
                        )}

                        <button
                            onClick={handleGenerate}
                            disabled={isEditGenerateDisabled}
                            title={activeTab === "edit" ? "Применить редактирование" : "Сгенерировать"}
                            className={`
                                flex items-center justify-center w-10 h-10 rounded-full
                                transition-all duration-200 cursor-pointer
                                bg-accent-lime-hover hover:bg-accent-lime text-accent-lime-text
                                hover:scale-105 active:scale-95
                                disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100
                                shadow-sm hover:shadow-md
                            `}
                        >
                            {activeTab === "edit" ? <Wand2 size={18} /> : <Sparkles size={18} />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Advanced model settings modal — only mounted for LoRA-aware models. */}
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
    );
}
