/**
 * Client-side workflow handlers — thin contracts for the Phase 4 executor.
 *
 * These are NOT invoked in Phase 3. They exist so Phase 4 can import them
 * with the same signature the planner committed to in 03-CONTEXT.md / D-17,
 * and so we can unit-test the per-node param resolution rules now without
 * waiting for the executor implementation.
 *
 * Why client-side instead of server actions:
 * - imageInput needs a URL the user already chose interactively (library
 *   pick or in-browser upload). The server has no extra info to add.
 * - assetOutput writes the workflow's final image to the workspace asset
 *   library. It's a thin wrapper around the existing asset.attachUrlToWorkspace
 *   tRPC mutation; the executor calls it from the browser to keep auth and
 *   billing accounting on the user's session.
 *
 * Phase 3, Wave 5 — D-17.
 */

import {
    assetOutputParamsSchema,
    extractFrameParamsSchema,
    imageInputParamsSchema,
    imageToVideoParamsSchema,
    paintMaskParamsSchema,
    textToVideoParamsSchema,
    type AssetOutputParams,
    type ImageInputParams,
    type PaintMaskParams,
    type TextToVideoParams,
} from "@/lib/workflow/nodeParamSchemas";
import { buildMultiShotConfigFromWorkflowParams, isMultiShotCustomize } from "@/lib/video-multishot";
import { getVideoModelById } from "@/lib/video-models";

/** Resolved output of an imageInput node — the executor pipes `.url` downstream. */
export interface ImageInputResult {
    url: string;
    /** Set only when the source was a library pick — null for raw URL or fresh upload. */
    assetId: string | null;
}

/** TRPC client surface the handlers depend on. Kept narrow for testability. */
export interface ClientHandlerDeps {
    /** trpc.asset.getById query — returns an asset row with at least { url }. */
    getAssetById: (input: { id: string }) => Promise<{ id: string; url: string }>;
    /** trpc.asset.attachUrlToWorkspace mutation — registers a final image/video. */
    attachUrlToWorkspace: (input: {
        workspaceId: string;
        url: string;
        filename?: string;
        mimeType?: string;
        type?: "IMAGE" | "VIDEO";
    }) => Promise<{ id: string }>;
}

/**
 * Resolve an imageInput node's params into a downstream URL.
 *
 * Validation is the executor's responsibility too (it must short-circuit the
 * whole graph if any node has invalid params), but we re-run safeParse here
 * so this contract is self-defending if a future caller forgets.
 */
export async function imageInput(
    rawParams: unknown,
    deps: ClientHandlerDeps,
): Promise<ImageInputResult> {
    const parsed = imageInputParamsSchema.safeParse(rawParams);
    if (!parsed.success) {
        throw new Error(
            `imageInput: invalid params — ${parsed.error.issues
                .map((i) => i.message)
                .join("; ")}`,
        );
    }

    const params: ImageInputParams = parsed.data;

    if (params.source === "asset") {
        const asset = await deps.getAssetById({ id: params.assetId! });
        return { url: asset.url, assetId: asset.id };
    }

    return { url: params.sourceUrl!, assetId: null };
}

/** Resolved output of an assetOutput node — the executor surfaces this in the run summary. */
export interface AssetOutputResult {
    assetId: string;
    url: string;
    name: string;
}

/** Resolved output of a preview node — just passes the upstream URL. */
export interface PreviewResult {
    url: string;
}

/**
 * Persist the upstream image as a workspace-level Asset.
 *
 * Idempotency is enforced server-side by `attachUrlToWorkspace`
 * (workspaceId + url uniqueness, projectId null), so re-running the same
 * workflow with unchanged inputs reuses the existing library entry.
 */
export async function assetOutput(
    rawParams: unknown,
    upstreamUrl: string,
    workspaceId: string,
    deps: ClientHandlerDeps,
): Promise<AssetOutputResult> {
    const parsed = assetOutputParamsSchema.safeParse(rawParams);
    if (!parsed.success) {
        throw new Error(
            `assetOutput: invalid params — ${parsed.error.issues
                .map((i) => i.message)
                .join("; ")}`,
        );
    }

    const params: AssetOutputParams = parsed.data;

    const video = isVideoUrl(upstreamUrl);
    const created = await deps.attachUrlToWorkspace({
        workspaceId,
        url: upstreamUrl,
        filename: params.name,
        ...(video ? { mimeType: "video/mp4", type: "VIDEO" as const } : {}),
    });

    return { assetId: created.id, url: upstreamUrl, name: params.name };
}

