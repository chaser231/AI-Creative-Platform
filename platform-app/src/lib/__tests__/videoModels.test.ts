import { describe, expect, it } from "vitest";
import {
    VIDEO_MODEL_REGISTRY,
    DEFAULT_VIDEO_MODEL_ID,
    getVideoModelById,
    getModelDurations,
    durationToSeconds,
    estimateVideoCostUsd,
    buildFalVideoInput,
    extractFalVideoUrl,
} from "../video-models";
import { applyMotionPreset, getMotionPresetById, VIDEO_MOTION_PRESETS } from "../video-presets";

describe("VIDEO_MODEL_REGISTRY", () => {
    it("has unique model ids", () => {
        const ids = VIDEO_MODEL_REGISTRY.map((m) => m.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("default model exists and supports both modes", () => {
        const model = getVideoModelById(DEFAULT_VIDEO_MODEL_ID);
        expect(model).toBeDefined();
        expect(model!.endpoints.t2v).toBeTruthy();
        expect(model!.endpoints.i2v).toBeTruthy();
    });

    it("every model: defaultDuration is in its durations list", () => {
        for (const m of VIDEO_MODEL_REGISTRY) {
            expect(m.durations, m.id).toContain(m.defaultDuration);
        }
    });

    it("every model: default aspect/resolution belong to the supported lists", () => {
        for (const m of VIDEO_MODEL_REGISTRY) {
            if (m.aspectRatios && m.defaultAspectRatio) {
                expect(m.aspectRatios, m.id).toContain(m.defaultAspectRatio);
            }
            if (m.resolutions && m.defaultResolution) {
                expect(m.resolutions, m.id).toContain(m.defaultResolution);
            }
        }
    });
});

describe("getModelDurations", () => {
    it("uses i2vDurations override for i2v mode", () => {
        const kling3 = getVideoModelById("kling-3.0-pro")!;
        expect(getModelDurations(kling3, "t2v")).toEqual(kling3.durations);
        expect(getModelDurations(kling3, "i2v")).toEqual(kling3.i2vDurations);
    });

    it("falls back to durations when no i2v override", () => {
        const veo = getVideoModelById("veo-3.1")!;
        expect(getModelDurations(veo, "i2v")).toEqual(veo.durations);
    });
});

describe("durationToSeconds / estimateVideoCostUsd", () => {
    it("parses both '8s' and '8' formats", () => {
        expect(durationToSeconds("8s")).toBe(8);
        expect(durationToSeconds("12")).toBe(12);
        expect(durationToSeconds("garbage")).toBe(5);
    });

    it("estimates cost as pricePerSecond × seconds", () => {
        const veo = getVideoModelById("veo-3.1")!;
        expect(estimateVideoCostUsd(veo, "8s")).toBeCloseTo(veo.pricePerSecondUsd * 8, 2);
    });
});

describe("buildFalVideoInput", () => {
    it("t2v: maps aspect/resolution/audio for Veo 3.1", () => {
        const veo = getVideoModelById("veo-3.1")!;
        const input = buildFalVideoInput(veo, "t2v", {
            prompt: "ocean waves",
            duration: "8s",
            aspectRatio: "16:9",
            resolution: "1080p",
            audio: false,
        });
        expect(input).toMatchObject({
            prompt: "ocean waves",
            duration: "8s",
            aspect_ratio: "16:9",
            resolution: "1080p",
            generate_audio: false,
        });
        expect(input.image_url).toBeUndefined();
    });

    it("omits audio toggle for models without supportsAudio (Sora native audio)", () => {
        const sora = getVideoModelById("sora-2-pro")!;
        const input = buildFalVideoInput(sora, "t2v", {
            prompt: "city",
            duration: "8",
            aspectRatio: "16:9",
            audio: true,
        });
        expect(input.generate_audio).toBeUndefined();
    });

    it("i2v: requires startFrameUrl", () => {
        const kling = getVideoModelById("kling-2.5-turbo-pro")!;
        expect(() =>
            buildFalVideoInput(kling, "i2v", { prompt: "x", duration: "5" }),
        ).toThrow(/startFrameUrl/);
    });

    it("i2v: kling 2.5 uses image_url + tail_image_url and drops aspect_ratio", () => {
        const kling = getVideoModelById("kling-2.5-turbo-pro")!;
        const input = buildFalVideoInput(kling, "i2v", {
            prompt: "animate",
            duration: "5",
            aspectRatio: "16:9",
            startFrameUrl: "https://s3/start.png",
            endFrameUrl: "https://s3/end.png",
        });
        expect(input.image_url).toBe("https://s3/start.png");
        expect(input.tail_image_url).toBe("https://s3/end.png");
        expect(input.start_image_url).toBeUndefined();
        expect(input.end_image_url).toBeUndefined();
        expect(input.aspect_ratio).toBeUndefined();
    });

    it("i2v: kling 3.0 pro uses start_image_url + end_image_url (not tail_image_url)", () => {
        const kling = getVideoModelById("kling-3.0-pro")!;
        const input = buildFalVideoInput(kling, "i2v", {
            prompt: "animate",
            duration: "5",
            aspectRatio: "16:9",
            startFrameUrl: "https://s3/start.png",
            endFrameUrl: "https://s3/end.png",
        });
        expect(input.start_image_url).toBe("https://s3/start.png");
        expect(input.end_image_url).toBe("https://s3/end.png");
        expect(input.image_url).toBeUndefined();
        expect(input.tail_image_url).toBeUndefined();
        expect(input.aspect_ratio).toBeUndefined();
    });

    it("i2v: seedance 1.0 uses end_image_url for the end frame", () => {
        const seedance = getVideoModelById("seedance-1.0-pro")!;
        const input = buildFalVideoInput(seedance, "i2v", {
            prompt: "animate",
            duration: "5",
            startFrameUrl: "https://s3/start.png",
            endFrameUrl: "https://s3/end.png",
        });
        expect(input.end_image_url).toBe("https://s3/end.png");
        expect(input.tail_image_url).toBeUndefined();
    });

    it("i2v: seedance 2.0 uses end_image_url and drops aspect on i2v", () => {
        const seedance = getVideoModelById("seedance-2.0")!;
        const input = buildFalVideoInput(seedance, "i2v", {
            prompt: "animate",
            duration: "5",
            aspectRatio: "16:9",
            startFrameUrl: "https://s3/start.png",
            endFrameUrl: "https://s3/end.png",
            audio: true,
        });
        expect(input.image_url).toBe("https://s3/start.png");
        expect(input.end_image_url).toBe("https://s3/end.png");
        expect(input.generate_audio).toBe(true);
        expect(input.aspect_ratio).toBeUndefined();
    });

    it("i2v: ignores endFrameUrl when the model does not support it", () => {
        const veo = getVideoModelById("veo-3.1")!;
        const input = buildFalVideoInput(veo, "i2v", {
            prompt: "animate",
            duration: "8s",
            startFrameUrl: "https://s3/start.png",
            endFrameUrl: "https://s3/end.png",
        });
        expect(input.tail_image_url).toBeUndefined();
        expect(input.end_image_url).toBeUndefined();
    });

    it("includes negative_prompt only for models that support it", () => {
        const veo = getVideoModelById("veo-3.1")!;
        const sora = getVideoModelById("sora-2-pro")!;
        const withNeg = buildFalVideoInput(veo, "t2v", {
            prompt: "x",
            duration: "8s",
            negativePrompt: "blurry",
        });
        const withoutNeg = buildFalVideoInput(sora, "t2v", {
            prompt: "x",
            duration: "8",
            negativePrompt: "blurry",
        });
        expect(withNeg.negative_prompt).toBe("blurry");
        expect(withoutNeg.negative_prompt).toBeUndefined();
    });
});

describe("extractFalVideoUrl", () => {
    it("reads video.url, video_url and url shapes", () => {
        expect(extractFalVideoUrl({ video: { url: "https://v/1.mp4" } })).toBe("https://v/1.mp4");
        expect(extractFalVideoUrl({ video_url: "https://v/2.mp4" })).toBe("https://v/2.mp4");
        expect(extractFalVideoUrl({ url: "https://v/3.mp4" })).toBe("https://v/3.mp4");
        expect(extractFalVideoUrl({ something: 1 })).toBeNull();
    });
});

describe("motion presets", () => {
    it("has unique ids", () => {
        const ids = VIDEO_MOTION_PRESETS.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("applyMotionPreset appends the suffix once", () => {
        const preset = VIDEO_MOTION_PRESETS[0];
        const out = applyMotionPreset("a cat", preset.id);
        expect(out).toContain("a cat");
        expect(out).toContain(preset.promptSuffix);
    });

    it("applyMotionPreset is a no-op for unknown/empty preset", () => {
        expect(applyMotionPreset("a cat", undefined)).toBe("a cat");
        expect(applyMotionPreset("a cat", "nope")).toBe("a cat");
        expect(getMotionPresetById("nope")).toBeUndefined();
    });
});
