"use client";

/**
 * LoraSelectorPicker — compact LoRA selector for prompt bars.
 *
 * Mirrors the visual language of `StylePresetPicker` so both pills sit
 * comfortably next to each other. Renders an outlined pill that opens a
 * portal-positioned popover with three sections:
 *
 *   1. Catalogue grid — system + workspace LoRA presets for the active
 *      family, multi-select up to `maxCount`.
 *   2. Selected stack  — each picked LoRA gets a scale slider 0…2 with
 *      a remove button, so weights can be tuned without leaving the popover.
 *   3. Manual URL row  — paste a `.safetensors` URL directly; client-side
 *      it's added to the selection and persisted later via the LoraPreset
 *      router (out of scope here — this picker only mutates the in-memory
 *      `value` array).
 *
 * The component is fully controlled. Parent components own the
 * `LoraWeight[]` array and pass it back through `onChange`. When
 * `family` is `null` (model doesn't support LoRA) the trigger renders
 * disabled.
 */

import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Layers, X as XIcon, Link as LinkIcon } from "lucide-react";
import type { LoraWeight } from "@/lib/ai-providers";
import type { LoraSpec } from "@/lib/ai-models";
import { useLoraPresets } from "@/hooks/useLoraPresets";

interface LoraSelectorPickerProps {
    /** Active LoRA family — null disables the picker. */
    family: LoraSpec["family"] | null;
    /** Hard cap on simultaneous LoRAs (`loraSpec.maxCount`). */
    maxCount: number;
    /** Currently selected LoRAs (parent owns this state). */
    value: LoraWeight[];
    /** Update selection — parent should also reset on model change. */
    onChange: (next: LoraWeight[]) => void;
}