/**
 * Preview node handler. Just passes the upstream image URL downstream.
 */
export async function preview(
    rawParams: unknown,
    upstreamUrl: string,
): Promise<PreviewResult> {
    return { url: upstreamUrl };
}

/** Resolved output of a paintMask node — the executor pipes `.url` to mask-in ports downstream. */
export interface PaintMaskResult {
    url: string;
}

/**
 * paintMask node handler.
 *
 * The actual mask painting happens in the inspector's modal (InpaintImageModal),
 * which uploads the rasterized mask PNG to S3 and writes the URL into
 * `node.data.params.maskUrl`. This handler simply re-emits that URL so the
 * executor wires it into downstream `mask-in` ports.
 *
 * If `maskUrl` is missing or empty, we throw a friendly error — the user
 * must open the inspector and paint a mask before running the graph.
 */
export async function paintMask(rawParams: unknown): Promise<PaintMaskResult> {
    const parsed = paintMaskParamsSchema.safeParse(rawParams);
    if (!parsed.success) {
        throw new Error(
            `paintMask: invalid params — ${parsed.error.issues
                .map((i) => i.message)
                .join("; ")}`,
        );
    }
    const params: PaintMaskParams = parsed.data;
    if (!params.maskUrl) {
        throw new Error("paintMask: маска не нарисована — откройте инспектор и нарисуйте область");
    }
    return { url: params.maskUrl };
}

// ─── Video nodes ─────────────────────────────────────────────────────────────

/** Heuristic for telling video URLs apart from images on `any`-typed ports. */
export function isVideoUrl(url: string): boolean {
    try {
        const pathname = new URL(url).pathname.toLowerCase();
        return /\.(mp4|webm|mov|m4v)$/.test(pathname);
    } catch {
        return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
    }
}

/** Minimal job shape returned by the video generate/poll API. */
export interface VideoJobSnapshot {
    id: string;
    status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
    resultUrl: string | null;
    error: string | null;
}

/**
 * Video generation API surface, injected so tests don't hit the network.
 * Defaults (fetch against /api/ai/video/*) live in the executor module.
 */
export interface VideoGenerationDeps {
    submitVideoJob: (body: Record<string, unknown>) => Promise<VideoJobSnapshot>;
    pollVideoJob: (jobId: string) => Promise<VideoJobSnapshot>;
    /** Injectable sleep — tests pass a no-op to fast-forward the poll loop. */
    sleepMs?: (ms: number) => Promise<void>;
    /** Poll interval / max attempts overrides (defaults: 5s × 180 = 15 min). */
    pollIntervalMs?: number;
    maxPollAttempts?: number;
}

