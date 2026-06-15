/**
 * Multi-shot video generation helpers.
 *
 * Kling 3.0 uses native fal `multi_prompt` + `shot_type`.
 * Seedance compiles shots into a single prompt with timestamp markers.
 */

import type { VideoMode, VideoModelEntry } from "./video-models";

export type MultiShotStrategy = "api" | "prompt";
export type ShotType = "customize" | "intelligent";

export interface VideoMultiShotCapabilities {
    /** api = fal multi_prompt; prompt = compile into one prompt string. */
    strategy: MultiShotStrategy;
    maxShots: number;
    minShots: number;
    shotDurationRange: [number, number];
    totalDurationCap: number;
    shotTypeOptions?: ShotType[];
    defaultShotType?: ShotType;
}

export interface VideoShot {
    prompt: string;
    durationSec: number;
}

export interface MultiShotConfig {
    enabled: boolean;
    shots: VideoShot[];
    shotType?: ShotType;
}

export function createDefaultShots(count = 2, durationSec = 5): VideoShot[] {
    return Array.from({ length: count }, () => ({ prompt: "", durationSec }));
}

export function sumShotDurationSec(shots: VideoShot[]): number {
    return shots.reduce((sum, s) => sum + s.durationSec, 0);
}

/** Seedance-style: "[0-5s] shot1 Cut scene to [5-10s] shot2" */
export function compileSeedanceMultiShotPrompt(shots: VideoShot[]): string {
    let offset = 0;
    const parts: string[] = [];
    for (let i = 0; i < shots.length; i++) {
        const text = shots[i].prompt.trim();
        const start = offset;
        const end = offset + shots[i].durationSec;
        if (i === 0) {
            parts.push(`[${start}-${end}s] ${text}`);
        } else {
            parts.push(`Cut scene to [${start}-${end}s] ${text}`);
        }
        offset = end;
    }
    return parts.join(" ");
}

/** Workflow textarea format: one line per shot as "duration|prompt". */
export function parseMultiShotLines(text: string): VideoShot[] {
    return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const pipe = line.indexOf("|");
            if (pipe === -1) {
                return { durationSec: 5, prompt: line };
            }
            const dur = parseInt(line.slice(0, pipe).trim(), 10);
            return {
                durationSec: Number.isFinite(dur) ? dur : 5,
                prompt: line.slice(pipe + 1).trim(),
            };
        });
}

export function formatMultiShotLines(shots: VideoShot[]): string {
    return shots.map((s) => `${s.durationSec}|${s.prompt}`).join("\n");
}

export function isMultiShotCustomize(config: MultiShotConfig | undefined, model: VideoModelEntry): boolean {
    if (!config?.enabled || !model.multiShot) return false;
    const shotType = config.shotType ?? model.multiShot.defaultShotType ?? "customize";
    return shotType === "customize";
}

export function validateMultiShot(
    model: VideoModelEntry,
    config: MultiShotConfig,
    mode: VideoMode,
): string | null {
    if (!config.enabled) return null;
    const caps = model.multiShot;
    if (!caps) return "Модель не поддерживает multi-shot";

    const shotType = config.shotType ?? caps.defaultShotType ?? "customize";
    if (shotType === "intelligent") return null;

    const { shots } = config;
    if (shots.length < caps.minShots) {
        return `Multi-shot: минимум ${caps.minShots} шота`;
    }
    if (shots.length > caps.maxShots) {
        return `Multi-shot: максимум ${caps.maxShots} шотов`;
    }

    const [minDur, maxDur] = caps.shotDurationRange;
    for (let i = 0; i < shots.length; i++) {
        if (!shots[i].prompt.trim()) {
            return `Шот ${i + 1}: укажите описание`;
        }
        if (shots[i].durationSec < minDur || shots[i].durationSec > maxDur) {
            return `Шот ${i + 1}: длительность ${minDur}–${maxDur} с`;
        }
    }

    const total = sumShotDurationSec(shots);
    if (total > caps.totalDurationCap) {
        return `Суммарная длительность ${total} с превышает лимит ${caps.totalDurationCap} с`;
    }

    if (mode === "i2v" && model.i2vDurations) {
        const totalStr = String(total);
        if (!model.i2vDurations.includes(totalStr)) {
            return `Для i2v сумма шотов должна быть ${model.i2vDurations.join(" или ")} с (сейчас ${total} с)`;
        }
    }

    return null;
}

export function parseMultiShotConfig(raw: unknown): MultiShotConfig | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    if (o.enabled !== true) return null;

    const shotsRaw = o.shots;
    if (!Array.isArray(shotsRaw)) return null;

    const shots: VideoShot[] = [];
    for (const item of shotsRaw) {
        if (!item || typeof item !== "object") continue;
        const s = item as Record<string, unknown>;
        const prompt = typeof s.prompt === "string" ? s.prompt : "";
        const durationSec = typeof s.durationSec === "number" && Number.isFinite(s.durationSec)
            ? Math.round(s.durationSec)
            : typeof s.durationSec === "string"
                ? parseInt(s.durationSec, 10)
                : 5;
        shots.push({ prompt, durationSec: Number.isFinite(durationSec) ? durationSec : 5 });
    }

    const shotType = o.shotType === "intelligent" || o.shotType === "customize"
        ? o.shotType
        : undefined;

    return { enabled: true, shots, shotType };
}

export function resolveEffectiveDuration(
    model: VideoModelEntry,
    config: MultiShotConfig | undefined,
    fallbackDuration: string,
): string {
    if (!config?.enabled || !model.multiShot) return fallbackDuration;
    const shotType = config.shotType ?? model.multiShot.defaultShotType ?? "customize";
    if (shotType === "intelligent") return fallbackDuration;
    if (config.shots.length === 0) return fallbackDuration;
    return String(sumShotDurationSec(config.shots));
}

export function buildMultiShotConfigFromWorkflowParams(params: {
    multiShotEnabled?: boolean;
    multiShotType?: ShotType;
    multiShotLines?: string;
}): MultiShotConfig | undefined {
    if (!params.multiShotEnabled) return undefined;
    const shots = parseMultiShotLines(params.multiShotLines ?? "");
    return {
        enabled: true,
        shots,
        shotType: params.multiShotType ?? "customize",
    };
}
