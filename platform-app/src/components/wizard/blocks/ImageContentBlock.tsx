"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
    Image as ImageIcon,
    Upload,
    Sparkles,
    Wand2,
    Pencil,
    Loader2,
    Settings2,
    Ratio,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ReferenceImageInput } from "@/components/ui/ReferenceImageInput";
import { RefAutocompleteTextarea, type RefAutocompleteTextareaHandle } from "@/components/ui/RefAutocompleteTextarea";
import { ImageStylePresetPicker } from "@/components/ui/StylePresetPicker";
import { LoraSelectorPicker } from "@/components/ui/LoraSelectorPicker";
import { LoraTriggerHint } from "@/components/ui/LoraTriggerHint";
import { ModelSettingsModal, type AdvancedAIParams } from "@/components/ui/ModelSettingsModal";
import { getModelById, getMaxRefs, getAspectRatios, getResolutions, resolveRefTags, getLoraSpec } from "@/lib/ai-models";
import type { LoraWeight } from "@/lib/ai-providers";
import { getImagePresetPromptSuffixForModel } from "@/lib/stylePresets";
import { useStylePresets } from "@/hooks/useStylePresets";
import { uploadManyForAI } from "@/utils/imageUpload";
import type { ImageComponentProps, BusinessUnit } from "@/types";
import { ImageEditorModal } from "./ImageEditorModal";
import { Sliders } from "lucide-react";

// ─── AI Models ───────────────────────────────────────────────────────────────

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

// Aspect ratios and resolutions are now dynamic per model — see ai-models.ts

interface ImageContentBlockProps {
    id: string;
    name: string;
    props: ImageComponentProps;
    value: string;
    onChange: (value: string) => void;
    businessUnit?: BusinessUnit;
    productDescription?: string;
    projectId?: string;
}

