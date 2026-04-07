"use client";

/**
 * StylePresetPicker — Reusable style preset selector.
 *
 * Used across all AI surfaces:
 * - AIPromptBar ("compact" variant — outlined pill with portal dropdown)
 * - ImageContentBlock / Wizard ("grid" variant — full tile grid with categories)
 * - ImageEditorModal ("inline" variant — small chip row)
 *
 * Supports both image and text presets via the `presetType` prop.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Palette, Type, X as XIcon } from "lucide-react";
import type {
  ImageStylePreset,
  TextStylePreset,
  ImageStyleCategory,
} from "@/lib/stylePresets";
import {
  IMAGE_CATEGORY_LABELS,
  groupImagePresetsByCategory,
} from "@/lib/stylePresets";

// ─── Image Style Preset Picker ───────────────────────────────────────────────

interface ImageStylePresetPickerProps {
  presets: ImageStylePreset[];
  selectedId: string;
  onChange: (id: string) => void;
  variant?: "grid" | "compact" | "inline";
}

export function ImageStylePresetPicker({
  presets,
  selectedId,
  onChange,
  variant = "grid",
}: ImageStylePresetPickerProps) {
  if (variant === "compact") {
    return (
      <CompactImagePicker
        presets={presets}
        selectedId={selectedId}
        onChange={onChange}
      />
    );
  }

  if (variant === "inline") {
    return (
      <InlineImagePicker
        presets={presets}
        selectedId={selectedId}
        onChange={onChange}
      />
    );
  }

  // Default: grid variant with categories
  return (
    <GridImagePicker
      presets={presets}
      selectedId={selectedId}
      onChange={onChange}
    />
  );
}

// ─── Grid Variant (Wizard) ──────────────────────────────────────────────────

function GridImagePicker({
  presets,
  selectedId,
  onChange,
}: {
  presets: ImageStylePreset[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  const nonePreset = presets.find((p) => p.id === "none");
  const grouped = groupImagePresetsByCategory(presets);
  const categoryOrder: ImageStyleCategory[] = [
    "photography",
    "digital",
    "artistic",
    "custom",
  ];

  return (
    <div className="space-y-3">
      {/* "No style" option */}
      {nonePreset && (
        <button
          onClick={() => onChange("none")}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-[var(--radius-md)] border transition-all cursor-pointer ${
            selectedId === "none"
              ? "border-accent-primary bg-accent-primary/5 ring-1 ring-accent-primary"
              : "border-border-primary hover:border-accent-primary/40 bg-bg-secondary"
          }`}
        >
          <div className="w-10 h-10 rounded-lg bg-bg-tertiary flex items-center justify-center text-text-tertiary">
            ✕
          </div>
          <div className="text-left">
            <div className="text-xs font-medium text-text-primary">
              {nonePreset.label}
            </div>
            <div className="text-[10px] text-text-tertiary">
              {nonePreset.description}
            </div>
          </div>
          {selectedId === "none" && (
            <Check size={14} className="ml-auto text-accent-primary" />
          )}
        </button>
      )}

      {/* Categories */}
      {categoryOrder.map((cat) => {
        const items = grouped[cat];
        if (items.length === 0) return null;
        return (
          <div key={cat}>
            <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">
              {IMAGE_CATEGORY_LABELS[cat]}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {items.map((preset) => (
                <StyleTile
                  key={preset.id}
                  preset={preset}
                  isSelected={selectedId === preset.id}
                  onClick={() => onChange(preset.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StyleTile({
  preset,
  isSelected,
  onClick,
}: {
  preset: ImageStylePreset;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative group flex flex-col items-center p-1.5 rounded-[var(--radius-md)] border transition-all cursor-pointer ${
        isSelected
          ? "border-accent-primary bg-accent-primary/5 ring-1 ring-accent-primary"
          : "border-border-primary hover:border-accent-primary/40 bg-bg-secondary hover:bg-bg-tertiary"
      }`}
    >
      <div className="w-full aspect-square rounded-[var(--radius-sm)] overflow-hidden bg-bg-tertiary mb-1.5">
        <img
          src={preset.thumbnailUrl}
          alt={preset.label}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      <span className="text-[10px] font-medium text-text-primary truncate w-full text-center">
        {preset.label}
      </span>
      {isSelected && (
        <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-accent-primary flex items-center justify-center">
          <Check size={10} className="text-white" />
        </div>
      )}
    </button>
  );
}

