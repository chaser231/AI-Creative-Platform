import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
    enqueueImageGeneration,
    subscribeImageGenerationJobs,
    type ImageGenerationJobMeta,
    type ImageGenerationRunner,
} from "@/lib/imageGenerationQueue";

export interface ProjectQueueCounts {
    running: number;
    queued: number;
}

interface GenerationQueueStore {
    jobs: ImageGenerationJobMeta[];
    setJobs: (jobs: ImageGenerationJobMeta[]) => void;
    enqueue: (
        meta: Omit<ImageGenerationJobMeta, "status" | "createdAt">,
        runner: ImageGenerationRunner,
    ) => void;
    jobsForProject: (projectId: string) => ImageGenerationJobMeta[];
    countsForProject: (projectId: string) => { running: number; queued: number };
    jobsForLayer: (projectId: string, layerId: string) => ImageGenerationJobMeta[];
    jobsForSession: (projectId: string, sessionId: string) => ImageGenerationJobMeta[];
}

let subscribed = false;

function ensureSubscription(setJobs: (jobs: ImageGenerationJobMeta[]) => void) {
    if (subscribed) return;
    subscribed = true;
    subscribeImageGenerationJobs(setJobs);
}

export const useGenerationQueueStore = create<GenerationQueueStore>((set, get) => {
    ensureSubscription((jobs) => set({ jobs }));

    return {
        jobs: [],
        setJobs: (jobs) => set({ jobs }),
        enqueue: (meta, runner) => {
            enqueueImageGeneration(meta, runner);
        },
        jobsForProject: (projectId) =>
            get().jobs.filter((j) => j.projectId === projectId),
        countsForProject: (projectId) => {
            const jobs = get().jobs.filter((j) => j.projectId === projectId);
            return {
                running: jobs.filter((j) => j.status === "running").length,
                queued: jobs.filter((j) => j.status === "queued").length,
            };
        },
        jobsForLayer: (projectId, layerId) =>
            get().jobs.filter((j) => j.projectId === projectId && j.layerId === layerId),
        jobsForSession: (projectId, sessionId) =>
            get().jobs.filter((j) => j.projectId === projectId && j.sessionId === sessionId),
    };
});

export function truncatePromptLabel(prompt: string, maxLen = 40): string {
    const trimmed = prompt.trim();
    if (trimmed.length <= maxLen) return trimmed;
    return `${trimmed.slice(0, maxLen - 1)}…`;
}

/** Stable selector — avoids returning a new array from useSyncExternalStore. */
export function useProjectQueueCounts(projectId: string | undefined): ProjectQueueCounts {
    return useGenerationQueueStore(
        useShallow((s) => {
            if (!projectId) return { running: 0, queued: 0 };
            let running = 0;
            let queued = 0;
            for (const job of s.jobs) {
                if (job.projectId !== projectId) continue;
                if (job.status === "running") running += 1;
                else if (job.status === "queued") queued += 1;
            }
            return { running, queued };
        }),
    );
}

export function formatProjectQueueBadge(counts: ProjectQueueCounts): string | null {
    const { running, queued } = counts;
    if (running === 0 && queued === 0) return null;
    if (running > 0 && queued > 0) return `${running} · ${queued} в очереди`;
    if (running > 0) return `${running} генерируются`;
    return `${queued} в очереди`;
}
