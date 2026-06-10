/**
 * Video Model Registry (client-safe)
 *
 * fal.ai video generation models grouped into pricing tiers. Mirrors the
 * structure of ai-models.ts MODEL_REGISTRY but for video: each entry knows
 * its fal queue endpoints (t2v / i2v), supported durations / aspect ratios /
 * resolutions, audio and end-frame capabilities, and an approximate price
 * per output second used for cost tracking.
 *
 * Daily per-user quota defaults per tier live in video-quotas.ts and are
 * editable from the admin panel (VideoModelQuota table).
 *
 * No server-side dependencies — safe to import in the browser.
 */

export type VideoTier = "premium" | "advanced" | "standard";
export type VideoMode = "t2v" | "i2v";

export interface VideoModelEntry {
    id: string;
    label: string;
    /** Short marketing-style description shown in the model picker. */
    description: string;
    tier: VideoTier;
    /** fal queue endpoints. A model may support only one mode. */
    endpoints: {
        t2v?: string;
        i2v?: string;
    };
    /** Allowed duration values (seconds, as the API expects them). */
    durations: string[];
    defaultDuration: string;
    /** i2v duration override when it differs from t2v (e.g. Kling i2v: 5|10). */
    i2vDurations?: string[];
    /** Supported aspect ratios (omit = model has no aspect control). */
    aspectRatios?: string[];
    defaultAspectRatio?: string;
    /** Supported resolutions (omit = model has no resolution control). */
    resolutions?: string[];
    defaultResolution?: string;
    /** Model exposes a generate_audio-style toggle. */
    supportsAudio: boolean;
    /** Audio is always on (native, no toggle) — e.g. Sora 2. */
    alwaysAudio?: boolean;
    /** i2v accepts an end/tail frame in addition to the start frame. */
    supportsEndFrame: boolean;
    supportsNegativePrompt?: boolean;
    /** Approximate price per output second (USD) — UI display + costUnits. */
    pricePerSecondUsd: number;
}

// ─── Registry ───────────────────────────────────────────────────────────────

