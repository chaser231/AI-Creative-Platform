/**
 * Video Generation Store
 *
 * Client state for the Higgsfield-like `/video/[id]` workspace:
 * - active session (chat-style history reuses AISession/AIMessage)
 * - generation settings (mode, model, duration, aspect, resolution, audio,
 *   motion preset, start/end frames)
 * - active jobs being polled (submitted to /api/ai/video/generate; the
 *   useVideoJobPolling hook drives them to completion)
 */

import { create } from "zustand";
import {
    DEFAULT_VIDEO_MODEL_ID,
    getVideoModelById,
    getModelDurations,
    type VideoMode,
} from "@/lib/video-models";

export interface ActiveVideoJob {
    id: string;
    sessionId: string | null;
    prompt: string;
    modelId: string;
    mode: VideoMode;
    status: "QUEUED" | "RUNNING";
    aspectRatio?: string;
    createdAt: number;
}

export interface VideoStore {
    // Sessions
    activeSessionId: string | null;
    setActiveSession: (id: string | null) => void;

    // Generation settings
    mode: VideoMode;
    setMode: (mode: VideoMode) => void;
    selectedModelId: string;
    setSelectedModel: (id: string) => void;
    duration: string;
    setDuration: (d: string) => void;
    aspectRatio: string | undefined;
    setAspectRatio: (r: string | undefined) => void;
    resolution: string | undefined;
    setResolution: (r: string | undefined) => void;
    audio: boolean;
    setAudio: (a: boolean) => void;
    presetId: string | null;
    setPresetId: (id: string | null) => void;

    // i2v frames (public https URLs)
    startFrameUrl: string | null;
    setStartFrameUrl: (url: string | null) => void;
    endFrameUrl: string | null;
    setEndFrameUrl: (url: string | null) => void;

    // Active jobs (polled by useVideoJobPolling)
    activeJobs: ActiveVideoJob[];
    addActiveJob: (job: ActiveVideoJob) => void;
    updateActiveJobStatus: (id: string, status: "QUEUED" | "RUNNING") => void;
    removeActiveJob: (id: string) => void;
}

/** Reconcile dependent settings after a model/mode change. */
function settingsForModel(modelId: string, mode: VideoMode, prev: Partial<VideoStore>) {
    const model = getVideoModelById(modelId);
    if (!model) return {};
    const durations = getModelDurations(model, mode);
    const duration = prev.duration && durations.includes(prev.duration)
        ? prev.duration
        : (durations.includes(model.defaultDuration) ? model.defaultDuration : durations[0]);
    const aspectRatio = model.aspectRatios
        ? (prev.aspectRatio && model.aspectRatios.includes(prev.aspectRatio) ? prev.aspectRatio : model.defaultAspectRatio)
        : undefined;
    const resolution = model.resolutions
        ? (prev.resolution && model.resolutions.includes(prev.resolution) ? prev.resolution : model.defaultResolution)
        : undefined;
    return { duration, aspectRatio, resolution };
}

const defaultModel = getVideoModelById(DEFAULT_VIDEO_MODEL_ID);

export const useVideoStore = create<VideoStore>((set) => ({
    activeSessionId: null,
    setActiveSession: (id) => set({ activeSessionId: id }),

    mode: "t2v",
    setMode: (mode) =>
        set((s) => {
            const next = settingsForModel(s.selectedModelId, mode, s);
            const model = getVideoModelById(s.selectedModelId);
            // If the current model doesn't support the new mode, fall back to
            // the default model (which supports both).
            if (model && !model.endpoints[mode]) {
                return { mode, selectedModelId: DEFAULT_VIDEO_MODEL_ID, ...settingsForModel(DEFAULT_VIDEO_MODEL_ID, mode, s) };
            }
            return { mode, ...next };
        }),

    selectedModelId: DEFAULT_VIDEO_MODEL_ID,
    setSelectedModel: (id) =>
        set((s) => ({ selectedModelId: id, ...settingsForModel(id, s.mode, s) })),

    duration: defaultModel?.defaultDuration ?? "5",
    setDuration: (d) => set({ duration: d }),
    aspectRatio: defaultModel?.defaultAspectRatio,
    setAspectRatio: (r) => set({ aspectRatio: r }),
    resolution: defaultModel?.defaultResolution,
    setResolution: (r) => set({ resolution: r }),
    audio: true,
    setAudio: (a) => set({ audio: a }),
    presetId: null,
    setPresetId: (id) => set({ presetId: id }),

    startFrameUrl: null,
    setStartFrameUrl: (url) => set({ startFrameUrl: url }),
    endFrameUrl: null,
    setEndFrameUrl: (url) => set({ endFrameUrl: url }),

    activeJobs: [],
    addActiveJob: (job) =>
        set((s) => (s.activeJobs.some((j) => j.id === job.id) ? s : { activeJobs: [...s.activeJobs, job] })),
    updateActiveJobStatus: (id, status) =>
        set((s) => ({
            activeJobs: s.activeJobs.map((j) => (j.id === id ? { ...j, status } : j)),
        })),
    removeActiveJob: (id) =>
        set((s) => ({ activeJobs: s.activeJobs.filter((j) => j.id !== id) })),
}));
