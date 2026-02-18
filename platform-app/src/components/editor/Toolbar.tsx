"use client";

import {
    MousePointer2,
    Type,
    Square,
    SquareDashed,
    ImagePlus,
    Award,
    LayoutTemplate,
    Sparkles,
} from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import type { ToolType } from "@/types";
import { useRef, useState } from "react";

const TOOLS: { id: ToolType; icon: React.ReactNode; label: string }[] = [
    { id: "select", icon: <MousePointer2 size={18} />, label: "Выбор" },
    { id: "text", icon: <Type size={18} />, label: "Текст" },
    { id: "rectangle", icon: <Square size={18} />, label: "Прямоугольник" },
    { id: "frame", icon: <SquareDashed size={18} />, label: "Фрейм" },
    { id: "badge", icon: <Award size={18} />, label: "Бейдж" },
    { id: "image", icon: <ImagePlus size={18} />, label: "Изображение" },
];

interface ToolbarProps {
    onOpenTemplates?: () => void;
    onToggleAI?: () => void;
    aiActive?: boolean;
}

export function Toolbar({ onOpenTemplates, onToggleAI, aiActive }: ToolbarProps) {
    const {
        activeTool,
        setActiveTool,
        addTextLayer,
        addRectangleLayer,
        addImageLayer,
        addBadgeLayer,
        addFrameLayer,
    } = useCanvasStore();
    const fileRef = useRef<HTMLInputElement>(null);

    const handleToolClick = (toolId: ToolType) => {
        if (toolId === "image") {
            fileRef.current?.click();
            return;
        }
        if (toolId === "text") {
            addTextLayer();
            return;
        }
        if (toolId === "rectangle") {
            addRectangleLayer();
            return;
        }
        if (toolId === "badge") {
            addBadgeLayer();
            return;
        }
        if (toolId === "frame") {
            addFrameLayer();
            return;
        }
        setActiveTool(toolId);
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const img = new window.Image();
            img.onload = () => {
                const maxSize = 500;
                const scale = Math.min(
                    maxSize / img.width,
                    maxSize / img.height,
                    1
                );
                addImageLayer(
                    reader.result as string,
                    img.width * scale,
                    img.height * scale
                );
            };
            img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
        e.target.value = "";
    };

    return (
        <>
            <div className="flex items-center gap-1 border border-border-primary rounded-[var(--radius-2xl)] px-2.5 py-2 shadow-[var(--shadow-lg)] backdrop-blur-xl bg-bg-surface/85">
                {TOOLS.map((tool) => (
                    <button
                        key={tool.id}
                        onClick={() => handleToolClick(tool.id)}
                        title={tool.label}
                        className={`
                            p-2.5 rounded-[var(--radius-lg)] transition-all cursor-pointer
                            ${activeTool === tool.id
                                ? "bg-bg-tertiary text-text-primary shadow-[var(--shadow-sm)]"
                                : "text-text-secondary hover:bg-bg-tertiary/60 hover:text-text-primary"
                            }
                        `}
                    >
                        {tool.icon}
                    </button>
                ))}

                {/* Divider */}
                <div className="w-px h-6 bg-border-primary mx-1" />

                {onOpenTemplates && (
                    <button
                        onClick={onOpenTemplates}
                        title="Шаблоны"
                        className="p-2 text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded-[var(--radius-lg)] transition-colors"
                    >
                        <LayoutTemplate size={20} />
                    </button>
                )}

                {onToggleAI && (
                    <button
                        onClick={onToggleAI}
                        title="AI Ассистент"
                        className={`
                            p-2.5 rounded-[var(--radius-md)] transition-all cursor-pointer
                            ${aiActive
                                ? "bg-accent-primary/15 text-accent-primary shadow-[var(--shadow-sm)]"
                                : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary"
                            }
                        `}
                    >
                        <Sparkles size={18} />
                    </button>
                )}
            </div>

            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
            />
        </>
    );
}