export const VIDEO_MODEL_REGISTRY: VideoModelEntry[] = [
    // ── Premium ──────────────────────────────────────────────────────────
    {
        id: "veo-3.1",
        label: "Veo 3.1",
        description: "Google DeepMind — максимальное качество, звук, до 1080p",
        tier: "premium",
        endpoints: {
            t2v: "fal-ai/veo3.1",
            i2v: "fal-ai/veo3.1/image-to-video",
        },
        durations: ["4s", "6s", "8s"],
        defaultDuration: "8s",
        aspectRatios: ["16:9", "9:16"],
        defaultAspectRatio: "16:9",
        resolutions: ["720p", "1080p"],
        defaultResolution: "720p",
        supportsAudio: true,
        supportsEndFrame: false,
        supportsNegativePrompt: true,
        pricePerSecondUsd: 0.4,
    },
    {
        id: "sora-2-pro",
        label: "Sora 2 Pro",
        description: "OpenAI — клипы до 20 секунд с нативным звуком",
        tier: "premium",
        endpoints: {
            t2v: "fal-ai/sora-2-pro/text-to-video",
            i2v: "fal-ai/sora-2-pro/image-to-video",
        },
        durations: ["4", "8", "12", "16", "20"],
        defaultDuration: "8",
        aspectRatios: ["16:9", "9:16"],
        defaultAspectRatio: "16:9",
        resolutions: ["720p", "1080p"],
        defaultResolution: "720p",
        supportsAudio: false,
        alwaysAudio: true,
        supportsEndFrame: false,
        pricePerSecondUsd: 0.5,
    },
    {
        id: "kling-3.0-pro",
        label: "Kling 3.0 Pro",
        description: "Кинематографичный моушен, мульти-шот, нативный звук",
        tier: "premium",
        endpoints: {
            t2v: "fal-ai/kling-video/v3/pro/text-to-video",
            i2v: "fal-ai/kling-video/v3/pro/image-to-video",
        },
        durations: ["3", "5", "8", "10", "12", "15"],
        defaultDuration: "5",
        i2vDurations: ["5", "10"],
        aspectRatios: ["16:9", "9:16", "1:1"],
        defaultAspectRatio: "16:9",
        supportsAudio: true,
        supportsEndFrame: true,
        supportsNegativePrompt: true,
        pricePerSecondUsd: 0.28,
    },

    // ── Advanced ─────────────────────────────────────────────────────────
    {
        id: "veo-3.1-fast",
        label: "Veo 3.1 Fast",
        description: "Быстрая версия Veo 3.1 — итерации без ожидания",
        tier: "advanced",
        endpoints: {
            t2v: "fal-ai/veo3.1/fast",
            i2v: "fal-ai/veo3.1/fast/image-to-video",
        },
        durations: ["4s", "6s", "8s"],
        defaultDuration: "8s",
        aspectRatios: ["16:9", "9:16"],
        defaultAspectRatio: "16:9",
        resolutions: ["720p", "1080p"],
        defaultResolution: "720p",
        supportsAudio: true,
        supportsEndFrame: false,
        supportsNegativePrompt: true,
        pricePerSecondUsd: 0.15,
    },
    {
        id: "sora-2",
        label: "Sora 2",
        description: "OpenAI — детализированные динамичные клипы со звуком",
        tier: "advanced",
        endpoints: {
            t2v: "fal-ai/sora-2/text-to-video",
            i2v: "fal-ai/sora-2/image-to-video",
        },
        durations: ["4", "8", "12"],
        defaultDuration: "8",
        aspectRatios: ["16:9", "9:16"],
        defaultAspectRatio: "16:9",
        resolutions: ["720p"],
        defaultResolution: "720p",
        supportsAudio: false,
        alwaysAudio: true,
        supportsEndFrame: false,
        pricePerSecondUsd: 0.1,
    },
    {
        id: "seedance-1.0-pro",
        label: "Seedance 1.0 Pro",
        description: "ByteDance — мульти-шот сцены, start/end кадры",
        tier: "advanced",
        endpoints: {
            t2v: "fal-ai/bytedance/seedance/v1/pro/text-to-video",
            i2v: "fal-ai/bytedance/seedance/v1/pro/image-to-video",
        },
        durations: ["3", "5", "8", "10", "12"],
        defaultDuration: "5",
        aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        defaultAspectRatio: "16:9",
        resolutions: ["480p", "720p", "1080p"],
        defaultResolution: "720p",
        supportsAudio: false,
        supportsEndFrame: true,
        pricePerSecondUsd: 0.062,
    },

    // ── Standard ─────────────────────────────────────────────────────────
    {
        id: "kling-2.5-turbo-pro",
        label: "Kling 2.5 Turbo Pro",
        description: "Лучший баланс цены и качества — модель по умолчанию",
        tier: "standard",
        endpoints: {
            t2v: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
            i2v: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
        },
        durations: ["5", "10"],
        defaultDuration: "5",
        aspectRatios: ["16:9", "9:16", "1:1"],
        defaultAspectRatio: "16:9",
        supportsAudio: false,
        supportsEndFrame: true,
        supportsNegativePrompt: true,
        pricePerSecondUsd: 0.07,
    },
    {
        id: "hailuo-2.3",
        label: "Hailuo 2.3",
        description: "MiniMax — быстрые соц-клипы 768p",
        tier: "standard",
        endpoints: {
            t2v: "fal-ai/minimax/hailuo-2.3/standard/text-to-video",
            i2v: "fal-ai/minimax/hailuo-2.3/standard/image-to-video",
        },
        durations: ["6", "10"],
        defaultDuration: "6",
        supportsAudio: false,
        supportsEndFrame: false,
        pricePerSecondUsd: 0.045,
    },
    {
        id: "wan-2.5",
        label: "Wan 2.5",
        description: "Alibaba — самая доступная генерация",
        tier: "standard",
        endpoints: {
            t2v: "fal-ai/wan-25-preview/text-to-video",
            i2v: "fal-ai/wan-25-preview/image-to-video",
        },
        durations: ["5", "10"],
        defaultDuration: "5",
        resolutions: ["480p", "720p", "1080p"],
        defaultResolution: "720p",
        supportsAudio: true,
        supportsEndFrame: false,
        supportsNegativePrompt: true,
        pricePerSecondUsd: 0.05,
    },
    {
        id: "pixverse-v6",
        label: "Pixverse v6",
        description: "Стилизованные клипы и аниме-эстетика",
        tier: "standard",
        endpoints: {
            t2v: "fal-ai/pixverse/v6/text-to-video",
            i2v: "fal-ai/pixverse/v6/image-to-video",
        },
        durations: ["5", "8"],
        defaultDuration: "5",
        aspectRatios: ["16:9", "9:16", "1:1"],
        defaultAspectRatio: "16:9",
        resolutions: ["540p", "720p", "1080p"],
        defaultResolution: "720p",
        supportsAudio: false,
        supportsEndFrame: false,
        supportsNegativePrompt: true,
        pricePerSecondUsd: 0.04,
    },
];

