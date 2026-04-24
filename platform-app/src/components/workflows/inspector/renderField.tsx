"use client";

/**
 * Renders a single inspector input from a Zod schema field.
 *
 * Inspector composes these per `schema.shape[key]`. ImageInput's `source`
 * field is special-cased upstream and never reaches this helper.
 *
 * Phase 3, Wave 4 — D-14, REQ-12.
 */

import type { z } from "zod";
import { pickFieldKind, type FieldDescriptor } from "./fieldKind";

export interface RenderFieldProps {
    name: string;
    label: string;
    schema: z.ZodTypeAny;
    value: unknown;
    error?: string;
    /** For enum fields: human-readable label per option id. */
    optionLabels?: Record<string, string>;
    onChange: (next: unknown) => void;
}

export function RenderField({
    name,
    label,
    schema,
    value,
    error,
    optionLabels,
    onChange,
}: RenderFieldProps) {
    const desc: FieldDescriptor = pickFieldKind(schema);

    return (
        <label className="flex flex-col gap-2.5">
            <span className="text-xs font-medium leading-5 text-text-primary">
                {label}
                {desc.optional && (
                    <span className="ml-1 text-text-tertiary">— необязательно</span>
                )}
            </span>

            {desc.kind === "string" && (
                <input
                    type="text"
                    value={typeof value === "string" ? value : ""}
                    onChange={(e) => onChange(e.target.value || undefined)}
                    className={inputClass(!!error)}
                    name={name}
                />
            )}

            {desc.kind === "textarea" && (
                <textarea
                    value={typeof value === "string" ? value : ""}
                    onChange={(e) => onChange(e.target.value || undefined)}
                    rows={3}
                    className={inputClass(!!error)}
                    name={name}
                />
            )}

            {desc.kind === "number" && (
                <input
                    type="number"
                    value={typeof value === "number" ? value : ""}
                    onChange={(e) => {
                        const n = e.target.valueAsNumber;
                        onChange(Number.isFinite(n) ? n : undefined);
                    }}
                    className={inputClass(!!error)}
                    name={name}
                />
            )}

            {desc.kind === "slider" && typeof desc.min === "number" && typeof desc.max === "number" && (
                <div className="flex items-center gap-4 py-1">
                    <input
                        type="range"
                        min={desc.min}
                        max={desc.max}
                        step={(desc.max - desc.min) / 100}
                        value={typeof value === "number" ? value : desc.min}
                        onChange={(e) => onChange(e.target.valueAsNumber)}
                        className="flex-1 accent-accent-primary"
                        name={name}
                    />
                    <span className="w-10 text-right text-xs tabular-nums text-text-secondary">
                        {(typeof value === "number" ? value : desc.min).toFixed(2)}
                    </span>
                </div>
            )}

            {desc.kind === "enum" && desc.options && (
                <select
                    value={typeof value === "string" ? value : desc.options[0]}
                    onChange={(e) => onChange(e.target.value)}
                    className={inputClass(!!error)}
                    name={name}
                >
                    {desc.options.map((opt) => (
                        <option key={opt} value={opt}>
                            {optionLabels?.[opt] ?? opt}
                        </option>
                    ))}
                </select>
            )}

            {desc.kind === "boolean" && (
                <input
                    type="checkbox"
                    checked={value === true}
                    onChange={(e) => onChange(e.target.checked)}
                    className="h-4 w-4 self-start accent-accent-primary"
                    name={name}
                />
            )}

            {desc.kind === "unsupported" && (
                <span className="text-xs italic text-text-tertiary">
                    (Поле «{name}» пока не поддерживается)
                </span>
            )}

            {error && (
                <span className="text-xs text-red-500" role="alert">
                    {error}
                </span>
            )}
        </label>
    );
}

function inputClass(hasError: boolean): string {
    return [
        "h-11 w-full rounded-[var(--radius-md)] border bg-bg-surface px-3 text-sm text-text-primary",
        "focus:outline-none focus:ring-2 focus:ring-border-focus/40",
        hasError
            ? "border-red-500 focus:border-red-500"
            : "border-border-primary focus:border-border-focus",
    ].join(" ");
}
