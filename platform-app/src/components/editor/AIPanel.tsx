"use client";

import { useState, useRef, useEffect } from "react";
import {
    Sparkles,
    Type,
    ImageIcon,
    Send,
    Loader2,
    Copy,
    Check,
    Trash2,
    X,
} from "lucide-react";
import { useAIStore } from "@/store/aiStore";
import { useCanvasStore } from "@/store/canvasStore";
import type { AIResult } from "@/services/aiService";

export function AIPanel({ onClose }: { onClose: () => void }) {
    const {
        isGenerating,
        generationHistory,
        error,
        activeTab,
        setActiveTab,
        generateText,
        generateImage,
        clearHistory,
        clearError,
    } = useAIStore();

    const { addTextLayer, addImageLayer } = useCanvasStore();

    const [prompt, setPrompt] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        textareaRef.current?.focus();
    }, [activeTab]);

    const handleGenerate = async () => {
        if (!prompt.trim() || isGenerating) return;
        if (activeTab === "text") {
            await generateText(prompt.trim());
        } else {
            await generateImage(prompt.trim());
        }
        setPrompt("");
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleGenerate();
        }
    };

    const handleApplyResult = (result: AIResult) => {
        if (result.type === "text") {
            addTextLayer({ text: result.content });
        } else if (result.type === "image") {
            addImageLayer(result.content, 400, 400);
        }
    };

    return (
        <div className="w-[320px] min-w-[320px] h-full border border-border-primary rounded-[var(--radius-2xl)] shadow-[var(--shadow-md)] flex flex-col overflow-hidden backdrop-blur-xl bg-bg-surface/85">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-accent-primary" />
                    <h3 className="text-[11px] font-medium text-text-tertiary uppercase tracking-widest">
                        AI Генерация
                    </h3>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded-[var(--radius-sm)] hover:bg-bg-secondary text-text-tertiary hover:text-text-primary cursor-pointer transition-colors"
                >
                    <X size={14} />
                </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border-primary">
                <button
                    onClick={() => setActiveTab("text")}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-colors cursor-pointer ${activeTab === "text"
                        ? "text-accent-primary border-b-2 border-accent-primary"
                        : "text-text-tertiary hover:text-text-primary"
                        }`}
                >
                    <Type size={13} />
                    Текст
                </button>
                <button
                    onClick={() => setActiveTab("image")}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-colors cursor-pointer ${activeTab === "image"
                        ? "text-accent-primary border-b-2 border-accent-primary"
                        : "text-text-tertiary hover:text-text-primary"
                        }`}
                >
                    <ImageIcon size={13} />
                    Изображение
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className="mx-3 mt-2 p-2.5 rounded-[var(--radius-md)] bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-[11px] text-red-600 dark:text-red-400 flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={clearError} className="ml-2 hover:text-red-800 cursor-pointer">
                        <X size={12} />
                    </button>
                </div>
            )}

            {/* Results / History */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
                {generationHistory.length === 0 && !isGenerating && (
                    <div className="flex flex-col items-center justify-center h-full text-center py-12">
                        <Sparkles size={24} className="text-text-tertiary/30 mb-3" />
                        <p className="text-[11px] text-text-tertiary">
                            {activeTab === "text"
                                ? "Введите промпт, чтобы сгенерировать текст"
                                : "Введите промпт, чтобы сгенерировать изображение"}
                        </p>
                        <p className="text-[10px] text-text-tertiary/60 mt-1">
                            Используются mock-провайдеры для демо
                        </p>
                    </div>
                )}

                {isGenerating && (
                    <div className="flex items-center gap-2 p-3 rounded-[var(--radius-lg)] bg-bg-secondary border border-border-primary animate-pulse">
                        <Loader2 size={14} className="text-accent-primary animate-spin" />
                        <span className="text-[11px] text-text-secondary">
                            {activeTab === "text" ? "Генерация текста..." : "Генерация изображения..."}
                        </span>
                    </div>
                )}

                {generationHistory.map((result, idx) => (
                    <ResultCard
                        key={`${result.timestamp.getTime()}-${idx}`}
                        result={result}
                        onApply={() => handleApplyResult(result)}
                    />
                ))}
            </div>

            {/* Prompt input — anchored at bottom */}
            <div className="p-3 border-t border-border-primary">
                <div className="relative">
                    <textarea
                        ref={textareaRef}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={
                            activeTab === "text"
                                ? "Напишите промо-текст для баннера..."
                                : "Сгенерируйте фон для промо-баннера..."
                        }
                        className="w-full min-h-[80px] max-h-[160px] px-3 py-2.5 pr-10 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary text-[12px] text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary/50"
                    />
                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating || !prompt.trim()}
                        className="absolute right-2 bottom-2 p-1.5 rounded-[var(--radius-md)] bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                    >
                        {isGenerating ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <Send size={14} />
                        )}
                    </button>
                </div>
            </div>

            {/* Footer */}
            {generationHistory.length > 0 && (
                <div className="px-3 py-2 border-t border-border-primary">
                    <button
                        onClick={clearHistory}
                        className="flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-primary cursor-pointer transition-colors"
                    >
                        <Trash2 size={10} />
                        Очистить историю
                    </button>
                </div>
            )}
        </div>
    );
}

/* ─── Result card ─────────────────────────────────────── */

function ResultCard({
    result,
    onApply,
}: {
    result: AIResult;
    onApply: () => void;
}) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(result.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary overflow-hidden">
            {result.type === "image" && (
                <div className="aspect-square bg-bg-tertiary">
                    <img
                        src={result.content}
                        alt={result.prompt}
                        className="w-full h-full object-cover"
                    />
                </div>
            )}
            {result.type === "text" && (
                <div className="p-3">
                    <p className="text-[12px] text-text-primary leading-relaxed">{result.content}</p>
                </div>
            )}
            <div className="flex items-center justify-between px-3 py-2 border-t border-border-primary">
                <span className="text-[9px] text-text-tertiary">
                    {result.model} · {result.timestamp.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <div className="flex items-center gap-1">
                    {result.type === "text" && (
                        <button
                            onClick={handleCopy}
                            className="p-1 rounded hover:bg-bg-tertiary cursor-pointer text-text-tertiary hover:text-text-primary transition-colors"
                            title="Копировать"
                        >
                            {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                        </button>
                    )}
                    <button
                        onClick={onApply}
                        className="text-[10px] px-2 py-0.5 rounded-[var(--radius-sm)] bg-accent-primary text-white hover:bg-accent-primary/90 cursor-pointer transition-colors"
                    >
                        Применить
                    </button>
                </div>
            </div>
        </div>
    );
}
