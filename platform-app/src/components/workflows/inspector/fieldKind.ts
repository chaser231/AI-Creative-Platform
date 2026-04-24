/**
 * Zod schema → form field kind dispatcher.
 *
 * Inspector iterates `schema.shape[key]` and asks `pickFieldKind(field)` to
 * decide which input to render. Extracted to a pure function so it stays
 * unit-testable in Node (no React, no Zod runtime peculiarities pinned to
 * jsdom).
 *
 * Targets Zod v4 — uses `.def.type` (not legacy `_def.typeName`) and the
 * public `.minValue` / `.maxValue` / `.maxLength` getters.
 *
 * Phase 3, Wave 4 — D-14, REQ-12.
 */

import type { z } from "zod";

export type FieldKind =
    | "string"
    | "textarea"
    | "number"
    | "slider"
    | "enum"
    | "boolean"
    | "unsupported";

export interface FieldDescriptor {
    kind: FieldKind;
    /** Whether the schema is wrapped in z.optional()/.nullable()/.default(). */
    optional: boolean;
    /** For enum: the list of allowed values. */
    options?: readonly string[];
    /** For number: numeric bounds parsed off the schema. */
    min?: number;
    max?: number;
}

interface ZodLike {
    def: { type: string; innerType?: ZodLike; schema?: ZodLike };
    options?: readonly string[];
    minValue?: number | null;
    maxValue?: number | null;
    maxLength?: number | null;
}

function asZodLike(schema: z.ZodTypeAny): ZodLike {
    return schema as unknown as ZodLike;
}

function unwrap(schema: z.ZodTypeAny): { inner: ZodLike; optional: boolean } {
    let current = asZodLike(schema);
    let optional = false;

    while (true) {
        const t = current.def.type;
        if (t === "optional" || t === "nullable" || t === "default") {
            optional = true;
            if (!current.def.innerType) break;
            current = current.def.innerType;
            continue;
        }
        if (t === "pipe" || t === "transform" || t === "effect" || t === "refine") {
            // Best-effort unwrap of effects-like wrappers. Zod v4 names vary.
            if (!current.def.innerType) break;
            current = current.def.innerType;
            continue;
        }
        break;
    }

    return { inner: current, optional };
}

export function pickFieldKind(schema: z.ZodTypeAny): FieldDescriptor {
    const { inner, optional } = unwrap(schema);
    const t = inner.def.type;

    switch (t) {
        case "string": {
            const max = inner.maxLength ?? undefined;
            return {
                kind: typeof max === "number" && max > 200 ? "textarea" : "string",
                optional,
            };
        }
        case "number": {
            // Zod v4 returns -Infinity / Infinity for unbounded numbers — treat those
            // as "no bound" so the slider mode only kicks in for genuinely finite ranges.
            const rawMin = inner.minValue;
            const rawMax = inner.maxValue;
            const min = typeof rawMin === "number" && Number.isFinite(rawMin) ? rawMin : undefined;
            const max = typeof rawMax === "number" && Number.isFinite(rawMax) ? rawMax : undefined;
            const slider = typeof min === "number" && typeof max === "number";
            return { kind: slider ? "slider" : "number", optional, min, max };
        }
        case "enum":
            return { kind: "enum", optional, options: inner.options ?? [] };
        case "boolean":
            return { kind: "boolean", optional };
        default:
            return { kind: "unsupported", optional };
    }
}
