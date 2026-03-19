"use client";

import { useState, useRef } from "react";
import {
    Image as ImageIcon,
    Upload,
    Sparkles,
    Wand2,
    Pencil,
    Loader2,
    Plus,
    X,
    Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ImageComponentProps, BusinessUnit } from "@/types";
import { getSystemPromptForBU } from "@/services/aiService";
import { ImageEditorModal } from "./ImageEditorModal";

// ─── AI Models for Image Generation ──────────────────────

const IMAGE_GEN_MODELS = [
    { id: "dall-e", label: "DALL-E 3", provider: "openai" },
    { id: "flux", label: "Flux 2.0", provider: "fal" },
    { id: "nano-banana", label: "Nano Banana", provider: "replicate" },
    { id: "nano-banana-2", label: "Nano Banana 2", provider: "replicate" },
    { id: "nano-banana-pro", label: "Nano Banana Pro", provider: "replicate" },
    { id: "gpt-image", label: "GPT Image 1.5", provider: "openai" },
    { id: "seadream", label: "SeaDream 4.5", provider: "replicate" },
] as const;

const ASPECT_RATIOS = [
    { id: "1:1", label: "1:1", w: 1024, h: 1024 },
    { id: "4:3", label: "4:3", w: 1024, h: 768 },
    { id: "3:4", label: "3:4", w: 768, h: 1024 },
    { id: "16:9", label: "16:9", w: 1024, h: 576 },
    { id: "9:16", label: "9:16", w: 576, h: 1024 },
    { id: "3:2", label: "3:2", w: 1024, h: 682 },
] as const;

const STYLE_PRESETS = [
    { id: "none", label: "Без стиля", emoji: "✨" },
    { id: "product", label: "Продуктовая", emoji: "📦" },
    { id: "food", label: "Фуд", emoji: "🍔" },
    { id: "lifestyle", label: "Лайфстайл", emoji: "🌿" },
    { id: "tech", label: "Технологии", emoji: "💻" },
    { id: "minimal", label: "Минимализм", emoji: "⬜" },
    { id: "vibrant", label: "Яркий", emoji: "🎨" },
    { id: "cinematic", label: "Кинематограф.", emoji: "🎬" },
] as const;

