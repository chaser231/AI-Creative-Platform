/**
 * Maps `outpaintImage`'s `onProgress` stage events to user-friendly
 * Russian status messages and a coarse 0-100 percent for an indicative
 * progress bar.
 *
 * Why a separate module: both the studio (`AIPromptBar`) and the wizard
 * (`WizardContentWorkspace`) call `outpaintImage` and need identical
 * progress UX. Centralising the strings + ordering here keeps the two
 * call sites byte-compatible and lets us iterate on copy without
 * touching either component.
 *
 * Design notes:
 *   - Internal/diagnostic events ("preserve-pipeline-armed",
 *     "border-strips-stitched", "border-only-skipped-feather-too-large",
 *     "preserve-no-upscale-needed", "pass-1-done", "pass-2-done",
 *     "outpaint-api-done") return `null`. The UI keeps the previous
 *     non-null status visible so the bar doesn't flicker on noisy
 *     internal transitions.
 *   - Percent values are intentionally non-linear: the API call
 *     ("outpaint-api-start") jumps from 25→40% but holds there until
 *     "preserve-upscale-start" lands (~25-40s later). The UI is
 *     expected to render an indeterminate spinner alongside the
 *     percent so a stationary bar feels alive.
 *   - Multipass (passDepth > 0) sub-passes emit pass-1-start /
 *     pass-2-start before recursing — those map to a different label
 *     band so the user understands "this is taking longer because
 *     it's two passes".
 */

export interface OutpaintProgressState {
    /** User-facing Russian label, e.g. "Расширяем фон с помощью AI". */
    label: string;
    /**
     * Coarse progress 0..100. The bar should NOT animate between these
     * values smoothly — instead snap, and animate the indeterminate
     * spinner over the bar to convey ongoing work. Holds the same
     * value across multiple internal events for a given stage.
     */
    percent: number;
}

/**
 * Map a raw stage name from `outpaintImage`'s `onProgress` callback to
 * a user-facing state. Returns `null` for internal/diagnostic events
 * the user shouldn't see — callers should keep their previous state in
 * that case.
 */
export function mapOutpaintStage(stage: string): OutpaintProgressState | null {
    switch (stage) {
        case "input-persisted":
            return { label: "Подготавливаем изображение", percent: 10 };
        case "downscaled":
            return { label: "Подбираем оптимальный размер для модели", percent: 20 };
        case "outpaint-api-start":
            return { label: "Расширяем фон с помощью AI", percent: 30 };
        // outpaint-api-done is intentionally NOT here — the next
        // meaningful stage ("preserve-upscale-start" or
        // "preserve-no-upscale-needed") will move the bar forward.
        case "preserve-upscale-start":
            return { label: "Восстанавливаем разрешение границ", percent: 70 };
        case "preserve-composite-done":
            return { label: "Совмещаем с оригиналом", percent: 90 };
        case "output-persisted":
            return { label: "Сохраняем результат", percent: 95 };
        // Multipass — sub-pass markers. The recursive sub-pass itself
        // re-emits all the internal events (input-persisted,
        // outpaint-api-start, etc.) which would normally flicker the
        // label back to "Подготавливаем" — the wizard/studio guards
        // against that by keeping pass-1-start / pass-2-start labels
        // dominant for the duration of the sub-pass.
        case "pass-1-start":
            return { label: "Шаг 1 из 2: первая часть расширения", percent: 15 };
        case "pass-2-start":
            return { label: "Шаг 2 из 2: вторая часть расширения", percent: 60 };
        default:
            return null;
    }
}

/** Final state to render right before resolving the outpaint promise. */
export const OUTPAINT_DONE_STATE: OutpaintProgressState = {
    label: "Готово",
    percent: 100,
};
