import {
    GENERATION_RATE_LIMIT_RETRY_DELAYS_MS,
    MAX_CONCURRENT_IMAGE_JOBS,
} from "@/lib/generation-limits";
import { isRetryableGenerationError } from "@/lib/parseGenerationError";

export type ImageJobStatus = "queued" | "running" | "completed" | "failed";
export type ImageJobSurface = "photo" | "studio" | "wizard" | "multi";

export interface ImageGenerationJobMeta {
    id: string;
    projectId: string;
    surface: ImageJobSurface;
    layerId?: string;
    sessionId?: string;
    prompt: string;
    imageCount: number;
    status: ImageJobStatus;
    createdAt: number;
    errorMessage?: string;
}

export type ImageGenerationRunner = () => Promise<void>;

interface QueuedEntry {
    meta: ImageGenerationJobMeta;
    runner: ImageGenerationRunner;
}

type JobListener = (jobs: ImageGenerationJobMeta[]) => void;

const jobsByProject = new Map<string, ImageGenerationJobMeta[]>();
const waitQueueByProject = new Map<string, QueuedEntry[]>();
const runningCountByProject = new Map<string, number>();
const listeners = new Set<JobListener>();

function getJobs(projectId: string): ImageGenerationJobMeta[] {
    if (!jobsByProject.has(projectId)) {
        jobsByProject.set(projectId, []);
    }
    return jobsByProject.get(projectId)!;
}

function notify() {
    const snapshot = new Map(jobsByProject);
    for (const listener of listeners) {
        listener(Array.from(snapshot.values()).flat());
    }
}

function updateJob(projectId: string, jobId: string, patch: Partial<ImageGenerationJobMeta>) {
    const jobs = getJobs(projectId);
    const index = jobs.findIndex((j) => j.id === jobId);
    if (index === -1) return;
    jobs[index] = { ...jobs[index], ...patch };
    notify();
}

function runningCount(projectId: string): number {
    return runningCountByProject.get(projectId) ?? 0;
}

function setRunningCount(projectId: string, count: number) {
    runningCountByProject.set(projectId, count);
}

async function runWithRetry(runner: ImageGenerationRunner): Promise<void> {
    let attempt = 0;
    const maxAttempts = 1 + GENERATION_RATE_LIMIT_RETRY_DELAYS_MS.length;

    while (attempt < maxAttempts) {
        try {
            await runner();
            return;
        } catch (error) {
            attempt += 1;
            const retryable = isRetryableGenerationError(error);
            if (!retryable || attempt >= maxAttempts) {
                throw error;
            }
            const delay = GENERATION_RATE_LIMIT_RETRY_DELAYS_MS[attempt - 1] ?? 8_000;
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}

function pump(projectId: string) {
    const waitQueue = waitQueueByProject.get(projectId) ?? [];
    while (runningCount(projectId) < MAX_CONCURRENT_IMAGE_JOBS && waitQueue.length > 0) {
        const next = waitQueue.shift()!;
        waitQueueByProject.set(projectId, waitQueue);
        void executeEntry(next);
    }
}

async function executeEntry(entry: QueuedEntry) {
    const { meta, runner } = entry;
    const { projectId, id } = meta;

    setRunningCount(projectId, runningCount(projectId) + 1);
    updateJob(projectId, id, { status: "running" });

    try {
        await runWithRetry(runner);
        updateJob(projectId, id, { status: "completed", errorMessage: undefined });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateJob(projectId, id, { status: "failed", errorMessage: message });
    } finally {
        setRunningCount(projectId, Math.max(0, runningCount(projectId) - 1));
        pump(projectId);
    }
}

export function subscribeImageGenerationJobs(listener: JobListener): () => void {
    listeners.add(listener);
    listener(Array.from(jobsByProject.values()).flat());
    return () => listeners.delete(listener);
}

export function enqueueImageGeneration(
    meta: Omit<ImageGenerationJobMeta, "status" | "createdAt"> & { createdAt?: number },
    runner: ImageGenerationRunner,
): void {
    const job: ImageGenerationJobMeta = {
        ...meta,
        status: "queued",
        createdAt: meta.createdAt ?? Date.now(),
    };

    const jobs = getJobs(meta.projectId);
    jobs.push(job);
    notify();

    const entry: QueuedEntry = { meta: job, runner };
    const waitQueue = waitQueueByProject.get(meta.projectId) ?? [];

    if (runningCount(meta.projectId) < MAX_CONCURRENT_IMAGE_JOBS) {
        void executeEntry(entry);
    } else {
        waitQueue.push(entry);
        waitQueueByProject.set(meta.projectId, waitQueue);
    }
}

export function getImageJobsForProject(projectId: string): ImageGenerationJobMeta[] {
    return [...getJobs(projectId)];
}

export function getProjectQueueCounts(projectId: string): { running: number; queued: number } {
    const jobs = getJobs(projectId);
    const running = jobs.filter((j) => j.status === "running").length;
    const queued = jobs.filter((j) => j.status === "queued").length;
    return { running, queued };
}

export function clearCompletedJobs(projectId: string, maxAgeMs = 60_000) {
    const jobs = getJobs(projectId);
    const cutoff = Date.now() - maxAgeMs;
    const filtered = jobs.filter(
        (j) =>
            j.status === "queued"
            || j.status === "running"
            || j.createdAt > cutoff,
    );
    jobsByProject.set(projectId, filtered);
    notify();
}

/** Test-only reset */
export function _resetImageGenerationQueueForTests() {
    jobsByProject.clear();
    waitQueueByProject.clear();
    runningCountByProject.clear();
}
