"use client";

import { useState, useRef } from "react";
import {
    Image as ImageIcon,
    Upload,
    Sparkles,
    Wand2,
    Pencil,
    Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ImageComponentProps, BusinessUnit } from "@/types";
import { getSystemPromptForBU } from "@/services/aiService";
import { ImageEditorModal } from "./ImageEditorModal";

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
    const [showEditor, setShowEditor] = useState(false);
    const [showGenPrompt, setShowGenPrompt] = useState(false);
    const [genPrompt, setGenPrompt] = useState("");

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (ev.target?.result) {
                    onChange(ev.target.result as string);
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const handleGenerateImage = async (promptOverride?: string) => {
        const prompt = promptOverride || genPrompt.trim() || productDescription;
        if (!prompt) return;
        setIsGenerating(true);
        try {
            const stylePrompt = businessUnit ? getSystemPromptForBU(businessUnit, "image") : "";
            const finalPrompt = `${stylePrompt} ${prompt}`;

            const response = await fetch("/api/ai/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: finalPrompt,
                    type: "image",
                    model: "dall-e",
                }),
            });
            const data = await response.json();
            if (data.content) {
                onChange(data.content);
            }
        } catch (e) {
            console.error("Failed to generate image:", e);
            onChange(`https://placehold.co/800x800/e2e8f0/1e293b.png?text=AI+Generated+Image`);
        } finally {
            setIsGenerating(false);
        }
    };

    const currentImageSrc = value || props.src;

    return (
        <>
            <div className="p-4 bg-bg-primary border border-border-primary rounded-[var(--radius-lg)] shadow-sm">
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
                                <img
                                    src={currentImageSrc}
                                    alt={name}
                                    className="w-full h-full object-cover"
                                />
                                {/* Edit overlay */}
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
                        <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                        />
                        <Button
                            variant="secondary"
                            className="w-full justify-start text-sm h-9"
                            icon={<Upload size={16} />}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            Загрузить файл
                        </Button>

                        {/* Edit with AI (only if image exists) */}
                        {currentImageSrc && (
                            <Button
                                variant="secondary"
                                className="w-full justify-start text-sm h-9 border-purple-100 text-purple-600 hover:bg-purple-50"
                                icon={<Pencil size={16} className="text-purple-500" />}
                                onClick={() => setShowEditor(true)}
                            >
                                Редактировать AI
                            </Button>
                        )}

                        {/* Generate toggle */}
                        <Button
                            variant="secondary"
                            className={`w-full justify-start text-sm h-9 ${
                                showGenPrompt
                                    ? "bg-purple-50 border-purple-200 text-purple-600"
                                    : "border-purple-100 text-purple-600 hover:bg-purple-50 bg-purple-50/50"
                            }`}
                            icon={<Wand2 size={16} className="text-purple-500" />}
                            onClick={() => setShowGenPrompt(!showGenPrompt)}
                        >
                            Сгенерировать с нуля
                        </Button>
                    </div>
                </div>

                {/* Generation Prompt Panel */}
                {showGenPrompt && (
                    <div className="mt-3 p-3 bg-gradient-to-br from-purple-50/80 to-indigo-50/60 border border-purple-100 rounded-[var(--radius-md)] space-y-2">
                        <textarea
                            placeholder={productDescription || "Опишите изображение, которое хотите создать..."}
                            value={genPrompt}
                            onChange={(e) => setGenPrompt(e.target.value)}
                            className="w-full h-16 px-3 py-2 rounded-[var(--radius-md)] border border-purple-200/60 bg-white/80 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-purple-300 resize-none placeholder:text-text-tertiary"
                        />
                        <Button
                            variant="ai"
                            className="w-full"
                            icon={isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                            onClick={() => handleGenerateImage()}
                            disabled={isGenerating || (!genPrompt.trim() && !productDescription)}
                        >
                            {isGenerating ? "Создание..." : "Сгенерировать"}
                        </Button>
                    </div>
                )}

                {businessUnit && (
                    <div className="mt-3 flex items-center gap-1.5 text-[10px] text-text-tertiary border-t border-border-secondary pt-2">
                        <Sparkles size={10} className="text-purple-400" />
                        <span>Стиль генерации: {businessUnit === "yandex-market" ? "Студийный свет, яркий фон" : "Кастомный пресет BU"}</span>
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
