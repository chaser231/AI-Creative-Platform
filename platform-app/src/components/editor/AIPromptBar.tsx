import { useState, useRef, useEffect, useCallback } from "react";
import { Sparkles, Wand2, Image as ImageIcon, Send, MessageCircle, Settings2, Ratio, Type, Grip, CheckCircle2, Circle, X, ChevronDown, Eraser, Paintbrush, Expand, Loader2, Sliders } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ReferenceImageInput, ReferenceImagePreviewTray, getReferenceTrayReserveWidth } from "@/components/ui/ReferenceImageInput";
import { RefAutocompleteTextarea, type RefAutocompleteTextareaHandle } from "@/components/ui/RefAutocompleteTextarea";
import { ImageStylePresetPicker, TextStylePresetPicker } from "@/components/ui/StylePresetPicker";
import { LoraSelectorPicker } from "@/components/ui/LoraSelectorPicker";
import { LoraTriggerHint } from "@/components/ui/LoraTriggerHint";
import { ModelSettingsModal, type AdvancedAIParams } from "@/components/ui/ModelSettingsModal";
import { GeneratedImageStrip, type GeneratedImageVariant } from "@/components/ui/GeneratedImageStrip";
import { SelectPill } from "@/components/ui/SelectPill";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import { RemoteTextProvider, RemoteImageProvider } from "@/services/aiService";
import { getModelById, getMaxRefs, getMaxOutputs, getAspectRatios, getResolutions, getDefaultResolution, resolveRefTags, getLoraSpec } from "@/lib/ai-models";
import type { LoraWeight } from "@/lib/ai-providers";
import { getImagePresetPromptSuffixForModel, getTextPresetInstruction } from "@/lib/stylePresets";
import { useStylePresets } from "@/hooks/useStylePresets";
import { persistImageToS3, uploadForAI, uploadManyForAI } from "@/utils/imageUpload";
import { outpaintImage } from "@/utils/outpaintPipeline";
import { getOutpaintModel } from "@/utils/outpaintModel";
import { mapOutpaintStage, type OutpaintProgressState } from "@/utils/outpaintProgress";
import { OutpaintProgressIndicator } from "@/components/ui/OutpaintProgressIndicator";
import { useProjectLibrary } from "@/hooks/useProjectLibrary";
import { trpc } from "@/lib/trpc";
import type { ImageLayer } from "@/types";

// Helper models lists
const TEXT_MODELS = [
    { id: "deepseek", name: "DeepSeek V3" },
    { id: "gemini-flash", name: "Gemini 2.5 Flash" },
];

const IMAGE_MODELS = [
    { id: "nano-banana-2", name: "Nano Banana 2" },
    { id: "nano-banana-pro", name: "Nano Banana Pro" },
    { id: "nano-banana", name: "Nano Banana" },
    { id: "flux-2-pro", name: "Flux 2 Pro" },
    { id: "seedream-5", name: "Seedream 5" },
    { id: "seedream", name: "Seedream 4.5" },
    { id: "gpt-image-2", name: "GPT Image 2" },
    { id: "gpt-image", name: "GPT Image 1.5" },
    { id: "qwen-image", name: "Qwen Image" },
    { id: "flux-schnell", name: "Flux Schnell" },
    { id: "flux-dev", name: "Flux Dev" },
    { id: "flux-1.1-pro", name: "Flux 1.1 Pro" },
    { id: "dall-e-3", name: "DALL-E 3" },
    // LoRA-aware variants — lower in the list so non-LoRA workflows stay
    // unchanged for users who never open the LoRA picker.
    { id: "flux-lora", name: "FLUX.1 LoRA" },
    { id: "flux-2-lora", name: "FLUX.2 LoRA" },
    { id: "qwen-image-lora", name: "Qwen Image LoRA" },
];

// Models available for AI image editing (with "edit" cap or specialized tools)
const EDIT_MODELS = [
    { id: "nano-banana-2", name: "Nano Banana 2" },
    { id: "nano-banana-pro", name: "Nano Banana Pro" },
    { id: "nano-banana", name: "Nano Banana" },
    { id: "flux-2-pro", name: "Flux 2 Pro" },
    { id: "seedream-5", name: "Seedream 5" },
    { id: "seedream", name: "Seedream 4.5" },
    { id: "gpt-image-2", name: "GPT Image 2" },
    { id: "gpt-image", name: "GPT Image 1.5" },
    { id: "qwen-image-edit", name: "Qwen Image Edit" },
    { id: "qwen-image-edit-lora", name: "Qwen Image Edit LoRA" },
];

