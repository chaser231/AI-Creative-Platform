"use client";

import { Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";

interface OutpaintProgressIndicatorProps {
    /**
     * The label currently shown to the user. When `null`, the indicator
     * collapses to nothing (e.g. before the pipeline starts or after it
     * finishes).
     */
    label: string | null;
    /**
     * 0..100 indicative progress. The bar snaps to this value rather
     * than animating between, so the indeterminate spinner inside the
     * label is what conveys "still working" during the long
     * outpaint-api-start hold.
     */
    percent: number;
    /** Optional class to override layout (mostly for spacing). */
    className?: string;
}

/**
 * Inline status banner shown while `outpaintImage` is running.
 *
 * Used by both the studio (`AIPromptBar`) and the wizard
 * (`WizardContentWorkspace`) to surface pipeline stage progress to the
 * user. Designed to be compact enough to fit in either prompt-bar
 * footer without forcing layout shifts. The bar's percent is fed by
 * `mapOutpaintStage` (see `@/utils/outpaintProgress`).
 *
 * Visual contract:
 *   - When `label === null`: renders nothing. Callers are expected to
 *     toggle visibility themselves (typically by passing `null` when
 *     `isGenerating === false`).
 *   - When the bar is at or past 30% (the "outpaint-api-start" stage),
 *     the bar pulses with an indeterminate animation overlay so the
 *     ~25-40s flux call doesn't feel stuck.
 */
export function OutpaintProgressIndicator({
    label,
    percent,
    className,
}: OutpaintProgressIndicatorProps) {
    if (!label) return null;

    // Clamp for safety — mapOutpaintStage should already return 0..100.
    const clamped = Math.max(0, Math.min(100, percent));
    const indeterminate = clamped >= 30 && clamped < 95;

    return (
        <div
            className={cn(
                "flex flex-col gap-1.5 px-3 py-2 rounded-[10px] border border-border-primary/60 bg-bg-tertiary/40",
                className,
            )}
            role="status"
            aria-live="polite"
            aria-busy="true"
        >
            <div className="flex items-center gap-2 text-[12px] text-text-secondary">
                <Loader2 size={13} className="animate-spin shrink-0" />
                <span className="flex-1 truncate">{label}</span>
                <span className="text-[10px] tabular-nums text-text-tertiary shrink-0">
                    {Math.round(clamped)}%
                </span>
            </div>
            <div
                className="relative h-[3px] w-full overflow-hidden rounded-full bg-bg-secondary/60"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(clamped)}
            >
                {/* Snap-to-percent fill — gives a coarse sense of how
                    far through the pipeline we are. */}
                <div
                    className="absolute inset-y-0 left-0 bg-accent-primary/80 transition-[width] duration-300"
                    style={{ width: `${clamped}%` }}
                />
                {/* Indeterminate shimmer overlay during the long
                    outpaint-api-start hold (30%..70%). Keeps the bar
                    feeling "alive" even when percent doesn't move. */}
                {indeterminate && (
                    <div
                        className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-outpaint-progress-shimmer"
                        aria-hidden="true"
                    />
                )}
            </div>
        </div>
    );
}