const SCALE_OPTIONS = ["1x", "2x", "4x"] as const;

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
    const multiFileInputRef = useRef<HTMLInputElement>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [showEditor, setShowEditor] = useState(false);
    const [showGenPanel, setShowGenPanel] = useState(false);
    const [genPrompt, setGenPrompt] = useState("");

    // Generation params
    const [selectedModel, setSelectedModel] = useState("dall-e");
    const [aspectRatio, setAspectRatio] = useState("1:1");
    const [genCount, setGenCount] = useState(1);
    const [seed, setSeed] = useState("");
    const [scale, setScale] = useState<string>("1x");
    const [stylePreset, setStylePreset] = useState("none");
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Multi-photo state
    const [additionalPhotos, setAdditionalPhotos] = useState<string[]>([]);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (ev.target?.result) onChange(ev.target.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleMultiFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (ev.target?.result) {
                    setAdditionalPhotos(prev => [...prev, ev.target!.result as string]);
                }
            };
            reader.readAsDataURL(file);
        });
    };

    const removePhoto = (idx: number) => {
        setAdditionalPhotos(prev => prev.filter((_, i) => i !== idx));
    };

    const handleGenerate = async () => {
        const prompt = genPrompt.trim() || productDescription;
        if (!prompt) return;
        setIsGenerating(true);
        try {
            const style = STYLE_PRESETS.find(s => s.id === stylePreset);
            const ratio = ASPECT_RATIOS.find(r => r.id === aspectRatio);
            const buPrompt = businessUnit ? getSystemPromptForBU(businessUnit, "image") : "";
            const styleInstr = style && style.id !== "none" ? `Стиль: ${style.label}.` : "";

            const finalPrompt = [buPrompt, styleInstr, prompt].filter(Boolean).join(" ");

            const response = await fetch("/api/ai/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: finalPrompt,
                    type: "image",
                    model: selectedModel,
                    width: ratio?.w || 1024,
                    height: ratio?.h || 1024,
                    count: genCount,
                    seed: seed ? Number(seed) : undefined,
                    scale,
                    referenceImages: additionalPhotos.length > 0 ? additionalPhotos : undefined,
                }),
            });
            const data = await response.json();
            if (data.content) onChange(data.content);
        } catch (e) {
            console.error("Failed to generate image:", e);
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
                    {/* Preview Thumbnail */}
                    <div className="w-24 h-24 shrink-0 rounded-[var(--radius-md)] border border-border-primary overflow-hidden bg-bg-secondary flex items-center justify-center relative group">
                        {currentImageSrc ? (
                            <>
                                <img src={currentImageSrc} alt={name} className="w-full h-full object-cover" />
                                <button
                                    onClick={() => setShowEditor(true)}
                                    className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer"
                                >
                                    <Pencil size={16} className="text-white" />
                                </button>
                            </>
                        ) : (
                            <ImageIcon size={24} className="text-text-tertiary" />
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex-1 flex flex-col gap-2">
                        <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                        <input type="file" accept="image/*" multiple className="hidden" ref={multiFileInputRef} onChange={handleMultiFileUpload} />

                        <Button
                            variant="secondary"
                            className="w-full justify-start text-sm h-9"
                            icon={<Upload size={16} />}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            Загрузить файл
                        </Button>

                        {currentImageSrc && (
                            <button
                                onClick={() => setShowEditor(true)}
                                className="w-full flex items-center gap-2 justify-start text-sm h-9 px-3 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
                            >
                                <Pencil size={16} className="text-text-secondary" />
                                Редактировать AI
                            </button>
                        )}

                        <button
                            onClick={() => setShowGenPanel(!showGenPanel)}
                            className={`w-full flex items-center gap-2 justify-start text-sm h-9 px-3 rounded-[var(--radius-md)] border transition-all cursor-pointer ${
                                showGenPanel
                                    ? "bg-accent-lime text-accent-primary border-accent-lime-hover font-medium"
                                    : "bg-bg-secondary text-text-primary border-border-primary hover:bg-bg-tertiary"
                            }`}
                        >
                            <Wand2 size={16} />
                            Сгенерировать с нуля
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
                                    <button
                                        key={m.id}
                                        onClick={() => setSelectedModel(m.id)}
                                        className={`px-2.5 py-1.5 text-[11px] font-medium rounded-[var(--radius-sm)] border transition-all cursor-pointer ${
                                            selectedModel === m.id
                                                ? "bg-accent-primary text-text-inverse border-accent-primary"
                                                : "bg-bg-primary text-text-secondary border-border-primary hover:bg-bg-tertiary"
                                        }`}
                                    >
                                        {m.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Prompt */}
                        <div>
                            <textarea
                                placeholder={productDescription || "Опишите изображение..."}
                                value={genPrompt}
                                onChange={(e) => setGenPrompt(e.target.value)}
                                className="w-full h-16 px-3 py-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-primary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus resize-none placeholder:text-text-tertiary"
                            />
                        </div>

                        {/* Style Presets */}
                        <div>
                            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2">Стиль</p>
                            <div className="grid grid-cols-4 gap-1.5">
                                {STYLE_PRESETS.map(s => (
                                    <button
                                        key={s.id}
                                        onClick={() => setStylePreset(s.id)}
                                        className={`flex flex-col items-center gap-1 p-2 rounded-[var(--radius-md)] border text-[10px] transition-all cursor-pointer ${
                                            stylePreset === s.id
                                                ? "bg-accent-lime/30 border-accent-lime-hover text-text-primary"
                                                : "bg-bg-primary border-border-primary text-text-secondary hover:bg-bg-tertiary"
                                        }`}
                                    >
                                        <span className="text-lg">{s.emoji}</span>
                                        <span className="font-medium">{s.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Aspect Ratio */}
                        <div>
                            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2">Соотношение сторон</p>
                            <div className="flex gap-1.5 flex-wrap">
                                {ASPECT_RATIOS.map(r => (
                                    <button
                                        key={r.id}
                                        onClick={() => setAspectRatio(r.id)}
                                        className={`px-3 py-1.5 text-[11px] font-medium rounded-[var(--radius-sm)] border transition-all cursor-pointer ${
                                            aspectRatio === r.id
                                                ? "bg-accent-primary text-text-inverse border-accent-primary"
                                                : "bg-bg-primary text-text-secondary border-border-primary hover:bg-bg-tertiary"
                                        }`}
                                    >
                                        {r.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Multi-photo (reference images) */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Фото-референсы</p>
                                <button
                                    onClick={() => multiFileInputRef.current?.click()}
                                    className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
                                >
                                    <Plus size={12} /> Добавить
                                </button>
                            </div>
                            {additionalPhotos.length > 0 ? (
                                <div className="flex gap-2 flex-wrap">
                                    {additionalPhotos.map((photo, i) => (
                                        <div key={i} className="relative w-14 h-14 rounded-[var(--radius-sm)] overflow-hidden border border-border-primary group">
                                            <img src={photo} alt={`Ref ${i + 1}`} className="w-full h-full object-cover" />
                                            <button
                                                onClick={() => removePhoto(i)}
                                                className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                            >
                                                <X size={10} className="text-white" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-[10px] text-text-tertiary">Добавьте фото для мульти-фото генерации (напр. Nano Banana)</p>
                            )}
                        </div>

                        {/* Advanced settings toggle */}
                        <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="flex items-center gap-1.5 text-[11px] text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
                        >
                            <Settings2 size={12} />
                            {showAdvanced ? "Скрыть настройки" : "Расширенные настройки"}
                        </button>

                        {showAdvanced && (
                            <div className="grid grid-cols-3 gap-3 pt-1">
                                <div>
                                    <p className="text-[10px] font-medium text-text-secondary mb-1">Количество</p>
                                    <select
                                        value={genCount}
                                        onChange={(e) => setGenCount(Number(e.target.value))}
                                        className="w-full h-8 px-2 text-[11px] bg-bg-primary border border-border-primary rounded-[var(--radius-sm)] text-text-primary cursor-pointer"
                                    >
                                        {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium text-text-secondary mb-1">Масштаб</p>
                                    <div className="flex gap-1">
                                        {SCALE_OPTIONS.map(s => (
                                            <button
                                                key={s}
                                                onClick={() => setScale(s)}
                                                className={`flex-1 h-8 text-[11px] rounded-[var(--radius-sm)] border cursor-pointer transition-all ${
                                                    scale === s
                                                        ? "bg-accent-primary text-text-inverse border-accent-primary"
                                                        : "bg-bg-primary text-text-secondary border-border-primary hover:bg-bg-tertiary"
                                                }`}
                                            >
                                                {s}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium text-text-secondary mb-1">Seed</p>
                                    <input
                                        type="text"
                                        placeholder="Авто"
                                        value={seed}
                                        onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))}
                                        className="w-full h-8 px-2 text-[11px] bg-bg-primary border border-border-primary rounded-[var(--radius-sm)] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-border-focus"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Generate button */}
                        <button
                            onClick={handleGenerate}
                            disabled={isGenerating || (!genPrompt.trim() && !productDescription)}
                            className="w-full h-10 flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent-lime text-accent-primary font-semibold text-sm hover:bg-accent-lime-hover disabled:opacity-50 transition-all cursor-pointer disabled:cursor-default"
                        >
                            {isGenerating ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : (
                                <Sparkles size={16} />
                            )}
                            {isGenerating ? "Создаю..." : "Сгенерировать"}
                        </button>
                    </div>
                )}
            </div>

            {/* Image Editor Modal */}
            {showEditor && currentImageSrc && (
                <ImageEditorModal
                    imageSrc={currentImageSrc}
                    onApply={(edited) => {
                        onChange(edited);
                        setShowEditor(false);
                    }}
                    onClose={() => setShowEditor(false)}
                    businessUnit={businessUnit}
                />
            )}
        </>
    );
}
