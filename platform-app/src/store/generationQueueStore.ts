import { create } from "zustand";
import {
    enqueueImageGeneration,
    subscribeImageGenerationJobs,
    type ImageGenerationJobMeta,
    type ImageGenerationRunner,
} from "@/lib/imageGenerationQueue";

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
