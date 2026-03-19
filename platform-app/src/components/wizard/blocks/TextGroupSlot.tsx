"use client";

import { useState } from "react";
import { Sparkles, Link2, ChevronLeft, ChevronRight, Check, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { BusinessUnit, TextGenPreset, MasterComponent, TextComponentProps } from "@/types";
import { TEXT_GEN_PRESET_LABELS } from "@/types";
import { TextContentBlock } from "./TextContentBlock";

interface TextGroupSlotProps {
    groupId: string;
    members: MasterComponent[];
    textValues: Record<string, string>;
    onTextChange: (masterComponentId: string, value: string) => void;
    onBatchTextChange: (updates: Record<string, string>) => void;
    businessUnit?: BusinessUnit;
    productDescription?: string;
}

export function TextGroupSlot({
    groupId, members, textValues, onTextChange, onBatchTextChange, businessUnit, productDescription,
}: TextGroupSlotProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [aiPrompt, setAiPrompt] = useState("");
    const [showGroupGen, setShowGroupGen] = useState(false);
    const [selectedPreset, setSelectedPreset] = useState<TextGenPreset | undefined>(undefined);
    const [generatedSets, setGeneratedSets] = useState<Record<string, string>[]>([]);
    const [activeSetIdx, setActiveSetIdx] = useState(0);

    const handleGroupGenerate = async () => {
        const prompt = aiPrompt.trim() || productDescription || "";
        if (!prompt) return;
        setIsGenerating(true);
        try {
            const { generateTextGroup } = await import("@/services/aiService");
            const sets: Record<string, string>[] = [];
            for (let i = 0; i < 3; i++) {
                const result = await generateTextGroup(
                    members.map(mc => ({ id: mc.id, name: mc.name })),
                    prompt, businessUnit, selectedPreset,
                );
                sets.push(result);
            }
            setGeneratedSets(sets);
            setActiveSetIdx(0);
            if (sets.length > 0) onBatchTextChange(sets[0]);
        } catch (e) {
            console.error("Failed to generate text group:", e);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSelectSet = (idx: number) => {
        setActiveSetIdx(idx);
        onBatchTextChange(generatedSets[idx]);
    };

    const presetKeys = Object.keys(TEXT_GEN_PRESET_LABELS) as TextGenPreset[];

    return (
        <div className="border border-border-primary rounded-[var(--radius-lg)] bg-bg-secondary overflow-hidden">
            {/* Group header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-primary bg-bg-primary">
                <span className="flex items-center gap-2 text-[11px] font-semibold text-text-secondary">
                    <Link2 size={14} />
                    Связанная группа: {groupId}
                </span>
                <button
                    onClick={() => setShowGroupGen(!showGroupGen)}
                    className={`flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium rounded-[var(--radius-sm)] border transition-all cursor-pointer ${
                        showGroupGen
                            ? "bg-accent-lime text-accent-primary border-accent-lime-hover"
                            : "bg-bg-secondary text-text-secondary border-border-primary hover:bg-bg-tertiary"
                    }`}
                >
                    <Wand2 size={12} />
                    Генерация связки
                </button>
            </div>

            {/* Group AI panel */}
            {showGroupGen && (
                <div className="px-4 py-3 border-b border-border-primary bg-bg-secondary space-y-3">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder={productDescription || "Опишите тему для связанных текстов..."}
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleGroupGenerate()}
                            className="flex-1 h-9 px-3 rounded-[var(--radius-md)] border border-border-primary bg-bg-primary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus placeholder:text-text-tertiary"
                        />
                        <button
                            onClick={handleGroupGenerate}
                            disabled={isGenerating}
                            className="h-9 px-4 rounded-[var(--radius-md)] bg-accent-lime text-accent-primary font-semibold text-xs hover:bg-accent-lime-hover disabled:opacity-50 transition-all cursor-pointer disabled:cursor-default shrink-0 flex items-center gap-1.5"
                        >
                            {isGenerating ? <div className="animate-spin text-xs">⟳</div> : <Sparkles size={14} />}
                            {isGenerating ? "..." : "Связка"}
                        </button>
                    </div>

                    {/* Presets */}
                    <div className="flex gap-1.5 flex-wrap">
                        {presetKeys.map((preset) => (
                            <button
                                key={preset}
                                onClick={() => setSelectedPreset(selectedPreset === preset ? undefined : preset)}
                                className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-all cursor-pointer ${
                                    selectedPreset === preset
                                        ? "bg-accent-primary text-text-inverse border-accent-primary"
                                        : "bg-bg-primary text-text-secondary border-border-primary hover:bg-bg-tertiary"
                                }`}
                            >
                                {TEXT_GEN_PRESET_LABELS[preset]}
                            </button>
                        ))}
                    </div>

                    {/* Generated Sets */}
                    {generatedSets.length > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium text-text-secondary">
                                    Наборы ({activeSetIdx + 1}/{generatedSets.length})
                                </span>
                                <div className="flex gap-1">
                                    <button onClick={() => handleSelectSet(Math.max(0, activeSetIdx - 1))} disabled={activeSetIdx === 0} className="w-6 h-6 flex items-center justify-center rounded-full border border-border-primary text-text-secondary hover:bg-bg-tertiary disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors">
                                        <ChevronLeft size={14} />
                                    </button>
                                    <button onClick={() => handleSelectSet(Math.min(generatedSets.length - 1, activeSetIdx + 1))} disabled={activeSetIdx === generatedSets.length - 1} className="w-6 h-6 flex items-center justify-center rounded-full border border-border-primary text-text-secondary hover:bg-bg-tertiary disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors">
                                        <ChevronRight size={14} />
                                    </button>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                {generatedSets.map((setVals, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleSelectSet(i)}
                                        className={`flex-1 text-left p-2.5 rounded-[var(--radius-md)] border text-[11px] leading-snug transition-all cursor-pointer ${
                                            activeSetIdx === i
                                                ? "bg-accent-lime/30 border-accent-lime-hover text-text-primary shadow-[var(--shadow-sm)]"
                                                : "bg-bg-primary border-border-primary text-text-secondary hover:bg-bg-tertiary"
                                        }`}
                                    >
                                        <div className="space-y-1">
                                            {activeSetIdx === i && <Check size={12} className="text-text-primary mb-1" />}
                                            {members.map(mc => (
                                                <p key={mc.id} className="truncate">
                                                    <span className="font-medium text-text-secondary">{mc.name}:</span>{" "}
                                                    {setVals[mc.id] || "—"}
                                                </p>
                                            ))}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Individual text blocks */}
            <div className="p-3 space-y-3">
                {members.map(mc => (
                    <TextContentBlock
                        key={mc.id} id={mc.id} name={mc.name}
                        props={mc.props as TextComponentProps}
                        value={textValues[mc.id] ?? ""}
                        onChange={(val) => onTextChange(mc.id, val)}
                        businessUnit={businessUnit}
                        productDescription={productDescription}
                    />
                ))}
            </div>
        </div>
    );
}
