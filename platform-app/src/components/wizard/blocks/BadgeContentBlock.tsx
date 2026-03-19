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
    onConfigChange?: (config: BadgeConfig) => void;
    businessUnit?: BusinessUnit;
}

const SHAPE_OPTIONS: { id: BadgeConfig["shape"]; label: string; preview: string }[] = [
    { id: "pill", label: "Капсула", preview: "⬮" },
    { id: "rectangle", label: "Прямоуг.", preview: "▬" },
    { id: "circle", label: "Круг", preview: "●" },
    { id: "star", label: "Звезда", preview: "★" },
    { id: "arrow", label: "Стрелка", preview: "➤" },
];

const COLOR_PALETTE = [
    "#7C3AED", "#EF4444", "#F59E0B", "#10B981", "#3B82F6",
    "#EC4899", "#14B8A6", "#F97316", "#6366F1", "#1F2937",
];

export function BadgeContentBlock({ id, name, props, value, onChange, onConfigChange, businessUnit }: BadgeContentBlockProps) {
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

    const BadgePreview = ({ cfg, size = "normal" }: { cfg: BadgeConfig; size?: "normal" | "small" }) => {
        const isSmall = size === "small";
        const baseStyles: React.CSSProperties = {
            backgroundColor: cfg.fill, color: cfg.textColor,
            fontSize: isSmall ? 10 : cfg.fontSize, fontWeight: cfg.fontWeight as any,
            border: cfg.borderWidth > 0 ? `${cfg.borderWidth}px solid ${cfg.borderColor}` : "none",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            padding: isSmall ? "2px 6px" : "4px 12px", lineHeight: 1.3,
        };
        switch (cfg.shape) {
            case "pill": return <span style={{ ...baseStyles, borderRadius: 999 }}>{cfg.label || "Badge"}</span>;
            case "rectangle": return <span style={{ ...baseStyles, borderRadius: 4 }}>{cfg.label || "Badge"}</span>;
            case "circle": return <span style={{ ...baseStyles, borderRadius: "50%", width: isSmall ? 28 : 40, height: isSmall ? 28 : 40, padding: 0 }}>{cfg.label || "B"}</span>;
            case "star": return <span style={{ ...baseStyles, borderRadius: 4 }}>★ {cfg.label || "Badge"}</span>;
            case "arrow": return <span style={{ ...baseStyles, borderRadius: "4px 16px 16px 4px" }}>{cfg.label || "Badge"} →</span>;
            default: return <span style={{ ...baseStyles, borderRadius: 999 }}>{cfg.label || "Badge"}</span>;
        }
    };

    return (
        <div className="p-4 bg-bg-primary border border-border-primary rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)]">
            <div className="flex justify-between items-center mb-2">
                <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Tag size={16} className="text-text-secondary" />
                    {name}
                </label>
                <button
                    onClick={() => setShowConstructor(!showConstructor)}
                    className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-text-secondary hover:bg-bg-tertiary transition-all cursor-pointer"
                >
                    {showConstructor ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    Конструктор
                </button>
            </div>

            <input
                type="text"
                placeholder={props.label || "Текст бейджа"}
                value={config.label}
                onChange={(e) => updateConfig({ label: e.target.value })}
                className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus"
            />

            <div className="flex gap-2 mt-2 flex-wrap">
                {presets.map(p => (
                    <button key={p} onClick={() => updateConfig({ label: p })} className="px-2 py-1 text-[11px] font-medium bg-bg-secondary hover:bg-bg-tertiary border border-border-primary rounded-[var(--radius-sm)] text-text-secondary transition-colors cursor-pointer">
                        {p}
                    </button>
                ))}
            </div>

            <div className="mt-3 flex items-center justify-center p-3 bg-bg-secondary rounded-[var(--radius-md)] border border-border-primary">
                <BadgePreview cfg={config} />
            </div>

            {showConstructor && (
                <div className="mt-3 p-3 bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] space-y-4">
                    {/* Shape */}
                    <div>
                        <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2">Форма</p>
                        <div className="flex gap-2">
                            {SHAPE_OPTIONS.map(shape => (
                                <button key={shape.id} onClick={() => updateConfig({ shape: shape.id })}
                                    className={`flex-1 p-2 rounded-[var(--radius-md)] border text-center transition-all cursor-pointer ${
                                        config.shape === shape.id
                                            ? "bg-accent-lime/30 border-accent-lime-hover text-text-primary shadow-[var(--shadow-sm)]"
                                            : "bg-bg-primary border-border-primary text-text-secondary hover:bg-bg-tertiary"
                                    }`}>
                                    <span className="text-lg block">{shape.preview}</span>
                                    <span className="text-[10px]">{shape.label}</span>
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
                                    <button key={c} onClick={() => updateConfig({ fill: c })}
                                        className={`w-6 h-6 rounded-full border-2 transition-all cursor-pointer ${config.fill === c ? "border-text-primary scale-110 shadow-[var(--shadow-sm)]" : "border-transparent hover:scale-105"}`}
                                        style={{ backgroundColor: c }} />
                                ))}
                                <input type="color" value={config.fill} onChange={(e) => updateConfig({ fill: e.target.value })} className="w-6 h-6 rounded-full cursor-pointer border-0 p-0" />
                            </div>
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold text-text-secondary mb-2">Цвет текста</p>
                            <div className="flex gap-1.5 flex-wrap">
                                {["#FFFFFF", "#000000", "#1F2937", "#F9FAFB"].map(c => (
                                    <button key={c} onClick={() => updateConfig({ textColor: c })}
                                        className={`w-6 h-6 rounded-full border-2 transition-all cursor-pointer ${config.textColor === c ? "border-text-primary scale-110 shadow-[var(--shadow-sm)]" : "border-border-primary hover:scale-105"}`}
                                        style={{ backgroundColor: c }} />
                                ))}
                                <input type="color" value={config.textColor} onChange={(e) => updateConfig({ textColor: e.target.value })} className="w-6 h-6 rounded-full cursor-pointer border-0 p-0" />
                            </div>
                        </div>
                    </div>

                    {/* Font & Border */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <p className="text-[10px] font-medium text-text-secondary mb-1">Размер: {config.fontSize}px</p>
                            <input type="range" min={8} max={32} value={config.fontSize} onChange={(e) => updateConfig({ fontSize: Number(e.target.value) })} className="w-full" />
                        </div>
                        <div>
                            <p className="text-[10px] font-medium text-text-secondary mb-1">Жирность</p>
                            <div className="flex gap-1">
                                {["400", "500", "600", "700", "800"].map(w => (
                                    <button key={w} onClick={() => updateConfig({ fontWeight: w })}
                                        className={`flex-1 text-[10px] py-1 rounded border cursor-pointer transition-all ${
                                            config.fontWeight === w
                                                ? "bg-accent-primary text-text-inverse border-accent-primary"
                                                : "bg-bg-primary text-text-secondary border-border-primary hover:bg-bg-tertiary"
                                        }`} style={{ fontWeight: Number(w) }}>
                                        {w}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <p className="text-[10px] font-medium text-text-secondary mb-1">Обводка: {config.borderWidth}px</p>
                            <input type="range" min={0} max={4} value={config.borderWidth} onChange={(e) => updateConfig({ borderWidth: Number(e.target.value) })} className="w-full" />
                        </div>
                        {config.borderWidth > 0 && (
                            <div>
                                <p className="text-[10px] font-medium text-text-secondary mb-1">Цвет обводки</p>
                                <input type="color" value={config.borderColor === "transparent" ? "#000000" : config.borderColor} onChange={(e) => updateConfig({ borderColor: e.target.value })} className="w-8 h-8 rounded cursor-pointer border-0 p-0" />
                            </div>
                        )}
                    </div>

                    {/* Save templates */}
                    <div className="pt-3 border-t border-border-primary space-y-2">
                        {!showSaveForm ? (
                            <div className="flex gap-2">
                                <Button variant="secondary" size="sm" icon={<Save size={14} />} onClick={() => setShowSaveForm(true)} className="text-xs">
                                    Сохранить как шаблон
                                </Button>
                                {templates.length > 0 && (
                                    <Button variant="ghost" size="sm" onClick={() => setShowSaved(!showSaved)} className="text-xs text-text-secondary">
                                        Мои шаблоны ({templates.length})
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <input type="text" placeholder="Название шаблона" value={saveName} onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSave()} className="flex-1 h-8 px-2 text-xs rounded border border-border-primary bg-bg-primary text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus" />
                                <Button variant="primary" size="sm" onClick={handleSave} className="text-xs h-8">Сохранить</Button>
                                <Button variant="ghost" size="sm" onClick={() => setShowSaveForm(false)} className="text-xs h-8">✕</Button>
                            </div>
                        )}

                        {showSaved && templates.length > 0 && (
                            <div className="flex gap-2 flex-wrap mt-2">
                                {templates.map(tpl => (
                                    <div key={tpl.id} className="flex items-center gap-2 bg-bg-primary border border-border-primary rounded-[var(--radius-md)] p-2 hover:bg-bg-tertiary transition-colors group">
                                        <button onClick={() => applyTemplate(tpl)} className="flex items-center gap-2 cursor-pointer">
                                            <BadgePreview cfg={tpl.config} size="small" />
                                            <span className="text-[11px] text-text-secondary">{tpl.name}</span>
                                        </button>
                                        <button onClick={() => removeTemplate(tpl.id)} className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-red-500 transition-all cursor-pointer">
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
