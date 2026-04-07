"use client";

import { useState, useRef } from "react";
import {
    Image as ImageIcon,
    Upload,
    Sparkles,
    Wand2,
    Pencil,
    Loader2,
    Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ReferenceImageInput } from "@/components/ui/ReferenceImageInput";
import { RefAutocompleteTextarea, type RefAutocompleteTextareaHandle } from "@/components/ui/RefAutocompleteTextarea";
import { getModelById, getMaxRefs, getAspectRatios, getResolutions, resolveRefTags } from "@/lib/ai-models";
import { getImagePresetPromptSuffix } from "@/lib/stylePresets";
import { useStylePresets } from "@/hooks/useStylePresets";
import type { ImageComponentProps, BusinessUnit } from "@/types";
import { ImageEditorModal } from "./ImageEditorModal";

// ─── AI Models ───────────────────────────────────────────────────────────────

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

// Aspect ratios and resolutions are now dynamic per model — see ai-models.ts

const SCALE_OPTIONS = ["1x", "2x", "4x"];

interface ImageContentBlockProps {
    id: string;
    name: string;
    props: ImageComponentProps;
    value: string;
    onChange: (value: string) => void;
    businessUnit?: BusinessUnit;
    productDescription?: string;
}

export function ImageContentBlock({ id, name, props, value, onChange, businessUnit, productDescription }: ImageContentBlockProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [genError, setGenError] = useState<string | null>(null);
    const [showEditor, setShowEditor] = useState(false);
    const [showGenPanel, setShowGenPanel] = useState(false);
    const [genPrompt, setGenPrompt] = useState("");
    const promptRef = useRef<RefAutocompleteTextareaHandle>(null);

    // Generation params
    const [selectedModel, setSelectedModel] = useState("flux-dev");
    const [aspectRatio, setAspectRatio] = useState("1:1");
    const [genCount, setGenCount] = useState(1);
    const [seed, setSeed] = useState("");
    const [scale, setScale] = useState("");
    const [stylePreset, setStylePreset] = useState("none");
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [additionalPhotos, setAdditionalPhotos] = useState<string[]>([]);

    // Whether selected model supports vision (reference images)
    const supportsVision = getModelById(selectedModel)?.caps.includes("vision") ?? false;
    // Dynamic per-model options
    const modelAspectRatios = getAspectRatios(selectedModel);
    const modelResolutions = getResolutions(selectedModel);
    // Workspace-aware presets (system + custom from DB)
    const { imagePresets } = useStylePresets();

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            import("@/utils/imageUpload").then(({ compressImageFile }) => {
                compressImageFile(file).then((compressedBase64) => {
                    onChange(compressedBase64);
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
            const styleSuffix = getImagePresetPromptSuffix(stylePreset, imagePresets);
            const styleContext = styleSuffix ? `. Style: ${styleSuffix}` : "";
            const finalPrompt = `${basePrompt}${styleContext}`;

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
                    referenceImages: additionalPhotos.length > 0 ? additionalPhotos : undefined,
                }),
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            if (data.content) onChange(data.content);
        } catch (e: unknown) {
            const err = e as Error;
            setGenError(err.message || "Ошибка генерации");
        } finally {
            setIsGenerating(false);
        }
    };

    const currentImageSrc = value || props.src;

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
                                <img src={currentImageSrc} alt={name} className="w-full h-full object-cover" />
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
                            Загрузить файл
                        </Button>

                        {currentImageSrc && (
                            <button onClick={() => setShowEditor(true)} className="w-full flex items-center gap-2 justify-start text-sm h-9 px-3 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer">
                                <Pencil size={16} className="text-text-secondary" />
                                Редактировать AI
                            </button>
                        )}

                        <button
                            onClick={() => setShowGenPanel(!showGenPanel)}
                            className={`w-full flex items-center gap-2 justify-start text-sm h-9 px-3 rounded-[var(--radius-md)] border transition-all cursor-pointer ${showGenPanel ? "bg-accent-lime text-accent-primary border-accent-lime-hover font-medium" : "bg-bg-secondary text-text-primary border-border-primary hover:bg-bg-tertiary"}`}
                        >
                            <Wand2 size={16} /> Сгенерировать с нуля
                        </button>
                    </div>
                </div>

                {/* Generation Panel */}
                {showGenPanel && (
                    <div className="mt-4 p-4 bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] space-y-4">

                        {/* Model Selection */}
                        <div>
                            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2">Модель</p>
                            <div className="flex gap-1.5 flex-wrap">
                                {IMAGE_GEN_MODELS.map(m => (
                                    <button key={m.id} onClick={() => setSelectedModel(m.id)}
                                        className={`px-2.5 py-1.5 text-[11px] font-medium rounded-[var(--radius-sm)] border transition-all cursor-pointer ${selectedModel === m.id ? "bg-accent-primary text-text-inverse border-accent-primary" : "bg-bg-primary text-text-secondary border-border-primary hover:bg-bg-tertiary"}`}>
                                        {m.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Prompt */}
                        <RefAutocompleteTextarea
                            ref={promptRef}
                            value={genPrompt}
                            onChange={(v) => { setGenPrompt(v); setGenError(null); }}
                            referenceImages={additionalPhotos}
                            placeholder={productDescription || "Опишите изображение..."}
                            className="w-full h-16 px-3 py-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-primary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus resize-none placeholder:text-text-tertiary"
                        />

                        {/* Style Presets — unified from stylePresets.ts */}
                        <div>
                            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2">Стиль</p>
                            <div className="grid grid-cols-4 gap-2">
                                {imagePresets.map(s => (
                                    <button key={s.id} onClick={() => setStylePreset(s.id)}
                                        className={`relative rounded-[var(--radius-md)] overflow-hidden border-2 transition-all cursor-pointer aspect-square ${stylePreset === s.id ? "border-accent-lime-hover shadow-[0_0_0_1px_var(--accent-lime)]" : "border-border-primary hover:border-border-secondary"}`}>
                                        <img src={s.thumbnailUrl} alt={s.label} className="w-full h-full object-cover" />
                                        <div className={`absolute inset-0 flex items-end justify-center pb-1.5 bg-gradient-to-t from-black/60 to-transparent`}>
                                            <span className={`text-[10px] font-semibold leading-tight text-center px-1 ${stylePreset === s.id ? "text-white" : "text-white/90"}`}>{s.label}</span>
                                        </div>
                                        {stylePreset === s.id && (
                                            <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-accent-lime rounded-full flex items-center justify-center">
                                                <span className="text-[8px] font-bold text-accent-primary">✓</span>
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Aspect Ratio */}
                        <div>
                            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2">Соотношение сторон</p>
                            <div className="flex gap-1.5 flex-wrap">
                                {modelAspectRatios.map(r => (
                                    <button key={r} onClick={() => setAspectRatio(r)}
                                        className={`px-3 py-1.5 text-[11px] font-medium rounded-[var(--radius-sm)] border transition-all cursor-pointer ${aspectRatio === r ? "bg-accent-primary text-text-inverse border-accent-primary" : "bg-bg-primary text-text-secondary border-border-primary hover:bg-bg-tertiary"}`}>
                                        {r}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Reference photos */}
                        {supportsVision && (
                            <div>
                                <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2">Фото-референсы</p>
                                <ReferenceImageInput
                                    images={additionalPhotos}
                                    onChange={setAdditionalPhotos}
                                    max={getMaxRefs(selectedModel)}
                                    label="Добавить референс"
                                    onTagClick={(tag) => promptRef.current?.insertAtCursor(tag)}
                                />
                            </div>
                        )}

                        {/* Advanced settings */}
                        <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1.5 text-[11px] text-text-secondary hover:text-text-primary cursor-pointer transition-colors">
                            <Settings2 size={12} />
                            {showAdvanced ? "Скрыть настройки" : "Расширенные настройки"}
                        </button>

                        {showAdvanced && (
                            <div className="grid grid-cols-2 gap-3 pt-1">
                                <div>
                                    <p className="text-[10px] font-medium text-text-secondary mb-1">Количество</p>
                                    <select value={genCount} onChange={(e) => setGenCount(Number(e.target.value))} className="w-full h-8 px-2 text-[11px] bg-bg-primary border border-border-primary rounded-[var(--radius-sm)] text-text-primary cursor-pointer">
                                        {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                                    </select>
                                </div>
                                {modelResolutions.length > 0 && (
                                    <div>
                                        <p className="text-[10px] font-medium text-text-secondary mb-1">Разрешение</p>
                                        <select value={scale} onChange={(e) => setScale(e.target.value)} className="w-full h-8 px-2 text-[11px] bg-bg-primary border border-border-primary rounded-[var(--radius-sm)] text-text-primary cursor-pointer">
                                            {modelResolutions.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                                        </select>
                                    </div>
                                )}
                                <div>
                                    <p className="text-[10px] font-medium text-text-secondary mb-1">Seed</p>
                                    <input type="text" placeholder="Авто" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} className="w-full h-8 px-2 text-[11px] bg-bg-primary border border-border-primary rounded-[var(--radius-sm)] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border-focus" />
                                </div>
                            </div>
                        )}

                        {/* Error */}
                        {genError && (
                            <p className="text-[12px] text-red-500">{genError}</p>
                        )}

                        {/* Generate button */}
                        <button
                            onClick={handleGenerate}
                            disabled={isGenerating}
                            className="w-full h-10 flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent-lime text-accent-primary font-semibold text-sm hover:bg-accent-lime-hover disabled:opacity-50 transition-all cursor-pointer disabled:cursor-default"
                        >
                            {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                            {isGenerating ? "Создаю..." : "Сгенерировать"}
                        </button>
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
        </>
    );
}