export const DEFAULT_VIDEO_MODEL_ID = "kling-2.5-turbo-pro";

export const VIDEO_TIER_LABELS: Record<VideoTier, string> = {
    premium: "Premium",
    advanced: "Advanced",
    standard: "Standard",
};

export const VIDEO_TIER_ORDER: VideoTier[] = ["premium", "advanced", "standard"];

export function getVideoModelById(id: string): VideoModelEntry | undefined {
    return VIDEO_MODEL_REGISTRY.find((m) => m.id === id);
}

export function listVideoModelsByTier(): { tier: VideoTier; models: VideoModelEntry[] }[] {
    return VIDEO_TIER_ORDER.map((tier) => ({
        tier,
        models: VIDEO_MODEL_REGISTRY.filter((m) => m.tier === tier),
    })).filter((g) => g.models.length > 0);
}

/** Duration options for the given mode (i2v may be narrower than t2v). */
export function getModelDurations(model: VideoModelEntry, mode: VideoMode): string[] {
    if (mode === "i2v" && model.i2vDurations) return model.i2vDurations;
    return model.durations;
}

/** Parse "8s" | "8" → seconds as a number (for cost estimation). */
export function durationToSeconds(duration: string): number {
    const n = parseFloat(duration.replace(/s$/i, ""));
    return Number.isFinite(n) ? n : 5;
}

export function estimateVideoCostUsd(model: VideoModelEntry, duration: string): number {
    return Math.round(model.pricePerSecondUsd * durationToSeconds(duration) * 100) / 100;
}

// ─── fal input mapping ──────────────────────────────────────────────────────

export interface VideoGenerationParams {
    prompt: string;
    duration: string;
    aspectRatio?: string;
    resolution?: string;
    /** generate_audio toggle (only when model.supportsAudio). */
    audio?: boolean;
    negativePrompt?: string;
    /** i2v start frame (public URL). */
    startFrameUrl?: string;
    /** i2v end/tail frame (public URL), when model.supportsEndFrame. */
    endFrameUrl?: string;
}

/**
 * Map registry-level params to the model-specific fal input payload.
 * Each model family names its fields slightly differently (duration enums,
 * tail_image_url vs end_image_url, etc.) — this is the single source of
 * truth for those quirks.
 */
export function buildFalVideoInput(
    model: VideoModelEntry,
    mode: VideoMode,
    params: VideoGenerationParams,
): Record<string, unknown> {
    const input: Record<string, unknown> = {
        prompt: params.prompt,
        duration: params.duration,
    };

    if (model.aspectRatios && params.aspectRatio) {
        input.aspect_ratio = params.aspectRatio;
    }
    if (model.resolutions && params.resolution) {
        input.resolution = params.resolution;
    }
    if (model.supportsAudio) {
        input.generate_audio = params.audio ?? true;
    }
    if (model.supportsNegativePrompt && params.negativePrompt) {
        input.negative_prompt = params.negativePrompt;
    }

    if (mode === "i2v") {
        if (!params.startFrameUrl) {
            throw new Error("startFrameUrl is required for image-to-video");
        }
        input.image_url = params.startFrameUrl;
        if (model.supportsEndFrame && params.endFrameUrl) {
            // Kling uses tail_image_url, Seedance uses end_image_url.
            if (model.id.startsWith("kling")) {
                input.tail_image_url = params.endFrameUrl;
            } else {
                input.end_image_url = params.endFrameUrl;
            }
        }
        // Kling / Hailuo / Sora i2v infer the aspect from the input image —
        // drop the field to avoid strict input validation errors. Veo 3.1
        // i2v does accept aspect_ratio (default "auto"), so it stays.
        if (model.id.startsWith("kling") || model.id.startsWith("hailuo") || model.id.startsWith("sora")) {
            delete input.aspect_ratio;
        }
    }

    return input;
}

/** Extract the video URL from a fal queue response payload. */
export function extractFalVideoUrl(payload: Record<string, unknown>): string | null {
    const video = payload.video;
    if (video && typeof video === "object" && "url" in video && typeof (video as { url: unknown }).url === "string") {
        return (video as { url: string }).url;
    }
    if (typeof payload.video_url === "string") return payload.video_url;
    if (typeof payload.url === "string") return payload.url;
    return null;
}
