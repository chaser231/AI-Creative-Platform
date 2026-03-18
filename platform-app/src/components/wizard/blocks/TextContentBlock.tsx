"use client";

import { useState } from "react";
import { Sparkles, Type, ChevronLeft, ChevronRight, Check, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { TextComponentProps, BusinessUnit, TextGenPreset } from "@/types";
import { TEXT_GEN_PRESET_LABELS } from "@/types";

interface TextContentBlockProps {
    id: string;
    name: string;
    props: TextComponentProps;
    value: string;
    onChange: (value: string) => void;
    businessUnit?: BusinessUnit;
    productDescription?: string;
}

export function TextContentBlock({ id, name, props, value, onChange, businessUnit, productDescription }: TextContentBlockProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [aiPrompt, setAiPrompt] = useState("");
    const [showAiPanel, setShowAiPanel] = useState(false);
    const [variants, setVariants] = useState<string[]>([]);
    const [activeVariantIdx, setActiveVariantIdx] = useState(0);
    const [selectedPreset, setSelectedPreset] = useState<TextGenPreset | undefined>(undefined);

    const handleGenerate = async () => {
        const prompt = aiPrompt.trim() || productDescription || "";
        if (!prompt) return;
        setIsGenerating(true);
        try {
            const { generateTextVariants } = await import("@/services/aiService");
            const results = await generateTextVariants(
                prompt,
                name,
                3,
                businessUnit,
                selectedPreset,
            );
            setVariants(results);
            setActiveVariantIdx(0);
            // Auto-apply first variant
            if (results.length > 0) {
                onChange(results[0]);
            }
        } catch (e) {
            console.error("Failed to generate text variants:", e);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSelectVariant = (idx: number) => {
        setActiveVariantIdx(idx);
        onChange(variants[idx]);
    };

    const presetKeys = Object.keys(TEXT_GEN_PRESET_LABELS) as TextGenPreset[];

    return (
        <div className="p-4 bg-bg-primary border border-border-primary rounded-[var(--radius-lg)] shadow-sm">
            {/* Header */}
            <div className="flex justify-between items-center mb-2">
                <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Type size={16} className="text-text-secondary" />
                    {name}
                </label>
                <Button
                    variant="ghost"
                    size="sm"
                    icon={<Wand2 size={14} className={showAiPanel ? "text-purple-500" : "text-text-tertiary"} />}
                    onClick={() => setShowAiPanel(!showAiPanel)}
                    className={`text-xs h-7 px-2 transition-colors ${
                        showAiPanel
                            ? "bg-purple-50 text-purple-600 border border-purple-200"
                            : "hover:bg-bg-secondary text-text-secondary"
                    }`}
                >
                    AI
                </Button>
            </div>

            {/* Text Input */}
            <input
                type="text"
                placeholder={props.text || "Введите текст"}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
            />

            {/* AI Generation Panel */}
            {showAiPanel && (
                <div className="mt-3 p-3 bg-gradient-to-br from-purple-50/80 to-indigo-50/60 border border-purple-100 rounded-[var(--radius-md)] space-y-3">
                    {/* Prompt input */}
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder={productDescription || "Опишите что нужно сгенерировать..."}
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                            className="flex-1 h-9 px-3 rounded-[var(--radius-md)] border border-purple-200/60 bg-white/80 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-purple-300 placeholder:text-text-tertiary"
                        />
                        <Button
                            variant="ai"
                            size="sm"
                            icon={isGenerating ? <div className="animate-spin text-white text-xs">⟳</div> : <Sparkles size={14} />}
                            onClick={handleGenerate}
                            disabled={isGenerating}
                            className="h-9 px-3 shrink-0"
                        >
                            {isGenerating ? "..." : "Генерация"}
                        </Button>
                    </div>

                    {/* Presets */}
                    <div className="flex gap-1.5 flex-wrap">
                        {presetKeys.map((preset) => (
                            <button
                                key={preset}
                                onClick={() => setSelectedPreset(selectedPreset === preset ? undefined : preset)}
                                className={`px-2 py-1 text-[11px] font-medium rounded-full border transition-all cursor-pointer ${
                                    selectedPreset === preset
                                        ? "bg-purple-500 text-white border-purple-500"
                                        : "bg-white/60 text-purple-600 border-purple-200 hover:bg-purple-100/50"
                                }`}
                            >
                                {TEXT_GEN_PRESET_LABELS[preset]}
                            </button>
                        ))}
                    </div>

                    {/* Variants Carousel */}
                    {variants.length > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium text-purple-600">
                                    Варианты ({activeVariantIdx + 1}/{variants.length})
                                </span>
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => handleSelectVariant(Math.max(0, activeVariantIdx - 1))}
                                        disabled={activeVariantIdx === 0}
                                        className="w-6 h-6 flex items-center justify-center rounded-full border border-purple-200 text-purple-500 hover:bg-purple-100 disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors"
                                    >
                                        <ChevronLeft size={14} />
                                    </button>
                                    <button
                                        onClick={() => handleSelectVariant(Math.min(variants.length - 1, activeVariantIdx + 1))}
                                        disabled={activeVariantIdx === variants.length - 1}
                                        className="w-6 h-6 flex items-center justify-center rounded-full border border-purple-200 text-purple-500 hover:bg-purple-100 disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors"
                                    >
                                        <ChevronRight size={14} />
                                    </button>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                {variants.map((v, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleSelectVariant(i)}
                                        className={`flex-1 text-left p-2.5 rounded-[var(--radius-md)] border text-xs leading-snug transition-all cursor-pointer ${
                                            activeVariantIdx === i
                                                ? "bg-white border-purple-400 text-text-primary shadow-sm ring-1 ring-purple-200"
                                                : "bg-white/50 border-purple-100 text-text-secondary hover:bg-white/80 hover:border-purple-200"
                                        }`}
                                    >
                                        <div className="flex items-start gap-1.5">
                                            {activeVariantIdx === i && (
                                                <Check size={12} className="text-purple-500 shrink-0 mt-0.5" />
                                            )}
                                            <span className="line-clamp-3">{v}</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* BU TOV indicator */}
            {businessUnit && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-text-tertiary">
                    <Sparkles size={10} />
                    <span>TOV: {businessUnit}</span>
                </div>
            )}
        </div>
    );
}
