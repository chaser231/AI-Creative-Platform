"use client";

import { useState, useEffect } from "react";
import {
    Type,
    ALargeSmall,
    BoxSelect,
    AlignLeft,
    AlignCenter,
    AlignRight,
    Paintbrush,
    Eye,
    EyeOff,
} from "lucide-react";
import { Popover, PopoverButton } from "@/components/ui/Popover";
import { PREINSTALLED_FONTS, saveUserFont, getUserFonts } from "@/lib/customFonts";
import type { TextLayer } from "@/types";
import { ColorInput } from "./ColorInput";
import { AlignButton } from "./AlignButton";

const SYSTEM_FONTS = [
    "Inter", "Roboto", "Open Sans", "Montserrat",
    "PT Sans", "Outfit", "Arial", "Georgia"
];

export function TextPropsGrouped({
    layer,
    onChange,
}: {
    layer: TextLayer;
    onChange: (updates: Partial<TextLayer>) => void;
}) {
    const [activePopover, setActivePopover] = useState<string | null>(null);
    const [availableFonts, setAvailableFonts] = useState<string[]>(SYSTEM_FONTS);
    const [isUploadingFont, setIsUploadingFont] = useState(false);
    const [availableWeights, setAvailableWeights] = useState<string[]>([]);

    useEffect(() => {
        if (!activePopover) return;
        
        let weights = new Set<string>();
        let isVariable = false;

        document.fonts.forEach((font) => {
            const familyName = font.family.replace(/['"]/g, '');
            if (familyName === layer.fontFamily) {
                if (font.weight.includes(" ")) {
                    isVariable = true; // "100 900" variable font supports all
                } else {
                    let w = font.weight;
                    if (w === 'normal') w = '400';
                    if (w === 'bold') w = '700';
                    weights.add(w);
                }
            }
        });

        if (isVariable || weights.size === 0) {
            // Either a variable font, or a system font not loaded via FontFace API
            setAvailableWeights(["100", "200", "300", "400", "500", "600", "700", "800", "900"]);
        } else {
            setAvailableWeights(Array.from(weights).sort());
        }
    }, [layer.fontFamily, activePopover]);

    useEffect(() => {
        const loadFonts = async () => {
            try {
                const userFonts = await getUserFonts();
                const fontNames = [
                    ...SYSTEM_FONTS,
                    ...PREINSTALLED_FONTS.map((f: { name: string }) => f.name),
                    ...userFonts.map((f: { name: string }) => f.name)
                ];
                setAvailableFonts(Array.from(new Set(fontNames)));
            } catch (err) {
                console.error("Failed to load custom fonts:", err);
            }
        };
        loadFonts();
    }, [activePopover]);

    const togglePopover = (name: string) => {
        setActivePopover((prev) => (prev === name ? null : name));
    };

    return (
        <div className="flex items-center gap-1 relative">
            {/* Шрифт — font family + weight */}
            <div className="relative">
                <PopoverButton
                    icon={<Type size={12} />}
                    label="Шрифт"
                    isActive={activePopover === "font"}
                    onClick={() => togglePopover("font")}
                />
                <Popover isOpen={activePopover === "font"} onClose={() => setActivePopover(null)}>
                    <div className="space-y-3">
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Семейство</label>
                            <select
                                value={layer.fontFamily}
                                onChange={(e) => onChange({ fontFamily: e.target.value })}
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-border-focus mb-2"
                            >
                                {availableFonts.map(f => (
                                    <option key={f} value={f}>{f}</option>
                                ))}
                            </select>

                            <label className="flex items-center justify-center gap-1.5 w-full h-8 px-2 rounded-[var(--radius-md)] bg-bg-primary border border-dashed border-border-focus text-text-secondary text-[10px] cursor-pointer hover:bg-bg-tertiary transition-colors">
                                {isUploadingFont ? "Загрузка..." : "+ Загрузить свой (.ttf, .otf)"}
                                <input 
                                    type="file" 
                                    accept=".ttf,.otf,.woff,.woff2" 
                                    className="hidden" 
                                    disabled={isUploadingFont}
                                    onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        const fontName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9-]/g, "");
                                        if (!fontName) return alert("Неверное имя файла шрифта");
                                        
                                        setIsUploadingFont(true);
                                        const reader = new FileReader();
                                        reader.onload = async (ev) => {
                                            try {
                                                const buffer = ev.target?.result as ArrayBuffer;
                                                if (!buffer) throw new Error("File read failed");
                                                const f = new FontFace(fontName, buffer);
                                                const loadedFace = await f.load();
                                                document.fonts.add(loadedFace);
                                                await saveUserFont(fontName, buffer);
                                                setAvailableFonts(prev => Array.from(new Set([...prev, fontName])));
                                                onChange({ fontFamily: fontName });
                                            } catch (err) {
                                                console.error("Failed to install font:", err);
                                                alert("Ошибка при установке шрифта");
                                            } finally {
                                                setIsUploadingFont(false);
                                            }
                                        };
                                        reader.onerror = () => setIsUploadingFont(false);
                                        reader.readAsArrayBuffer(file);
                                    }}
                                />
                            </label>
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Начертание</label>
                            <select
                                value={layer.fontWeight}
                                onChange={(e) => onChange({ fontWeight: e.target.value })}
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-border-focus"
                            >
                                {availableWeights.includes("100") && <option value="100">Thin</option>}
                                {availableWeights.includes("200") && <option value="200">ExtraLight</option>}
                                {availableWeights.includes("300") && <option value="300">Light</option>}
                                {(availableWeights.includes("400") || availableWeights.length === 0) && <option value="400">Regular</option>}
                                {availableWeights.includes("500") && <option value="500">Medium</option>}
                                {availableWeights.includes("600") && <option value="600">SemiBold</option>}
                                {(availableWeights.includes("700") || availableWeights.length === 0) && <option value="700">Bold</option>}
                                {availableWeights.includes("800") && <option value="800">ExtraBold / Heavy</option>}
                                {availableWeights.includes("900") && <option value="900">Black</option>}
                            </select>
                        </div>
                    </div>
                </Popover>
            </div>

            {/* Текст — size, spacing, line height */}
            <div className="relative">
                <PopoverButton
                    icon={<ALargeSmall size={12} />}
                    label="Текст"
                    isActive={activePopover === "text"}
                    onClick={() => togglePopover("text")}
                />
                <Popover isOpen={activePopover === "text"} onClose={() => setActivePopover(null)}>
                    <div className="space-y-3">
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Кегль</label>
                            <input
                                type="number"
                                value={layer.fontSize}
                                onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                            />
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Кернинг (px)</label>
                            <input
                                type="number"
                                value={layer.letterSpacing}
                                step={0.5}
                                onChange={(e) => onChange({ letterSpacing: Number(e.target.value) })}
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                            />
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Интерлиньяж</label>
                            <input
                                type="number"
                                value={layer.lineHeight}
                                step={0.1}
                                onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                            />
                        </div>
                    </div>
                </Popover>
            </div>

            {/* Контейнер — layout, overflow */}
            <div className="relative">
                <PopoverButton
                    icon={<BoxSelect size={12} />}
                    label="Контейнер"
                    isActive={activePopover === "layout"}
                    onClick={() => togglePopover("layout")}
                />
                <Popover isOpen={activePopover === "layout"} onClose={() => setActivePopover(null)}>
                    <div className="space-y-4">
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Размер Контейнера</label>
                            <select
                                value={layer.textAdjust || "auto_width"}
                                onChange={(e) => {
                                    const val = e.target.value as TextLayer["textAdjust"];
                                    const updates: any = { textAdjust: val };
                                    if (val === "auto_width" && layer.layoutSizingWidth === "fill") {
                                        updates.layoutSizingWidth = "fixed";
                                    }
                                    onChange(updates);
                                }}
                                className="w-full h-8 px-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-border-focus"
                            >
                                <option value="auto_width">Auto Width</option>
                                <option value="auto_height">Auto Height</option>
                                <option value="fixed">Fixed Size</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <div className={`w-3.5 h-3.5 rounded-[var(--radius-sm)] border flex items-center justify-center transition-colors ${layer.truncateText ? 'bg-accent-primary border-accent-primary' : 'border-border-primary bg-bg-secondary group-hover:border-border-focus'}`}>
                                    {layer.truncateText && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
                                </div>
                                <span className="text-[11px] text-text-primary">Truncate Text</span>
                                <input
                                    type="checkbox"
                                    className="hidden"
                                    checked={layer.truncateText || false}
                                    onChange={(e) => onChange({ truncateText: e.target.checked })}
                                />
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <div className={`w-3.5 h-3.5 rounded-[var(--radius-sm)] border flex items-center justify-center transition-colors ${layer.verticalTrim ? 'bg-accent-primary border-accent-primary' : 'border-border-primary bg-bg-secondary group-hover:border-border-focus'}`}>
                                    {layer.verticalTrim && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
                                </div>
                                <span className="text-[11px] text-text-primary">Vertical Trim</span>
                                <input
                                    type="checkbox"
                                    className="hidden"
                                    checked={layer.verticalTrim || false}
                                    onChange={(e) => onChange({ verticalTrim: e.target.checked })}
                                />
                            </label>
                        </div>
                    </div>
                </Popover>
            </div>

            {/* Стиль текста — color, alignment, transform */}
            <div className="relative">
                <PopoverButton
                    icon={<Paintbrush size={12} />}
                    label="Стиль"
                    isActive={activePopover === "style"}
                    onClick={() => togglePopover("style")}
                />
                <Popover isOpen={activePopover === "style"} onClose={() => setActivePopover(null)}>
                    <div className="space-y-4">
                        {/* Opacity */}
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Непрозрачность</label>
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={Math.round((layer.opacity ?? 1) * 100)}
                                    onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
                                    className="flex-1 h-1.5 accent-accent-primary cursor-pointer"
                                />
                                <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={Math.round((layer.opacity ?? 1) * 100)}
                                    onChange={(e) => {
                                        const v = Math.max(0, Math.min(100, Number(e.target.value)));
                                        onChange({ opacity: v / 100 });
                                    }}
                                    className="w-12 h-7 px-1 rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-[10px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                                />
                                <span className="text-[10px] text-text-tertiary">%</span>
                            </div>
                        </div>
                        <div className="w-full h-px bg-border-primary" />
                        {/* Fill */}
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Цвет текста</label>
                            <div className="flex items-center gap-1.5">
                                <div className={`transition-opacity ${layer.fillEnabled !== false ? '' : 'opacity-30 pointer-events-none'}`}>
                                    <ColorInput value={layer.fill} onChange={(v) => onChange({ fill: v })} />
                                </div>
                                <button
                                    onClick={() => onChange({ fillEnabled: !(layer.fillEnabled !== false) })}
                                    className={`p-1 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${layer.fillEnabled !== false ? 'text-text-secondary hover:text-text-primary' : 'text-text-tertiary/40 hover:text-text-tertiary'}`}
                                    title={layer.fillEnabled !== false ? "Скрыть цвет" : "Показать цвет"}
                                >
                                    {layer.fillEnabled !== false ? <Eye size={12} /> : <EyeOff size={12} />}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Выравнивание</label>
                            <div className="flex items-center border border-border-primary rounded-[var(--radius-md)] overflow-hidden w-fit">
                                <AlignButton
                                    icon={<AlignLeft size={12} />}
                                    isActive={layer.align === "left"}
                                    onClick={() => onChange({ align: "left" })}
                                    title="По левому краю"
                                />
                                <AlignButton
                                    icon={<AlignCenter size={12} />}
                                    isActive={layer.align === "center"}
                                    onClick={() => onChange({ align: "center" })}
                                    title="По центру"
                                />
                                <AlignButton
                                    icon={<AlignRight size={12} />}
                                    isActive={layer.align === "right"}
                                    onClick={() => onChange({ align: "right" })}
                                    title="По правому краю"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Регистр</label>
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <div className={`w-3.5 h-3.5 rounded-[var(--radius-sm)] border flex items-center justify-center transition-colors ${layer.textTransform === 'uppercase' ? 'bg-accent-primary border-accent-primary' : 'border-border-primary bg-bg-secondary group-hover:border-border-focus'}`}>
                                    {layer.textTransform === 'uppercase' && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
                                </div>
                                <span className="text-[11px] text-text-primary">ВЕРХНИЙ РЕГИСТР</span>
                                <input
                                    type="checkbox"
                                    className="hidden"
                                    checked={layer.textTransform === 'uppercase'}
                                    onChange={(e) => onChange({ textTransform: e.target.checked ? 'uppercase' : 'none' })}
                                />
                            </label>
                        </div>
                    </div>
                </Popover>
            </div>
        </div>
    );
}