// Outpaint target aspect ratios (used within the edit tab's "Expand" action)
const OUTPAINT_RATIOS = [
    { id: "16:9", label: "16:9" },
    { id: "9:16", label: "9:16" },
    { id: "4:3", label: "4:3" },
    { id: "3:4", label: "3:4" },
    { id: "1:1", label: "1:1" },
    { id: "21:9", label: "21:9" },
];

// Aspect ratios and resolutions are now dynamic per model — see ai-models.ts

interface AIPromptBarProps {
    open: boolean;
    onClose: () => void;
    onToggleChat: () => void;
    isChatOpen: boolean;
    onResult: (result: { type: string; content: string; contents?: string[]; prompt: string; model?: string }) => void;
    /** Project ID for S3 image persistence */
    projectId?: string;
}

const S3_PERSIST_HOST = "storage.yandexcloud.net";

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
    const [activeTab, setActiveTab] = useState<"text" | "image" | "edit">("text");
    const [prompt, setPrompt] = useState("");
    const [selectedModel, setSelectedModel] = useState(TEXT_MODELS[0].id);
    const [aspectRatio, setAspectRatio] = useState("1:1");
    const [scale, setScale] = useState("");
    const [imageCount, setImageCount] = useState(1);
    const [applyToSelection, setApplyToSelection] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedVariants, setGeneratedVariants] = useState<GeneratedImageVariant[]>([]);
    const [selectedGeneratedVariantId, setSelectedGeneratedVariantId] = useState<string | undefined>(undefined);
    const [generatedTargetLayerId, setGeneratedTargetLayerId] = useState<string | null>(null);
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
        // Always reset expand mode when switching tabs
        if (tab !== "edit") resetExpandMode();
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

    const clearGeneratedVariants = useCallback(() => {
        setGeneratedVariants([]);
        setSelectedGeneratedVariantId(undefined);
        setGeneratedTargetLayerId(null);
    }, []);

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
        if (generatedVariants.length === 0) return;
        if (activeTab !== "image" || !open) {
            clearGeneratedVariants();
            return;
        }
        if (generatedTargetLayerId && !selectedLayerIds.includes(generatedTargetLayerId)) {
            clearGeneratedVariants();
        }
    }, [activeTab, clearGeneratedVariants, generatedTargetLayerId, generatedVariants.length, open, selectedLayerIds]);

    // LoRA capabilities — drive picker visibility / disabled state and the
    // gear chip that opens advanced model settings.
    const loraSpec = getLoraSpec(selectedModel);
    const supportsLoraInTab =
        !!loraSpec &&
        (activeTab === "image" ||
            (activeTab === "edit" && (selectedModel === "qwen-image-edit-lora" || selectedModel === "flux-lora")));

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
        editedSrc: string,
        opts?: { action?: string; padding?: { top: number; right: number; bottom: number; left: number } },
    ) => {
        if (!selectedImageLayer) return;

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
            const newWidth = selectedImageLayer.width + pad.left + pad.right;
            const newHeight = selectedImageLayer.height + pad.top + pad.bottom;
            const newX = selectedImageLayer.x - pad.left;
            const newY = selectedImageLayer.y - pad.top;

            updateLayer(selectedImageLayer.id, {
                src: persistedSrc,
                width: newWidth,
                height: newHeight,
                x: newX,
                y: newY,
            } as any);
            return;
        }

        // ── Generic edit: only replace src, preserve layer geometry ──
        // The edited image fills the same canvas space via objectFit;
        // changing width/height/x/y would break positioning and cascade.
        updateLayer(selectedImageLayer.id, { src: persistedSrc } as any);
    }, [selectedImageLayer, projectId, updateLayer]);

    // ── Image edit API call (shared by all edit actions) ──
    const callImageEdit = useCallback(async (action: string, editPrompt?: string) => {
        if (!selectedImageLayer) return;
        setIsGenerating(true);
        setEditError(null);

        try {
            const styleSuffix = getImagePresetPromptSuffixForModel(imageStyleId, selectedModel, imagePresets);
            const rawPrompt = editPrompt || "";
            const styledPrompt = styleSuffix && rawPrompt ? `${rawPrompt}. Style: ${styleSuffix}` : rawPrompt;
            const resolvedPrompt = resolveRefTags(styledPrompt, selectedModel);

            // ── Outpaint: delegated to the shared pipeline so the wizard
            // and the studio stay byte-compatible with each other ──
            if (action === "outpaint") {
                const currentExpandPadding = { ...expandPadding };
                // Reset progress state at the start of each outpaint so
                // a previous run's "Готово" doesn't briefly flash before
                // the first stage label lands.
                setOutpaintProgress({ label: "Подготавливаем изображение", percent: 5 });
                const outpaintResult = await outpaintImage({
                    imageSrc: selectedImageLayer.src,
                    canvasPadding: currentExpandPadding,
                    layerSize: { width: selectedImageLayer.width, height: selectedImageLayer.height },
                    prompt: resolvedPrompt,
                    projectId,
                    model: getOutpaintModel(),
                    onProgress: (stage, info) => {
                        console.log(`[Outpaint/${stage}]`, info ?? "");
                        // Internal/diagnostic stages return null —
                        // keep the previous user-facing label visible
                        // so the bar doesn't flicker.
                        const next = mapOutpaintStage(stage);
                        if (next) setOutpaintProgress(next);
                    },
                });

                await applyEditedImageToLayer(outpaintResult.src, {
                    action: "outpaint",
                    padding: currentExpandPadding,
                });
                resetExpandMode();

                if (projectId) {
                    try {
                        const storeLayer = useCanvasStore
                            .getState()
                            .layers.find((l) => l.id === selectedImageLayer.id) as ImageLayer | undefined;
                        let persistedUrl = storeLayer?.src ?? outpaintResult.src;
                        if (!persistedUrl.startsWith("https://storage.yandexcloud.net")) {
                            persistedUrl = await persistImageToS3(persistedUrl, projectId);
                        }
                        await saveGeneratedAssetMutation.mutateAsync({
                            projectId,
                            url: persistedUrl,
                            prompt: rawPrompt || action,
                            model: outpaintResult.model,
                            source: "banner-edit-expand",
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
                    content: outpaintResult.src,
                    prompt: rawPrompt || action,
                    model: outpaintResult.model,
                });
                return;
            }

            let finalImageBase64 = selectedImageLayer.src;
            let editDownscaleRatio = 1;

            try {
                const img = new window.Image();
                img.crossOrigin = "anonymous"; // Prevents tainted canvas error
                await new Promise<void>((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = reject;
                    img.src = selectedImageLayer.src;
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

                await applyEditedImageToLayer(finalContent);

                // ── Persist as workspace asset so the result shows up in the library ──
                // applyEditedImageToLayer already uploaded the content to S3 and called
                // updateLayer with the permanent URL. We pull it from the fresh store
                // state to avoid a race with the in-flight S3 upload.
                if (projectId) {
                    try {
                        const storeLayer = useCanvasStore
                            .getState()
                            .layers.find((l) => l.id === selectedImageLayer.id) as ImageLayer | undefined;
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
                // Prompt and references are intentionally preserved after a
                // successful edit so the user can iterate on the same input
                // (tweak wording, swap a reference, rerun) without retyping.
            }
        } catch (e: unknown) {
            const error = e as Error;
            console.error(`Image edit (${action}) failed:`, error);
            setEditError(parseAiError(error));
        } finally {
            setIsGenerating(false);
            // Outpaint progress is per-action; clear it regardless of
            // whether this run was an outpaint (cheap, prevents stale
            // labels leaking into a subsequent edit-tab interaction).
            setOutpaintProgress(null);
        }
    }, [selectedImageLayer, selectedModel, scale, imageStyleId, imagePresets, referenceImages, expandPadding, projectId, applyEditedImageToLayer, onResult, resetExpandMode, saveGeneratedAssetMutation, trpcUtils, loraRequestFields]);

    // ── Edit tab handlers ──
    const handleRemoveBg = () => callImageEdit("remove-bg");
    const handleInpaint = () => {
        if (!prompt.trim()) return;
        callImageEdit("inpaint", prompt);
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
        if (!variant.url || !generatedTargetLayerId) return;
        updateLayer(generatedTargetLayerId, { src: variant.url } as any);
        setSelectedGeneratedVariantId(variant.id);
    };

    // ── Standard text/image generation (non-edit tabs) ──
    const handleGenerate = async () => {
        // In edit mode, route to the appropriate edit handler
        if (activeTab === "edit") {
            if (editAction === "remove-bg") return handleRemoveBg();
            if (editAction === "inpaint") return handleInpaint();
            if (editAction === "expand") return handleExpand();
            // Default: text-edit with prompt
            return handleTextEdit();
        }

        if (!prompt) return;
        const requestedImageCount = activeTab === "image" ? Math.min(imageCount, maxImageOutputs) : 1;
        setIsGenerating(true);
        if (activeTab === "image") {
            setGeneratedVariants(Array.from({ length: requestedImageCount }, (_, index) => ({
                id: `loading-${Date.now()}-${index}`,
                status: "loading" as const,
            })));
            setSelectedGeneratedVariantId(undefined);
            setGeneratedTargetLayerId(null);
        }

        try {
            let res;
            if (activeTab === "text") {
                // Inject text style instruction if selected
                const textInstruction = textStyleId ? getTextPresetInstruction(textStyleId, textPresets) : "";
                const textPromptWithStyle = textInstruction
                    ? `${textInstruction}\n\n${prompt}`
                    : prompt;
                res = await RemoteTextProvider.generate(textPromptWithStyle, { model: selectedModel, projectId });
            } else {
                // Inject image style suffix if selected
                const styleSuffix = getImagePresetPromptSuffixForModel(imageStyleId, selectedModel, imagePresets);
                const styledPrompt = styleSuffix ? `${prompt}. Style: ${styleSuffix}` : prompt;
                const resolvedPrompt = resolveRefTags(styledPrompt, selectedModel);
                res = await RemoteImageProvider.generate(resolvedPrompt, {
                    model: selectedModel,
                    aspectRatio,
                    scale: scale || undefined,
                    count: requestedImageCount,
                    referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
                    projectId,
                    ...loraRequestFields,
                });
            }

            const rawContents = activeTab !== "text"
                ? Array.from(new Set((res.contents?.length ? res.contents : [res.content]).filter(Boolean)))
                : [res.content];
            let persistedContents = rawContents;
            if (activeTab !== "text" && projectId) {
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
                            prompt,
                            model: res.model ?? selectedModel,
                            source: "banner-generation",
                        });
                        persistedList.push(persisted);
                    } catch (persistErr) {
                        console.error(`[AIPromptBar] batch persist index=${i}`, persistErr);
                    }
                }
                if (persistedList.length === 0) {
                    throw new Error("Не удалось сохранить сгенерированное изображение. Повторите попытку.");
                }
                persistedContents = persistedList;

                await Promise.all([
                    trpcUtils.asset.listByProject.invalidate({ projectId }),
                    trpcUtils.asset.listByWorkspace.invalidate().catch(() => undefined),
                ]);
            }
            const persistedContent = persistedContents[0] ?? res.content;

            // AUTO-ADD to Canvas Logic
            let targetLayerId: string | null = null;
            if (applyToSelection && selectedLayerIds.length > 0) {
                // Update existing layer if checkbox is checked
                const layerId = selectedLayerIds[0]; // Naive: take first
                if (activeTab === "text") {
                    updateLayer(layerId, { text: persistedContent });
                } else {
                    // For image, we can only update source if it's an image layer or update fill of rect
                    // This logic depends on layer type, simplified here:
                    updateLayer(layerId, { src: persistedContent } as any);
                    targetLayerId = selectedImageLayer?.id === layerId ? layerId : null;
                }
            } else {
                // Creates NEW layer
                if (activeTab === "text") {
                    addTextLayer({
                        text: persistedContent,
                        fontSize: 40,
                        x: 100,
                        y: 100,
                        width: 600,
                    });
                } else {
                    targetLayerId = await addImageLayerFromUrl(persistedContent);
                }
            }

            if (activeTab === "image" && targetLayerId) {
                const variants = persistedContents.map((url, index) => ({
                    id: `${targetLayerId}-${index}-${url}`,
                    url,
                    status: "ready" as const,
                }));
                setGeneratedVariants(variants);
                setSelectedGeneratedVariantId(variants[0]?.id);
                setGeneratedTargetLayerId(targetLayerId);
            } else {
                clearGeneratedVariants();
            }

            // Pass result up to chat history
            onResult({
                type: activeTab,
                content: persistedContent,
                contents: activeTab === "image" ? persistedContents : undefined,
                prompt: prompt,
                model: res.model,
            });
            // Keep the prompt and reference images in the bar after a
            // successful generation so users can iterate on the same request
            // without retyping (tweak wording, swap a ref, regenerate).
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            console.error("AI Generation Error:", message);
            
            let displayMsg = message;
            if (message.includes("fetch failed") || message.includes("E003") || message.includes("polling failed")) {
                displayMsg = "Сетевая ошибка при обращении к сервису генерации. Проверьте интернет-соединение и попробуйте снова.";
            } else if (message.includes("timed out")) {
                displayMsg = "Генерация заняла слишком много времени. Попробуйте снова или выберите более быструю модель.";
            } else if (message.includes("Replicate error (429)")) {
                displayMsg = "Слишком много запросов. Попробуйте через 10 секунд.";
            }
            if (activeTab === "image") {
                setGeneratedVariants((variants) =>
                    variants.length > 0
                        ? variants.map((variant) => ({ ...variant, status: "error" as const }))
                        : [{ id: `error-${Date.now()}`, status: "error" as const }],
                );
                setSelectedGeneratedVariantId(undefined);
                setGeneratedTargetLayerId(null);
            }
            alert("Ошибка генерации: " + displayMsg);
        } finally {
            setIsGenerating(false);
        }
    };

    if (!open) return null;

    const currentModels = activeTab === "text" ? TEXT_MODELS :
        activeTab === "image" ? IMAGE_MODELS : EDIT_MODELS;

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
    const isEditGenerateDisabled = activeTab === "edit"
        ? isGenerating || (editAction !== "remove-bg" && editAction !== "expand" && !prompt.trim())
        : isGenerating || !prompt;

    return (
        <div className="flex flex-col items-center gap-2">
            {activeTab === "image" && generatedVariants.length > 1 && (
                <GeneratedImageStrip
                    variants={generatedVariants}
                    selectedId={selectedGeneratedVariantId}
                    onSelect={handleGeneratedVariantSelect}
                    className="self-center"
                />
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
                                    loading={isGenerating && editAction === "remove-bg"}
                                    disabled={isGenerating}
                                    onClick={() => {
                                        if (editAction === "remove-bg") {
                                            setEditAction(null);
                                        } else {
                                            setEditAction("remove-bg");
                                            handleRemoveBg();
                                        }
                                    }}
                                />
                                <EditActionIconButton
                                    icon={<Paintbrush size={14} />}
                                    label="Inpaint"
                                    active={editAction === "inpaint"}
                                    disabled={isGenerating}
                                    onClick={() => setEditAction(editAction === "inpaint" ? null : "inpaint")}
                                />
                                <EditActionIconButton
                                    icon={<Expand size={14} />}
                                    label="Расширить фон"
                                    active={editAction === "expand"}
                                    disabled={isGenerating}
                                    onClick={() => {
                                        if (editAction === "expand") {
                                            setEditAction(null);
                                            resetExpandMode();
                                        } else {
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

                        {/* Generate Button — compact icon-only circle */}
                        <button
                            onClick={handleGenerate}
                            disabled={isEditGenerateDisabled}
                            title={isGenerating ? "Генерирую..." : activeTab === "edit" ? "Применить редактирование" : "Сгенерировать"}
                            className={`
                                flex items-center justify-center w-10 h-10 rounded-full
                                transition-all duration-200 cursor-pointer
                                bg-accent-lime-hover hover:bg-accent-lime text-accent-lime-text
                                hover:scale-105 active:scale-95
                                disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100
                                shadow-sm hover:shadow-md
                            `}
                        >
                            {isGenerating ? (
                                <Loader2 size={18} className="animate-spin" />
                            ) : (
                                activeTab === "edit" ? <Wand2 size={18} /> : <Sparkles size={18} />
                            )}
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
