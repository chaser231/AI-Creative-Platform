/**
 * POST /api/ai/video/generate — submit an async video generation job.
 *
 * Unlike image generation, video runs 1–10 minutes — far beyond the 300s
 * serverless ceiling — so this route NEVER waits for the result. It checks
 * the per-user daily quota, submits to the fal queue, records a VideoJob
 * and returns immediately. The client polls GET /api/ai/video/jobs/[id].
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { assertWorkspaceAccess } from "@/server/authz/guards";
import { falSubmitOnly } from "@/lib/ai-providers";
import {
    getVideoModelById,
    getModelDurations,
    buildFalVideoInput,
    type VideoMode,
    type VideoGenerationParams,
} from "@/lib/video-models";
import {
    isMultiShotCustomize,
    parseMultiShotConfig,
    resolveEffectiveDuration,
    validateMultiShot,
} from "@/lib/video-multishot";
import { applyMotionPreset, getMotionPresetById } from "@/lib/video-presets";
import { checkVideoQuota } from "@/server/video/quota";
import { toVideoJobView } from "@/server/video/jobs";

export const maxDuration = 60;

function isHttpsUrl(value: unknown): value is string {
    if (typeof value !== "string") return false;
    try {
        return new URL(value).protocol === "https:";
    } catch {
        return false;
    }
}

function applyPresetToMultiShot(
    multiShot: NonNullable<VideoGenerationParams["multiShot"]>,
    presetId: string | undefined,
    strategy: "api" | "prompt",
): NonNullable<VideoGenerationParams["multiShot"]> {
    if (!presetId || multiShot.shotType === "intelligent") return multiShot;
    if (strategy === "api") {
        return {
            ...multiShot,
            shots: multiShot.shots.map((s) => ({
                ...s,
                prompt: applyMotionPreset(s.prompt, presetId),
            })),
        };
    }
    return multiShot;
}

export async function POST(req: NextRequest) {
    const requestId = randomUUID();
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
        }
        const userId = session.user.id;

        const rl = checkRateLimit(`video-gen:${userId}`, { limit: 10, windowSeconds: 60 });
        if (!rl.allowed) {
            return NextResponse.json(
                { error: "Слишком много запросов. Подождите минуту.", requestId, retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
                { status: 429 },
            );
        }

        const body = await req.json() as Record<string, unknown>;
        const {
            modelId, mode, prompt, duration, aspectRatio, resolution,
            audio, negativePrompt, presetId, multiShot: multiShotRaw,
            startFrameUrl, endFrameUrl,
            workspaceId, projectId, sessionId,
        } = body;

        if (typeof workspaceId !== "string" || !workspaceId) {
            return NextResponse.json({ error: "workspaceId required", requestId }, { status: 400 });
        }

        const model = getVideoModelById(typeof modelId === "string" ? modelId : "");
        if (!model) {
            return NextResponse.json({ error: `Unknown video model: ${modelId}`, requestId }, { status: 400 });
        }

        const multiShot = parseMultiShotConfig(multiShotRaw);
        const videoMode: VideoMode = mode === "i2v" ? "i2v" : "t2v";
        const customizeMulti = multiShot && isMultiShotCustomize(multiShot, model);
        const intelligentMulti = multiShot?.enabled && multiShot.shotType === "intelligent";

        const promptText = typeof prompt === "string" ? prompt.trim() : "";
        if (!customizeMulti && !intelligentMulti && !promptText) {
            return NextResponse.json({ error: "Prompt is required", requestId }, { status: 400 });
        }
        if (intelligentMulti && !promptText) {
            return NextResponse.json({ error: "Prompt is required for intelligent multi-shot", requestId }, { status: 400 });
        }

        const endpoint = model.endpoints[videoMode];
        if (!endpoint) {
            return NextResponse.json({ error: `Модель ${model.label} не поддерживает режим ${videoMode}`, requestId }, { status: 400 });
        }
        if (videoMode === "i2v" && !isHttpsUrl(startFrameUrl)) {
            return NextResponse.json({ error: "startFrameUrl (https) required for image-to-video", requestId }, { status: 400 });
        }
        if (presetId !== undefined && presetId !== null && (typeof presetId !== "string" || (presetId && !getMotionPresetById(presetId)))) {
            return NextResponse.json({ error: `Unknown motion preset: ${presetId}`, requestId }, { status: 400 });
        }

        if (multiShot) {
            const multiErr = validateMultiShot(model, multiShot, videoMode);
            if (multiErr) {
                return NextResponse.json({ error: multiErr, requestId }, { status: 400 });
            }
        }

        const allowedDurations = getModelDurations(model, videoMode);
        const fallbackDuration = typeof duration === "string" && allowedDurations.includes(duration)
            ? duration
            : (allowedDurations.includes(model.defaultDuration) ? model.defaultDuration : allowedDurations[0]);
        const resolvedDuration = resolveEffectiveDuration(model, multiShot ?? undefined, fallbackDuration);
        const resolvedAspect = model.aspectRatios && typeof aspectRatio === "string" && model.aspectRatios.includes(aspectRatio)
            ? aspectRatio
            : model.defaultAspectRatio;
        const resolvedResolution = model.resolutions && typeof resolution === "string" && model.resolutions.includes(resolution)
            ? resolution
            : model.defaultResolution;

        try {
            await assertWorkspaceAccess({ prisma, user: { id: userId } }, workspaceId);
        } catch {
            return NextResponse.json({ error: "Forbidden workspace", requestId }, { status: 403 });
        }

        const quota = await checkVideoQuota(userId, model.id);
        if (!quota.allowed) {
            const message = quota.reason === "model-disabled"
                ? `Модель ${model.label} отключена администратором`
                : `Дневной лимит для ${model.label} исчерпан (${quota.dailyLimit}/день)`;
            return NextResponse.json(
                {
                    error: message,
                    code: quota.reason,
                    requestId,
                    quota: { dailyLimit: quota.dailyLimit, usedToday: quota.usedToday, remaining: quota.remaining, resetAt: quota.resetAt },
                },
                { status: 429 },
            );
        }

        const presetKey = typeof presetId === "string" ? presetId : undefined;
        let resolvedMultiShot = multiShot;
        if (multiShot && model.multiShot) {
            resolvedMultiShot = applyPresetToMultiShot(multiShot, presetKey, model.multiShot.strategy);
        }

        const params: VideoGenerationParams & { presetId?: string } = {
            prompt: customizeMulti
                ? ""
                : applyMotionPreset(promptText, presetKey),
            duration: resolvedDuration,
            aspectRatio: resolvedAspect,
            resolution: resolvedResolution,
            audio: typeof audio === "boolean" ? audio : undefined,
            negativePrompt: typeof negativePrompt === "string" && negativePrompt.trim() ? negativePrompt.trim() : undefined,
            startFrameUrl: isHttpsUrl(startFrameUrl) ? startFrameUrl : undefined,
            endFrameUrl: isHttpsUrl(endFrameUrl) ? endFrameUrl : undefined,
            multiShot: resolvedMultiShot ?? undefined,
            ...(presetKey ? { presetId: presetKey } : {}),
        };
        const falInput = buildFalVideoInput(model, videoMode, params);

        console.log("[/api/ai/video/generate] submit", {
            requestId, userId, modelId: model.id, mode: videoMode, endpoint,
            duration: resolvedDuration, aspect: resolvedAspect, resolution: resolvedResolution,
            multiShot: Boolean(resolvedMultiShot?.enabled),
        });

        const submission = await falSubmitOnly(endpoint, falInput);

        const job = await prisma.videoJob.create({
            data: {
                userId,
                workspaceId,
                projectId: typeof projectId === "string" && projectId ? projectId : null,
                sessionId: typeof sessionId === "string" && sessionId ? sessionId : null,
                modelId: model.id,
                mode: videoMode,
                params: {
                    ...params,
                    prompt: promptText,
                    ...(resolvedMultiShot ? { multiShot: resolvedMultiShot } : {}),
                } as object,
                falRequestId: submission.requestId,
                falStatusUrl: submission.statusUrl,
                falResponseUrl: submission.responseUrl,
                status: "QUEUED",
            },
        });

        return NextResponse.json({
            job: toVideoJobView(job),
            quota: {
                dailyLimit: quota.dailyLimit,
                remaining: quota.remaining === null ? null : quota.remaining - 1,
                resetAt: quota.resetAt,
            },
            requestId,
        });
    } catch (error: unknown) {
        const err = error as Error;
        console.error("[/api/ai/video/generate]", { requestId, error: err });
        return NextResponse.json({ error: err.message || "Internal Server Error", requestId }, { status: 500 });
    }
}
