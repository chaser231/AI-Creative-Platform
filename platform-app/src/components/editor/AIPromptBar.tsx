import { useState, useRef, useEffect } from "react";
import { Sparkles, Wand2, Image as ImageIcon, Send, MessageCircle, Settings2, Ratio, Type, Grip, CheckCircle2, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useCanvasStore } from "@/store/canvasStore";
import { RemoteTextProvider, RemoteImageProvider } from "@/services/aiService";

// Helper models lists
const TEXT_MODELS = [
    { id: "openai", name: "GPT-4o" },
    { id: "alice", name: "Yandex Alice" },
];

const IMAGE_MODELS = [
    { id: "dall-e-3", name: "DALL-E 3" },
    { id: "flux", name: "Flux 2.0" },
    { id: "seadream", name: "SeaDream 4.5" },
];

const OUTPAINT_MODELS = [
    { id: "flux-fill", name: "Flux Fill" },
];

const ASPECT_RATIOS = [
    { id: "1:1", label: "1:1", width: 1024, height: 1024 },
    { id: "16:9", label: "16:9", width: 1792, height: 1024 },
    { id: "9:16", label: "9:16", width: 1024, height: 1792 },
    { id: "4:3", label: "4:3", width: 1152, height: 896 },
];

interface AIPromptBarProps {
    open: boolean;
    onClose: () => void;
    onToggleChat: () => void;
    isChatOpen: boolean;
    onResult: (result: { type: string; content: string; prompt: string }) => void;
}

export function AIPromptBar({ open, onClose, onToggleChat, isChatOpen, onResult }: AIPromptBarProps) {
    const { addTextLayer, addImageLayer, selectedLayerIds, updateLayer } = useCanvasStore();
    const [activeTab, setActiveTab] = useState<"text" | "image" | "outpaint">("text");
    const [prompt, setPrompt] = useState("");
    const [selectedModel, setSelectedModel] = useState(TEXT_MODELS[0].id);
    const [aspectRatio, setAspectRatio] = useState(ASPECT_RATIOS[0]);
    const [applyToSelection, setApplyToSelection] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 180) + "px";
        }
    }, [prompt, activeTab]);

    // Reset model on tab change
    const handleTabChange = (tab: "text" | "image" | "outpaint") => {
        setActiveTab(tab);
        const models = tab === "text" ? TEXT_MODELS : tab === "image" ? IMAGE_MODELS : OUTPAINT_MODELS;
        setSelectedModel(models[0].id);
    };

    const handleGenerate = async () => {
        if (!prompt) return;
        setIsGenerating(true);

        try {
            let res;
            if (activeTab === "text") {
                res = await RemoteTextProvider.generate(prompt, { model: selectedModel });
            } else {
                res = await RemoteImageProvider.generate(prompt, {
                    model: selectedModel,
                    width: aspectRatio.width,
                    height: aspectRatio.height
                });
            }

            // AUTO-ADD to Canvas Logic
            if (applyToSelection && selectedLayerIds.length > 0) {
                // Update existing layer if checkbox is checked
                const layerId = selectedLayerIds[0]; // Naive: take first
                if (activeTab === "text") {
                    updateLayer(layerId, { text: res.content });
                } else {
                    // For image, we can only update source if it's an image layer or update fill of rect
                    // This logic depends on layer type, simplified here:
                    updateLayer(layerId, { src: res.content } as any);
                }
            } else {
                // Creates NEW layer
                if (activeTab === "text") {
                    addTextLayer({
                        text: res.content,
                        fontSize: 40,
                        x: 100,
                        y: 100,
                        width: 600,
                    });
                } else {
                    addImageLayer(res.content, aspectRatio.width / 2, aspectRatio.height / 2); // Divide by 2 to fit screen better
                }
            }

            // Pass result up to chat history
            onResult({
                type: activeTab,
                content: res.content,
                prompt: prompt
            });
            setPrompt(""); // Clear prompt after success
        } catch (err: any) {
            console.error("AI Generation Error", err);
            alert("Error: " + err.message);
        } finally {
            setIsGenerating(false);
        }
    };

    if (!open) return null;

    const currentModels = activeTab === "text" ? TEXT_MODELS :
        activeTab === "image" ? IMAGE_MODELS : OUTPAINT_MODELS;

    const hasSelection = selectedLayerIds.length > 0;

    return (
        <div className="relative flex bg-bg-surface/95 backdrop-blur-xl border border-border-primary rounded-[24px] shadow-2xl w-[720px] max-w-[95vw] overflow-hidden animate-in slide-in-from-bottom-6 duration-300">
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
                    onClick={() => handleTabChange("outpaint")}
                    className={`nav-button p-2.5 rounded-xl transition-all ${activeTab === "outpaint" ? "bg-bg-surface text-purple-500 shadow-sm" : "text-text-tertiary hover:text-text-primary"}`}
                    title="Magic Edit"
                >
                    <Wand2 size={20} strokeWidth={activeTab === "outpaint" ? 2.5 : 2} />
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

                {/* PROMPT INPUT */}
                <div className="flex-1 px-4 py-2">
                    <textarea
                        ref={textareaRef}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder={activeTab === "text" ? "Например: Заголовок для распродажи кроссовок..." : "Например: Футуристичный город в неоновых тонах..."}
                        className="w-full h-full min-h-[80px] bg-transparent text-lg text-text-primary placeholder:text-text-tertiary/50 focus:outline-none resize-none leading-relaxed"
                        onKeyDown={(e) => {
                            e.stopPropagation(); // Stop event from bubble to canvas (prevents Panning)
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
                            onChange={(e) => setSelectedModel(e.target.value)}
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
                                value={aspectRatio.id}
                                onChange={(e) => setAspectRatio(ASPECT_RATIOS.find(r => r.id === e.target.value) || ASPECT_RATIOS[0])}
                                className="bg-transparent text-xs font-medium text-text-secondary focus:outline-none cursor-pointer hover:text-text-primary appearance-none min-w-[40px]"
                            >
                                {ASPECT_RATIOS.map(r => (
                                    <option key={r.id} value={r.id}>{r.label}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="flex-1" />

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
        </div>
    );
}
