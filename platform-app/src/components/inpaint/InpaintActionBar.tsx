/**
 * InpaintActionBar — compact control row shown in prompt bars when a user is
 * actively drawing an inpaint mask.
 *
 * Layout (left → right):
 *   [brush size slider] [eraser toggle] [undo] [clear]
 *
 * When `hasMask` is true the bar exposes the two main actions:
 *   • "Правка" (intent="edit")    — uses the user prompt + per-model suffix
 *   • "Удалить" (intent="remove") — fixed object-removal instruction
 *
 * The bar is intentionally headless about prompts and selected model — it
 * just emits the two intents. The caller (AIPromptBar / PhotoPromptBar /
 * WizardLayerPromptBar) is in charge of resolving the prompt and dispatching
 * to /api/ai/image-edit.
 */

"use client";

import { Paintbrush, Eraser, Undo2, Trash2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { UseInpaintMaskApi } from "@/hooks/useInpaintMask";

export type InpaintAction = "edit" | "remove";

export interface InpaintActionBarProps {
    mask: UseInpaintMaskApi;
    /** Called when the user clicks "Правка" or "Удалить". */
    onAction: (action: InpaintAction) => void;
    /** Disable all actions and brush controls (e.g. while generating). */
    disabled?: boolean;
    /** Disable just the action buttons (e.g. when user prompt is empty). */
    editDisabled?: boolean;
    /** Reason hint for tooltip when editDisabled is true. */
    editDisabledHint?: string;
    /** Whether to render the "Cancel inpaint" button on the far right. */
    onCancel?: () => void;
    /** Min/max brush size in screen px. */
    minBrushSize?: number;
    maxBrushSize?: number;
}

export function InpaintActionBar({
    mask,
    onAction,
    disabled = false,
    editDisabled = false,
    editDisabledHint,
    onCancel,
    minBrushSize = 8,
    maxBrushSize = 120,
}: InpaintActionBarProps) {
    const eraseLabel = mask.eraserActive ? "Кисть" : "Ластик";
    const eraseIcon = mask.eraserActive ? <Paintbrush size={14} /> : <Eraser size={14} />;

    return (
        <div className="flex flex-wrap items-center gap-2 p-2 rounded-[var(--radius-md)] bg-bg-tertiary border border-border-primary">
            {/* Brush size */}
            <div className="flex items-center gap-2 px-2">
                <Paintbrush size={14} className="text-text-secondary" />
                <input
                    type="range"
                    min={minBrushSize}
                    max={maxBrushSize}
                    value={mask.brushSize}
                    onChange={(e) => mask.setBrushSize(Number(e.target.value))}
                    disabled={disabled}
                    className="w-24 accent-accent-primary cursor-pointer disabled:cursor-not-allowed"
                />
                <span className="text-[10px] font-mono text-text-tertiary w-8 text-right">
                    {mask.brushSize}px
                </span>
            </div>

            <div className="h-5 w-px bg-border-primary" />

            {/* Tool toggle: brush ↔ eraser */}
            <button
                type="button"
                onClick={() => mask.setEraserActive(!mask.eraserActive)}
                disabled={disabled}
                title={eraseLabel}
                className={
                    "h-7 px-2.5 inline-flex items-center gap-1.5 rounded-full text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed "
                    + (mask.eraserActive
                        ? "bg-red-500/15 text-red-500 border border-red-500/30"
                        : "bg-bg-surface text-text-secondary border border-border-primary hover:bg-bg-secondary")
                }
            >
                {eraseIcon}
                <span>{eraseLabel}</span>
            </button>

            {/* Undo / Clear */}
            <button
                type="button"
                onClick={mask.undo}
                disabled={disabled || !mask.hasMask}
                title="Отменить последний штрих"
                className="h-7 w-7 inline-flex items-center justify-center rounded-full text-text-secondary hover:bg-bg-secondary disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
            >
                <Undo2 size={14} />
            </button>
            <button
                type="button"
                onClick={mask.clear}
                disabled={disabled || !mask.hasMask}
                title="Очистить маску"
                className="h-7 w-7 inline-flex items-center justify-center rounded-full text-text-secondary hover:bg-bg-secondary disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
            >
                <Trash2 size={14} />
            </button>

            <div className="flex-1 min-w-2" />

            {/* Actions — show only when there is something to inpaint. */}
            {mask.hasMask && (
                <>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        icon={<Wand2 size={14} />}
                        onClick={() => onAction("edit")}
                        disabled={disabled || editDisabled}
                        title={editDisabled ? editDisabledHint : "Заменить выделенную область по промпту"}
                    >
                        Правка
                    </Button>
                    <Button
                        type="button"
                        variant="accent"
                        size="sm"
                        icon={<Eraser size={14} />}
                        onClick={() => onAction("remove")}
                        disabled={disabled}
                        title="Очистить выделенную область (без промпта)"
                    >
                        Удалить
                    </Button>
                </>
            )}

            {onCancel && (
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={disabled}
                    title="Выйти из inpaint"
                    className="h-7 w-7 inline-flex items-center justify-center rounded-full text-text-tertiary hover:text-text-primary hover:bg-bg-secondary disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                    <X size={14} />
                </button>
            )}
        </div>
    );
}
