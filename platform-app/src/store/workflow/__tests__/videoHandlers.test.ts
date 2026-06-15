import { describe, expect, it, vi } from "vitest";
import {
    buildVideoGenerateBody,
    extractFrame,
    isVideoUrl,
    runVideoGeneration,
    type VideoGenerationDeps,
    type VideoJobSnapshot,
} from "../clientHandlers";

const BASE_PARAMS = {
    prompt: "a red fox running",
    model: "kling-2.5-turbo-pro",
    duration: "5",
    aspectRatio: "16:9" as const,
    resolution: "auto" as const,
    audio: true,
    presetId: "none",
    multiShotEnabled: false,
    multiShotType: "customize" as const,
    multiShotLines: "",
};

function makeDeps(overrides: Partial<VideoGenerationDeps> = {}): VideoGenerationDeps {
    return {
        submitVideoJob: vi.fn().mockResolvedValue({
            id: "job-1",
            status: "QUEUED",
            resultUrl: null,
            error: null,
        } satisfies VideoJobSnapshot),
        pollVideoJob: vi.fn().mockResolvedValue({
            id: "job-1",
            status: "COMPLETED",
            resultUrl: "https://s3/video.mp4",
            error: null,
        } satisfies VideoJobSnapshot),
        sleepMs: () => Promise.resolve(),
        ...overrides,
    };
}

describe("isVideoUrl", () => {
    it("detects common video extensions, with and without query strings", () => {
        expect(isVideoUrl("https://s3/clip.mp4")).toBe(true);
        expect(isVideoUrl("https://s3/clip.webm?sig=abc")).toBe(true);
        expect(isVideoUrl("https://s3/photo.png")).toBe(false);
        expect(isVideoUrl("not a url.mp4")).toBe(true);
    });
});

describe("buildVideoGenerateBody", () => {
    it("maps node params to the generate API body and drops sentinel values", () => {
        const body = buildVideoGenerateBody({
            mode: "t2v",
            params: BASE_PARAMS,
            workspaceId: "ws-1",
        });
        expect(body).toMatchObject({
            modelId: "kling-2.5-turbo-pro",
            mode: "t2v",
            prompt: "a red fox running",
            duration: "5",
            aspectRatio: "16:9",
            audio: true,
            workspaceId: "ws-1",
        });
        // "auto"/"none" sentinels must be absent, not sent as-is.
        expect("resolution" in body).toBe(false);
        expect("presetId" in body).toBe(false);
    });

    it("passes through explicit resolution and preset", () => {
        const body = buildVideoGenerateBody({
            mode: "t2v",
            params: { ...BASE_PARAMS, resolution: "1080p", presetId: "dolly-in" },
            workspaceId: "ws-1",
        });
        expect(body.resolution).toBe("1080p");
        expect(body.presetId).toBe("dolly-in");
    });

    it("includes multiShot when enabled on the node", () => {
        const body = buildVideoGenerateBody({
            mode: "t2v",
            params: {
                ...BASE_PARAMS,
                model: "kling-3.0-pro",
                multiShotEnabled: true,
                multiShotType: "customize",
                multiShotLines: "5|wide\n5|close",
            },
            workspaceId: "ws-1",
        });
        expect(body.multiShot).toMatchObject({
            enabled: true,
            shotType: "customize",
            shots: [
                { durationSec: 5, prompt: "wide" },
                { durationSec: 5, prompt: "close" },
            ],
        });
    });

    it("concatenates the local prompt with upstream text input", () => {
        const body = buildVideoGenerateBody({
            mode: "t2v",
            params: BASE_PARAMS,
            workspaceId: "ws-1",
            promptFromInput: "in a snowy forest",
        });
        expect(body.prompt).toBe("a red fox running\nin a snowy forest");
    });

    it("includes start/end frame urls for i2v", () => {
        const body = buildVideoGenerateBody({
            mode: "i2v",
            params: BASE_PARAMS,
            workspaceId: "ws-1",
            startFrameUrl: "https://s3/start.png",
            endFrameUrl: "https://s3/end.png",
        });
        expect(body.startFrameUrl).toBe("https://s3/start.png");
        expect(body.endFrameUrl).toBe("https://s3/end.png");
    });
});

