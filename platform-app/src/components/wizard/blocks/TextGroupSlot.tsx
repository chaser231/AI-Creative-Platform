"use client";

import { useState } from "react";
import { Sparkles, Link2, ChevronLeft, ChevronRight, Check, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { BusinessUnit, TextGenPreset, MasterComponent, TextComponentProps } from "@/types";
import { TEXT_GEN_PRESET_LABELS } from "@/types";
import { TextContentBlock } from "./TextContentBlock";

interface TextGroupSlotProps {
    /** The groupSlotId that links these text fields */
    groupId: string;
    /** Master components belonging to this group */
    members: MasterComponent[];
    /** Current text values by masterId */
    textValues: Record<string, string>;
    /** Callback to update a single text value */
    onTextChange: (masterComponentId: string, value: string) => void;
    /** Callback to update multiple text values at once */
    onBatchTextChange: (updates: Record<string, string>) => void;
    businessUnit?: BusinessUnit;
    productDescription?: string;
}

export function TextGroupSlot({
    groupId,
    members,
    textValues,
    onTextChange,
    onBatchTextChange,
    businessUnit,
    productDescription,
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
            // Generate 3 coordinated sets
            const sets: Record<string, string>[] = [];
            for (let i = 0; i < 3; i++) {
                const result = await generateTextGroup(
                    members.map(mc => ({ id: mc.id, name: mc.name })),
                    prompt,
                    businessUnit,
                    selectedPreset,
                );
                sets.push(result);
            }
            setGeneratedSets(sets);
            setActiveSetIdx(0);
            // Auto-apply first set
            if (sets.length > 0) {
                onBatchTextChange(sets[0]);
            }
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
        <div className="border border-indigo-100 rounded-[var(--radius-lg)] bg-gradient-to-br from-indigo-50/30 to-purple-50/20 overflow-hidden">
            {/* Group header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-indigo-100 bg-white/50">
                <span className="flex items-center gap-2 text-xs font-semibold text-indigo-600">
                    <Link2 size={14} />
                    Связанная группа: {groupId}
                </span>
                <Button
                    variant="ghost"
                    size="sm"
                    icon={<Wand2 size={14} className={showGroupGen ? "text-indigo-500" : "text-text-tertiary"} />}
                    onClick={() => setShowGroupGen(!showGroupGen)}
                    className={`text-[11px] h-7 px-2 transition-colors ${
                        showGroupGen
                            ? "bg-indigo-50 text-indigo-600 border border-indigo-200"
                            : "hover:bg-bg-secondary text-text-secondary"
                    }`}
                >
                    Генерация связки
                </Button>
            </div>

            {/* Group AI panel */}
            {showGroupGen && (
                <div className="px-4 py-3 bg-gradient-to-br from-indigo-50/80 to-purple-50/60 border-b border-indigo-100 space-y-3">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder={productDescription || "Опишите тему для связанных текстов..."}
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleGroupGenerate()}
                            className="flex-1 h-9 px-3 rounded-[var(--radius-md)] border border-indigo-200/60 bg-white/80 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-text-tertiary"
                        />
                        <Button
                            variant="ai"
                            size="sm"
                            icon={isGenerating ? <div className="animate-spin text-white text-xs">⟳</div> : <Sparkles size={14} />}
                            onClick={handleGroupGenerate}
                            disabled={isGenerating}
                            className="h-9 px-3 shrink-0"
                        >
                            {isGenerating ? "..." : "Связка"}
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
                                        ? "bg-indigo-500 text-white border-indigo-500"
                                        : "bg-white/60 text-indigo-600 border-indigo-200 hover:bg-indigo-100/50"
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
                                <span className="text-[11px] font-medium text-indigo-600">
                                    Наборы ({activeSetIdx + 1}/{generatedSets.length})
                                </span>
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => handleSelectSet(Math.max(0, activeSetIdx - 1))}
                                        disabled={activeSetIdx === 0}
                                        className="w-6 h-6 flex items-center justify-center rounded-full border border-indigo-200 text-indigo-500 hover:bg-indigo-100 disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors"
                                    >
                                        <ChevronLeft size={14} />
                                    </button>
                                    <button
                                        onClick={() => handleSelectSet(Math.min(generatedSets.length - 1, activeSetIdx + 1))}
                                        disabled={activeSetIdx === generatedSets.length - 1}
                                        className="w-6 h-6 flex items-center justify-center rounded-full border border-indigo-200 text-indigo-500 hover:bg-indigo-100 disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors"
                                    >
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
                                                ? "bg-white border-indigo-400 text-text-primary shadow-sm ring-1 ring-indigo-200"
                                                : "bg-white/50 border-indigo-100 text-text-secondary hover:bg-white/80 hover:border-indigo-200"
                                        }`}
                                    >
                                        <div className="space-y-1">
                                            {activeSetIdx === i && (
                                                <Check size={12} className="text-indigo-500 mb-1" />
                                            )}
                                            {members.map(mc => (
                                                <p key={mc.id} className="truncate">
                                                    <span className="font-medium text-indigo-500">{mc.name}:</span>{" "}
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
                        key={mc.id}
                        id={mc.id}
                        name={mc.name}
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
