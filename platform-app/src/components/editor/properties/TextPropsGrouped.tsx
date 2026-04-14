"use client";

import { useState, useEffect, useMemo } from "react";
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
    AlertTriangle,
} from "lucide-react";
import { Popover, PopoverButton } from "@/components/ui/Popover";
import { Select } from "@/components/ui/Select";
import { PREINSTALLED_FONTS, saveUserFont, getUserFonts, normalizeFontFamilyName } from "@/lib/customFonts";
import { getAvailableFontFamiliesSync } from "@/utils/fontUtils";
import type { TextLayer } from "@/types";
import { ColorInput } from "./ColorInput";
import { AlignButton } from "./AlignButton";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { useAssetList, useAssetUpload } from "@/hooks/useAssetUpload";

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
    const { currentWorkspace } = useWorkspace();
    const { assets: workspaceFontAssets } = useAssetList("FONT");
    const { uploadFile } = useAssetUpload();
    const workspaceFontNames = useMemo(() =>
        workspaceFontAssets.map((asset: any) =>
            String(asset.metadata?.family || normalizeFontFamilyName(asset.filename))
        ),
    [workspaceFontAssets]);

    // Check if current layer's font is available locally
    const isFontMissing = useMemo(() => {
        if (!layer.fontFamily) return false;
        const available = [...getAvailableFontFamiliesSync(), ...workspaceFontNames];
        return !available.some(f => f.toLowerCase() === layer.fontFamily.toLowerCase());
    }, [layer.fontFamily, workspaceFontNames]);

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
                    ...userFonts.map((f: { name: string }) => f.name),
                    ...workspaceFontNames,
                ];
                setAvailableFonts(Array.from(new Set(fontNames)).sort());
            } catch (err) {
                console.error("Failed to load custom fonts:", err);
            }
        };
        loadFonts();
    }, [activePopover, workspaceFontNames]);

    const togglePopover = (name: string) => {
        setActivePopover((prev) => (prev === name ? null : name));
    };

    return (
        <div className="flex items-center gap-1 relative">
            {/* Шрифт — font family + weight */}
            <div className="relative">
                <PopoverButton
                    icon={isFontMissing
                        ? <AlertTriangle size={12} className="text-amber-500" />
                        : <Type size={12} />
                    }
                    label={isFontMissing ? "Шрифт ⚠" : "Шрифт"}
                    isActive={activePopover === "font"}
                    onClick={() => togglePopover("font")}
                />
                {isFontMissing && (
                    <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 border border-bg-surface" />
                )}
                <Popover isOpen={activePopover === "font"} onClose={() => setActivePopover(null)}>
                    <div className="space-y-3">
                        {isFontMissing && (
                            <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-[10px] font-medium text-amber-500">
                                        Шрифт «{layer.fontFamily}» не установлен
                                    </p>
                                    <p className="text-[9px] text-text-tertiary mt-0.5">
                                        Выберите замену ниже или загрузите файл шрифта
                                    </p>
                                </div>
                            </div>
                        )}
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Семейство</label>
                            <Select
                                size="sm"
                                value={layer.fontFamily}
                                onChange={(val) => onChange({ fontFamily: val })}
                                options={availableFonts.map(f => ({ value: f, label: f }))}
                                className="mb-2"
                            />

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
                                        const fontName = normalizeFontFamilyName(file.name);
                                        if (!fontName) return alert("Неверное имя файла шрифта");
                                        
                                        setIsUploadingFont(true);
                                        try {
                                            const buffer = await file.arrayBuffer();
                                            const f = new FontFace(fontName, buffer);
                                            const loadedFace = await f.load();
                                            document.fonts.add(loadedFace);
                                            await saveUserFont(fontName, buffer);

                                            if (currentWorkspace?.id) {
                                                const uploaded = await uploadFile(file, {
                                                    type: "FONT",
                                                    workspaceId: currentWorkspace.id,
                                                    metadata: { family: fontName },
                                                });
                                                if (!uploaded) {
                                                    console.warn(`Font ${fontName} applied locally but failed to sync to workspace`);
                                                }
                                            }

                                            setAvailableFonts(prev => Array.from(new Set([...prev, fontName])).sort());
                                            onChange({ fontFamily: fontName });
                                        } catch (err) {
                                            console.error("Failed to install font:", err);
                                            alert("Ошибка при установке шрифта");
                                        } finally {
                                            setIsUploadingFont(false);
                                            e.target.value = "";
                                        }
                                    }}
                                />
                            </label>
                        </div>
                        <div>
                            <label className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium mb-1.5 block">Начертание</label>
                            <Select
                                size="sm"
                                value={layer.fontWeight}
                                onChange={(val) => onChange({ fontWeight: val })}
                                options={[
                                    ...(availableWeights.includes("100") ? [{ value: "100", label: "Thin" }] : []),
                                    ...(availableWeights.includes("200") ? [{ value: "200", label: "ExtraLight" }] : []),
                                    ...(availableWeights.includes("300") ? [{ value: "300", label: "Light" }] : []),
                                    ...(availableWeights.includes("400") || availableWeights.length === 0 ? [{ value: "400", label: "Regular" }] : []),
                                    ...(availableWeights.includes("500") ? [{ value: "500", label: "Medium" }] : []),
                                    ...(availableWeights.includes("600") ? [{ value: "600", label: "SemiBold" }] : []),
                                    ...(availableWeights.includes("700") || availableWeights.length === 0 ? [{ value: "700", label: "Bold" }] : []),
                                    ...(availableWeights.includes("800") ? [{ value: "800", label: "ExtraBold / Heavy" }] : []),
                                    ...(availableWeights.includes("900") ? [{ value: "900", label: "Black" }] : []),
                                ]}
                            />
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
                            <Select
                                size="sm"
                                value={layer.textAdjust || "auto_width"}
                                onChange={(val) => {
                                    const updates: any = { textAdjust: val };
                                    if (val === "auto_width") {
                                        // auto_width: text determines its own width → fill width is a conflict
                                        if (layer.layoutSizingWidth === "fill") {
                                            updates.layoutSizingWidth = "fixed";
                                        }
                                    } else if (val === "auto_height") {
                                        // auto_height: text determines its own height → fill height is a conflict
                                        if (layer.layoutSizingHeight === "fill") {
                                            updates.layoutSizingHeight = "fixed";
                                        }
                                    }
                                    onChange(updates);
                                }}
                                options={[
                                    { value: "auto_width", label: "Автоширина" },
                                    { value: "auto_height", label: "Автовысота" },
                                    { value: "fixed", label: "Фиксированный" },
                                ]}
                            />
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
