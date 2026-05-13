"use client";

/**
 * ModelSettingsModal — advanced LoRA-aware parameters for the active model.
 *
 * Surfaces fal.ai's low-level knobs (guidance scale, inference steps,
 * negative prompt, hardware acceleration) without cluttering the
 * default prompt bar. Opened from a small gear chip next to the model
 * selector.
 *
 * UX rules:
 *   - All controls are pre-filled with the model's defaults from
 *     `loraSpec`. Sliders are clamped to that model's `*Range`.
 *   - Fields the model doesn't expose (e.g. negative prompt on Qwen
 *     Image Edit) are hidden so users never see something the backend
 *     would silently drop.
 *   - "Reset to defaults" wipes the override back to `undefined` so the
 *     server falls back to `loraSpec.default*` — no permanent overrides
 *     leak between models.
 *
 * The modal is fully controlled. Parent components own the
 * `AdvancedAIParams` shape (subset of AIRequestParams the user can
 * tweak) and pass it back via `onChange`.
 */

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { LoraSpec } from "@/lib/ai-models";

export interface AdvancedAIParams {
    guidanceScale?: number;
    numInferenceSteps?: number;
    negativePrompt?: string;
    acceleration?: string;
}

interface ModelSettingsModalProps {
    open: boolean;
    onClose: () => void;
    /** loraSpec of the active model — drives field visibility & defaults. */
    spec: LoraSpec;
    /** Currently overridden values. */
    value: AdvancedAIParams;
    /** Persist overrides on the parent. */
    onChange: (next: AdvancedAIParams) => void;
}

export function ModelSettingsModal({
    open,
    onClose,
    spec,
    value,
    onChange,
}: ModelSettingsModalProps) {
    // Local draft so cancel actually cancels — parent doesn't see edits
    // until "Применить" is pressed.
    const [draft, setDraft] = useState<AdvancedAIParams>(value);

    useEffect(() => {
        if (open) setDraft(value);
    }, [open, value]);

    const guidance = draft.guidanceScale ?? spec.defaultGuidance;
    const steps = draft.numInferenceSteps ?? spec.defaultSteps;
    const acceleration = draft.acceleration ?? spec.accelerationOptions?.[0] ?? "regular";
    const negativePrompt = draft.negativePrompt ?? "";

    const handleApply = () => {
        onChange(draft);
        onClose();
    };

    const handleReset = () => {
        setDraft({});
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Параметры модели"
            maxWidth="max-w-md"
            footer={
                <>
                    <Button variant="secondary" onClick={handleReset}>
                        Сбросить к умолчаниям
                    </Button>
                    <Button onClick={handleApply}>Применить</Button>
                </>
            }
        >
            <div className="space-y-5">
                {/* Guidance scale */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-[12px] font-medium text-text-primary">
                            Guidance scale
                        </label>
                        <span className="text-[11px] tabular-nums text-text-secondary">
                            {guidance.toFixed(1)}
                        </span>
                    </div>
                    <input
                        type="range"
                        min={spec.guidanceRange[0]}
                        max={spec.guidanceRange[1]}
                        step={0.1}
                        value={guidance}
                        onChange={(e) =>
                            setDraft((d) => ({ ...d, guidanceScale: parseFloat(e.target.value) }))
                        }
                        className="w-full accent-amber-400 h-1"
                    />
                    <p className="mt-1 text-[10px] text-text-tertiary">
                        Сила следования промту. Ниже — творческие интерпретации,
                        выше — буквальное соответствие.
                    </p>
                </div>

                {/* Inference steps */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-[12px] font-medium text-text-primary">
                            Шаги инференса
                        </label>
                        <span className="text-[11px] tabular-nums text-text-secondary">
                            {steps}
                        </span>
                    </div>
                    <input
                        type="range"
                        min={spec.stepsRange[0]}
                        max={spec.stepsRange[1]}
                        step={1}
                        value={steps}
                        onChange={(e) =>
                            setDraft((d) => ({ ...d, numInferenceSteps: parseInt(e.target.value, 10) }))
                        }
                        className="w-full accent-amber-400 h-1"
                    />
                    <p className="mt-1 text-[10px] text-text-tertiary">
                        Больше шагов — лучше детализация, но медленнее и дороже.
                    </p>
                </div>

                {/* Acceleration */}
                {spec.supportsAcceleration && spec.accelerationOptions && spec.accelerationOptions.length > 1 && (
                    <div>
                        <label className="block text-[12px] font-medium text-text-primary mb-2">
                            Скорость генерации
                        </label>
                        <div className="grid grid-cols-3 gap-1.5">
                            {spec.accelerationOptions.map((opt) => (
                                <button
                                    key={opt}
                                    onClick={() =>
                                        setDraft((d) => ({ ...d, acceleration: opt }))
                                    }
                                    className={`py-1.5 text-[11px] font-medium rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${acceleration === opt
                                            ? "border-amber-400 bg-amber-500/10 text-amber-500"
                                            : "border-border-primary bg-bg-secondary text-text-secondary hover:bg-bg-tertiary"
                                        }`}
                                >
                                    {ACCELERATION_LABELS[opt] ?? opt}
                                </button>
                            ))}
                        </div>
                        <p className="mt-1 text-[10px] text-text-tertiary">
                            High — быстрее, regular — стабильнее качество.
                        </p>
                    </div>
                )}

                {/* Negative prompt */}
                {spec.supportsNegativePrompt && (
                    <div>
                        <label className="block text-[12px] font-medium text-text-primary mb-2">
                            Negative prompt
                        </label>
                        <textarea
                            value={negativePrompt}
                            onChange={(e) =>
                                setDraft((d) => ({
                                    ...d,
                                    negativePrompt: e.target.value || undefined,
                                }))
                            }
                            rows={3}
                            placeholder="например: blurry, low quality, extra fingers"
                            className="w-full px-2.5 py-2 text-[12px] rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-amber-400 resize-none"
                        />
                        <p className="mt-1 text-[10px] text-text-tertiary">
                            Что модель должна избегать в результате.
                        </p>
                    </div>
                )}
            </div>
        </Modal>
    );
}

const ACCELERATION_LABELS: Record<string, string> = {
    none: "Без ускорения",
    regular: "Обычное",
    high: "Быстрое",
};
