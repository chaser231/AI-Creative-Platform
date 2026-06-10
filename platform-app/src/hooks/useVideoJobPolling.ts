"use client";

/**
 * Polls active video jobs every 5s against /api/ai/video/jobs/[id].
 *
 * The server route performs the actual fal queue check and, on completion,
 * persists the video (S3 + Asset + AIMessage). This hook just reflects the
 * outcome into the UI: refresh the chat feed / library / quota badges,
 * surface failures as error messages, and refresh the project thumbnail
 * from the first frame of the newest result.
 */

import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useVideoStore } from "@/store/videoStore";
import { captureVideoFrame } from "@/utils/videoFrame";
import { uploadImageToS3 } from "@/utils/imageUpload";

const POLL_INTERVAL_MS = 5_000;

interface PolledJob {
    id: string;
    status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
    resultUrl: string | null;
    error: string | null;
    sessionId: string | null;
}

export function useVideoJobPolling(projectId: string) {
    const activeJobs = useVideoStore((s) => s.activeJobs);
    const utils = trpc.useUtils();
    const addMessageMutation = trpc.ai.addMessage.useMutation();
    const updateProjectMutation = trpc.project.update.useMutation();
    // Jobs currently being checked — prevents overlapping fetches when a
    // poll takes longer than the interval (e.g. server persisting to S3).
    const inFlightRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (activeJobs.length === 0) return;

        const tick = async () => {
            const { activeJobs: jobs, updateActiveJobStatus, removeActiveJob } = useVideoStore.getState();
            await Promise.all(jobs.map(async (job) => {
                if (inFlightRef.current.has(job.id)) return;
                inFlightRef.current.add(job.id);
                try {
                    const res = await fetch(`/api/ai/video/jobs/${job.id}`);
                    if (!res.ok) return; // transient — retry next tick
                    const data = await res.json() as { job?: PolledJob };
                    const polled = data.job;
                    if (!polled) return;

                    if (polled.status === "QUEUED" || polled.status === "RUNNING") {
                        if (polled.status !== job.status) {
                            updateActiveJobStatus(job.id, polled.status);
                        }
                        return;
                    }

                    // Terminal state
                    removeActiveJob(job.id);

                    if (polled.status === "FAILED") {
                        if (polled.sessionId) {
                            try {
                                await addMessageMutation.mutateAsync({
                                    sessionId: polled.sessionId,
                                    role: "assistant",
                                    content: polled.error || "Генерация видео не удалась",
                                    type: "error",
                                });
                            } catch { /* non-fatal */ }
                        }
                    }

                    // Refresh everything the result touches.
                    if (polled.sessionId) {
                        utils.ai.getMessages.invalidate({ sessionId: polled.sessionId });
                    }
                    utils.asset.listByProject.invalidate({ projectId });
                    utils.video.myQuotas.invalidate();

                    // Project thumbnail from the first frame (best-effort;
                    // fails silently when the video host lacks CORS).
                    if (polled.status === "COMPLETED" && polled.resultUrl) {
                        try {
                            const frame = await captureVideoFrame(polled.resultUrl, 0);
                            const thumbUrl = await uploadImageToS3(frame, projectId, "image/webp");
                            if (thumbUrl) {
                                await updateProjectMutation.mutateAsync({ id: projectId, thumbnail: thumbUrl });
                                utils.project.list.invalidate();
                            }
                        } catch { /* non-fatal */ }
                    }
                } catch {
                    // network blip — retry next tick
                } finally {
                    inFlightRef.current.delete(job.id);
                }
            }));
        };

        // Immediate first check, then interval.
        void tick();
        const interval = setInterval(tick, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeJobs.length, projectId]);
}
