/**
 * Video Generation Store
 *
 * Client state for the Higgsfield-like `/video/[id]` workspace:
 * - active session (chat-style history reuses AISession/AIMessage)
 * - generation settings (mode, model, duration, aspect, resolution, audio,
 *   motion preset, start/end frames, multi-shot)
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
import {
    createDefaultShots,
    type MultiShotConfig,
    type ShotType,
    type VideoShot,
} from "@/lib/video-multishot";

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

    // Multi-shot
    multiShotEnabled: boolean;
    setMultiShotEnabled: (enabled: boolean) => void;
    multiShots: VideoShot[];
    setMultiShots: (shots: VideoShot[]) => void;
    updateMultiShot: (index: number, patch: Partial<VideoShot>) => void;
    addMultiShot: () => void;
    removeMultiShot: (index: number) => void;
    shotType: ShotType;
    setShotType: (t: ShotType) => void;

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

    /** Build MultiShotConfig for API from current store state. */
    getMultiShotConfig: () => MultiShotConfig | undefined;
}

function resetMultiShotForModel(modelId: string): Partial<VideoStore> {
    const model = getVideoModelById(modelId);
    if (!model?.multiShot) {
        return {
            multiShotEnabled: false,
            multiShots: createDefaultShots(2, 5),
            shotType: "customize",
        };
    }
    return {
        multiShotEnabled: false,
        multiShots: createDefaultShots(model.multiShot.minShots, 5),
        shotType: model.multiShot.defaultShotType ?? "customize",
    };
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

export const useVideoStore = create<VideoStore>((set, get) => ({
    activeSessionId: null,
    setActiveSession: (id) => set({ activeSessionId: id }),

    mode: "t2v",
    setMode: (mode) =>
        set((s) => {
            const next = settingsForModel(s.selectedModelId, mode, s);
            const model = getVideoModelById(s.selectedModelId);
            if (model && !model.endpoints[mode]) {
                return {
                    mode,
                    selectedModelId: DEFAULT_VIDEO_MODEL_ID,
                    ...settingsForModel(DEFAULT_VIDEO_MODEL_ID, mode, s),
                    ...resetMultiShotForModel(DEFAULT_VIDEO_MODEL_ID),
                };
            }
            return { mode, ...next };
        }),

    selectedModelId: DEFAULT_VIDEO_MODEL_ID,
    setSelectedModel: (id) =>
        set((s) => ({
            selectedModelId: id,
            ...settingsForModel(id, s.mode, s),
            ...resetMultiShotForModel(id),
        })),

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

    multiShotEnabled: false,
    setMultiShotEnabled: (enabled) => set({ multiShotEnabled: enabled }),
    multiShots: createDefaultShots(2, 5),
    setMultiShots: (shots) => set({ multiShots: shots }),
    updateMultiShot: (index, patch) =>
        set((s) => ({
            multiShots: s.multiShots.map((shot, i) => (i === index ? { ...shot, ...patch } : shot)),
        })),
    addMultiShot: () =>
        set((s) => {
            const model = getVideoModelById(s.selectedModelId);
            const max = model?.multiShot?.maxShots ?? 6;
            if (s.multiShots.length >= max) return s;
            return { multiShots: [...s.multiShots, { prompt: "", durationSec: 5 }] };
        }),
    removeMultiShot: (index) =>
        set((s) => {
            const model = getVideoModelById(s.selectedModelId);
            const min = model?.multiShot?.minShots ?? 2;
            if (s.multiShots.length <= min) return s;
            return { multiShots: s.multiShots.filter((_, i) => i !== index) };
        }),
    shotType: "customize",
    setShotType: (t) => set({ shotType: t }),

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

    getMultiShotConfig: () => {
        const s = get();
        if (!s.multiShotEnabled) return undefined;
        return {
            enabled: true,
            shots: s.multiShots,
            shotType: s.shotType,
        };
    },
}));
