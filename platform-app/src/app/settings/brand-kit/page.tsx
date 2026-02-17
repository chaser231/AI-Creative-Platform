"use client";

import { useState } from "react";
import { Plus, Trash2, Save, Palette, Type as TypeIcon, Volume2 } from "lucide-react";
import { useBrandKitStore } from "@/store/brandKitStore";
import { Button } from "@/components/ui/Button";
import { AppShell } from "@/components/layout/AppShell";

type BrandTab = "colors" | "typography" | "voice";

export default function BrandKitPage() {
    const {
        brandKit,
        addColor,
        updateColor,
        removeColor,
        addFont,
        updateFont,
        removeFont,
        setToneOfVoice,
    } = useBrandKitStore();

    const [activeTab, setActiveTab] = useState<BrandTab>("colors");
    const [newColorName, setNewColorName] = useState("");
    const [newColorHex, setNewColorHex] = useState("#000000");

    const tabs: { id: BrandTab; label: string; icon: React.ReactNode }[] = [
        { id: "colors", label: "Цвета", icon: <Palette size={14} /> },
        { id: "typography", label: "Типографика", icon: <TypeIcon size={14} /> },
        { id: "voice", label: "Тон коммуникации", icon: <Volume2 size={14} /> },
    ];

    return (
        <AppShell>
            <div className="flex-1 overflow-y-auto p-8">
                <div className="max-w-3xl mx-auto">
                    <h1 className="text-2xl font-bold text-text-primary mb-1">Бренд-кит</h1>
                    <p className="text-sm text-text-secondary mb-6">
                        Настройте айдентику бренда вашего воркспейса. Эти параметры учитываются при ИИ-генерации и ограничивают дизайн-систему.
                    </p>

                    {/* Tabs */}
                    <div className="flex items-center gap-1 bg-bg-secondary rounded-[var(--radius-md)] p-1 mb-6 w-fit">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`
                                    flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] text-xs font-medium
                                    transition-all cursor-pointer
                                    ${activeTab === tab.id
                                        ? "bg-bg-primary text-text-primary shadow-[var(--shadow-sm)]"
                                        : "text-text-secondary hover:text-text-primary"
                                    }
                                `}
                            >
                                {tab.icon}
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Colors */}
                    {activeTab === "colors" && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                {brandKit.colors.map((color) => (
                                    <div
                                        key={color.id}
                                        className="flex items-center gap-3 p-3 bg-bg-primary rounded-[var(--radius-md)] border border-border-primary group"
                                    >
                                        <input
                                            type="color"
                                            value={color.hex}
                                            onChange={(e) => updateColor(color.id, { hex: e.target.value })}
                                            className="w-10 h-10 rounded-[var(--radius-md)] border border-border-primary cursor-pointer shrink-0"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <input
                                                type="text"
                                                value={color.name}
                                                onChange={(e) => updateColor(color.id, { name: e.target.value })}
                                                className="block w-full text-sm font-medium text-text-primary bg-transparent border-none focus:outline-none"
                                            />
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-xs text-text-tertiary font-mono">{color.hex}</span>
                                                {color.usage && (
                                                    <span className="text-[10px] text-text-tertiary">· {color.usage}</span>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => removeColor(color.id)}
                                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-red-50 transition-opacity cursor-pointer"
                                        >
                                            <Trash2 size={13} className="text-text-tertiary hover:text-red-500" />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {/* Add new color */}
                            <div className="flex items-center gap-2 pt-2">
                                <input
                                    type="color"
                                    value={newColorHex}
                                    onChange={(e) => setNewColorHex(e.target.value)}
                                    className="w-8 h-8 rounded border border-border-primary cursor-pointer"
                                />
                                <input
                                    type="text"
                                    placeholder="Название цвета"
                                    value={newColorName}
                                    onChange={(e) => setNewColorName(e.target.value)}
                                    className="flex-1 h-8 px-3 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-sm focus:outline-none focus:ring-1 focus:ring-border-focus"
                                />
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    icon={<Plus size={14} />}
                                    disabled={!newColorName.trim()}
                                    onClick={() => {
                                        addColor({ name: newColorName.trim(), hex: newColorHex });
                                        setNewColorName("");
                                    }}
                                >
                                    Добавить
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Typography */}
                    {activeTab === "typography" && (
                        <div className="space-y-4">
                            {brandKit.fonts.map((font) => (
                                <div
                                    key={font.id}
                                    className="p-4 bg-bg-primary rounded-[var(--radius-md)] border border-border-primary"
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <input
                                            type="text"
                                            value={font.name}
                                            onChange={(e) => updateFont(font.id, { name: e.target.value })}
                                            className="text-sm font-semibold text-text-primary bg-transparent border-none focus:outline-none"
                                        />
                                        <button
                                            onClick={() => removeFont(font.id)}
                                            className="p-1.5 rounded hover:bg-red-50 cursor-pointer"
                                        >
                                            <Trash2 size={13} className="text-text-tertiary hover:text-red-500" />
                                        </button>
                                    </div>
                                    <div className="space-y-2">
                                        {font.weights.map((weight) => (
                                            <div
                                                key={weight}
                                                className="flex items-center gap-3"
                                            >
                                                <span
                                                    className="text-lg text-text-primary"
                                                    style={{ fontFamily: font.name, fontWeight: Number(weight) }}
                                                >
                                                    Aa Бб
                                                </span>
                                                <span className="text-xs text-text-tertiary">{weight}</span>
                                            </div>
                                        ))}
                                    </div>
                                    {font.usage && (
                                        <p className="text-xs text-text-tertiary mt-2">Usage: {font.usage}</p>
                                    )}
                                </div>
                            ))}
                            <Button
                                variant="secondary"
                                icon={<Plus size={14} />}
                                onClick={() => addFont({ name: "Новый шрифт", weights: ["400", "700"] })}
                            >
                                Добавить шрифт
                            </Button>
                        </div>
                    )}

                    {/* Tone of Voice */}
                    {activeTab === "voice" && (
                        <div className="space-y-4">
                            <div className="p-4 bg-bg-primary rounded-[var(--radius-md)] border border-border-primary">
                                <label className="block text-sm font-medium text-text-primary mb-2">
                                    Системный промпт для TOV
                                </label>
                                <p className="text-xs text-text-tertiary mb-3">
                                    Этот промпт автоматически добавляется во все ИИ-генерации текста. Опишите голос и тон вашего бренда.
                                </p>
                                <textarea
                                    value={brandKit.toneOfVoice}
                                    onChange={(e) => setToneOfVoice(e.target.value)}
                                    rows={6}
                                    className="w-full px-3 py-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-sm text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-border-focus"
                                />
                            </div>
                            <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-[var(--radius-md)] border border-purple-200">
                                <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-blue-500 flex items-center justify-center">
                                    <Volume2 size={14} className="text-white" />
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-purple-800">Превью ИИ-пайплайна</p>
                                    <p className="text-xs text-purple-600 mt-0.5">
                                        Когда ИИ-генерация текста активна, этот промпт будет добавлен к каждому запросу.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </AppShell>
    );
}
