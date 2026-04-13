"use client";

/**
 * MissingFontsModal — Figma-style missing fonts dialog
 *
 * Shown when a template is loaded and some of its required fonts
 * are not available locally. Offers three actions:
 * 1. Replace missing fonts with available alternatives
 * 2. Continue without replacing (browser fallback rendering)
 * 3. Upload missing font files (.ttf, .otf)
 */

import { useState, useCallback } from "react";
import { AlertTriangle, Upload, ArrowRight, X, Type, RefreshCw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { saveUserFont, getUserFonts } from "@/lib/customFonts";
import type { RequiredFont } from "@/utils/fontUtils";

interface MissingFontsModalProps {
    open: boolean;
    onClose: () => void;
    missingFonts: RequiredFont[];
    availableFonts: string[];
    /** Called with replacement map (oldFamily → newFamily) when user confirms */
    onReplace: (replacementMap: Record<string, string>) => void;
    /** Called when user chooses to continue without replacing */
    onContinueWithoutReplace: () => void;
}

export function MissingFontsModal({
    open,
    onClose,
    missingFonts,
    availableFonts,
    onReplace,
    onContinueWithoutReplace,
}: MissingFontsModalProps) {
    // Map of originalFontFamily → selected replacement font
    const [replacements, setReplacements] = useState<Record<string, string>>(() => {
        const initial: Record<string, string> = {};
        for (const f of missingFonts) {
            initial[f.family] = availableFonts[0] || "Inter";
        }
        return initial;
    });

    const [isUploadingFont, setIsUploadingFont] = useState(false);
    const [uploadedFontNames, setUploadedFontNames] = useState<string[]>([]);
    const [resolvedFonts, setResolvedFonts] = useState<Set<string>>(new Set());

    const handleReplacementChange = useCallback((family: string, newValue: string) => {
        setReplacements(prev => ({ ...prev, [family]: newValue }));
    }, []);

    const handleUploadFont = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setIsUploadingFont(true);

        for (const file of Array.from(files)) {
            const fontName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9\s-]/g, "");
            if (!fontName) continue;

            try {
                const buffer = await file.arrayBuffer();
                const f = new FontFace(fontName, buffer);
                const loadedFace = await f.load();
                document.fonts.add(loadedFace);
                await saveUserFont(fontName, buffer);
                setUploadedFontNames(prev => [...prev, fontName]);

                // Check if this resolves any missing font
                const resolvedFamily = missingFonts.find(
                    mf => mf.family.toLowerCase() === fontName.toLowerCase()
                );
                if (resolvedFamily) {
                    setResolvedFonts(prev => new Set([...prev, resolvedFamily.family]));
                }
            } catch (err) {
                console.error(`Failed to upload font ${fontName}:`, err);
            }
        }

        setIsUploadingFont(false);
        // Reset the input
        e.target.value = "";
    }, [missingFonts]);

    const handleReplace = useCallback(() => {
        // Only include replacements for fonts that weren't resolved by upload
        const finalMap: Record<string, string> = {};
        for (const [family, replacement] of Object.entries(replacements)) {
            if (!resolvedFonts.has(family)) {
                finalMap[family] = replacement;
            }
        }
        onReplace(finalMap);
    }, [replacements, resolvedFonts, onReplace]);

    const handleContinue = useCallback(() => {
        onContinueWithoutReplace();
    }, [onContinueWithoutReplace]);

    // Remaining unresolved missing fonts
    const unresolvedFonts = missingFonts.filter(f => !resolvedFonts.has(f.family));
    const allResolved = unresolvedFonts.length === 0;

    if (!open) return null;

    const fontOptions = availableFonts.map(f => ({ value: f, label: f }));

    return (
        <Modal open={open} onClose={onClose} title="Недостающие шрифты" maxWidth="max-w-lg">
            <div className="space-y-4 pt-1">
                {/* Warning banner */}
                <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
                    <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-[12px] font-medium text-amber-500">
                            {allResolved
                                ? "Все шрифты найдены!"
                                : `${unresolvedFonts.length} ${unresolvedFonts.length === 1 ? "шрифт не найден" : unresolvedFonts.length < 5 ? "шрифта не найдено" : "шрифтов не найдено"}`
                            }
                        </p>
                        <p className="text-[11px] text-text-tertiary mt-0.5">
                            {allResolved
                                ? "Все необходимые шрифты теперь доступны. Нажмите «Продолжить» для загрузки шаблона."
                                : "Некоторые шрифты из этого шаблона отсутствуют. Вы можете заменить их на доступные или загрузить файлы шрифтов."
                            }
                        </p>
                    </div>
                </div>

                {/* Font list */}
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {missingFonts.map(font => {
                        const isResolved = resolvedFonts.has(font.family);

                        return (
                            <div
                                key={font.family}
                                className={`p-3 rounded-xl border transition-colors ${
                                    isResolved
                                        ? "bg-green-500/5 border-green-500/20"
                                        : "bg-bg-secondary border-border-primary"
                                }`}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <Type size={14} className={isResolved ? "text-green-500" : "text-amber-500"} />
                                        <span className={`text-[12px] font-semibold ${isResolved ? "text-green-500" : "text-text-primary"}`}>
                                            {font.family}
                                        </span>
                                        {isResolved && (
                                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-500 font-medium">
                                                Найден ✓
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-[9px] text-text-tertiary">
                                        {font.usedInLayers.length} {font.usedInLayers.length === 1 ? "слой" : font.usedInLayers.length < 5 ? "слоя" : "слоёв"}
                                    </span>
                                </div>

                                {/* Weights used */}
                                <div className="flex gap-1 mb-2">
                                    {font.weights.map(w => (
                                        <span
                                            key={w}
                                            className="text-[8px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-tertiary border border-border-primary"
                                        >
                                            {w}
                                        </span>
                                    ))}
                                </div>

                                {/* Replacement selector (only for unresolved) */}
                                {!isResolved && (
                                    <div className="flex items-center gap-2">
                                        <ArrowRight size={12} className="text-text-tertiary shrink-0" />
                                        <div className="flex-1">
                                            <Select
                                                size="sm"
                                                value={replacements[font.family] || availableFonts[0]}
                                                onChange={(val) => handleReplacementChange(font.family, val)}
                                                options={fontOptions}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Upload font button */}
                <div className="pt-1">
                    <label className="flex items-center justify-center gap-2 w-full h-9 px-3 rounded-xl bg-bg-primary border border-dashed border-border-focus text-text-secondary text-[11px] font-medium cursor-pointer hover:bg-bg-tertiary hover:border-accent-primary/40 transition-all">
                        {isUploadingFont ? (
                            <>
                                <RefreshCw size={13} className="animate-spin" />
                                Загрузка...
                            </>
                        ) : (
                            <>
                                <Upload size={13} />
                                Загрузить шрифты (.ttf, .otf, .woff, .woff2)
                            </>
                        )}
                        <input
                            type="file"
                            accept=".ttf,.otf,.woff,.woff2"
                            multiple
                            className="hidden"
                            disabled={isUploadingFont}
                            onChange={handleUploadFont}
                        />
                    </label>
                    {uploadedFontNames.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                            {uploadedFontNames.map(name => (
                                <span
                                    key={name}
                                    className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent-primary/10 text-accent-primary font-medium"
                                >
                                    ✓ {name}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex justify-between items-center gap-2 pt-2 border-t border-border-primary">
                    <Button variant="ghost" size="sm" onClick={handleContinue}>
                        {allResolved ? "Продолжить" : "Использовать как есть"}
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={onClose}>
                            Отмена
                        </Button>
                        {!allResolved && (
                            <Button size="sm" onClick={handleReplace}>
                                Заменить и продолжить
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
