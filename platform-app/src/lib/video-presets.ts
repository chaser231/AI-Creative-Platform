/**
 * Camera / motion presets (Higgsfield-style, client-safe)
 *
 * Each preset is a prompt snippet appended to the user's prompt — the same
 * mechanism Higgsfield uses for its "camera moves" library. Works across all
 * video models since it's pure prompt engineering, no model-specific params.
 */

/** Lucide icon key — resolved in MotionPresetIcon (client-only). */
export type MotionPresetIconName =
    | "lock"
    | "zoom-in"
    | "zoom-out"
    | "zap"
    | "rotate-cw"
    | "arrow-left"
    | "arrow-right"
    | "arrow-up"
    | "smartphone"
    | "plane"
    | "focus"
    | "chevrons-up";

export interface VideoMotionPreset {
    id: string;
    /** UI label (Russian). */
    label: string;
    icon: MotionPresetIconName;
    /** English prompt snippet appended after the user prompt. */
    promptSuffix: string;
    description: string;
}

export const VIDEO_MOTION_PRESETS: VideoMotionPreset[] = [
    {
        id: "static",
        label: "Статика",
        icon: "lock",
        promptSuffix: "Static camera, locked-off tripod shot, no camera movement.",
        description: "Камера зафиксирована на штативе",
    },
    {
        id: "dolly-in",
        label: "Наезд",
        icon: "zoom-in",
        promptSuffix: "Slow cinematic dolly in, camera smoothly pushes towards the subject.",
        description: "Камера плавно наезжает на объект",
    },
    {
        id: "dolly-out",
        label: "Отъезд",
        icon: "zoom-out",
        promptSuffix: "Slow cinematic dolly out, camera smoothly pulls away revealing the scene.",
        description: "Камера плавно отъезжает, раскрывая сцену",
    },
    {
        id: "crash-zoom",
        label: "Резкий зум",
        icon: "zap",
        promptSuffix: "Fast aggressive crash zoom in on the subject, dramatic snap zoom effect.",
        description: "Резкий быстрый зум на объект",
    },
    {
        id: "orbit",
        label: "Облёт",
        icon: "rotate-cw",
        promptSuffix: "Smooth 360 orbit shot, camera circles around the subject keeping it centered.",
        description: "Камера облетает объект по кругу",
    },
    {
        id: "pan-left",
        label: "Панорама ←",
        icon: "arrow-left",
        promptSuffix: "Smooth horizontal pan from right to left across the scene.",
        description: "Горизонтальная панорама влево",
    },
    {
        id: "pan-right",
        label: "Панорама →",
        icon: "arrow-right",
        promptSuffix: "Smooth horizontal pan from left to right across the scene.",
        description: "Горизонтальная панорама вправо",
    },
    {
        id: "crane-up",
        label: "Подъём",
        icon: "arrow-up",
        promptSuffix: "Cinematic crane shot rising upward, camera ascends revealing the scene from above.",
        description: "Камера поднимается вверх краном",
    },
    {
        id: "handheld",
        label: "С руки",
        icon: "smartphone",
        promptSuffix: "Handheld camera with subtle natural shake, documentary style movement.",
        description: "Ручная камера с естественной тряской",
    },
    {
        id: "fpv-drone",
        label: "FPV-дрон",
        icon: "plane",
        promptSuffix: "Fast FPV drone shot flying through the scene, dynamic sweeping aerial movement.",
        description: "Динамичный пролёт FPV-дроном",
    },
    {
        id: "tracking",
        label: "Слежение",
        icon: "focus",
        promptSuffix: "Smooth tracking shot following the subject as it moves, steadicam style.",
        description: "Камера следует за объектом",
    },
    {
        id: "tilt-up",
        label: "Наклон ↑",
        icon: "chevrons-up",
        promptSuffix: "Slow tilt up from bottom to top, gradually revealing the subject.",
        description: "Наклон камеры снизу вверх",
    },
];

export function getMotionPresetById(id: string): VideoMotionPreset | undefined {
    return VIDEO_MOTION_PRESETS.find((p) => p.id === id);
}

/** Append the preset suffix to a user prompt (no-op for unknown/empty id). */
export function applyMotionPreset(prompt: string, presetId?: string | null): string {
    if (!presetId) return prompt;
    const preset = getMotionPresetById(presetId);
    if (!preset) return prompt;
    const trimmed = prompt.trim().replace(/[.\s]+$/, "");
    return trimmed.length > 0 ? `${trimmed}. ${preset.promptSuffix}` : preset.promptSuffix;
}
