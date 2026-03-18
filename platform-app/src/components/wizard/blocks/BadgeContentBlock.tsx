"use client";

import { useState, useMemo } from "react";
import { Tag, Save, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { BadgeComponentProps, BusinessUnit } from "@/types";
import { useBadgeStore, DEFAULT_BADGE_CONFIG, type BadgeConfig } from "@/store/badgeStore";

interface BadgeContentBlockProps {
    id: string;
    name: string;
    props: BadgeComponentProps;
    value: string;
    onChange: (value: string) => void;
    /** Extended callback for full badge config changes */
    onConfigChange?: (config: BadgeConfig) => void;
    businessUnit?: BusinessUnit;
}

const SHAPE_OPTIONS: { id: BadgeConfig["shape"]; label: string; preview: string }[] = [
    { id: "pill", label: "Капсула", preview: "⬮" },
    { id: "rectangle", label: "Прямоугольник", preview: "▬" },
    { id: "circle", label: "Круг", preview: "●" },
    { id: "star", label: "Звезда", preview: "★" },
    { id: "arrow", label: "Стрелка", preview: "➤" },
];

const COLOR_PALETTE = [
    "#7C3AED", "#EF4444", "#F59E0B", "#10B981", "#3B82F6",
    "#EC4899", "#14B8A6", "#F97316", "#6366F1", "#1F2937",
];

export function BadgeContentBlock({
    id,
    name,
    props,
    value,
    onChange,
    onConfigChange,
    businessUnit,
}: BadgeContentBlockProps) {
    const { templates, addTemplate, removeTemplate } = useBadgeStore();
    const [showConstructor, setShowConstructor] = useState(false);
    const [showSaved, setShowSaved] = useState(false);
    const [saveName, setSaveName] = useState("");
    const [showSaveForm, setShowSaveForm] = useState(false);
    const [config, setConfig] = useState<BadgeConfig>(() => ({
        ...DEFAULT_BADGE_CONFIG,
        label: value || props.label || "",
        fill: props.fill || DEFAULT_BADGE_CONFIG.fill,
        textColor: props.textColor || DEFAULT_BADGE_CONFIG.textColor,
        fontSize: props.fontSize || DEFAULT_BADGE_CONFIG.fontSize,
        shape: props.shape || DEFAULT_BADGE_CONFIG.shape,
    }));

    // BU-aware quick presets
    const presets = useMemo(() => {
        if (businessUnit === "yandex-market") return ["Скидка", "Акция", "Новинка", "Хит", "−20%"];
        if (businessUnit === "yandex-food") return ["Вкусно", "Быстро", "−20%", "Новое", "🔥 Хит"];
        return ["New", "Sale", "Special", "Hot", "−15%"];
    }, [businessUnit]);

    const updateConfig = (partial: Partial<BadgeConfig>) => {
        const next = { ...config, ...partial };
        setConfig(next);
        if (partial.label !== undefined) onChange(partial.label);
        onConfigChange?.(next);
    };

    const applyTemplate = (tpl: typeof templates[0]) => {
        setConfig({ ...tpl.config });
        onChange(tpl.config.label);
        onConfigChange?.(tpl.config);
    };

    const handleSave = () => {
        if (!saveName.trim()) return;
        addTemplate(saveName.trim(), config);
        setSaveName("");
        setShowSaveForm(false);
    };

    // Preview renderer
    const BadgePreview = ({ cfg, size = "normal" }: { cfg: BadgeConfig; size?: "normal" | "small" }) => {
        const isSmall = size === "small";
        const baseStyles: React.CSSProperties = {
            backgroundColor: cfg.fill,
            color: cfg.textColor,
            fontSize: isSmall ? 10 : cfg.fontSize,
            fontWeight: cfg.fontWeight as any,
            border: cfg.borderWidth > 0 ? `${cfg.borderWidth}px solid ${cfg.borderColor}` : "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: isSmall ? "2px 6px" : "4px 12px",
            lineHeight: 1.3,
        };

        switch (cfg.shape) {
            case "pill":
                return <span style={{ ...baseStyles, borderRadius: 999 }}>{cfg.label || "Badge"}</span>;
            case "rectangle":
                return <span style={{ ...baseStyles, borderRadius: 4 }}>{cfg.label || "Badge"}</span>;
            case "circle":
                return (
                    <span style={{
                        ...baseStyles,
                        borderRadius: "50%",
                        width: isSmall ? 28 : 40,
                        height: isSmall ? 28 : 40,
                        padding: 0,
                    }}>
                        {cfg.label || "B"}
                    </span>
                );
            case "star":
                return (
                    <span style={{ ...baseStyles, borderRadius: 4, position: "relative" }}>
                        ★ {cfg.label || "Badge"}
                    </span>
                );
            case "arrow":
                return (
                    <span style={{ ...baseStyles, borderRadius: "4px 16px 16px 4px" }}>
                        {cfg.label || "Badge"} →
                    </span>
                );
            default:
                return <span style={{ ...baseStyles, borderRadius: 999 }}>{cfg.label || "Badge"}</span>;
        }
    };

    return (
        <div className="p-4 bg-bg-primary border border-border-primary rounded-[var(--radius-lg)] shadow-sm">
            {/* Header */}
            <div className="flex justify-between items-center mb-2">
                <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Tag size={16} className="text-text-secondary" />
                    {name}
                </label>
                <Button
                    variant="ghost"
                    size="sm"
                    icon={showConstructor ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    onClick={() => setShowConstructor(!showConstructor)}
                    className="text-[11px] h-7 px-2 text-text-secondary hover:text-text-primary"
                >
                    Конструктор
                </Button>
            </div>

            {/* Quick text input */}
            <input
                type="text"
                placeholder={props.label || "Текст бейджа"}
                value={config.label}
                onChange={(e) => updateConfig({ label: e.target.value })}
                className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
            />

            {/* Quick presets */}
            <div className="flex gap-2 mt-2 flex-wrap">
                {presets.map(p => (
                    <button
                        key={p}
                        onClick={() => updateConfig({ label: p })}
                        className="px-2 py-1 text-[11px] font-medium bg-bg-secondary hover:bg-bg-surface border border-border-primary rounded-[var(--radius-sm)] text-text-secondary transition-colors cursor-pointer"
                    >
                        {p}
                    </button>
                ))}
            </div>

            {/* Preview */}
            <div className="mt-3 flex items-center justify-center p-3 bg-bg-secondary rounded-[var(--radius-md)] border border-border-secondary">
                <BadgePreview cfg={config} />
            </div>

            {/* Constructor Panel */}
            {showConstructor && (
                <div className="mt-3 p-3 bg-gradient-to-br from-amber-50/50 to-orange-50/30 border border-amber-100 rounded-[var(--radius-md)] space-y-4">
                    {/* Shape Selector */}
                    <div>
                        <p className="text-[11px] font-semibold text-text-secondary mb-2 uppercase tracking-wider">Форма</p>
                        <div className="flex gap-2">
                            {SHAPE_OPTIONS.map(shape => (
                                <button
                                    key={shape.id}
                                    onClick={() => updateConfig({ shape: shape.id })}
                                    className={`flex-1 p-2 rounded-[var(--radius-md)] border text-center transition-all cursor-pointer ${
                                        config.shape === shape.id
                                            ? "bg-white border-amber-400 shadow-sm ring-1 ring-amber-200"
                                            : "bg-white/50 border-amber-100 hover:bg-white/80 hover:border-amber-200"
                                    }`}
                                >
                                    <span className="text-lg block">{shape.preview}</span>
                                    <span className="text-[10px] text-text-tertiary">{shape.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Colors */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <p className="text-[11px] font-semibold text-text-secondary mb-2">Цвет фона</p>
                            <div className="flex gap-1.5 flex-wrap">
                                {COLOR_PALETTE.map(c => (
                                    <button
                                        key={c}
                                        onClick={() => updateConfig({ fill: c })}
                                        className={`w-6 h-6 rounded-full border-2 transition-all cursor-pointer ${
                                            config.fill === c ? "border-text-primary scale-110 shadow-md" : "border-transparent hover:scale-105"
                                        }`}
                                        style={{ backgroundColor: c }}
                                    />
                                ))}
                                <input
                                    type="color"
                                    value={config.fill}
                                    onChange={(e) => updateConfig({ fill: e.target.value })}
                                    className="w-6 h-6 rounded-full cursor-pointer border-0 p-0"
                                />
                            </div>
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold text-text-secondary mb-2">Цвет текста</p>
                            <div className="flex gap-1.5 flex-wrap">
                                {["#FFFFFF", "#000000", "#1F2937", "#F9FAFB"].map(c => (
                                    <button
                                        key={c}
                                        onClick={() => updateConfig({ textColor: c })}
                                        className={`w-6 h-6 rounded-full border-2 transition-all cursor-pointer ${
                                            config.textColor === c ? "border-amber-500 scale-110 shadow-md" : "border-border-primary hover:scale-105"
                                        }`}
                                        style={{ backgroundColor: c }}
                                    />
                                ))}
                                <input
                                    type="color"
                                    value={config.textColor}
                                    onChange={(e) => updateConfig({ textColor: e.target.value })}
                                    className="w-6 h-6 rounded-full cursor-pointer border-0 p-0"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Font size & weight */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <p className="text-[11px] font-semibold text-text-secondary mb-1">Размер: {config.fontSize}px</p>
                            <input
                                type="range"
                                min={8}
                                max={32}
                                value={config.fontSize}
                                onChange={(e) => updateConfig({ fontSize: Number(e.target.value) })}
                                className="w-full"
                            />
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold text-text-secondary mb-1">Жирность</p>
                            <div className="flex gap-1">
                                {["400", "500", "600", "700", "800"].map(w => (
                                    <button
                                        key={w}
                                        onClick={() => updateConfig({ fontWeight: w })}
                                        className={`flex-1 text-[10px] py-1 rounded border cursor-pointer transition-all ${
                                            config.fontWeight === w
                                                ? "bg-amber-500 text-white border-amber-500"
                                                : "bg-white/50 text-text-secondary border-amber-100 hover:bg-white"
                                        }`}
                                        style={{ fontWeight: Number(w) }}
                                    >
                                        {w}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Border */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <p className="text-[11px] font-semibold text-text-secondary mb-1">Обводка: {config.borderWidth}px</p>
                            <input
                                type="range"
                                min={0}
                                max={4}
                                value={config.borderWidth}
                                onChange={(e) => updateConfig({ borderWidth: Number(e.target.value) })}
                                className="w-full"
                            />
                        </div>
                        {config.borderWidth > 0 && (
                            <div>
                                <p className="text-[11px] font-semibold text-text-secondary mb-1">Цвет обводки</p>
                                <input
                                    type="color"
                                    value={config.borderColor === "transparent" ? "#000000" : config.borderColor}
                                    onChange={(e) => updateConfig({ borderColor: e.target.value })}
                                    className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                                />
                            </div>
                        )}
                    </div>

                    {/* Save as template */}
                    <div className="pt-3 border-t border-amber-100 space-y-2">
                        {!showSaveForm ? (
                            <div className="flex gap-2">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    icon={<Save size={14} />}
                                    onClick={() => setShowSaveForm(true)}
                                    className="text-xs"
                                >
                                    Сохранить как шаблон
                                </Button>
                                {templates.length > 0 && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setShowSaved(!showSaved)}
                                        className="text-xs text-amber-600"
                                    >
                                        Мои шаблоны ({templates.length})
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Название шаблона"
                                    value={saveName}
                                    onChange={(e) => setSaveName(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleSave()}
                                    className="flex-1 h-8 px-2 text-xs rounded border border-amber-200 bg-white/80 focus:outline-none focus:ring-1 focus:ring-amber-300"
                                />
                                <Button variant="primary" size="sm" onClick={handleSave} className="text-xs h-8">
                                    Сохранить
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setShowSaveForm(false)} className="text-xs h-8">
                                    ✕
                                </Button>
                            </div>
                        )}

                        {/* Saved templates gallery */}
                        {showSaved && templates.length > 0 && (
                            <div className="flex gap-2 flex-wrap mt-2">
                                {templates.map(tpl => (
                                    <div
                                        key={tpl.id}
                                        className="flex items-center gap-2 bg-white/70 border border-amber-100 rounded-lg p-2 hover:bg-white transition-colors group"
                                    >
                                        <button
                                            onClick={() => applyTemplate(tpl)}
                                            className="flex items-center gap-2 cursor-pointer"
                                        >
                                            <BadgePreview cfg={tpl.config} size="small" />
                                            <span className="text-[11px] text-text-secondary">{tpl.name}</span>
                                        </button>
                                        <button
                                            onClick={() => removeTemplate(tpl.id)}
                                            className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-red-500 transition-all cursor-pointer"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
