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
            audio, negativePrompt, presetId,
            startFrameUrl, endFrameUrl,
            workspaceId, projectId, sessionId,
        } = body;

        if (typeof workspaceId !== "string" || !workspaceId) {
            return NextResponse.json({ error: "workspaceId required", requestId }, { status: 400 });
        }
        if (typeof prompt !== "string" || !prompt.trim()) {
            return NextResponse.json({ error: "Prompt is required", requestId }, { status: 400 });
        }
        const model = getVideoModelById(typeof modelId === "string" ? modelId : "");
        if (!model) {
            return NextResponse.json({ error: `Unknown video model: ${modelId}`, requestId }, { status: 400 });
        }
        const videoMode: VideoMode = mode === "i2v" ? "i2v" : "t2v";
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

        const allowedDurations = getModelDurations(model, videoMode);
        const resolvedDuration = typeof duration === "string" && allowedDurations.includes(duration)
            ? duration
            : (allowedDurations.includes(model.defaultDuration) ? model.defaultDuration : allowedDurations[0]);
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

        // ── Daily quota ────────────────────────────────────────────────
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

        // ── Build input + submit to fal queue ──────────────────────────
        const params: VideoGenerationParams & { presetId?: string } = {
            prompt: applyMotionPreset(prompt.trim(), typeof presetId === "string" ? presetId : undefined),
            duration: resolvedDuration,
            aspectRatio: resolvedAspect,
            resolution: resolvedResolution,
            audio: typeof audio === "boolean" ? audio : undefined,
            negativePrompt: typeof negativePrompt === "string" && negativePrompt.trim() ? negativePrompt.trim() : undefined,
            startFrameUrl: isHttpsUrl(startFrameUrl) ? startFrameUrl : undefined,
            endFrameUrl: isHttpsUrl(endFrameUrl) ? endFrameUrl : undefined,
            ...(typeof presetId === "string" && presetId ? { presetId } : {}),
        };
        const falInput = buildFalVideoInput(model, videoMode, params);

        console.log("[/api/ai/video/generate] submit", {
            requestId, userId, modelId: model.id, mode: videoMode, endpoint,
            duration: resolvedDuration, aspect: resolvedAspect, resolution: resolvedResolution,
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
                // Store the original user prompt (preset already merged into
                // the fal input) so the feed shows what the user typed.
                params: { ...params, prompt: prompt.trim() },
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