// ─── Compact Variant (AIPromptBar) ──────────────────────────────────────────
// Uses portal-based dropdown to prevent clipping by parent overflow

function CompactImagePicker({
  presets,
  selectedId,
  onChange,
}: {
  presets: ImageStylePreset[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selected = presets.find((p) => p.id === selectedId);
  const hasStyle = selectedId !== "none";

  // Position state for portal dropdown
  const [pos, setPos] = useState({ left: 0, bottom: 0 });

  // Recalculate position when opening
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 8,
    });
  }, [open]);

  // Close on outside click
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

  return (
    <>
      {/* Trigger — outlined pill matching other selectors */}
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className={`
          flex items-center gap-1.5 px-2.5 py-1 rounded-[10px]
          border text-[12px] font-medium transition-all cursor-pointer
          ${hasStyle
            ? "text-violet-500 border-violet-400/40 bg-violet-500/5 hover:bg-violet-500/10"
            : "text-text-secondary border-border-primary/60 hover:border-border-secondary hover:bg-bg-tertiary/30"
          }
        `}
      >
        <Palette size={13} className={hasStyle ? "text-violet-400" : "text-text-tertiary"} />
        <span className="max-w-[80px] truncate">
          {hasStyle && selected ? selected.label : "Стиль"}
        </span>
        {/* Reset button — shown when a style is active */}
        {hasStyle ? (
          <span
            role="button"
            className="text-violet-400 hover:text-violet-300 ml-0.5"
            onClick={(e) => { e.stopPropagation(); onChange("none"); }}
            title="Сбросить стиль"
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

      {/* Portal dropdown — renders at body level to avoid clipping */}
      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed w-[280px] bg-bg-surface border border-border-primary rounded-[var(--radius-lg)] shadow-xl p-3 max-h-[360px] overflow-y-auto animate-in fade-in slide-in-from-bottom-2 duration-150"
          style={{ left: pos.left, bottom: pos.bottom, zIndex: 9999 }}
        >
          <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-2">
            Стиль генерации
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {presets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => {
                  // Toggle: clicking the same preset resets to "none"
                  onChange(selectedId === preset.id ? "none" : preset.id);
                  setOpen(false);
                }}
                className={`relative flex flex-col items-center p-1 rounded-[var(--radius-sm)] border transition-all cursor-pointer ${
                  selectedId === preset.id
                    ? "border-accent-primary bg-accent-primary/5"
                    : "border-transparent hover:bg-bg-tertiary"
                }`}
              >
                <div className="w-full aspect-square rounded-sm overflow-hidden bg-bg-tertiary mb-1">
                  <img
                    src={preset.thumbnailUrl}
                    alt={preset.label}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <span className="text-[9px] text-text-secondary truncate w-full text-center">
                  {preset.label}
                </span>
                {selectedId === preset.id && (
                  <div className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-accent-primary flex items-center justify-center">
                    <Check size={8} className="text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ─── Inline Variant (ImageEditorModal) ──────────────────────────────────────

function InlineImagePicker({
  presets,
  selectedId,
  onChange,
}: {
  presets: ImageStylePreset[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {presets.map((preset) => (
        <button
          key={preset.id}
          onClick={() =>
            onChange(selectedId === preset.id ? "none" : preset.id)
          }
          className={`px-2.5 py-1 text-[10px] font-medium rounded-full border transition-all cursor-pointer ${
            selectedId === preset.id
              ? "bg-violet-500/15 text-violet-400 border-violet-500/30"
              : "bg-bg-secondary text-text-secondary border-border-primary hover:bg-bg-tertiary"
          }`}
          title={preset.description}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

// ─── Text Style Preset Picker ────────────────────────────────────────────────

interface TextStylePresetPickerProps {
  presets: TextStylePreset[];
  selectedId: string | undefined;
  onChange: (id: string | undefined) => void;
  variant?: "chips" | "compact";
}

export function TextStylePresetPicker({
  presets,
  selectedId,
  onChange,
  variant = "chips",
}: TextStylePresetPickerProps) {
  if (variant === "compact") {
    return (
      <CompactTextPicker
        presets={presets}
        selectedId={selectedId}
        onChange={onChange}
      />
    );
  }

  // Default: chips (used in wizard TextContentBlock / TextGroupSlot)
  return (
    <div className="flex gap-1.5 flex-wrap">
      {presets.map((preset) => (
        <button
          key={preset.id}
          onClick={() =>
            onChange(selectedId === preset.id ? undefined : preset.id)
          }
          className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-all cursor-pointer ${
            selectedId === preset.id
              ? "bg-accent-primary text-text-inverse border-accent-primary"
              : "bg-bg-primary text-text-secondary border-border-primary hover:bg-bg-tertiary"
          }`}
          title={preset.description}
        >
          {preset.icon} {preset.label}
        </button>
      ))}
    </div>
  );
}

// ─── Compact Text Picker (AIPromptBar) ──────────────────────────────────────
// Uses portal-based dropdown to prevent clipping by parent overflow

function CompactTextPicker({
  presets,
  selectedId,
  onChange,
}: {
  presets: TextStylePreset[];
  selectedId: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selected = presets.find((p) => p.id === selectedId);
  const hasStyle = !!selectedId;

  // Position state for portal dropdown
  const [pos, setPos] = useState({ left: 0, bottom: 0 });

  // Recalculate position when opening
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 8,
    });
  }, [open]);

  // Close on outside click
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

  return (
    <>
      {/* Trigger — outlined pill */}
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className={`
          flex items-center gap-1.5 px-2.5 py-1 rounded-[10px]
          border text-[12px] font-medium transition-all cursor-pointer
          ${hasStyle
            ? "text-blue-500 border-blue-400/40 bg-blue-500/5 hover:bg-blue-500/10"
            : "text-text-secondary border-border-primary/60 hover:border-border-secondary hover:bg-bg-tertiary/30"
          }
        `}
      >
        <Type size={13} className={hasStyle ? "text-blue-400" : "text-text-tertiary"} />
        <span className="max-w-[80px] truncate">
          {selected ? selected.label : "Тон"}
        </span>
        {/* Reset button — shown when a style is active */}
        {hasStyle ? (
          <span
            role="button"
            className="text-blue-400 hover:text-blue-300 ml-0.5"
            onClick={(e) => { e.stopPropagation(); onChange(undefined); }}
            title="Сбросить тон"
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

      {/* Portal dropdown */}
      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed w-[200px] bg-bg-surface border border-border-primary rounded-[var(--radius-lg)] shadow-xl py-1.5 animate-in fade-in slide-in-from-bottom-2 duration-150"
          style={{ left: pos.left, bottom: pos.bottom, zIndex: 9999 }}
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">
            Стиль текста
          </div>
          {/* "None" option */}
          <button
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-2 text-[11px] flex items-center gap-2 transition-colors cursor-pointer ${
              !selectedId
                ? "text-blue-400 bg-blue-500/5"
                : "text-text-secondary hover:bg-bg-secondary"
            }`}
          >
            <span className="w-4 text-center">✕</span>
            <span>Без стиля</span>
          </button>
          {presets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => {
                // Toggle: clicking the same preset resets to undefined
                onChange(selectedId === preset.id ? undefined : preset.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-[11px] flex items-center gap-2 transition-colors cursor-pointer ${
                selectedId === preset.id
                  ? "text-blue-400 bg-blue-500/5"
                  : "text-text-secondary hover:bg-bg-secondary"
              }`}
            >
              <span className="w-4 text-center">{preset.icon}</span>
              <span>{preset.label}</span>
              {selectedId === preset.id && (
                <Check size={10} className="ml-auto" />
              )}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
