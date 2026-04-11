"use client";

import { useState, useRef, useCallback } from "react";
import {
    X,
    Eraser,
    Paintbrush,
    Type,
    Undo2,
    Check,
    Loader2,
    ImageIcon,
    Expand,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { ReferenceImageInput } from "@/components/ui/ReferenceImageInput";
import { ImageStylePresetPicker } from "@/components/ui/StylePresetPicker";
import { getMaxRefs, resolveRefTags } from "@/lib/ai-models";
import { getImagePresetPromptSuffix } from "@/lib/stylePresets";
import { useStylePresets } from "@/hooks/useStylePresets";
import type { BusinessUnit } from "@/types";

type EditorTool = "remove-bg" | "inpaint" | "text-edit" | "outpaint";

// Outpaint target aspect ratios
const OUTPAINT_RATIOS = [
    { id: "16:9", label: "16:9" },
    { id: "9:16", label: "9:16" },
    { id: "4:3", label: "4:3" },
    { id: "3:4", label: "3:4" },
    { id: "1:1", label: "1:1" },
    { id: "21:9", label: "21:9" },
];

// ─── AI Models for Image Editing ──────────────────────────
// Only models with "edit" capability in MODEL_REGISTRY
const IMAGE_EDIT_MODELS: { id: string; label: string; caps: EditorTool[] }[] = [
    { id: "nano-banana-2", label: "Nano Banana 2", caps: ["remove-bg", "inpaint", "text-edit"] },
    { id: "nano-banana-pro", label: "Nano Banana Pro", caps: ["remove-bg", "inpaint", "text-edit"] },
    { id: "nano-banana", label: "Nano Banana", caps: ["remove-bg", "inpaint", "text-edit"] },
    { id: "flux-2-pro", label: "Flux 2 Pro", caps: ["remove-bg", "text-edit"] },
    { id: "seedream", label: "Seedream 4.5", caps: ["remove-bg", "text-edit"] },
    { id: "gpt-image", label: "GPT Image 1.5", caps: ["remove-bg", "text-edit"] },
    { id: "qwen-image-edit", label: "Qwen Image Edit", caps: ["remove-bg", "text-edit"] },
    { id: "flux-fill", label: "Flux Fill", caps: ["remove-bg", "inpaint"] },
    { id: "bria-expand", label: "Bria Expand", caps: ["outpaint"] },
];

interface ImageEditorModalProps {
    imageSrc: string;
    onApply: (editedImageSrc: string) => void;
    onClose: () => void;
    businessUnit?: BusinessUnit;
}

export function ImageEditorModal({ imageSrc, onApply, onClose }: ImageEditorModalProps) {
    const [currentImage, setCurrentImage] = useState(imageSrc);
    const [history, setHistory] = useState<string[]>([imageSrc]);
    const [historyIdx, setHistoryIdx] = useState(0);
    const [activeTool, setActiveTool] = useState<EditorTool | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [editPrompt, setEditPrompt] = useState("");
    const [selectedModel, setSelectedModel] = useState("nano-banana-2");

    // Inpaint mask state
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [brushSize, setBrushSize] = useState(20);
    const [maskDrawn, setMaskDrawn] = useState(false);
    
    // Outpaint state
    const [outpaintRatio, setOutpaintRatio] = useState("16:9");
    const [outpaintMode, setOutpaintMode] = useState<"ratio" | "padding">("ratio");
    const [outpaintPadding, setOutpaintPadding] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const [editStyleId, setEditStyleId] = useState("none");
    // Workspace-aware presets
    const { imagePresets } = useStylePresets();

    const parseAiError = (e: Error) => {
        const msg = String(e.message || "");
        if (msg.includes("E003") || msg.includes("high demand") || msg.includes("fetch failed")) {
            return "Слишком много запросов к модели. Пожалуйста, подождите 10-15 секунд и попробуйте снова, либо выберите другую модель.";
        }
        if (msg.includes("prompt is required")) {
            return "Для этой функции необходимо ввести текстовый запрос (prompt).";
        }
        return `Ошибка обработки: ${msg}`;
    };

    const currentModelCaps = IMAGE_EDIT_MODELS.find(m => m.id === selectedModel)?.caps || [];

    const pushHistory = useCallback((newSrc: string) => {
        const newHistory = [...history.slice(0, historyIdx + 1), newSrc];
        setHistory(newHistory);
        setHistoryIdx(newHistory.length - 1);
        setCurrentImage(newSrc);
    }, [history, historyIdx]);

    const handleUndo = () => {
        if (historyIdx > 0) {
            setHistoryIdx(historyIdx - 1);
            setCurrentImage(history[historyIdx - 1]);
        }
    };

    const callImageEdit = async (action: string, prompt?: string, maskB64?: string) => {
        setIsProcessing(true);
        setErrorMsg(null);
        try {
            const response = await fetch("/api/ai/image-edit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action,
                    prompt: resolveRefTags(prompt || "", selectedModel),
                    imageBase64: currentImage,
                    maskBase64: maskB64 || undefined,
                    model: selectedModel,
                    referenceImages: action === "text-edit" && referenceImages.length > 0
                        ? referenceImages
                        : undefined,
                }),
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            if (data.content) pushHistory(data.content);
        } catch (e: unknown) {
            const error = e as Error;
            console.error(`Image edit (${action}) failed:`, error);
            setErrorMsg(parseAiError(error));
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRemoveBg = () => callImageEdit("remove-bg");
    const handleTextEdit = () => {
        if (!editPrompt.trim()) return;
        const styleSuffix = getImagePresetPromptSuffix(editStyleId);
        const styledPrompt = styleSuffix ? `${editPrompt}. Style: ${styleSuffix}` : editPrompt;
        callImageEdit("text-edit", styledPrompt);
    };
    const handleInpaint = () => {
        if (!editPrompt.trim()) return;
        const canvas = canvasRef.current;
        const maskB64 = canvas ? canvas.toDataURL("image/png") : undefined;
        const styleSuffix = getImagePresetPromptSuffix(editStyleId);
        const styledPrompt = styleSuffix ? `${editPrompt}. Style: ${styleSuffix}` : editPrompt;
        callImageEdit("inpaint", styledPrompt, maskB64);
    };
    const handleOutpaint = async () => {
        setIsProcessing(true);
        setErrorMsg(null);
        try {
            if (outpaintMode === "padding") {
                const img = new Image();
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = currentImage;
                });
                
                const padT = outpaintPadding.top || 0;
                const padR = outpaintPadding.right || 0;
                const padB = outpaintPadding.bottom || 0;
                const padL = outpaintPadding.left || 0;
                
                if (padT === 0 && padR === 0 && padB === 0 && padL === 0) {
                    throw new Error("Укажите отступы для расширения изображения");
                }
                
                const newWidth = img.naturalWidth + padL + padR;
                const newHeight = img.naturalHeight + padT + padB;
                
                // 1. Create padded image
                const paddedCanvas = document.createElement("canvas");
                paddedCanvas.width = newWidth;
                paddedCanvas.height = newHeight;
                const ctx = paddedCanvas.getContext("2d");
                if (!ctx) throw new Error("Не удалось создать Canvas");
                
                // Leave background transparent, draw origin image
                ctx.drawImage(img, padL, padT);
                const paddedBase64 = paddedCanvas.toDataURL("image/png");
                
                // 2. Create inpaint mask (White = fill/outpaint, Black = preserve)
                const maskCanvas = document.createElement("canvas");
                maskCanvas.width = newWidth;
                maskCanvas.height = newHeight;
                const mCtx = maskCanvas.getContext("2d");
                if (!mCtx) throw new Error("Не удалось создать маску");
                
                mCtx.fillStyle = "#FFFFFF";
                mCtx.fillRect(0, 0, newWidth, newHeight);
                mCtx.fillStyle = "#000000";
                mCtx.fillRect(padL, padT, img.naturalWidth, img.naturalHeight);
                const maskBase64 = maskCanvas.toDataURL("image/png");

                const response = await fetch("/api/ai/image-edit", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "inpaint",
                        imageBase64: paddedBase64,
                        maskBase64: maskBase64,
                        model: "flux-fill",
                        prompt: editPrompt || "Fill seamlessly"
                    }),
                });
                const data = await response.json();
                if (data.error) throw new Error(data.error);
                if (data.content) {
                    pushHistory(data.content);
                }
                return;
            }

            // Normal format-based outpaint
            const response = await fetch("/api/ai/image-edit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "outpaint",
                    imageBase64: currentImage,
                    model: selectedModel,
                    aspectRatio: outpaintRatio,
                    prompt: editPrompt
                }),
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            if (data.content) pushHistory(data.content);
        } catch (e: unknown) {
            const error = e as Error;
            console.error("Outpaint failed:", error);
            setErrorMsg(parseAiError(error));
        } finally {
            setIsProcessing(false);
        }
    };

    // Canvas drawing
    const startDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (activeTool !== "inpaint") return;
        setIsDrawing(true);
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const rect = canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
        const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
        ctx.beginPath(); ctx.arc(x, y, brushSize, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(200, 230, 74, 0.4)"; ctx.fill();
        setMaskDrawn(true);
    };

    const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing || activeTool !== "inpaint") return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const rect = canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
        const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
        ctx.beginPath(); ctx.arc(x, y, brushSize, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(200, 230, 74, 0.4)"; ctx.fill();
        setMaskDrawn(true);
    };

    const endDraw = () => setIsDrawing(false);
    const clearMask = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setMaskDrawn(false);
    };

    const tools: { id: EditorTool; label: string; icon: React.ReactNode; description: string }[] = [
        { id: "remove-bg", label: "Удалить фон", icon: <Eraser size={18} />, description: "Автоматически удалить фон" },
        { id: "inpaint", label: "Inpaint", icon: <Paintbrush size={18} />, description: "Кисть + промпт для замены области" },
        { id: "text-edit", label: "Редактировать", icon: <Type size={18} />, description: "Текстовое описание изменений" },
        { id: "outpaint", label: "Outpaint", icon: <Expand size={18} />, description: "Расширить изображение до нового формата" },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-bg-primary rounded-2xl shadow-[var(--shadow-xl)] border border-border-primary w-[960px] max-w-[95vw] max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border-primary">
                    <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                        <ImageIcon size={20} className="text-text-secondary" />
                        AI-редактор изображения
                    </h2>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" icon={<Undo2 size={16} />} onClick={handleUndo} disabled={historyIdx === 0 || isProcessing} className="text-xs">
                            Отменить
                        </Button>
                        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-secondary text-text-secondary transition-colors cursor-pointer">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex flex-1 overflow-hidden">
                    {/* Image Preview */}
                    <div className="flex-1 flex items-center justify-center p-6 bg-bg-tertiary relative">
                        <div className="relative max-w-full max-h-[60vh]">
                            <img src={currentImage} alt="Editing" className="max-w-full max-h-[60vh] object-contain rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)]" />
                            {activeTool === "inpaint" && (
                                <canvas ref={canvasRef} width={800} height={600} className="absolute inset-0 w-full h-full cursor-crosshair" onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw} />
                            )}
                        </div>
                        {isProcessing && (
                            <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                                <div className="bg-bg-primary/90 backdrop-blur-sm rounded-[var(--radius-xl)] p-6 flex flex-col items-center gap-3 shadow-[var(--shadow-lg)]">
                                    <Loader2 size={32} className="animate-spin text-text-secondary" />
                                    <p className="text-sm font-medium text-text-primary">Обрабатываю...</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Toolbox Sidebar */}
                    <div className="w-72 border-l border-border-primary bg-bg-secondary flex flex-col">
                        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
                            {/* Model selector */}
                            <div>
                                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">Модель</p>
                                <Select
                                    size="sm"
                                    value={selectedModel}
                                    onChange={(val) => {
                                        setSelectedModel(val);
                                        setActiveTool(null);
                                    }}
                                    options={IMAGE_EDIT_MODELS.map(m => ({ value: m.id, label: m.label }))}
                                />
                            </div>

                            <div className="h-px bg-border-primary" />

                            <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">Инструменты</p>
                            {tools.filter(tool => currentModelCaps.includes(tool.id)).map((tool) => (
                                <button
                                    key={tool.id}
                                    onClick={() => { setActiveTool(activeTool === tool.id ? null : tool.id); setEditPrompt(""); clearMask(); }}
                                    disabled={isProcessing}
                                    className={`w-full text-left p-3 rounded-[var(--radius-md)] border transition-all cursor-pointer ${
                                        activeTool === tool.id
                                            ? "bg-accent-lime/20 border-accent-lime-hover shadow-[var(--shadow-sm)]"
                                            : "bg-bg-primary border-border-primary hover:bg-bg-tertiary"
                                    }`}
                                >
                                    <div className="flex items-center gap-2.5">
                                        <span className={activeTool === tool.id ? "text-text-primary" : "text-text-secondary"}>{tool.icon}</span>
                                        <div>
                                            <p className={`text-sm font-medium ${activeTool === tool.id ? "text-text-primary" : "text-text-primary"}`}>{tool.label}</p>
                                            <p className="text-[10px] text-text-tertiary mt-0.5">{tool.description}</p>
                                        </div>
                                    </div>
                                </button>
                            ))}

                            {/* Error Banner */}
                            {errorMsg && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-[var(--radius-sm)] p-3 mb-3 animate-in fade-in zoom-in-95">
                                    <p className="text-[11px] text-red-500 leading-relaxed font-medium">{errorMsg}</p>
                                </div>
                            )}

                            {/* Tool-specific UI */}
                            {activeTool === "remove-bg" && (
                                <div className="pt-3 border-t border-border-primary">
                                    <button
                                        onClick={handleRemoveBg}
                                        disabled={isProcessing}
                                        className="w-full h-10 flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent-lime text-accent-primary font-semibold text-sm hover:bg-accent-lime-hover disabled:opacity-50 transition-all cursor-pointer disabled:cursor-default"
                                    >
                                        {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Eraser size={16} />}
                                        {isProcessing ? "Удаляю фон..." : "Удалить фон"}
                                    </button>
                                </div>
                            )}

                            {activeTool === "inpaint" && (
                                <div className="pt-3 border-t border-border-primary space-y-3">
                                    <div>
                                        <label className="text-[10px] font-medium text-text-secondary">Кисть: {brushSize}px</label>
                                        <input type="range" min={5} max={60} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full mt-1" />
                                    </div>
                                    {maskDrawn && (
                                        <button onClick={clearMask} className="text-[11px] text-text-secondary hover:text-text-primary cursor-pointer">Очистить маску</button>
                                    )}
                                    <textarea
                                        placeholder="Что нарисовать в выделенной области?"
                                        value={editPrompt}
                                        onChange={(e) => setEditPrompt(e.target.value)}
                                        className="w-full h-20 px-3 py-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-primary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus resize-none placeholder:text-text-tertiary"
                                    />
                                    {/* Style Preset for inpaint */}
                                    <div>
                                        <p className="text-[10px] font-medium text-text-secondary mb-1.5">Стиль</p>
                                        <ImageStylePresetPicker
                                            presets={imagePresets}
                                            selectedId={editStyleId}
                                            onChange={setEditStyleId}
                                            variant="inline"
                                        />
                                    </div>
                                    <button
                                        onClick={handleInpaint}
                                        disabled={isProcessing || !editPrompt.trim()}
                                        className="w-full h-10 flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent-lime text-accent-primary font-semibold text-sm hover:bg-accent-lime-hover disabled:opacity-50 transition-all cursor-pointer disabled:cursor-default"
                                    >
                                        {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Paintbrush size={16} />}
                                        {isProcessing ? "Рисую..." : "Применить Inpaint"}
                                    </button>
                                </div>
                            )}
                            
                            {errorMsg && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-[var(--radius-sm)] p-3 my-2 animate-in fade-in zoom-in-95">
                                    <p className="text-xs text-red-500 leading-relaxed font-medium">{errorMsg}</p>
                                </div>
                            )}

                            {activeTool === "text-edit" && (
                                <div className="pt-3 border-t border-border-primary space-y-3">
                                    <textarea
                                        placeholder="Опишите изменения: «Сделай фон синим», «Добавь тень»..."
                                        value={editPrompt}
                                        onChange={(e) => setEditPrompt(e.target.value)}
                                        className="w-full h-20 px-3 py-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-primary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus resize-none placeholder:text-text-tertiary"
                                    />
                                    <div>
                                        <p className="text-[10px] font-medium text-text-secondary mb-1.5">Референсное фото (опционально)</p>
                                        <ReferenceImageInput
                                            images={referenceImages}
                                            onChange={setReferenceImages}
                                            max={getMaxRefs(selectedModel)}
                                            label="Добавить референс"
                                        />
                                    </div>
                                    {/* Style Preset for text-edit */}
                                    <div>
                                        <p className="text-[10px] font-medium text-text-secondary mb-1.5">Стиль</p>
                                        <ImageStylePresetPicker
                                            presets={imagePresets}
                                            selectedId={editStyleId}
                                            onChange={setEditStyleId}
                                            variant="inline"
                                        />
                                    </div>
                                    <button
                                        onClick={handleTextEdit}
                                        disabled={isProcessing || !editPrompt.trim()}
                                        className="w-full h-10 flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent-lime text-accent-primary font-semibold text-sm hover:bg-accent-lime-hover disabled:opacity-50 transition-all cursor-pointer disabled:cursor-default"
                                    >
                                        {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Type size={16} />}
                                        {isProcessing ? "Редактирую..." : "Применить"}
                                    </button>
                                </div>
                            )}

                            {activeTool === "outpaint" && (
                                <div className="pt-3 border-t border-border-primary space-y-3">
                                    <div className="flex bg-bg-primary rounded-[var(--radius-sm)] p-1 border border-border-primary">
                                        <button 
                                            onClick={() => setOutpaintMode("ratio")}
                                            className={`flex-1 py-1 text-[11px] font-medium rounded-[var(--radius-sm)] transition-all ${outpaintMode === "ratio" ? "bg-bg-tertiary text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"}`}
                                        >
                                            Формат
                                        </button>
                                        <button 
                                            onClick={() => setOutpaintMode("padding")}
                                            className={`flex-1 py-1 text-[11px] font-medium rounded-[var(--radius-sm)] transition-all ${outpaintMode === "padding" ? "bg-bg-tertiary text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"}`}
                                        >
                                            Пиксели
                                        </button>
                                    </div>

                                    {outpaintMode === "ratio" ? (
                                        <div>
                                            <p className="text-[10px] font-medium text-text-secondary mb-1">Целевой формат пропорций</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {OUTPAINT_RATIOS.map(r => (
                                                    <button
                                                        key={r.id}
                                                        onClick={() => setOutpaintRatio(r.id)}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                                                            outpaintRatio === r.id
                                                                ? "bg-accent-lime text-accent-primary"
                                                                : "bg-bg-primary border border-border-primary text-text-secondary hover:bg-bg-tertiary"
                                                        }`}
                                                    >
                                                        {r.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <p className="text-[10px] font-medium text-text-secondary mb-1">Добавить отступы (AI заполнит пустые зоны)</p>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="flex flex-col gap-1">
                                                    <label className="text-[9px] text-text-tertiary uppercase text-center">Сверху</label>
                                                    <input type="number" min="0" value={outpaintPadding.top} onChange={e => setOutpaintPadding(p => ({ ...p, top: parseInt(e.target.value) || 0 }))} className="bg-bg-primary border border-border-primary rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-border-focus" />
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <label className="text-[9px] text-text-tertiary uppercase text-center">Снизу</label>
                                                    <input type="number" min="0" value={outpaintPadding.bottom} onChange={e => setOutpaintPadding(p => ({ ...p, bottom: parseInt(e.target.value) || 0 }))} className="bg-bg-primary border border-border-primary rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-border-focus" />
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <label className="text-[9px] text-text-tertiary uppercase text-center">Слева</label>
                                                    <input type="number" min="0" value={outpaintPadding.left} onChange={e => setOutpaintPadding(p => ({ ...p, left: parseInt(e.target.value) || 0 }))} className="bg-bg-primary border border-border-primary rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-border-focus" />
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <label className="text-[9px] text-text-tertiary uppercase text-center">Справа</label>
                                                    <input type="number" min="0" value={outpaintPadding.right} onChange={e => setOutpaintPadding(p => ({ ...p, right: parseInt(e.target.value) || 0 }))} className="bg-bg-primary border border-border-primary rounded px-2 py-1 text-xs text-center focus:outline-none focus:border-border-focus" />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    
                                    <textarea
                                        placeholder="Описание расширенной области (опционально)..."
                                        value={editPrompt}
                                        onChange={(e) => setEditPrompt(e.target.value)}
                                        className="w-full h-16 px-3 py-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-primary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus resize-none placeholder:text-text-tertiary"
                                    />
                                    <button
                                        onClick={handleOutpaint}
                                        disabled={isProcessing || (outpaintMode === "padding" && Object.values(outpaintPadding).every(v => v === 0))}
                                        className="w-full h-10 flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent-lime text-accent-primary font-semibold text-sm hover:bg-accent-lime-hover disabled:opacity-50 transition-all cursor-pointer disabled:cursor-default"
                                    >
                                        {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Expand size={16} />}
                                        {isProcessing ? "Расширяю..." : (outpaintMode === "ratio" ? `Расширить до ${outpaintRatio}` : "Сгенерировать области")}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-border-primary space-y-2">
                            <button
                                onClick={() => onApply(currentImage)}
                                disabled={isProcessing}
                                className="w-full h-10 flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent-primary text-text-inverse font-semibold text-sm hover:bg-accent-primary-hover disabled:opacity-50 transition-all cursor-pointer disabled:cursor-default"
                            >
                                <Check size={16} />
                                Применить
                            </button>
                            <Button variant="secondary" className="w-full" onClick={onClose}>
                                Отмена
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
