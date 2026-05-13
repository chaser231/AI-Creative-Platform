"use client";

/**
 * LoraTriggerHint — visual mirror of the server-side trigger-word
 * auto-injection.
 *
 * `FalProvider.generateLora` automatically prepends the union of every
 * selected LoRA's `triggerWords` (deduped via `new Set(...)`) to the user's
 * prompt before calling fal.ai. The user has no way of knowing this is
 * happening unless we surface it in the UI — otherwise they'd type those
 * words manually and end up with subtle duplication or misformed prompts.
 *
 * This component reads the same `loraPreset.list` data the picker uses,
 * matches it against the currently selected `LoraWeight[]`, and renders a
 * compact non-interactive hint right under the prompt textarea / picker:
 *
 *   ✨ + к промпту: studio lighting, clean background      ⓘ
 *
 * The hint hides itself when:
 *   - no model with `loraSpec` is active (`family === null`), OR
 *   - no LoRAs are selected, OR
 *   - none of the selected LoRAs have trigger words.
 *
 * Server behavior is the source of truth: the same dedup happens on the
 * server, so even if the user copies these words into the prompt manually,
 * the dedup keeps the final prompt clean.
 */

import { Sparkles, Info } from "lucide-react";
import { useMemo } from "react";
import type { LoraWeight } from "@/lib/ai-providers";
import type { LoraSpec } from "@/lib/ai-models";
import { useLoraPresets } from "@/hooks/useLoraPresets";

interface LoraTriggerHintProps {
    /** Active LoRA family — null disables the hint (no model has `loraSpec`). */
    family: LoraSpec["family"] | null;
    /** Currently selected LoRAs (same array passed to LoraSelectorPicker). */
    loras: LoraWeight[];
    /** Optional className for layout tweaks at the call site. */
    className?: string;
}

export function LoraTriggerHint({ family, loras, className }: LoraTriggerHintProps) {
    const { presets } = useLoraPresets(family ?? undefined);

    // Dedup mirrors `FalProvider.generateLora` exactly: union of triggerWords
    // across every selected preset, preserving first-occurrence order.
    const triggerWords = useMemo(() => {
        if (!family || loras.length === 0 || presets.length === 0) return [];
        const presetByPath = new Map<string, (typeof presets)[number]>();
        for (const p of presets) presetByPath.set(p.path, p);

        const seen = new Set<string>();
        const out: string[] = [];
        for (const sel of loras) {
            const meta = presetByPath.get(sel.path);
            if (!meta?.triggerWords) continue;
            for (const w of meta.triggerWords) {
                if (seen.has(w)) continue;
                seen.add(w);
                out.push(w);
            }
        }
        return out;
    }, [family, loras, presets]);

    if (triggerWords.length === 0) return null;

    return (
        <div
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-md)] bg-amber-500/5 border border-amber-500/15 text-[11px] ${className ?? ""}`}
            role="note"
            aria-label="Триггер-слова LoRA добавятся автоматически"
        >
            <Sparkles size={12} className="text-amber-500 shrink-0" />
            <span className="text-text-tertiary shrink-0">+ к промпту:</span>
            <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                {triggerWords.map((w) => (
                    <span
                        key={w}
                        className="font-medium text-amber-700 dark:text-amber-300 bg-amber-500/15 px-1.5 py-0.5 rounded-full"
                    >
                        {w}
                    </span>
                ))}
            </div>
            <span
                title="Эти слова добавляются автоматически на сервере — дублировать в промпте не нужно."
                className="shrink-0 text-text-tertiary cursor-help"
                aria-label="Подсказка"
            >
                <Info size={11} />
            </span>
        </div>
    );
}