describe("runVideoGeneration", () => {
    it("submits then polls until COMPLETED and returns the result url", async () => {
        const deps = makeDeps({
            pollVideoJob: vi
                .fn()
                .mockResolvedValueOnce({ id: "job-1", status: "QUEUED", resultUrl: null, error: null })
                .mockResolvedValueOnce({ id: "job-1", status: "RUNNING", resultUrl: null, error: null })
                .mockResolvedValueOnce({
                    id: "job-1",
                    status: "COMPLETED",
                    resultUrl: "https://s3/video.mp4",
                    error: null,
                }),
        });
        const out = await runVideoGeneration({
            mode: "t2v",
            rawParams: BASE_PARAMS,
            workspaceId: "ws-1",
            deps,
        });
        expect(out).toEqual({ url: "https://s3/video.mp4", jobId: "job-1" });
        expect(deps.pollVideoJob).toHaveBeenCalledTimes(3);
    });

    it("throws when the job FAILED, surfacing the provider error", async () => {
        const deps = makeDeps({
            pollVideoJob: vi.fn().mockResolvedValue({
                id: "job-1",
                status: "FAILED",
                resultUrl: null,
                error: "NSFW content detected",
            }),
        });
        await expect(
            runVideoGeneration({ mode: "t2v", rawParams: BASE_PARAMS, workspaceId: "ws-1", deps }),
        ).rejects.toThrow("NSFW content detected");
    });

    it("requires a prompt (local or upstream)", async () => {
        const deps = makeDeps();
        await expect(
            runVideoGeneration({
                mode: "t2v",
                rawParams: { ...BASE_PARAMS, prompt: "  " },
                workspaceId: "ws-1",
                deps,
            }),
        ).rejects.toThrow(/промпт/i);
        expect(deps.submitVideoJob).not.toHaveBeenCalled();
    });

    it("requires a start frame for i2v", async () => {
        const deps = makeDeps();
        await expect(
            runVideoGeneration({ mode: "i2v", rawParams: BASE_PARAMS, workspaceId: "ws-1", deps }),
        ).rejects.toThrow(/стартового кадра|изображения/i);
        expect(deps.submitVideoJob).not.toHaveBeenCalled();
    });

    it("tolerates up to two consecutive poll failures", async () => {
        const deps = makeDeps({
            pollVideoJob: vi
                .fn()
                .mockRejectedValueOnce(new Error("network"))
                .mockRejectedValueOnce(new Error("network"))
                .mockResolvedValueOnce({
                    id: "job-1",
                    status: "COMPLETED",
                    resultUrl: "https://s3/video.mp4",
                    error: null,
                }),
        });
        const out = await runVideoGeneration({
            mode: "t2v",
            rawParams: BASE_PARAMS,
            workspaceId: "ws-1",
            deps,
        });
        expect(out.url).toBe("https://s3/video.mp4");
    });

    it("gives up after three consecutive poll failures", async () => {
        const deps = makeDeps({
            pollVideoJob: vi.fn().mockRejectedValue(new Error("server down")),
        });
        await expect(
            runVideoGeneration({ mode: "t2v", rawParams: BASE_PARAMS, workspaceId: "ws-1", deps }),
        ).rejects.toThrow("server down");
    });

    it("times out after maxPollAttempts", async () => {
        const deps = makeDeps({
            pollVideoJob: vi
                .fn()
                .mockResolvedValue({ id: "job-1", status: "RUNNING", resultUrl: null, error: null }),
            maxPollAttempts: 4,
        });
        await expect(
            runVideoGeneration({ mode: "t2v", rawParams: BASE_PARAMS, workspaceId: "ws-1", deps }),
        ).rejects.toThrow(/не завершилась/);
        expect(deps.pollVideoJob).toHaveBeenCalledTimes(4);
    });
});

describe("extractFrame", () => {
    it("captures a frame at timeSec and returns the uploaded url", async () => {
        const captureFrame = vi.fn().mockResolvedValue("data:image/png;base64,xxx");
        const uploadDataUrl = vi.fn().mockResolvedValue("https://s3/frame.png");
        const out = await extractFrame({ timeSec: 2.5 }, "https://s3/video.mp4", {
            captureFrame,
            uploadDataUrl,
        });
        expect(captureFrame).toHaveBeenCalledWith("https://s3/video.mp4", 2.5);
        expect(out).toEqual({ url: "https://s3/frame.png" });
    });

    it("fails when the upload falls back to the data url", async () => {
        await expect(
            extractFrame({ timeSec: 0 }, "https://s3/video.mp4", {
                captureFrame: vi.fn().mockResolvedValue("data:image/png;base64,xxx"),
                uploadDataUrl: vi.fn().mockResolvedValue("data:image/png;base64,xxx"),
            }),
        ).rejects.toThrow(/не удалось загрузить/);
    });

    it("rejects invalid params", async () => {
        await expect(
            extractFrame({ timeSec: -1 }, "https://s3/video.mp4", {
                captureFrame: vi.fn(),
                uploadDataUrl: vi.fn(),
            }),
        ).rejects.toThrow(/invalid params/);
    });
});
