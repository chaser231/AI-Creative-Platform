import { useState, useRef, useEffect, useCallback } from "react";
import { Sparkles, Wand2, Image as ImageIcon, Send, MessageCircle, Settings2, Ratio, Type, Grip, CheckCircle2, Circle, X, ChevronDown, Eraser, Paintbrush, Expand, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ReferenceImageInput } from "@/components/ui/ReferenceImageInput";
import { RefAutocompleteTextarea, type RefAutocompleteTextareaHandle } from "@/components/ui/RefAutocompleteTextarea";
import { ImageStylePresetPicker, TextStylePresetPicker } from "@/components/ui/StylePresetPicker";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import { RemoteTextProvider, RemoteImageProvider } from "@/services/aiService";
import { getModelById, getMaxRefs, getAspectRatios, getResolutions, resolveRefTags } from "@/lib/ai-models";
import { getImagePresetPromptSuffix, getTextPresetInstruction } from "@/lib/stylePresets";
import { useStylePresets } from "@/hooks/useStylePresets";
import { persistImageToS3 } from "@/utils/imageUpload";
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
    { id: "seedream", name: "Seedream 4.5" },
    { id: "gpt-image", name: "GPT Image 1.5" },
    { id: "qwen-image", name: "Qwen Image" },
    { id: "flux-schnell", name: "Flux Schnell" },
    { id: "flux-dev", name: "Flux Dev" },
    { id: "flux-1.1-pro", name: "Flux 1.1 Pro" },
    { id: "dall-e-3", name: "DALL-E 3" },
];

// Models available for AI image editing (with "edit" cap or specialized tools)
const EDIT_MODELS = [
    { id: "nano-banana-2", name: "Nano Banana 2" },
    { id: "nano-banana-pro", name: "Nano Banana Pro" },
    { id: "nano-banana", name: "Nano Banana" },
    { id: "flux-2-pro", name: "Flux 2 Pro" },
    { id: "seedream", name: "Seedream 4.5" },
    { id: "gpt-image", name: "GPT Image 1.5" },
    { id: "qwen-image-edit", name: "Qwen Image Edit" },
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
    onResult: (result: { type: string; content: string; prompt: string; model?: string }) => void;
    /** Project ID for S3 image persistence */
    projectId?: string;
}

// ─── Outlined Selector Pill ─────────────────────────────────────────────────
// Design-system component: outlined control with icon, text, and subtle border.
// Used across all bottom-bar selectors for visual consistency.

function OutlinedSelector({
    icon,
    children,
    className = "",
}: {
    icon?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={`
            flex items-center gap-1.5 px-2.5 py-1 rounded-[10px]
            border border-border-primary/60
            text-[12px] font-medium text-text-secondary
            hover:border-border-secondary hover:bg-bg-tertiary/30
            transition-all
            ${className}
        `}>
            {icon && <span className="text-text-tertiary flex-shrink-0">{icon}</span>}
            {children}
        </div>
    );
}

// ─── Quick Action Button ────────────────────────────────────────────────────
// Pill-shaped action buttons for the edit tab (Remove BG, Inpaint, Expand)

