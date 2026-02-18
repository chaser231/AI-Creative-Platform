"use client";

import { useCanvasStore } from "@/store/canvasStore";
import { Button } from "@/components/ui/Button";
import { Copy, Plus, X } from "lucide-react";

export interface AIChatMessage {
    id: string;
    role: "user" | "assistant";
    type: "text" | "image" | "outpaint";
    content: string;
    prompt?: string;
    timestamp: number;
}

interface AIChatPanelProps {
    open: boolean;
    onClose: () => void;
    messages: AIChatMessage[];
}

export function AIChatPanel({ open, onClose, messages }: AIChatPanelProps) {
    const { addTextLayer, addImageLayer } = useCanvasStore();

    const handleAddToCanvas = (msg: AIChatMessage) => {
        if (msg.type === "text") {
            addTextLayer({
                text: msg.content,
                fontSize: 40,
                x: 100,
                y: 100,
                width: 600,
            });
        } else {
            // Image
            addImageLayer(msg.content, 500, 500);
        }
    };

    if (!open) return null;

    return (
        <div className="absolute top-3 bottom-16 right-3 w-[320px] bg-bg-surface border border-border-primary rounded-[var(--radius-xl)] shadow-xl z-40 flex flex-col overflow-hidden animate-in slide-in-from-right-4 duration-300">
            {/* Header */}
            <div className="p-4 border-b border-border-primary flex justify-between items-center bg-bg-secondary/50">
                <h3 className="text-sm font-semibold text-text-primary">История генераций</h3>
                <button onClick={onClose} className="text-text-tertiary hover:text-text-primary p-1 rounded-md hover:bg-bg-tertiary">
                    <X size={16} />
                </button>
            </div>

            {/* Messages List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center text-text-tertiary pb-10">
                        <div className="w-12 h-12 rounded-full bg-bg-secondary flex items-center justify-center mb-3">
                            <span className="text-2xl">✨</span>
                        </div>
                        <p className="text-sm">Пока нет истории</p>
                        <p className="text-xs mt-1">Сгенерируйте что-нибудь в панели внизу</p>
                    </div>
                ) : (
                    messages.map((msg) => (
                        <div key={msg.id} className="flex flex-col gap-2">
                            {/* Prompt (User) */}
                            {msg.role === "user" && (
                                <div className="self-end max-w-[85%] bg-bg-secondary text-text-primary text-xs px-3 py-2 rounded-2xl rounded-tr-sm border border-border-primary">
                                    {msg.content}
                                </div>
                            )}

                            {/* Result (Assistant) */}
                            {msg.role === "assistant" && (
                                <div className="self-start max-w-[100%] flex flex-col gap-2">
                                    <div className="bg-gradient-card-blue p-3 rounded-2xl rounded-tl-sm border border-blue-100">
                                        {msg.type === "text" ? (
                                            <p className="text-sm text-text-primary whitespace-pre-wrap">{msg.content}</p>
                                        ) : (
                                            <div className="rounded-lg overflow-hidden border border-black/5">
                                                <img src={msg.content} alt="Generated" className="w-full h-auto" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Actions for result */}
                                    <div className="flex gap-2 pl-1">
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            className="h-7 text-[10px] px-2"
                                            onClick={() => handleAddToCanvas(msg)}
                                            icon={<Plus size={12} />}
                                        >
                                            На холст
                                        </Button>
                                        <button
                                            className="p-1.5 text-text-tertiary hover:text-text-primary bg-bg-secondary hover:bg-bg-tertiary rounded-md transition-colors"
                                            onClick={() => navigator.clipboard.writeText(msg.content)}
                                            title="Копировать"
                                        >
                                            <Copy size={12} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
