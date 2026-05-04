"use client";

import { useState, useEffect, useMemo, type ReactNode } from "react";
import {
    Type,
    AlignLeft,
    AlignCenter,
    AlignRight,
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

function getAssetFontFamily(asset: { metadata: unknown; filename: string }): string {
    const metadata = asset.metadata;
    const family = metadata && typeof metadata === "object" && !Array.isArray(metadata) && "family" in metadata
        ? (metadata as { family?: unknown }).family
        : undefined;
    return String(family || normalizeFontFamilyName(asset.filename));
}

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
    const { currentWorkspace } = useWorkspace();
    const { assets: workspaceFontAssets } = useAssetList("FONT");
    const { uploadFile } = useAssetUpload();
    const workspaceFontNames = useMemo(() =>
        workspaceFontAssets.map(getAssetFontFamily),
    [workspaceFontAssets]);

    // Check if current layer's font is available locally
    const isFontMissing = useMemo(() => {
        if (!layer.fontFamily) return false;
        const available = [...getAvailableFontFamiliesSync(), ...workspaceFontNames];
        return !available.some(f => f.toLowerCase() === layer.fontFamily.toLowerCase());
    }, [layer.fontFamily, workspaceFontNames]);

    const availableWeights = useMemo(() => {
        if (!activePopover || typeof document === "undefined") {
            return ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
        }

        const weights = new Set<string>();
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
            return ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
        }

        return Array.from(weights).sort();
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
            {/* Typography — figma-like single text properties popover */}
            <div className="relative">
                <PopoverButton
                    icon={isFontMissing
                        ? <AlertTriangle size={12} className="text-amber-500" />
                        : <Type size={12} />
                    }
                    label={isFontMissing ? "Typography ⚠" : "Typography"}
                    isActive={activePopover === "typography"}
                    onClick={() => togglePopover("typography")}
                />
                {isFontMissing && (
                    <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 border border-bg-surface" />
                )}
                <Popover
                    isOpen={activePopover === "typography"}
                    onClose={() => setActivePopover(null)}
                    className="w-[368px] p-4"
                >
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[15px] font-semibold text-text-primary">Typography</h3>
                            <Type size={14} className="text-text-tertiary" />
                        </div>

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

                        <Select
                            size="md"
                            value={layer.fontFamily}
                            onChange={(val) => onChange({ fontFamily: val })}
                            options={availableFonts.map(f => ({ value: f, label: f }))}
                            triggerClassName="h-12 text-[15px] rounded-[var(--radius-lg)] bg-bg-primary"
                        />

                        <div className="grid grid-cols-2 gap-3">
                            <Select
                                size="md"
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
                                triggerClassName="h-12 text-[15px] rounded-[var(--radius-lg)] bg-bg-primary"
                            />
                            <TypographyNumberInput
                                value={layer.fontSize}
                                min={1}
                                step={1}
                                onChange={(value) => onChange({ fontSize: value })}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <TypographyNumberInput
                                icon={<span className="text-[18px] leading-none text-text-tertiary">A</span>}
                                value={Math.round((layer.lineHeight || 1.2) * 100)}
                                suffix="%"
                                min={1}
                                step={1}
                                onChange={(value) => onChange({ lineHeight: value / 100 })}
                            />
                            <TypographyNumberInput
                                icon={<span className="text-[13px] leading-none text-text-tertiary">|A|</span>}
                                value={layer.letterSpacing}
                                step={0.1}
                                onChange={(value) => onChange({ letterSpacing: value })}
                            />
                        </div>

                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center border border-border-primary rounded-[var(--radius-lg)] overflow-hidden bg-bg-primary">
                                <AlignButton
                                    icon={<AlignLeft size={17} />}
                                    isActive={layer.align === "left"}
                                    onClick={() => onChange({ align: "left" })}
                                    title="По левому краю"
                                />
                                <AlignButton
                                    icon={<AlignCenter size={17} />}
                                    isActive={layer.align === "center"}
                                    onClick={() => onChange({ align: "center" })}
                                    title="По центру"
                                />
                                <AlignButton
                                    icon={<AlignRight size={17} />}
                                    isActive={layer.align === "right"}
                                    onClick={() => onChange({ align: "right" })}
                                    title="По правому краю"
                                />
                            </div>

                            <div className="flex items-center border border-border-primary rounded-[var(--radius-lg)] overflow-hidden bg-bg-primary">
                                <AlignButton
                                    icon={<VerticalAlignIcon align="top" />}
                                    isActive={(layer.verticalAlign || "top") === "top"}
                                    onClick={() => onChange({ verticalAlign: "top" })}
                                    title="По верхнему краю"
                                />
                                <AlignButton
                                    icon={<VerticalAlignIcon align="middle" />}
                                    isActive={layer.verticalAlign === "middle"}
                                    onClick={() => onChange({ verticalAlign: "middle" })}
                                    title="По вертикальному центру"
                                />
                                <AlignButton
                                    icon={<VerticalAlignIcon align="bottom" />}
                                    isActive={layer.verticalAlign === "bottom"}
                                    onClick={() => onChange({ verticalAlign: "bottom" })}
                                    title="По нижнему краю"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <Select
                                size="sm"
                                value={layer.textAdjust || "auto_width"}
                                onChange={(val) => {
                                    const updates: Partial<TextLayer> = { textAdjust: val as TextLayer["textAdjust"] };
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
                                triggerClassName="h-10 rounded-[var(--radius-lg)] bg-bg-primary"
                            />
                            <Select
                                size="sm"
                                value={layer.textTransform || "none"}
                                onChange={(val) => onChange({ textTransform: val as TextLayer["textTransform"] })}
                                options={[
                                    { value: "none", label: "Регистр: как введено" },
                                    { value: "uppercase", label: "ВЕРХНИЙ" },
                                    { value: "lowercase", label: "нижний" },
                                ]}
                                triggerClassName="h-10 rounded-[var(--radius-lg)] bg-bg-primary"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <ToggleRow
                                checked={!!layer.verticalTrim}
                                label="Vertical Trim"
                                onChange={(checked) => onChange({ verticalTrim: checked })}
                            />
                            <ToggleRow
                                checked={!!layer.truncateText}
                                label="Truncate"
                                onChange={(checked) => onChange({ truncateText: checked })}
                            />
                        </div>

                        <div className="w-full h-px bg-border-primary" />

                        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
                            <div className={`transition-opacity ${layer.fillEnabled !== false ? '' : 'opacity-30 pointer-events-none'}`}>
                                <ColorInput value={layer.fill} onChange={(v) => onChange({ fill: v })} />
                            </div>
                            <div>
                                <div className="text-[11px] font-medium text-text-primary">Цвет текста</div>
                                <div className="text-[10px] text-text-tertiary">Сохранено из прежнего Style-поповера</div>
                            </div>
                            <button
                                onClick={() => onChange({ fillEnabled: !(layer.fillEnabled !== false) })}
                                className={`p-1.5 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${layer.fillEnabled !== false ? 'text-text-secondary hover:text-text-primary' : 'text-text-tertiary/40 hover:text-text-tertiary'}`}
                                title={layer.fillEnabled !== false ? "Скрыть цвет" : "Показать цвет"}
                            >
                                {layer.fillEnabled !== false ? <Eye size={14} /> : <EyeOff size={14} />}
                            </button>
                        </div>

                        <div className="flex items-center gap-3">
                            <span className="w-16 text-[10px] text-text-tertiary">Opacity</span>
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
                                className="w-12 h-8 px-1 rounded-[var(--radius-sm)] border border-border-primary bg-bg-primary text-[11px] text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-border-focus"
                            />
                        </div>

                        <label className="flex items-center justify-center gap-1.5 w-full h-8 px-2 rounded-[var(--radius-md)] bg-bg-primary border border-dashed border-border-focus text-text-secondary text-[10px] cursor-pointer hover:bg-bg-tertiary transition-colors">
                            {isUploadingFont ? "Загрузка..." : "+ Загрузить свой шрифт (.ttf, .otf)"}
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
                                                console.error(`Font ${fontName} applied locally but failed to sync to workspace`);
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
                </Popover>
            </div>
        </div>
    );
}

function TypographyNumberInput({
    value,
    onChange,
    icon,
    suffix,
    min,
    step = 1,
}: {
    value: number;
    onChange: (value: number) => void;
    icon?: ReactNode;
    suffix?: string;
    min?: number;
    step?: number;
}) {
    return (
        <div className="h-12 flex items-center gap-2 px-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-primary">
            {icon}
            <input
                type="number"
                value={Number.isInteger(value) ? value : Number(value.toFixed(2))}
                min={min}
                step={step}
                onChange={(e) => onChange(Number(e.target.value))}
                className="min-w-0 flex-1 bg-transparent text-[15px] text-text-primary focus:outline-none"
            />
            {suffix && <span className="text-[12px] text-text-tertiary">{suffix}</span>}
        </div>
    );
}

function ToggleRow({
    checked,
    label,
    onChange,
}: {
    checked: boolean;
    label: string;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label className="h-10 px-3 rounded-[var(--radius-lg)] border border-border-primary bg-bg-primary flex items-center gap-2 cursor-pointer group">
            <div className={`w-3.5 h-3.5 rounded-[var(--radius-sm)] border flex items-center justify-center transition-colors ${checked ? 'bg-accent-primary border-accent-primary' : 'border-border-primary bg-bg-secondary group-hover:border-border-focus'}`}>
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

function VerticalAlignIcon({ align }: { align: "top" | "middle" | "bottom" }) {
    return (
        <span className="relative block w-[17px] h-[17px] text-text-primary">
            <span className={`absolute left-[3px] right-[3px] h-px bg-current ${align === "top" ? "top-[2px]" : align === "middle" ? "top-[8px]" : "bottom-[2px]"}`} />
            <span className={`absolute left-1/2 -translate-x-1/2 text-[15px] leading-none ${align === "top" ? "top-[3px]" : align === "middle" ? "top-[1px]" : "bottom-[3px]"}`}>
                {align === "bottom" ? "↓" : "↑"}
            </span>
        </span>
    );
}
