"use client";

import { useState, useRef, useCallback } from "react";
import {
    X,
    Eraser,
    Paintbrush,
    Type,
    Undo2,
    Download,
    Check,
    Loader2,
    ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { BusinessUnit } from "@/types";

type EditorTool = "remove-bg" | "inpaint" | "text-edit";

interface ImageEditorModalProps {
    imageSrc: string;
    onApply: (editedImageSrc: string) => void;
    onClose: () => void;
    businessUnit?: BusinessUnit;
}

export function ImageEditorModal({ imageSrc, onApply, onClose, businessUnit }: ImageEditorModalProps) {
    const [currentImage, setCurrentImage] = useState(imageSrc);
    const [history, setHistory] = useState<string[]>([imageSrc]);
    const [historyIdx, setHistoryIdx] = useState(0);
    const [activeTool, setActiveTool] = useState<EditorTool | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [editPrompt, setEditPrompt] = useState("");

    // Inpaint mask state
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [brushSize, setBrushSize] = useState(20);
    const [maskDrawn, setMaskDrawn] = useState(false);

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

    // ─── API Calls ──────────────────────────────────────────

    const callImageEdit = async (action: string, prompt?: string, maskB64?: string) => {
        setIsProcessing(true);
        try {
            const response = await fetch("/api/ai/image-edit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action,
                    prompt: prompt || "",
                    imageBase64: currentImage,
                    maskBase64: maskB64 || undefined,
                }),
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            if (data.content) {
                pushHistory(data.content);
            }
        } catch (e: unknown) {
            const error = e as Error;
            console.error(`Image edit (${action}) failed:`, error);
            alert(`Ошибка: ${error.message || "Не удалось обработать изображение"}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRemoveBg = () => callImageEdit("remove-bg");

    const handleTextEdit = () => {
        if (!editPrompt.trim()) return;
        callImageEdit("text-edit", editPrompt);
    };

    const handleInpaint = () => {
        if (!editPrompt.trim()) return;
        // Get mask from canvas
        const canvas = canvasRef.current;
        if (canvas) {
            const maskB64 = canvas.toDataURL("image/png");
            callImageEdit("inpaint", editPrompt, maskB64);
        } else {
            callImageEdit("inpaint", editPrompt);
        }
    };

    // ─── Canvas Drawing for Inpaint Mask ─────────────────

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
        ctx.beginPath();
        ctx.arc(x, y, brushSize, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 0, 0, 0.4)";
        ctx.fill();
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
        ctx.beginPath();
        ctx.arc(x, y, brushSize, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 0, 0, 0.4)";
        ctx.fill();
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
        {
            id: "remove-bg",
            label: "Удалить фон",
            icon: <Eraser size={18} />,
            description: "Автоматически удалить фон изображения",
        },
        {
            id: "inpaint",
            label: "Inpaint",
            icon: <Paintbrush size={18} />,
            description: "Выделите область кистью и опишите замену",
        },
        {
            id: "text-edit",
            label: "Редактировать",
            icon: <Type size={18} />,
            description: "Опишите текстом как изменить изображение",
        },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-bg-primary rounded-2xl shadow-2xl border border-border-primary w-[920px] max-w-[95vw] max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border-primary">
                    <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                        <ImageIcon size={20} className="text-purple-500" />
                        AI-редактор изображения
                    </h2>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            icon={<Undo2 size={16} />}
                            onClick={handleUndo}
                            disabled={historyIdx === 0 || isProcessing}
                            className="text-xs"
                        >
                            Отменить
                        </Button>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-secondary text-text-secondary transition-colors cursor-pointer"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex flex-1 overflow-hidden">
                    {/* Image Preview */}
                    <div className="flex-1 flex items-center justify-center p-6 bg-[repeating-conic-gradient(#e5e7eb_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] relative">
                        <div className="relative max-w-full max-h-[60vh]">
                            <img
                                src={currentImage}
                                alt="Editing"
                                className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-lg"
                            />
                            {/* Inpaint mask overlay */}
                            {activeTool === "inpaint" && (
                                <canvas
                                    ref={canvasRef}
                                    width={800}
                                    height={600}
                                    className="absolute inset-0 w-full h-full cursor-crosshair"
                                    onMouseDown={startDraw}
                                    onMouseMove={draw}
                                    onMouseUp={endDraw}
                                    onMouseLeave={endDraw}
                                />
                            )}
                        </div>
                        {/* Processing overlay */}
                        {isProcessing && (
                            <div className="absolute inset-0 bg-black/30 flex items-center justify-center rounded-lg">
                                <div className="bg-white/90 backdrop-blur-sm rounded-xl p-6 flex flex-col items-center gap-3">
                                    <Loader2 size={32} className="animate-spin text-purple-500" />
                                    <p className="text-sm font-medium text-text-primary">Обрабатываю...</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Toolbox Sidebar */}
                    <div className="w-72 border-l border-border-primary bg-bg-surface flex flex-col">
                        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
                            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Инструменты</p>
                            {tools.map((tool) => (
                                <button
                                    key={tool.id}
                                    onClick={() => {
                                        setActiveTool(activeTool === tool.id ? null : tool.id);
                                        setEditPrompt("");
                                        clearMask();
                                    }}
                                    disabled={isProcessing}
                                    className={`w-full text-left p-3 rounded-[var(--radius-md)] border transition-all cursor-pointer ${
                                        activeTool === tool.id
                                            ? "bg-purple-50 border-purple-300 shadow-sm"
                                            : "bg-bg-primary border-border-primary hover:border-border-secondary hover:bg-bg-secondary"
                                    }`}
                                >
                                    <div className="flex items-center gap-2.5">
                                        <span className={activeTool === tool.id ? "text-purple-500" : "text-text-secondary"}>
                                            {tool.icon}
                                        </span>
                                        <div>
                                            <p className={`text-sm font-medium ${activeTool === tool.id ? "text-purple-700" : "text-text-primary"}`}>
                                                {tool.label}
                                            </p>
                                            <p className="text-[11px] text-text-tertiary mt-0.5">
                                                {tool.description}
                                            </p>
                                        </div>
                                    </div>
                                </button>
                            ))}

                            {/* Tool-specific UI */}
                            {activeTool === "remove-bg" && (
                                <div className="pt-3 border-t border-border-secondary">
                                    <Button
                                        variant="ai"
                                        className="w-full"
                                        icon={isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Eraser size={16} />}
                                        onClick={handleRemoveBg}
                                        disabled={isProcessing}
                                    >
                                        {isProcessing ? "Удаляю фон..." : "Удалить фон"}
                                    </Button>
                                </div>
                            )}

                            {activeTool === "inpaint" && (
                                <div className="pt-3 border-t border-border-secondary space-y-3">
                                    <div>
                                        <label className="text-[11px] font-medium text-text-secondary">
                                            Размер кисти: {brushSize}px
                                        </label>
                                        <input
                                            type="range"
                                            min={5}
                                            max={60}
                                            value={brushSize}
                                            onChange={(e) => setBrushSize(Number(e.target.value))}
                                            className="w-full mt-1"
                                        />
                                    </div>
                                    {maskDrawn && (
                                        <button
                                            onClick={clearMask}
                                            className="text-[11px] text-purple-500 hover:text-purple-700 cursor-pointer"
                                        >
                                            Очистить маску
                                        </button>
                                    )}
                                    <textarea
                                        placeholder="Что нарисовать в выделенной области?"
                                        value={editPrompt}
                                        onChange={(e) => setEditPrompt(e.target.value)}
                                        className="w-full h-20 px-3 py-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-purple-300 resize-none placeholder:text-text-tertiary"
                                    />
                                    <Button
                                        variant="ai"
                                        className="w-full"
                                        icon={isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Paintbrush size={16} />}
                                        onClick={handleInpaint}
                                        disabled={isProcessing || !editPrompt.trim()}
                                    >
                                        {isProcessing ? "Рисую..." : "Применить Inpaint"}
                                    </Button>
                                </div>
                            )}

                            {activeTool === "text-edit" && (
                                <div className="pt-3 border-t border-border-secondary space-y-3">
                                    <textarea
                                        placeholder="Опишите изменения, например: «Сделай фон синим» или «Добавь тень»"
                                        value={editPrompt}
                                        onChange={(e) => setEditPrompt(e.target.value)}
                                        className="w-full h-20 px-3 py-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-purple-300 resize-none placeholder:text-text-tertiary"
                                    />
                                    <Button
                                        variant="ai"
                                        className="w-full"
                                        icon={isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Type size={16} />}
                                        onClick={handleTextEdit}
                                        disabled={isProcessing || !editPrompt.trim()}
                                    >
                                        {isProcessing ? "Редактирую..." : "Применить изменения"}
                                    </Button>
                                </div>
                            )}
                        </div>

                        {/* Footer actions */}
                        <div className="p-4 border-t border-border-primary space-y-2">
                            <Button
                                variant="primary"
                                className="w-full"
                                icon={<Check size={16} />}
                                onClick={() => onApply(currentImage)}
                                disabled={isProcessing}
                            >
                                Применить
                            </Button>
                            <Button
                                variant="secondary"
                                className="w-full"
                                onClick={onClose}
                            >
                                Отмена
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
