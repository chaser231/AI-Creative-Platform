/**
 * Batch generation runner — pure orchestration for one "Мульти-генерация" item.
 *
 * The browser drives the actual generation (the platform has no server-side
 * image job worker). This module contains the dependency-injected core so it
 * stays unit-testable: building the request for img2img vs t2i, extracting
 * result URLs, and the RUNNING → COMPLETED/FAILED status transitions written
 * back through the `batch` tRPC router. The React glue (tRPC mutations, the
 * image queue, S3 persistence) lives in `hooks/useBatchRunner.ts`.
 */

export type BatchMode = "img2img" | "t2i";

export type BatchItemStatus =
    | "PENDING"
    | "RUNNING"
    | "COMPLETED"
    | "FAILED"
    | "SKIPPED";

/** Settings shared by every item of a batch (snapshot taken at run start). */
export interface BatchGenerationConfig {
    projectId: string;
    mode: BatchMode;
    model: string;
    /** Fully-resolved prompt (ref tags + style suffix already applied). */
    prompt: string;
    aspectRatio?: string;
    scale?: string;
    countPerItem: number;
    /** LoRA / advanced fields forwarded verbatim to the generation endpoint. */
    loraFields?: Record<string, unknown>;
}

export interface BatchItemRef {
    id: string;
    sourceUrl: string;
}

export interface GenerationRequest {
    endpoint: string;
    body: Record<string, unknown>;
}

/**
 * Build the REST request for a single item. img2img reprocesses the source
 * photo through the image-edit pipeline; t2i feeds the source as a reference
 * to a fresh generation.
 */
export function buildGenerateRequest(
    config: BatchGenerationConfig,
    sourceUrl: string,
): GenerationRequest {
    const lora = config.loraFields ?? {};
    if (config.mode === "img2img") {
        return {
            endpoint: "/api/ai/image-edit",
            body: {
                action: "text-edit",
                prompt: config.prompt,
                imageBase64: sourceUrl,
                model: config.model,
                projectId: config.projectId,
                recordMessage: false,
                ...lora,
            },
        };
    }
    return {
        endpoint: "/api/ai/generate",
        body: {
            prompt: config.prompt,
            type: "image",
            model: config.model,
            aspectRatio: config.aspectRatio,
            scale: config.scale || undefined,
            count: config.countPerItem,
            referenceImages: [sourceUrl],
            projectId: config.projectId,
            recordMessage: false,
            ...lora,
        },
    };
}

interface GenerationResponse {
    error?: string;
    content?: string;
    contents?: unknown;
    model?: string;
}

/** Normalise the endpoint payload into a deduplicated list of result URLs. */
export function extractResultUrls(
    data: GenerationResponse,
    mode: BatchMode,
): string[] {
    if (mode === "img2img") {
        return data.content ? [data.content] : [];
    }
    const candidates =
        Array.isArray(data.contents) && data.contents.length > 0
            ? data.contents
            : data.content
              ? [data.content]
              : [];
    return Array.from(
        new Set(
            (candidates as unknown[]).filter(
                (url): url is string =>
                    typeof url === "string" && url.length > 0,
            ),
        ),
    );
}

export interface ProcessItemDeps {
    /** POST helper that returns the parsed JSON body. */
    fetchJson: (
        endpoint: string,
        body: Record<string, unknown>,
    ) => Promise<GenerationResponse>;
    /** Persist a (possibly temporary) result URL to S3; returns "" on failure. */
    persist: (url: string, projectId: string) => Promise<string>;
    /** Register the generated image in the project library. */
    saveAsset: (args: {
        projectId: string;
        url: string;
        prompt: string;
        model: string;
    }) => Promise<void>;
    /** Write the item's status back to the batch. */
    updateItem: (args: {
        itemId: string;
        status: BatchItemStatus;
        resultUrls?: string[];
        error?: string | null;
        costUnits?: number | null;
    }) => Promise<void>;
    /** Per-output cost estimate for a model id. */
    costForModel: (model: string) => number;
    /** True when the owning batch was cancelled — short-circuits the run. */
    isCancelled?: () => boolean;
    /** Maps an error into a user-facing message. */
    describeError?: (error: unknown) => string;
}

function isPersistedS3Url(url: string): boolean {
    return url.includes("storage.yandexcloud.net");
}

/**
 * Run one batch item end to end. Marks the item RUNNING, generates, persists
 * each result to S3, records library assets and flips the item to
 * COMPLETED. On failure it records FAILED and rethrows so the image queue can
 * apply its rate-limit retry/backoff. A cancelled batch short-circuits to
 * SKIPPED without spending a generation.
 */
export async function processBatchItem(
    deps: ProcessItemDeps,
    item: BatchItemRef,
    config: BatchGenerationConfig,
): Promise<void> {
    if (deps.isCancelled?.()) {
        await deps.updateItem({ itemId: item.id, status: "SKIPPED" });
        return;
    }

    await deps.updateItem({ itemId: item.id, status: "RUNNING" });

    try {
        const { endpoint, body } = buildGenerateRequest(config, item.sourceUrl);
        const data = await deps.fetchJson(endpoint, body);
        if (data.error || !data.content) {
            throw new Error(data.error || "Пустой ответ от модели");
        }

        const responseModel = data.model ?? config.model;
        const rawUrls = extractResultUrls(data, config.mode);

        const persisted: string[] = [];
        for (let i = 0; i < rawUrls.length; i++) {
            let result = "";
            try {
                result = await deps.persist(rawUrls[i], config.projectId);
                if (result && !isPersistedS3Url(result)) {
                    // One retry — temporary provider URLs occasionally race the
                    // upload proxy on the first attempt.
                    result = await deps.persist(rawUrls[i], config.projectId);
                }
            } catch {
                result = "";
            }
            if (!result || !isPersistedS3Url(result)) continue;
            persisted.push(result);
            try {
                await deps.saveAsset({
                    projectId: config.projectId,
                    url: result,
                    prompt: config.prompt,
                    model: responseModel,
                });
            } catch {
                // Library registration is best-effort; the result URL is still
                // recorded on the item below.
            }
        }

        if (persisted.length === 0) {
            throw new Error("Не удалось сохранить результат. Повторите попытку.");
        }

        await deps.updateItem({
            itemId: item.id,
            status: "COMPLETED",
            resultUrls: persisted,
            costUnits: deps.costForModel(responseModel) * persisted.length,
            error: null,
        });
    } catch (error) {
        const message = deps.describeError
            ? deps.describeError(error)
            : error instanceof Error
              ? error.message
              : String(error);
        await deps.updateItem({
            itemId: item.id,
            status: "FAILED",
            error: message,
        });
        throw error;
    }
}