export function LoraSelectorPicker({
    family,
    maxCount,
    value,
    onChange,
}: LoraSelectorPickerProps) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ left: 0, bottom: 0 });
    const { presets, isLoading } = useLoraPresets(family ?? undefined);

    const isDisabled = !family;
    const hasSelection = value.length > 0;

    // Index presets by `path` so selected state, default scales and labels
    // can be looked up cheaply during render.
    const presetByPath = useMemo(() => {
        const map = new Map<string, (typeof presets)[number]>();
        presets.forEach((p) => map.set(p.path, p));
        return map;
    }, [presets]);

    useEffect(() => {
        if (!open || !triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        setPos({
            left: rect.left,
            bottom: window.innerHeight - rect.top + 8,
        });
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                triggerRef.current && !triggerRef.current.contains(target) &&
                dropdownRef.current && !dropdownRef.current.contains(target)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    const togglePreset = (path: string, defaultScale: number) => {
        const existingIdx = value.findIndex((l) => l.path === path);
        if (existingIdx >= 0) {
            onChange(value.filter((_, i) => i !== existingIdx));
            return;
        }
        if (value.length >= maxCount) {
            // Replace the oldest entry — keeps UX predictable when the slot is
            // full instead of silently rejecting the click.
            onChange([...value.slice(1), { path, scale: defaultScale }]);
            return;
        }
        onChange([...value, { path, scale: defaultScale }]);
    };

    const updateScale = (path: string, scale: number) => {
        onChange(value.map((l) => (l.path === path ? { ...l, scale } : l)));
    };

    const removeAt = (path: string) => {
        onChange(value.filter((l) => l.path !== path));
    };

    return (
        <>
            <button
                ref={triggerRef}
                onClick={() => !isDisabled && setOpen(!open)}
                disabled={isDisabled}
                title={
                    isDisabled
                        ? "Текущая модель не поддерживает LoRA"
                        : "Выбрать LoRA-стилизацию"
                }
                className={`
                    flex items-center gap-1.5 px-2.5 py-1 rounded-[10px]
                    border text-[12px] font-medium transition-all
                    ${isDisabled
                        ? "text-text-tertiary border-border-primary/40 bg-bg-tertiary/30 cursor-not-allowed opacity-50"
                        : hasSelection
                            ? "text-amber-500 border-amber-400/40 bg-amber-500/5 hover:bg-amber-500/10 cursor-pointer"
                            : "text-text-secondary border-border-primary/60 hover:border-border-secondary hover:bg-bg-tertiary/30 cursor-pointer"
                    }
                `}
            >
                <Layers size={13} className={hasSelection ? "text-amber-400" : "text-text-tertiary"} />
                <span className="max-w-[80px] truncate">
                    {hasSelection ? `LoRA · ${value.length}` : "LoRA"}
                </span>
                {hasSelection ? (
                    <span
                        role="button"
                        className="text-amber-400 hover:text-amber-300 ml-0.5"
                        onClick={(e) => { e.stopPropagation(); onChange([]); }}
                        title="Сбросить LoRA"
                    >
                        <XIcon size={10} />
                    </span>
                ) : (
                    <ChevronDown
                        size={10}
                        className={`text-text-tertiary transition-transform ${open ? "rotate-180" : ""}`}
                    />
                )}
            </button>

            {open && createPortal(
                <div
                    ref={dropdownRef}
                    className="fixed w-[320px] bg-bg-surface border border-border-primary rounded-[var(--radius-lg)] shadow-xl p-3 max-h-[480px] overflow-y-auto animate-in fade-in slide-in-from-bottom-2 duration-150"
                    style={{ left: pos.left, bottom: pos.bottom, zIndex: 9999 }}
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">
                            LoRA · до {maxCount} одновременно
                        </div>
                        <div className="text-[10px] text-text-tertiary">
                            {value.length}/{maxCount}
                        </div>
                    </div>

                    {/* Selected stack with scale sliders */}
                    {value.length > 0 && (
                        <div className="space-y-2 mb-3">
                            {value.map((sel) => {
                                const meta = presetByPath.get(sel.path);
                                return (
                                    <SelectedLoraRow
                                        key={sel.path}
                                        path={sel.path}
                                        scale={sel.scale ?? 1}
                                        label={meta?.name ?? extractFilename(sel.path)}
                                        onScaleChange={(s) => updateScale(sel.path, s)}
                                        onRemove={() => removeAt(sel.path)}
                                    />
                                );
                            })}
                        </div>
                    )}

                    {/* Catalogue grid */}
                    <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">
                        Каталог
                    </div>
                    {isLoading ? (
                        <div className="text-[11px] text-text-tertiary py-3 text-center">
                            Загрузка пресетов…
                        </div>
                    ) : presets.length === 0 ? (
                        <div className="rounded-[var(--radius-md)] border border-dashed border-border-primary px-3 py-5 text-center">
                            <p className="text-[11px] font-medium text-text-secondary">
                                Нет пресетов для модели
                            </p>
                            <p className="mt-1 text-[10px] text-text-tertiary">
                                Добавьте свой `.safetensors` URL ниже.
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 gap-1.5">
                            {presets.map((preset) => {
                                const isSelected = value.some((l) => l.path === preset.path);
                                return (
                                    <button
                                        key={preset.id}
                                        onClick={() => togglePreset(preset.path, preset.defaultScale)}
                                        className={`relative flex flex-col items-center p-1 rounded-[var(--radius-sm)] border transition-all cursor-pointer ${isSelected
                                                ? "border-amber-400 bg-amber-500/5"
                                                : "border-transparent hover:bg-bg-tertiary"
                                            }`}
                                        title={preset.description || preset.name}
                                    >
                                        <div className="w-full aspect-square rounded-sm overflow-hidden bg-bg-tertiary mb-1">
                                            {preset.previewUrl ? (
                                                <img
                                                    src={preset.previewUrl}
                                                    alt={preset.name}
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-text-tertiary">
                                                    <Layers size={16} />
                                                </div>
                                            )}
                                        </div>
                                        <span className="text-[9px] text-text-secondary truncate w-full text-center">
                                            {preset.name}
                                        </span>
                                        {isSelected && (
                                            <div className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-amber-400 flex items-center justify-center">
                                                <Check size={8} className="text-white" />
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* Manual URL */}
                    <div className="mt-3 border-t border-border-primary pt-3">
                        <ManualUrlRow
                            disabled={value.length >= maxCount}
                            onAdd={(url) => {
                                if (value.some((l) => l.path === url)) return;
                                if (value.length >= maxCount) return;
                                onChange([...value, { path: url, scale: 1 }]);
                            }}
                        />
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}

// ─── Sub-components ───────────────────────────────────────

function SelectedLoraRow({
    path: _path,
    scale,
    label,
    onScaleChange,
    onRemove,
}: {
    path: string;
    scale: number;
    label: string;
    onScaleChange: (s: number) => void;
    onRemove: () => void;
}) {
    return (
        <div className="rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary p-2">
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-text-primary truncate" title={label}>
                    {label}
                </span>
                <button
                    onClick={onRemove}
                    className="text-text-tertiary hover:text-text-primary cursor-pointer p-0.5"
                    title="Убрать"
                >
                    <XIcon size={11} />
                </button>
            </div>
            <div className="flex items-center gap-2">
                <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={scale}
                    onChange={(e) => onScaleChange(parseFloat(e.target.value))}
                    className="flex-1 accent-amber-400 h-1"
                />
                <span className="text-[10px] tabular-nums text-text-secondary w-9 text-right">
                    {scale.toFixed(2)}
                </span>
            </div>
        </div>
    );
}

function ManualUrlRow({
    disabled,
    onAdd,
}: {
    disabled: boolean;
    onAdd: (url: string) => void;
}) {
    const [url, setUrl] = useState("");
    const [error, setError] = useState<string | null>(null);

    const handleAdd = () => {
        const trimmed = url.trim();
        if (!trimmed) return;
        try {
            const parsed = new URL(trimmed);
            if (parsed.protocol !== "https:") {
                setError("Только HTTPS URL");
                return;
            }
        } catch {
            setError("Невалидный URL");
            return;
        }
        setError(null);
        onAdd(trimmed);
        setUrl("");
    };

    return (
        <div>
            <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <LinkIcon size={10} />
                Свой `.safetensors` URL
            </div>
            <div className="flex items-center gap-1.5">
                <input
                    type="url"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); setError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                    placeholder="https://huggingface.co/.../weights.safetensors"
                    disabled={disabled}
                    className="flex-1 px-2 py-1 text-[11px] rounded-[var(--radius-sm)] border border-border-primary bg-bg-secondary text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-amber-400 disabled:opacity-50"
                />
                <button
                    onClick={handleAdd}
                    disabled={disabled || !url.trim()}
                    className="px-2 py-1 text-[11px] font-medium rounded-[var(--radius-sm)] bg-amber-500/15 text-amber-500 border border-amber-400/30 hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                    +
                </button>
            </div>
            {error && (
                <p className="mt-1 text-[10px] text-error">{error}</p>
            )}
            {disabled && !error && (
                <p className="mt-1 text-[10px] text-text-tertiary">
                    Достигнут лимит LoRA — освободите слот, чтобы добавить ещё.
                </p>
            )}
        </div>
    );
}

function extractFilename(url: string): string {
    try {
        const u = new URL(url);
        const parts = u.pathname.split("/");
        const last = parts[parts.length - 1] ?? url;
        return last.replace(/\.safetensors$/i, "");
    } catch {
        return url;
    }
}