export interface VideoGenerationResult {
    url: string;
    jobId: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Build the POST /api/ai/video/generate body from node params + wired inputs.
 * Exported separately so the param-mapping rules are unit-testable without
 * driving the full submit-and-poll loop.
 */
export function buildVideoGenerateBody(opts: {
    mode: "t2v" | "i2v";
    params: TextToVideoParams;
    workspaceId: string;
    promptFromInput?: string;
    startFrameUrl?: string;
    endFrameUrl?: string;
}): Record<string, unknown> {
    const { mode, params, workspaceId, promptFromInput, startFrameUrl, endFrameUrl } = opts;

    // Local prompt and upstream text are concatenated — the node's own prompt
    // acts as a style/instruction prefix for whatever the graph pipes in.
    const prompt = [params.prompt.trim(), promptFromInput?.trim()]
        .filter(Boolean)
        .join("\n");

    const multiShot = buildMultiShotConfigFromWorkflowParams({
        multiShotEnabled: params.multiShotEnabled,
        multiShotType: params.multiShotType,
        multiShotLines: params.multiShotLines,
    });

    return {
        modelId: params.model,
        mode,
        prompt,
        duration: params.duration,
        aspectRatio: params.aspectRatio,
        ...(params.resolution !== "auto" ? { resolution: params.resolution } : {}),
        audio: params.audio,
        ...(params.presetId !== "none" ? { presetId: params.presetId } : {}),
        ...(startFrameUrl ? { startFrameUrl } : {}),
        ...(endFrameUrl ? { endFrameUrl } : {}),
        ...(multiShot ? { multiShot } : {}),
        workspaceId,
    };
}

/**
 * Shared submit-and-poll driver for textToVideo / imageToVideo nodes.
 * Video generation runs 1–10 minutes, so this loops on the async job API
 * instead of a single blocking request.
 */
export async function runVideoGeneration(opts: {
    mode: "t2v" | "i2v";
    rawParams: unknown;
    workspaceId: string;
    promptFromInput?: string;
    startFrameUrl?: string;
    endFrameUrl?: string;
    deps: VideoGenerationDeps;
}): Promise<VideoGenerationResult> {
    const schema = opts.mode === "t2v" ? textToVideoParamsSchema : imageToVideoParamsSchema;
    const parsed = schema.safeParse(opts.rawParams);
    if (!parsed.success) {
        throw new Error(
            `videoGeneration: invalid params — ${parsed.error.issues
                .map((i) => i.message)
                .join("; ")}`,
        );
    }
    const params = parsed.data as TextToVideoParams;

    const body = buildVideoGenerateBody({
        mode: opts.mode,
        params,
        workspaceId: opts.workspaceId,
        promptFromInput: opts.promptFromInput,
        startFrameUrl: opts.startFrameUrl,
        endFrameUrl: opts.endFrameUrl,
    });
    const model = getVideoModelById(params.model);
    const multiShot = body.multiShot as ReturnType<typeof buildMultiShotConfigFromWorkflowParams>;
    const customizeMulti = Boolean(
        model && multiShot && isMultiShotCustomize(multiShot, model),
    );
    if (!customizeMulti && !String(body.prompt ?? "").trim()) {
        throw new Error("Видео-нода: укажите промпт или подключите текстовый вход");
    }
    if (opts.mode === "i2v" && !opts.startFrameUrl) {
        throw new Error("imageToVideo: нет входного изображения (стартовый кадр)");
    }

    const submitted = await opts.deps.submitVideoJob(body);
    if (submitted.status === "FAILED") {
        throw new Error(submitted.error || "Видео-генерация не запустилась");
    }

    const sleep = opts.deps.sleepMs ?? defaultSleep;
    const interval = opts.deps.pollIntervalMs ?? 5_000;
    const maxAttempts = opts.deps.maxPollAttempts ?? 180;

    let consecutivePollErrors = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await sleep(interval);
        let job: VideoJobSnapshot;
        try {
            job = await opts.deps.pollVideoJob(submitted.id);
            consecutivePollErrors = 0;
        } catch (err) {
            // Transient network/server hiccups shouldn't kill a 10-minute job.
            consecutivePollErrors += 1;
            if (consecutivePollErrors >= 3) throw err;
            continue;
        }
        if (job.status === "COMPLETED" && job.resultUrl) {
            return { url: job.resultUrl, jobId: job.id };
        }
        if (job.status === "FAILED") {
            throw new Error(job.error || "Видео-генерация завершилась с ошибкой");
        }
    }
    throw new Error("Видео-генерация не завершилась за отведённое время");
}

/** Browser capabilities the extractFrame handler needs, injected for tests. */
export interface ExtractFrameDeps {
    /** Decode the video and rasterise the frame at `timeSec` → data URL. */
    captureFrame: (videoUrl: string, timeSec: number) => Promise<string>;
    /** Upload the captured data URL to S3 → public https URL. */
    uploadDataUrl: (dataUrl: string) => Promise<string>;
}

/**
 * extractFrame node handler — pulls a single frame out of the upstream video
 * so it can feed image ports downstream (видео → кадр → видео chains).
 */
export async function extractFrame(
    rawParams: unknown,
    videoUrl: string,
    deps: ExtractFrameDeps,
): Promise<{ url: string }> {
    const parsed = extractFrameParamsSchema.safeParse(rawParams);
    if (!parsed.success) {
        throw new Error(
            `extractFrame: invalid params — ${parsed.error.issues
                .map((i) => i.message)
                .join("; ")}`,
        );
    }
    const dataUrl = await deps.captureFrame(videoUrl, parsed.data.timeSec);
    const uploaded = await deps.uploadDataUrl(dataUrl);
    if (!uploaded || uploaded.startsWith("data:")) {
        throw new Error("extractFrame: не удалось загрузить кадр в хранилище");
    }
    return { url: uploaded };
}