function QuickActionButton({
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
            onClick={onClick}
            disabled={disabled || loading}
            className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-[10px]
                text-[12px] font-medium transition-all cursor-pointer
                border whitespace-nowrap
                disabled:opacity-40 disabled:cursor-not-allowed
                ${active
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40 shadow-sm"
                    : "bg-bg-tertiary/40 text-text-secondary border-border-primary/60 hover:bg-bg-tertiary hover:border-border-secondary hover:text-text-primary"
                }
            `}
        >
            {loading ? <Loader2 size={13} className="animate-spin" /> : icon}
            {label}
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
    const [applyToSelection, setApplyToSelection] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const [imageStyleId, setImageStyleId] = useState("none");
    const [textStyleId, setTextStyleId] = useState<string | undefined>(undefined);
    const promptRef = useRef<RefAutocompleteTextareaHandle>(null);

    // ── Edit tab state ──
    const [editAction, setEditAction] = useState<"prompt" | "remove-bg" | "inpaint" | "expand" | null>(null);
    const [editError, setEditError] = useState<string | null>(null);
    const [outpaintRatio, setOutpaintRatio] = useState("16:9");

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
        // Clear reference images when switching to text tab
        if (tab === "text") setReferenceImages([]);
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
        // Reset resolution
        const res = getResolutions(modelId);
        setScale(res.length > 0 ? res[0].id : "");
    };

    // Current model's dynamic options
    const modelAspectRatios = getAspectRatios(selectedModel);
    const modelResolutions = getResolutions(selectedModel);

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

        // ── Generic edit: scale proportionally based on pixel dimensions ──
        try {
            // Measure old and new dimensions to scale the layer proportionally
            const oldImg = new window.Image();
            await new Promise((resolve, reject) => {
                oldImg.onload = resolve;
                oldImg.onerror = reject;
                oldImg.src = selectedImageLayer.src;
            });

            const newImg = new window.Image();
            await new Promise((resolve, reject) => {
                newImg.onload = resolve;
                newImg.onerror = reject;
                newImg.src = persistedSrc;
            });

            const scaleX = newImg.naturalWidth / oldImg.naturalWidth;
            const scaleY = newImg.naturalHeight / oldImg.naturalHeight;

            const newWidth = selectedImageLayer.width * scaleX;
            const newHeight = selectedImageLayer.height * scaleY;

            updateLayer(selectedImageLayer.id, {
                src: persistedSrc,
                width: newWidth,
                height: newHeight,
            } as any);
        } catch (e) {
            console.error("Failed to measure new image dimensions", e);
            updateLayer(selectedImageLayer.id, { src: persistedSrc } as any);
        }
    }, [selectedImageLayer, projectId, updateLayer]);

    // ── Image edit API call (shared by all edit actions) ──
    const callImageEdit = useCallback(async (action: string, editPrompt?: string) => {
        if (!selectedImageLayer) return;
        setIsGenerating(true);
        setEditError(null);

        // Snapshot expand padding BEFORE the API call (resetExpandMode clears it)
        const currentExpandPadding = { ...expandPadding };

        try {
            const styleSuffix = getImagePresetPromptSuffix(imageStyleId, imagePresets);
            const rawPrompt = editPrompt || "";
            const styledPrompt = styleSuffix && rawPrompt ? `${rawPrompt}. Style: ${styleSuffix}` : rawPrompt;
            const resolvedPrompt = resolveRefTags(styledPrompt, selectedModel);

            // For outpaint: measure actual image pixel dimensions (not canvas dimensions)
            // to ensure bria/expand works at the real image resolution
            let outpaintOriginalSize: [number, number] | undefined;
            if (action === "outpaint") {
                try {
                    const img = new window.Image();
                    await new Promise<void>((resolve, reject) => {
                        img.onload = () => resolve();
                        img.onerror = reject;
                        img.src = selectedImageLayer.src;
                    });
                    outpaintOriginalSize = [img.naturalWidth, img.naturalHeight];
                    console.log(`[Outpaint] Real image pixels: ${img.naturalWidth}×${img.naturalHeight}, canvas layer: ${selectedImageLayer.width}×${selectedImageLayer.height}`);
                } catch {
                    // Fallback to canvas dimensions if image fails to load
                    outpaintOriginalSize = [Math.round(selectedImageLayer.width), Math.round(selectedImageLayer.height)];
                }

                // Scale padding proportionally from canvas-space to pixel-space
                const pixelScaleX = outpaintOriginalSize[0] / selectedImageLayer.width;
                const pixelScaleY = outpaintOriginalSize[1] / selectedImageLayer.height;
                currentExpandPadding.left = Math.round(currentExpandPadding.left * pixelScaleX);
                currentExpandPadding.right = Math.round(currentExpandPadding.right * pixelScaleX);
                currentExpandPadding.top = Math.round(currentExpandPadding.top * pixelScaleY);
                currentExpandPadding.bottom = Math.round(currentExpandPadding.bottom * pixelScaleY);

                console.log(`[Outpaint] Pixel-space padding: T=${currentExpandPadding.top} R=${currentExpandPadding.right} B=${currentExpandPadding.bottom} L=${currentExpandPadding.left}`);
            }

            const response = await fetch("/api/ai/image-edit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action,
                    prompt: resolvedPrompt,
                    imageBase64: selectedImageLayer.src,
                    model: action === "remove-bg" ? "rembg" : (action === "outpaint" ? "bria-expand" : selectedModel),
                    referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
                    // For outpaint: send pixel-space expandPadding + real image pixel size
                    expandPadding: action === "outpaint" ? currentExpandPadding : undefined,
                    originalSize: action === "outpaint" ? outpaintOriginalSize : undefined,
                    projectId,
                }),
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            if (data.content) {
                // For outpaint: pass canvas-space padding (the original, un-scaled) for layer sizing
                await applyEditedImageToLayer(data.content, action === "outpaint" ? {
                    action: "outpaint",
                    padding: expandPadding, // canvas-space padding for layer resizing
                } : undefined);
                // Reset expand mode after successful outpaint
                if (action === "outpaint") resetExpandMode();
                // Pass result to chat history
                onResult({
                    type: "edit",
                    content: data.content,
                    prompt: rawPrompt || action,
                    model: data.model,
                });
                setPrompt("");
                setReferenceImages([]);
            }
        } catch (e: unknown) {
            const error = e as Error;
            console.error(`Image edit (${action}) failed:`, error);
            setEditError(parseAiError(error));
        } finally {
            setIsGenerating(false);
        }
    }, [selectedImageLayer, selectedModel, imageStyleId, imagePresets, referenceImages, expandPadding, projectId, applyEditedImageToLayer, onResult, resetExpandMode]);

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
        setIsGenerating(true);

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
                const styleSuffix = getImagePresetPromptSuffix(imageStyleId, imagePresets);
                const styledPrompt = styleSuffix ? `${prompt}. Style: ${styleSuffix}` : prompt;
                const resolvedPrompt = resolveRefTags(styledPrompt, selectedModel);
                res = await RemoteImageProvider.generate(resolvedPrompt, {
                    model: selectedModel,
                    aspectRatio,
                    scale: scale || undefined,
                    referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
                    projectId,
                });
            }

            // Persist AI-generated image to S3 immediately (before adding to canvas)
            // This prevents storing temporary Replicate/OpenAI URLs that expire in ~1hr
            let persistedContent = res.content;
            if (activeTab !== "text" && projectId) {
                try {
                    persistedContent = await persistImageToS3(res.content, projectId);
                } catch (e) {
                    console.warn("Image S3 persistence failed, using original URL:", e);
                }
            }

            // AUTO-ADD to Canvas Logic
            if (applyToSelection && selectedLayerIds.length > 0) {
                // Update existing layer if checkbox is checked
                const layerId = selectedLayerIds[0]; // Naive: take first
                if (activeTab === "text") {
                    updateLayer(layerId, { text: persistedContent });
                } else {
                    // For image, we can only update source if it's an image layer or update fill of rect
                    // This logic depends on layer type, simplified here:
                    updateLayer(layerId, { src: persistedContent } as any);
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
                    // Dynamically measure the new image to preserve aspect ratio
                    // Fit to artboard: scale down if larger than canvas
                    const img = new window.Image();
                    img.onload = () => {
                        let w = img.naturalWidth;
                        let h = img.naturalHeight;
                        // Fit to artboard — scale down proportionally if image exceeds canvas
                        if (w > canvasWidth || h > canvasHeight) {
                            const scaleFactor = Math.min(canvasWidth / w, canvasHeight / h);
                            w = Math.round(w * scaleFactor);
                            h = Math.round(h * scaleFactor);
                        }
                        addImageLayer(persistedContent, w, h);
                    };
                    img.onerror = () => {
                        // Fallback in case of loading error
                        addImageLayer(persistedContent, 512, 512);
                    };
                    img.src = persistedContent;
                }
            }

            // Pass result up to chat history
            onResult({
                type: activeTab,
                content: persistedContent,
                prompt: prompt,
                model: res.model,
            });
            setPrompt(""); // Clear prompt after success
            setReferenceImages([]); // Clear references after use
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
        /* Outer wrapper — allows "Apply to selection" badge to float above 
           without stretching the bar itself. Uses flex-col with items-start */
        <div className="flex flex-col items-start gap-2">
            {/* ── Floating "Apply to selection" badge — hidden in edit tab ── */}
            {hasSelection && activeTab !== "edit" && (
                <div
                    className={`
                        inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
                        text-[11px] font-medium transition-all cursor-pointer
                        border backdrop-blur-md shadow-sm
                        ${applyToSelection
                            ? "bg-emerald-500/15 text-emerald-600 border-emerald-300/60"
                            : "bg-bg-surface/90 text-text-secondary border-border-primary/60 hover:border-border-secondary"
                        }
                    `}
                    onClick={() => setApplyToSelection(!applyToSelection)}
                >
                    {applyToSelection ? <CheckCircle2 size={13} /> : <Circle size={13} />}
                    <span>Применить к выделению</span>
                </div>
            )}

            {/* ── MAIN BAR ── */}
            <div className="relative flex flex-col bg-bg-surface/95 backdrop-blur-xl border border-border-primary rounded-[20px] shadow-2xl w-[760px] max-w-[95vw] animate-in slide-in-from-bottom-6 duration-300">
                {/* ── TOP BAR: Horizontal tabs + AI-chat + Close ── */}
                <div className="flex items-center gap-1 px-2 pt-2 pb-0">
                    {/* Mode Tabs */}
                    <div className="flex items-center gap-0.5 bg-bg-tertiary/60 rounded-[12px] p-0.5">
                        <button
                            onClick={() => handleTabChange("text")}
                            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-[10px] text-[12px] font-medium transition-all cursor-pointer whitespace-nowrap ${
                                activeTab === "text"
                                    ? "bg-bg-surface text-text-primary shadow-sm"
                                    : "text-text-tertiary hover:text-text-secondary"
                            }`}
                        >
                            <Type size={13} strokeWidth={activeTab === "text" ? 2.5 : 2} />
                            Генерация текста
                        </button>
                        <button
                            onClick={() => handleTabChange("image")}
                            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-[10px] text-[12px] font-medium transition-all cursor-pointer whitespace-nowrap ${
                                activeTab === "image"
                                    ? "bg-bg-surface text-text-primary shadow-sm"
                                    : "text-text-tertiary hover:text-text-secondary"
                            }`}
                        >
                            <ImageIcon size={13} strokeWidth={activeTab === "image" ? 2.5 : 2} />
                            Генерация изображения
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
                            AI-редактирование
                        </button>
                    </div>

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
                <div className="flex-1 px-4 py-2.5 min-h-[80px]">
                    <RefAutocompleteTextarea
                        ref={promptRef}
                        value={prompt}
                        onChange={setPrompt}
                        referenceImages={referenceImages}
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

                {/* ── QUICK ACTIONS (Edit tab only) ── */}
                {activeTab === "edit" && (
                    <div className="px-4 pb-1 flex items-center gap-1.5 flex-wrap">
                        <QuickActionButton
                            icon={<Eraser size={13} />}
                            label="Удалить фон"
                            active={editAction === "remove-bg"}
                            loading={isGenerating && editAction === "remove-bg"}
                            disabled={isGenerating}
                            onClick={() => {
                                if (editAction === "remove-bg") {
                                    setEditAction(null);
                                } else {
                                    setEditAction("remove-bg");
                                    // Remove BG is instant — call immediately
                                    handleRemoveBg();
                                }
                            }}
                        />
                        <QuickActionButton
                            icon={<Paintbrush size={13} />}
                            label="Inpaint"
                            active={editAction === "inpaint"}
                            disabled={isGenerating}
                            onClick={() => setEditAction(editAction === "inpaint" ? null : "inpaint")}
                        />
                        <QuickActionButton
                            icon={<Expand size={13} />}
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

                        {/* Expand hint — shown when expand is active */}
                        {editAction === "expand" && (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] border border-emerald-500/30 bg-emerald-500/5">
                                <Expand size={12} className="text-emerald-700 dark:text-emerald-400" />
                                <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                                    Потяните за ручки на canvas
                                </span>
                            </div>
                        )}

                        {/* Error banner */}
                        {editError && (
                            <div className="flex-1 min-w-0">
                                <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5 animate-in fade-in zoom-in-95">
                                    <p className="text-[11px] text-red-500 leading-relaxed font-medium truncate">{editError}</p>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ── BOTTOM BAR: Outlined selectors + Reference + Generate ── */}
                <div className="px-4 pb-3 pt-1 flex items-center">
                    {/* LEFT: Outlined selector pills with proper spacing */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Model Select */}
                        <OutlinedSelector icon={<Settings2 size={13} />}>
                            <select
                                value={selectedModel}
                                onChange={(e) => handleModelChange(e.target.value)}
                                className="bg-transparent text-[12px] font-medium text-text-secondary focus:outline-none cursor-pointer hover:text-text-primary appearance-none pr-0"
                            >
                                {currentModels.map(m => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                        </OutlinedSelector>

                        {/* Aspect Ratio (Image tab only) */}
                        {activeTab === "image" && (
                            <OutlinedSelector icon={<Ratio size={13} />}>
                                <select
                                    value={aspectRatio}
                                    onChange={(e) => setAspectRatio(e.target.value)}
                                    className="bg-transparent text-[12px] font-medium text-text-secondary focus:outline-none cursor-pointer hover:text-text-primary appearance-none pr-0"
                                >
                                    {modelAspectRatios.map(r => (
                                        <option key={r} value={r}>{r}</option>
                                    ))}
                                </select>
                            </OutlinedSelector>
                        )}

                        {/* Resolution (Image tab only, if model supports) */}
                        {activeTab === "image" && modelResolutions.length > 0 && (
                            <OutlinedSelector>
                                <select
                                    value={scale}
                                    onChange={(e) => setScale(e.target.value)}
                                    className="bg-transparent text-[12px] font-medium text-text-secondary focus:outline-none cursor-pointer hover:text-text-primary appearance-none pr-0"
                                >
                                    {modelResolutions.map(r => (
                                        <option key={r.id} value={r.id}>{r.label}</option>
                                    ))}
                                </select>
                            </OutlinedSelector>
                        )}

                        {/* Style Preset (Image or Edit mode) */}
                        {(activeTab === "image" || activeTab === "edit") && (
                            <ImageStylePresetPicker
                                presets={imagePresets}
                                selectedId={imageStyleId}
                                onChange={setImageStyleId}
                                variant="compact"
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

                    <div className="flex-1" />

                    {/* RIGHT: Reference + Generate */}
                    <div className="flex items-center gap-2">
                        {/* Reference Images (vision-capable models, image or edit tab) */}
                        {supportsVision && (
                            <ReferenceImageInput
                                images={referenceImages}
                                onChange={setReferenceImages}
                                max={getMaxRefs(selectedModel)}
                                onTagClick={(tag) => promptRef.current?.insertAtCursor(tag)}
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
                                bg-accent-lime-hover hover:bg-accent-lime text-text-inverse
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
        </div>
    );
}
