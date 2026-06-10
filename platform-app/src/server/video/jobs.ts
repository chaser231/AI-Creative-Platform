/**
 * VideoJob lifecycle (server-only).
 *
 * syncVideoJob() performs exactly ONE non-blocking fal queue status check
 * and advances the job state machine:
 *
 *   QUEUED → RUNNING → PERSISTING → COMPLETED
 *                    ↘ FAILED
 *
 * PERSISTING is an internal claim state guarding the persist step against
 * concurrent polls (two tabs / StrictMode double-fetch): only the request
 * that wins the updateMany() transition downloads the video to S3, creates
 * the Asset and the AIMessage. Losers just return the current row and the
 * client keeps polling until COMPLETED.
 */

import type { VideoJob } from "@prisma/client";
import { prisma } from "@/server/db";
import { falGetQueueStatus } from "@/lib/ai-providers";
import {
    getVideoModelById,
    extractFalVideoUrl,
    estimateVideoCostUsd,
    type VideoGenerationParams,
} from "@/lib/video-models";
import { uploadVideoFromExternalUrl } from "@/server/workflow/helpers";

export const ACTIVE_VIDEO_JOB_STATUSES = ["QUEUED", "RUNNING", "PERSISTING"] as const;

/** Client-facing job shape (PERSISTING is reported as RUNNING). */
export interface VideoJobView {
    id: string;
    status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
    modelId: string;
    mode: string;
    params: VideoGenerationParams & { presetId?: string };
    resultUrl: string | null;
    error: string | null;
    projectId: string | null;
    sessionId: string | null;
    createdAt: string;
}

export function toVideoJobView(job: VideoJob): VideoJobView {
    const status = job.status === "PERSISTING" ? "RUNNING" : job.status;
    return {
        id: job.id,
        status: status as VideoJobView["status"],
        modelId: job.modelId,
        mode: job.mode,
        params: (job.params ?? {}) as unknown as VideoJobView["params"],
        resultUrl: job.resultUrl,
        error: job.error,
        projectId: job.projectId,
        sessionId: job.sessionId,
        createdAt: job.createdAt.toISOString(),
    };
}

/**
 * Poll fal once and advance the job. Returns the (possibly updated) row.
 */
export async function syncVideoJob(job: VideoJob): Promise<VideoJob> {
    if (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "PERSISTING") {
        return job;
    }

    const result = await falGetQueueStatus(job.falStatusUrl, job.falResponseUrl);

    if (result.status === "IN_QUEUE") {
        return job;
    }

    if (result.status === "IN_PROGRESS") {
        if (job.status !== "RUNNING") {
            return prisma.videoJob.update({
                where: { id: job.id },
                data: { status: "RUNNING" },
            });
        }
        return job;
    }

    if (result.status === "FAILED") {
        return prisma.videoJob.update({
            where: { id: job.id },
            data: { status: "FAILED", error: result.error.slice(0, 1000) },
        });
    }

    // COMPLETED — claim the persist step (loser of the race just re-reads).
    const claimed = await prisma.videoJob.updateMany({
        where: { id: job.id, status: { in: ["QUEUED", "RUNNING"] } },
        data: { status: "PERSISTING" },
    });
    if (claimed.count === 0) {
        return prisma.videoJob.findUniqueOrThrow({ where: { id: job.id } });
    }

    try {
        return await persistCompletedJob(job, result.payload);
    } catch (err) {
        // Persist failed (S3 hiccup, etc.) — release the claim so the next
        // poll retries instead of wedging the job in PERSISTING forever.
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[video] persist failed for job ${job.id}: ${msg}`);
        return prisma.videoJob.update({
            where: { id: job.id },
            data: { status: "RUNNING" },
        });
    }
}

async function persistCompletedJob(
    job: VideoJob,
    payload: Record<string, unknown>,
): Promise<VideoJob> {
    const falUrl = extractFalVideoUrl(payload);
    if (!falUrl) {
        return prisma.videoJob.update({
            where: { id: job.id },
            data: {
                status: "FAILED",
                error: `fal.ai response contained no video URL (keys: ${Object.keys(payload).join(", ")})`,
            },
        });
    }

    const params = (job.params ?? {}) as unknown as VideoGenerationParams & { presetId?: string };
    const model = getVideoModelById(job.modelId);
    const costUnits = model ? estimateVideoCostUsd(model, params.duration ?? model.defaultDuration) : null;

    // Persist to S3. If the re-upload fails we still complete the job with
    // the fal URL — a playable result beats a wedged job (fal links live
    // long enough for the user to download).
    let resultUrl = falUrl;
    let sizeBytes = 0;
    let contentType = "video/mp4";
    try {
        const uploaded = await uploadVideoFromExternalUrl(falUrl, { workspaceId: job.workspaceId });
        resultUrl = uploaded.s3Url;
        sizeBytes = uploaded.sizeBytes;
        contentType = uploaded.contentType;
    } catch (err) {
        console.warn(`[video] S3 persist failed for job ${job.id}, keeping fal URL:`, err instanceof Error ? err.message : err);
    }

    // Library asset (idempotent per projectless/workspace url).
    try {
        const existing = await prisma.asset.findFirst({
            where: { workspaceId: job.workspaceId, url: resultUrl },
            select: { id: true },
        });
        if (!existing) {
            await prisma.asset.create({
                data: {
                    type: "VIDEO",
                    filename: `video-generation-${Date.now()}.${contentType.split("/")[1] ?? "mp4"}`,
                    url: resultUrl,
                    mimeType: contentType,
                    sizeBytes,
                    metadata: {
                        source: "video-generation",
                        model: job.modelId,
                        mode: job.mode,
                        ...(params.prompt && { prompt: params.prompt.slice(0, 2000) }),
                        ...(params.duration && { duration: params.duration }),
                    },
                    workspaceId: job.workspaceId,
                    uploadedById: job.userId,
                    projectId: job.projectId,
                },
            });
        }
    } catch (err) {
        console.error(`[video] asset create failed for job ${job.id}:`, err instanceof Error ? err.message : err);
    }

    // Chat history message (video workspace feed restores from these).
    if (job.sessionId) {
        try {
            const session = await prisma.aISession.findUnique({
                where: { id: job.sessionId },
                select: { id: true },
            });
            if (session) {
                await prisma.aIMessage.create({
                    data: {
                        sessionId: job.sessionId,
                        role: "assistant",
                        content: resultUrl,
                        type: "video",
                        model: job.modelId,
                        costUnits,
                        metadata: {
                            jobId: job.id,
                            mode: job.mode,
                            ...(params.duration && { duration: params.duration }),
                            ...(params.aspectRatio && { aspectRatio: params.aspectRatio }),
                            ...(params.resolution && { resolution: params.resolution }),
                            ...(params.presetId && { presetId: params.presetId }),
                        },
                    },
                });
            }
        } catch (err) {
            console.error(`[video] message create failed for job ${job.id}:`, err instanceof Error ? err.message : err);
        }
    }

    return prisma.videoJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", resultUrl, costUnits },
    });
}