export function ImageContentBlock({ id, name, props, value, onChange, businessUnit, productDescription, projectId }: ImageContentBlockProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [genError, setGenError] = useState<string | null>(null);
    const [showEditor, setShowEditor] = useState(false);
    const [showGenPanel, setShowGenPanel] = useState(false);
    const [genPrompt, setGenPrompt] = useState("");
    const promptRef = useRef<RefAutocompleteTextareaHandle>(null);
    const [previewState, setPreviewState] = useState<"empty" | "loading" | "ready" | "error">("empty");

    // Generation params
    const [selectedModel, setSelectedModel] = useState("flux-dev");
    const [aspectRatio, setAspectRatio] = useState("1:1");
    const [genCount, setGenCount] = useState(1);
    const [seed, setSeed] = useState("");
    const [scale, setScale] = useState("");
    const [stylePreset, setStylePreset] = useState("none");
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [additionalPhotos, setAdditionalPhotos] = useState<string[]>([]);
    // LoRA selection + advanced overrides — both scoped to the active model.
    const [loras, setLoras] = useState<LoraWeight[]>([]);
    const [advancedParams, setAdvancedParams] = useState<AdvancedAIParams>({});
    const [settingsOpen, setSettingsOpen] = useState(false);

    // Whether selected model supports vision (reference images)
    const supportsVision = getModelById(selectedModel)?.caps.includes("vision") ?? false;
    // Dynamic per-model options
    const modelAspectRatios = getAspectRatios(selectedModel);
    const modelResolutions = getResolutions(selectedModel);
    // LoRA capabilities for the active model.
    const loraSpec = getLoraSpec(selectedModel);
    // Workspace-aware presets (system + custom from DB)
    const { imagePresets } = useStylePresets();

    // Reset LoRA + overrides on every model swap so values scoped to the
    // previous model can never leak into the next request.
    const handleModelChange = (modelId: string) => {
        setSelectedModel(modelId);
        setLoras([]);
        setAdvancedParams({});
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setIsUploading(true);
            setGenError(null);
            import("@/utils/imageUpload").then(({ compressImageFile }) => {
                compressImageFile(file).then((compressedBase64) => {
                    onChange(compressedBase64);
                }).catch(() => {
                    setGenError("Не удалось обработать изображение");
                }).finally(() => {
                    setIsUploading(false);
                });
            });
        }
    };

    const handleGenerate = async () => {
        const basePrompt = genPrompt.trim() || productDescription || "";
        if (!basePrompt) {
            setGenError("Введите описание изображения");
            return;
        }
        setGenError(null);
        setIsGenerating(true);
        try {
            // User prompt is primary; style is appended as context, not prefix
            const styleSuffix = getImagePresetPromptSuffixForModel(stylePreset, selectedModel, imagePresets);
            const styleContext = styleSuffix ? `. Style: ${styleSuffix}` : "";
            const finalPrompt = `${basePrompt}${styleContext}`;

            const refUrls = additionalPhotos.length > 0
                ? await uploadManyForAI(additionalPhotos, projectId || "ai-tmp")
                : undefined;

            const response = await fetch("/api/ai/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: resolveRefTags(finalPrompt, selectedModel),
                    type: "image",
                    model: selectedModel,
                    aspectRatio: aspectRatio,
                    count: genCount,
                    seed: seed ? Number(seed) : undefined,
                    scale: scale || undefined,
                    referenceImages: refUrls,
                    projectId,
                    // LoRA + overrides — server filters them based on the
                    // model entry, so non-LoRA models silently ignore these.
                    ...(loraSpec
                        ? {
                            loras: loras.length > 0 ? loras : undefined,
                            guidanceScale: advancedParams.guidanceScale,
                            numInferenceSteps: advancedParams.numInferenceSteps,
                            negativePrompt: advancedParams.negativePrompt,
                            acceleration: advancedParams.acceleration,
                        }
                        : {}),
                }),
            });
            const data = await response.json();
            if (data.error) throw new Error(data.requestId ? `${data.error} [request: ${data.requestId}]` : data.error);
            if (data.content) onChange(data.content);
        } catch (e: unknown) {
            const err = e as Error;
            setGenError(err.message || "Ошибка генерации");
        } finally {
            setIsGenerating(false);
        }
    };

    const currentImageSrc = value || props.src;

    useEffect(() => {
        if (!currentImageSrc) {
            setPreviewState("empty");
            return;
        }

        setPreviewState("loading");
        let cancelled = false;
        const img = new window.Image();
        img.onload = () => {
            if (!cancelled) setPreviewState("ready");
        };
        img.onerror = () => {
            if (!cancelled) setPreviewState("error");
        };
        img.src = currentImageSrc;

        return () => {
            cancelled = true;
        };
    }, [currentImageSrc]);

    return (
        <>
            <div className="p-4 bg-bg-primary border border-border-primary rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)]">
                <div className="flex justify-between items-center mb-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                        <ImageIcon size={16} className="text-text-secondary" />
                        {name}
                    </label>
                </div>

                <div className="flex gap-4">
                    {/* Preview */}
                    <div className="w-24 h-24 shrink-0 rounded-[var(--radius-md)] border border-border-primary overflow-hidden bg-bg-secondary flex items-center justify-center relative group">
                        {currentImageSrc ? (
                            <>
                                <img
                                    src={currentImageSrc}
                                    alt={name}
                                    className={`w-full h-full object-cover transition-opacity ${previewState === "ready" ? "opacity-100" : "opacity-0"}`}
                                />
                                {previewState !== "ready" && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-bg-secondary px-2 text-center">
                                        {previewState === "error" ? (
                                            <>
                                                <ImageIcon size={18} className="text-text-error" />
                                                <span className="text-[10px] text-text-error leading-tight">Ошибка превью</span>
                                            </>
                                        ) : (
                                            <>
                                                <Loader2 size={18} className="animate-spin text-text-secondary" />
                                                <span className="text-[10px] text-text-secondary leading-tight">Загружаю превью</span>
                                            </>
                                        )}
                                    </div>
                                )}
                                <button onClick={() => setShowEditor(true)} className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer">
                                    <Pencil size={16} className="text-white" />
                                </button>
                            </>
                        ) : (
                            <ImageIcon size={24} className="text-text-tertiary" />
                        )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex-1 flex flex-col gap-2">
                        <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />

                        <Button variant="secondary" className="w-full justify-start text-sm h-9" icon={<Upload size={16} />} onClick={() => fileInputRef.current?.click()}>
                            {isUploading ? "Подготавливаю файл..." : "Загрузить файл"}
                        </Button>

                        {currentImageSrc && (
                            <button onClick={() => setShowEditor(true)} className="w-full flex items-center gap-2 justify-start text-sm h-9 px-3 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer">
                                <Pencil size={16} className="text-text-secondary" />
                                Редактировать AI
                            </button>
                        )}

                        <button
                            onClick={() => setShowGenPanel(!showGenPanel)}
                            className={`w-full flex items-center gap-2 justify-start text-sm h-9 px-3 rounded-[var(--radius-md)] border transition-all cursor-pointer ${showGenPanel ? "bg-accent-lime text-accent-lime-text border-accent-lime-hover font-medium" : "bg-bg-secondary text-text-primary border-border-primary hover:bg-bg-tertiary"}`}
                        >
                            <Wand2 size={16} /> Сгенерировать с нуля
                        </button>
                    </div>
                </div>

                {/* Compact generation bar — mirrors the Studio AIPromptBar form factor. */}
                {showGenPanel && (
                    <div className="mt-4 overflow-visible rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface shadow-[var(--shadow-md)]">
                        <div className="px-4 pt-3">
                            <RefAutocompleteTextarea
                                ref={promptRef}
                                value={genPrompt}
                                onChange={(v) => { setGenPrompt(v); setGenError(null); }}
                                referenceImages={additionalPhotos}
                                placeholder={productDescription || "Промпт для генерации изображения"}
                                className="w-full h-12 bg-transparent text-sm text-text-primary focus:outline-none resize-none placeholder:text-text-tertiary"
                            />
                        </div>

                        {genError && (
                            <div className="mx-4 mb-2 rounded-[var(--radius-md)] border border-text-error/20 bg-text-error/10 px-3 py-2">
                                <p className="text-[11px] font-medium leading-relaxed text-text-error">{genError}</p>
                            </div>
                        )}

                        {(isUploading || previewState === "loading") && (
                            <div className="mx-4 mb-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary px-3 py-2">
                                <p className="text-[11px] text-text-secondary">
                                    {isUploading ? "Подготавливаю изображение для вставки..." : "Превью изображения еще подгружается..."}
                                </p>
                            </div>
                        )}

                        {/* LoRA trigger hint — mirrors server-side auto-injection */}
                        <div className="px-4 pb-1">
                            <LoraTriggerHint
                                family={loraSpec?.family ?? null}
                                loras={loras}
                            />
                        </div>

                        <div className="flex items-center gap-2 px-4 pb-3 pt-1">
                            <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                <OutlinedSelector icon={<Settings2 size={13} />}>
                                    <select
                                        value={selectedModel}
                                        onChange={(e) => handleModelChange(e.target.value)}
                                        className="max-w-[150px] bg-transparent text-[12px] font-medium text-text-secondary focus:outline-none cursor-pointer hover:text-text-primary appearance-none"
                                    >
                                        {IMAGE_GEN_MODELS.map((model) => (
                                            <option key={model.id} value={model.id}>
                                                {model.label}
                                            </option>
                                        ))}
                                    </select>
                                </OutlinedSelector>

                                {/* Advanced model settings — only for LoRA-aware models. */}
                                {loraSpec && (
                                    <button
                                        onClick={() => setSettingsOpen(true)}
                                        title="Параметры модели"
                                        className="flex items-center justify-center w-7 h-7 rounded-[10px] border border-border-primary/60 text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary/30 transition-all cursor-pointer"
                                    >
                                        <Sliders size={12} />
                                    </button>
                                )}

                                <OutlinedSelector icon={<Ratio size={13} />}>
                                    <select
                                        value={aspectRatio}
                                        onChange={(e) => setAspectRatio(e.target.value)}
                                        className="bg-transparent text-[12px] font-medium text-text-secondary focus:outline-none cursor-pointer hover:text-text-primary appearance-none"
                                    >
                                        {modelAspectRatios.map((ratio) => (
                                            <option key={ratio} value={ratio}>
                                                {ratio}
                                            </option>
                                        ))}
                                    </select>
                                </OutlinedSelector>

                                {!loraSpec && (
                                    <ImageStylePresetPicker
                                        presets={imagePresets}
                                        selectedId={stylePreset}
                                        onChange={setStylePreset}
                                        variant="compact"
                                    />
                                )}

                                {/* LoRA picker — disabled for non-LoRA models. */}
                                <LoraSelectorPicker
                                    family={loraSpec?.family ?? null}
                                    maxCount={loraSpec?.maxCount ?? 1}
                                    value={loras}
                                    onChange={setLoras}
                                />

                                <button
                                    onClick={() => setShowAdvanced((open) => !open)}
                                    className={`h-8 px-2.5 rounded-[10px] border text-[12px] font-medium transition-all cursor-pointer ${
                                        showAdvanced
                                            ? "border-accent-primary/40 bg-accent-primary/10 text-accent-primary"
                                            : "border-border-primary/60 text-text-secondary hover:border-border-secondary hover:bg-bg-tertiary/30"
                                    }`}
                                    title="Дополнительные настройки"
                                >
                                    <Settings2 size={13} />
                                </button>
                            </div>

                            {supportsVision && (
                                <ReferenceImageInput
                                    images={additionalPhotos}
                                    onChange={setAdditionalPhotos}
                                    max={getMaxRefs(selectedModel)}
                                    label="Референс"
                                    onTagClick={(tag) => promptRef.current?.insertAtCursor(tag)}
                                />
                            )}

                            <button
                                onClick={handleGenerate}
                                disabled={isGenerating}
                                title={isGenerating ? "Генерирую..." : "Сгенерировать изображение"}
                                className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-lime-hover text-accent-lime-text shadow-sm transition-all duration-200 cursor-pointer hover:bg-accent-lime hover:scale-105 hover:shadow-md active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                            >
                                {isGenerating ? (
                                    <Loader2 size={18} className="animate-spin" />
                                ) : (
                                    <Sparkles size={18} />
                                )}
                            </button>
                        </div>

                        {showAdvanced && (
                            <div className="grid grid-cols-3 gap-3 border-t border-border-primary bg-bg-secondary/40 px-4 py-3">
                                {modelResolutions.length > 0 && (
                                    <label className="space-y-1">
                                        <span className="text-[10px] font-medium text-text-secondary">Разрешение</span>
                                        <select
                                            value={scale}
                                            onChange={(e) => setScale(e.target.value)}
                                            className="h-8 w-full rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary px-2 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
                                        >
                                            <option value="">Авто</option>
                                            {modelResolutions.map((resolution) => (
                                                <option key={resolution.id} value={resolution.id}>
                                                    {resolution.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                )}
                                <label className="space-y-1">
                                    <span className="text-[10px] font-medium text-text-secondary">Количество</span>
                                    <select
                                        value={String(genCount)}
                                        onChange={(e) => setGenCount(Number(e.target.value))}
                                        className="h-8 w-full rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary px-2 text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus"
                                    >
                                        {[1, 2, 3, 4].map((count) => (
                                            <option key={count} value={count}>{count}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="space-y-1">
                                    <span className="text-[10px] font-medium text-text-secondary">Seed</span>
                                    <input
                                        type="text"
                                        placeholder="Авто"
                                        value={seed}
                                        onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))}
                                        className="h-8 w-full rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary px-2 text-[11px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border-focus"
                                    />
                                </label>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {showEditor && currentImageSrc && (
                <ImageEditorModal
                    imageSrc={currentImageSrc}
                    onApply={(edited) => { onChange(edited); setShowEditor(false); }}
                    onClose={() => setShowEditor(false)}
                    businessUnit={businessUnit}
                />
            )}

            {/* Advanced model settings — only mounted for LoRA-aware models. */}
            {loraSpec && (
                <ModelSettingsModal
                    open={settingsOpen}
                    onClose={() => setSettingsOpen(false)}
                    spec={loraSpec}
                    value={advancedParams}
                    onChange={setAdvancedParams}
                />
            )}
        </>
    );
}

function OutlinedSelector({
    icon,
    children,
}: {
    icon?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="flex h-8 items-center gap-1.5 rounded-[10px] border border-border-primary/60 px-2.5 text-text-secondary transition-colors hover:border-border-secondary hover:bg-bg-tertiary/30">
            {icon && <span className="text-text-tertiary">{icon}</span>}
            {children}
        </div>
    );
}
