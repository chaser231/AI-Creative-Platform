import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Sparkles, Wand2, Image as ImageIcon, Send, MessageCircle, Settings2, Ratio, Type, Grip, CheckCircle2, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ReferenceImageInput } from "@/components/ui/ReferenceImageInput";
import { RefAutocompleteTextarea, type RefAutocompleteTextareaHandle } from "@/components/ui/RefAutocompleteTextarea";
import { ImageStylePresetPicker, TextStylePresetPicker } from "@/components/ui/StylePresetPicker";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import { RemoteTextProvider, RemoteImageProvider } from "@/services/aiService";
import { ImageEditorModal } from "@/components/wizard/blocks/ImageEditorModal";
import { getModelById, getMaxRefs, getAspectRatios, getResolutions, resolveRefTags } from "@/lib/ai-models";
import { SYSTEM_IMAGE_PRESETS, SYSTEM_TEXT_PRESETS, getImagePresetPromptSuffix, getTextPresetInstruction } from "@/lib/stylePresets";
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

const OUTPAINT_MODELS = [
    { id: "bria-expand", name: "Bria Expand" },
    { id: "flux-fill", name: "Flux Fill" },
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

export function AIPromptBar({ open, onClose, onToggleChat, isChatOpen, onResult, projectId }: AIPromptBarProps) {
    const { addTextLayer, addImageLayer, selectedLayerIds, updateLayer, layers } = useCanvasStore(useShallow((s) => ({
        addTextLayer: s.addTextLayer, addImageLayer: s.addImageLayer,
        selectedLayerIds: s.selectedLayerIds, updateLayer: s.updateLayer, layers: s.layers,
    })));
    const [activeTab, setActiveTab] = useState<"text" | "image" | "outpaint">("text");
    const [prompt, setPrompt] = useState("");
    const [selectedModel, setSelectedModel] = useState(TEXT_MODELS[0].id);
    const [aspectRatio, setAspectRatio] = useState("1:1");
    const [scale, setScale] = useState("");
    const [applyToSelection, setApplyToSelection] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [showEditorModal, setShowEditorModal] = useState(false);
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const [imageStyleId, setImageStyleId] = useState("none");
    const [textStyleId, setTextStyleId] = useState<string | undefined>(undefined);
    const promptRef = useRef<RefAutocompleteTextareaHandle>(null);

    // Check if current model supports vision (reference images)
    const supportsVision = activeTab !== "text" &&
        (getModelById(selectedModel)?.caps.includes("vision") ?? false);

    // Get selected image layer (if any)
    const selectedImageLayer = selectedLayerIds.length > 0
        ? layers.find(l => l.id === selectedLayerIds[0] && l.type === "image") as ImageLayer | undefined
        : undefined;

    // Reset model on tab change
    const handleTabChange = (tab: "text" | "image" | "outpaint") => {
        setActiveTab(tab);
        const models = tab === "text" ? TEXT_MODELS : tab === "image" ? IMAGE_MODELS : OUTPAINT_MODELS;
        setSelectedModel(models[0].id);
        // Clear reference images when switching to text tab
        if (tab === "text") setReferenceImages([]);
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

    const handleGenerate = async () => {
        if (!prompt) return;
        setIsGenerating(true);

        try {
            let res;
            if (activeTab === "text") {
                // Inject text style instruction if selected
                const textInstruction = textStyleId ? getTextPresetInstruction(textStyleId) : "";
                const textPromptWithStyle = textInstruction
                    ? `${textInstruction}\n\n${prompt}`
                    : prompt;
                res = await RemoteTextProvider.generate(textPromptWithStyle, { model: selectedModel, projectId });
            } else {
                // Inject image style suffix if selected
                const styleSuffix = getImagePresetPromptSuffix(imageStyleId);
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
                    const img = new Image();
                    img.onload = () => {
                        let w = img.naturalWidth;
                        let h = img.naturalHeight;
                        const MAX_DIM = 600;
                        if (w > MAX_DIM || h > MAX_DIM) {
                            const scale = MAX_DIM / Math.max(w, h);
                            w *= scale;
                            h *= scale;
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
            if (message.includes("fetch failed") || message.includes("E003")) {
                displayMsg = "Сервер перегружен или недоступен (слишком много запросов). Попробуйте еще раз через 10 секунд.";
            }
            alert("Ошибка генерации: " + displayMsg);
        } finally {
            setIsGenerating(false);
        }
    };

    if (!open) return null;

    const currentModels = activeTab === "text" ? TEXT_MODELS :
        activeTab === "image" ? IMAGE_MODELS : OUTPAINT_MODELS;

    const hasSelection = selectedLayerIds.length > 0;

    return (
        <div className="relative flex bg-bg-surface/95 backdrop-blur-xl border border-border-primary rounded-[24px] shadow-2xl w-[860px] max-w-[95vw] overflow-hidden animate-in slide-in-from-bottom-6 duration-300">
            {/* Close Button */}
            <button
                onClick={onClose}
                className="absolute top-2 right-2 p-1.5 text-text-tertiary hover:text-text-primary rounded-full hover:bg-bg-secondary transition-colors z-50"
            >
                <X size={16} />
            </button>

            {/* LEFT RAIL: Mode Toggles */}
            <div className="flex flex-col gap-2 p-2 bg-bg-tertiary/50 border-r border-border-primary w-14 items-center">
                <button
                    onClick={() => handleTabChange("text")}
                    className={`nav-button p-2.5 rounded-xl transition-all ${activeTab === "text" ? "bg-bg-surface text-accent-primary shadow-sm" : "text-text-tertiary hover:text-text-primary"}`}
                    title="Текст"
                >
                    <Type size={20} strokeWidth={activeTab === "text" ? 2.5 : 2} />
                </button>
                <button
                    onClick={() => handleTabChange("image")}
                    className={`nav-button p-2.5 rounded-xl transition-all ${activeTab === "image" ? "bg-bg-surface text-accent-primary shadow-sm" : "text-text-tertiary hover:text-text-primary"}`}
                    title="Изображение"
                >
                    <ImageIcon size={20} strokeWidth={activeTab === "image" ? 2.5 : 2} />
                </button>
                <button
                    onClick={() => {
                        if (selectedImageLayer) {
                            setShowEditorModal(true);
                        } else {
                            alert("Выделите изображение на канвасе для AI-редактирования");
                        }
                    }}
                    className={`nav-button p-2.5 rounded-xl transition-all ${
                        selectedImageLayer
                            ? "text-purple-500 hover:bg-purple-50 hover:text-purple-600"
                            : "text-text-tertiary/40 cursor-not-allowed"
                    }`}
                    title={selectedImageLayer ? "AI-редактирование выбранного изображения" : "Выберите изображение на канвасе"}
                    disabled={!selectedImageLayer}
                >
                    <Wand2 size={20} strokeWidth={2} />
                </button>
                <div className="flex-1" />
                <button
                    onClick={onToggleChat}
                    className={`p-2.5 rounded-full transition-colors ${isChatOpen ? "bg-accent-primary/10 text-accent-primary" : "text-text-tertiary hover:text-text-primary"}`}
                    title="История"
                >
                    <MessageCircle size={20} />
                </button>
            </div>

            {/* MAIN AREA */}
            <div className="flex-1 flex flex-col min-h-[160px]">
                {/* Header / Title (Optional, context dependent) */}
                <div className="pl-4 pr-12 pt-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
                        {activeTab === "text" ? "Генерация текста" : activeTab === "image" ? "Генерация изображения" : "Magic Edit"}
                    </span>
                    {hasSelection && (
                        <div
                            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors cursor-pointer border ${applyToSelection ? "bg-emerald-500/10 text-emerald-600 border-emerald-200" : "bg-bg-secondary text-text-secondary border-transparent hover:border-border-primary"}`}
                            onClick={() => setApplyToSelection(!applyToSelection)}
                        >
                            {applyToSelection ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                            <span>Apply to selection</span>
                        </div>
                    )}
                </div>

                <div className="flex-1 px-4 py-2">
                    <RefAutocompleteTextarea
                        ref={promptRef}
                        value={prompt}
                        onChange={setPrompt}
                        referenceImages={referenceImages}
                        placeholder={activeTab === "text" ? "Например: Заголовок для распродажи кроссовок..." : "Например: Футуристичный город в неоновых тонах..."}
                        className="w-full h-full min-h-[80px] bg-transparent text-lg text-text-primary placeholder:text-text-tertiary/50 focus:outline-none resize-none leading-relaxed"
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleGenerate();
                            }
                        }}
                    />
                </div>

                {/* BOTTOM PARAMETERS & ACTIONS */}
                <div className="px-4 pb-4 pt-2 flex items-center gap-2 border-t border-border-primary/30">
                    {/* Model Select */}
                    <div className="flex items-center gap-2 bg-bg-secondary/50 px-3 py-1.5 rounded-lg hover:bg-bg-secondary transition-colors group relative">
                        <Settings2 size={14} className="text-text-tertiary group-hover:text-text-primary" />
                        <select
                            value={selectedModel}
                            onChange={(e) => handleModelChange(e.target.value)}
                            className="bg-transparent text-xs font-medium text-text-secondary focus:outline-none cursor-pointer hover:text-text-primary appearance-none min-w-[80px]"
                        >
                            {currentModels.map(m => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Aspect Ratio (Image Only) */}
                    {activeTab !== "text" && (
                        <div className="flex items-center gap-2 bg-bg-secondary/50 px-3 py-1.5 rounded-lg hover:bg-bg-secondary transition-colors group">
                            <Ratio size={14} className="text-text-tertiary group-hover:text-text-primary" />
                            <select
                                value={aspectRatio}
                                onChange={(e) => setAspectRatio(e.target.value)}
                                className="bg-transparent text-xs font-medium text-text-secondary focus:outline-none cursor-pointer hover:text-text-primary appearance-none min-w-[40px]"
                            >
                                {modelAspectRatios.map(r => (
                                    <option key={r} value={r}>{r}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Resolution (Image Only, if model supports) */}
                    {activeTab !== "text" && modelResolutions.length > 0 && (
                        <div className="flex items-center gap-2 bg-bg-secondary/50 px-3 py-1.5 rounded-lg hover:bg-bg-secondary transition-colors group">
                            <select
                                value={scale}
                                onChange={(e) => setScale(e.target.value)}
                                className="bg-transparent text-xs font-medium text-text-secondary focus:outline-none cursor-pointer hover:text-text-primary appearance-none min-w-[40px]"
                            >
                                {modelResolutions.map(r => (
                                    <option key={r.id} value={r.id}>{r.label}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Style Preset (Image mode) */}
                    {activeTab !== "text" && (
                        <ImageStylePresetPicker
                            presets={SYSTEM_IMAGE_PRESETS}
                            selectedId={imageStyleId}
                            onChange={setImageStyleId}
                            variant="compact"
                        />
                    )}

                    {/* Style Preset (Text mode) */}
                    {activeTab === "text" && (
                        <TextStylePresetPicker
                            presets={SYSTEM_TEXT_PRESETS}
                            selectedId={textStyleId}
                            onChange={setTextStyleId}
                            variant="compact"
                        />
                    )}

                    <div className="flex-1" />

                    {/* Reference Images (vision-capable models only) */}
                    {supportsVision && (
                        <ReferenceImageInput
                            images={referenceImages}
                            onChange={setReferenceImages}
                            max={getMaxRefs(selectedModel)}
                            onTagClick={(tag) => promptRef.current?.insertAtCursor(tag)}
                        />
                    )}

                    {/* Generate Button */}
                    <Button
                        size="lg"
                        onClick={handleGenerate}
                        disabled={isGenerating || !prompt}
                        className={`rounded-2xl px-6 h-12 text-sm font-bold shadow-none transition-all hover:scale-105 active:scale-95 bg-[#BEF264] text-black hover:bg-[#a3e635] ${isGenerating ? "opacity-70" : ""}`}
                    >
                        {isGenerating ? <div className="animate-spin text-black mr-2">⟳</div> : <Sparkles size={18} className="mr-2 text-black" />}
                        {isGenerating ? "Генерирую..." : "Сгенерировать"}
                    </Button>
                </div>
            </div>

            {/* ImageEditorModal via Portal — renders at document.body level */}
            {showEditorModal && selectedImageLayer && createPortal(
                <ImageEditorModal
                    imageSrc={selectedImageLayer.src}
                    onApply={async (editedSrc) => {
                        // Persist the edited image to S3 immediately
                        let persistedSrc = editedSrc;
                        if (projectId) {
                            try {
                                persistedSrc = await persistImageToS3(editedSrc, projectId);
                            } catch (e) {
                                console.warn("Failed to persist edited image to S3:", e);
                            }
                        }
                        try {
                            // Load both old and new images to measure how much pixel dimensions changed
                            const oldImg = new Image();
                            await new Promise((resolve, reject) => {
                                oldImg.onload = resolve;
                                oldImg.onerror = reject;
                                oldImg.src = selectedImageLayer.src;
                            });

                            const newImg = new Image();
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
                                height: newHeight 
                            } as any);
                        } catch (e) {
                            console.error("Failed to measure new image dimensions", e);
                            updateLayer(selectedImageLayer.id, { src: persistedSrc } as any);
                        }
                        
                        setShowEditorModal(false);
                    }}
                    onClose={() => setShowEditorModal(false)}
                />,
                document.body
            )}
        </div>
    );
}
