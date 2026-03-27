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
    Magnet,
} from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import type { ToolType } from "@/types";
import { useRef, useState } from "react";
import { Popover } from "@/components/ui/Popover";

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
        snapConfig,
        updateSnapConfig,
    } = useCanvasStore(useShallow((s) => ({
        activeTool: s.activeTool, setActiveTool: s.setActiveTool,
        addTextLayer: s.addTextLayer, addRectangleLayer: s.addRectangleLayer,
        addImageLayer: s.addImageLayer, addBadgeLayer: s.addBadgeLayer,
        addFrameLayer: s.addFrameLayer, snapConfig: s.snapConfig,
        updateSnapConfig: s.updateSnapConfig,
    })));
    const fileRef = useRef<HTMLInputElement>(null);
    const [showSnapConfig, setShowSnapConfig] = useState(false);

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

                {/* Snap Config */}
                <div className="relative">
                    <button
                        onClick={() => setShowSnapConfig(prev => !prev)}
                        title="Привязки (Snapping)"
                        className={`
                            p-2 rounded-[var(--radius-lg)] transition-all cursor-pointer
                            ${showSnapConfig || snapConfig.objectSnap || snapConfig.gridSnap
                                ? "bg-accent-primary/15 text-accent-primary"
                                : "text-text-secondary hover:bg-bg-tertiary/60 hover:text-text-primary"
                            }
                        `}
                    >
                        <Magnet size={18} />
                    </button>
                    <Popover isOpen={showSnapConfig} onClose={() => setShowSnapConfig(false)} position="top">
                        <div className="space-y-3 min-w-[180px]">
                            <p className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium">Привязки</p>
                            <SnapToggle label="К объектам" checked={snapConfig.objectSnap} onChange={(v) => updateSnapConfig({ objectSnap: v })} />
                            <SnapToggle label="К артборду" checked={snapConfig.artboardSnap} onChange={(v) => updateSnapConfig({ artboardSnap: v })} />
                            <SnapToggle label="К пикселям" checked={snapConfig.pixelSnap} onChange={(v) => updateSnapConfig({ pixelSnap: v })} />
                            <div className="w-full h-px bg-border-primary" />
                            <SnapToggle label="К сетке" checked={snapConfig.gridSnap} onChange={(v) => updateSnapConfig({ gridSnap: v })} />
                            {snapConfig.gridSnap && (
                                <div className="flex items-center gap-2 pl-5">
                                    <span className="text-[10px] text-text-tertiary">Шаг</span>
                                    <select
                                        value={snapConfig.gridSize}
                                        onChange={(e) => updateSnapConfig({ gridSize: Number(e.target.value) })}
                                        className="h-6 px-1.5 text-[10px] bg-bg-secondary border border-border-primary rounded-[var(--radius-sm)] text-text-primary cursor-pointer focus:outline-none"
                                    >
                                        <option value={1}>1 px</option>
                                        <option value={4}>4 px</option>
                                        <option value={8}>8 px</option>
                                        <option value={16}>16 px</option>
                                        <option value={32}>32 px</option>
                                    </select>
                                </div>
                            )}
                            <div className="w-full h-px bg-border-primary" />
                            <p className="text-[9px] text-text-quaternary">
                                Alt + Drag — расстояния
                            </p>
                        </div>
                    </Popover>
                </div>

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

/* ─── Snap toggle helper ─────────────────────────── */

function SnapToggle({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <label className="flex items-center gap-2 cursor-pointer group">
            <div
                className={`w-3.5 h-3.5 rounded-[var(--radius-sm)] border flex items-center justify-center transition-colors ${
                    checked
                        ? "bg-accent-primary border-accent-primary"
                        : "border-border-primary bg-bg-secondary group-hover:border-border-focus"
                }`}
            >
                {checked && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
            </div>
            <span className="text-[11px] text-text-primary">{label}</span>
            <input
                type="checkbox"
                className="hidden"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
            />
        </label>
    );
}
