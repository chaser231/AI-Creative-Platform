/**
 * Workflow server-side helpers.
 *
 * All HTTP fetches of external URLs MUST go through safeFetch
 * (see REQ-23 — SSRF guard). Direct `fetch(url)` for user-supplied URLs
 * is a P0 security violation.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { safeFetch, uploadImagePolicy } from "@/server/security/ssrfGuard";
import type { ActionContext } from "@/server/actionRegistry";

// ─── S3 client (lazy construction to survive test mocks) ────────────────────

function getS3Client(): S3Client {
    return new S3Client({
        region: "ru-central1",
        endpoint: process.env.S3_ENDPOINT || "https://storage.yandexcloud.net",
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
        },
    });
}

const DEFAULT_S3_ENDPOINT = "https://storage.yandexcloud.net";

function getBucket(): string {
    return process.env.S3_BUCKET || "acp-assets";
}

function getS3Endpoint(): string {
    return process.env.S3_ENDPOINT || DEFAULT_S3_ENDPOINT;
}

// ─── tryWithFallback ────────────────────────────────────────────────────────

export interface ProviderAttempt<T> {
    name: string;
    run: () => Promise<T>;
}

export interface FallbackResult<T> {
    result: T;
    winner: string;
    /** Names of providers that threw before the winner succeeded. */
    attempted: string[];
}

/**
 * Try providers in order. First successful result wins. All-fail throws
 * an aggregated Error with individual messages so callers can surface the
 * cascade in logs and error responses.
 */
export async function tryWithFallback<T>(
    providers: Array<ProviderAttempt<T>>,
): Promise<FallbackResult<T>> {
    if (providers.length === 0) {
        throw new Error("tryWithFallback: no providers supplied");
    }
    const errors: Array<{ name: string; message: string }> = [];
    for (const p of providers) {
        try {
            const result = await p.run();
            return { result, winner: p.name, attempted: errors.map(e => e.name) };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[workflow] provider ${p.name} failed: ${msg}`);
            errors.push({ name: p.name, message: msg });
        }
    }
    throw new Error(
        `All providers failed: ${errors.map(e => `${e.name}(${e.message})`).join(" → ")}`,
    );
}

// ─── uploadFromExternalUrl ──────────────────────────────────────────────────

export interface UploadResult {
    s3Url: string;
    s3Key: string;
    contentType: string;
    sizeBytes: number;
}

/**
 * Re-upload an external URL (e.g. Replicate temporary link) to our S3 bucket.
 * SSRF-guarded via safeFetch + uploadImagePolicy (pinned DNS, MIME + size caps).
 *
 * Key prefix: workflow-runs/{workspaceId}/{uuid}.{ext}
 */
export async function uploadFromExternalUrl(
    url: string,
    opts: { workspaceId: string },
): Promise<UploadResult> {
    const response = await safeFetch(
        url,
        { signal: AbortSignal.timeout(30_000) },
        uploadImagePolicy(),
    );
    if (!response.ok) {
        throw new Error(`External URL fetch failed: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/png";
    if (!contentType.startsWith("image/")) {
        throw new Error(`Non-image content-type from provider: ${contentType}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
        throw new Error("Provider returned empty body");
    }

    const ext = (contentType.split("/")[1] || "png").split(";")[0].trim();
    const key = `workflow-runs/${opts.workspaceId}/${randomUUID()}.${ext}`;

    await getS3Client().send(
        new PutObjectCommand({
            Bucket: getBucket(),
            Key: key,
            Body: buffer,
            ContentType: contentType,
        }),
    );

    return {
        s3Url: `${getS3Endpoint()}/${getBucket()}/${key}`,
        s3Key: key,
        contentType,
        sizeBytes: buffer.length,
    };
}

// ─── buildReflectionPrompt ──────────────────────────────────────────────────

export type ReflectionStyle = "subtle" | "hard" | "soft-glow";

/**
 * Build a prompt for AI reflection generation.
 *
 * intensity is clamped to [0.1, 1.0] to avoid invisible reflections at 0
 * and over-saturated results at >1. Consumers should default to 0.3.
 */
export function buildReflectionPrompt(
    style: ReflectionStyle = "subtle",
    intensity: number = 0.3,
): string {
    const clampedIntensity = Math.max(0.1, Math.min(1, intensity));
    return (
        `Generate a realistic reflection of the product below it. ` +
        `Style: ${style}. Opacity: ${clampedIntensity.toFixed(2)}. ` +
        `Preserve transparent background. Smooth gradient fade to fully transparent at the bottom. ` +
        `Photorealistic, high fidelity, commercial product photography aesthetic.`
    );
}

// ─── postProcessToTransparent ───────────────────────────────────────────────

/**
 * Re-entry to the remove_background action to guarantee an RGBA output.
 *
 * Needed after providers that return opaque images (e.g. FLUX Kontext Pro):
 * we compose a reflection but the alpha channel is lost, so we run a second
 * bg-removal pass to restore transparency.
 *
 * Uses a late-binding dynamic import to avoid a circular dependency
 * between workflow/helpers.ts and agent/executeAction.ts.
 */
export async function postProcessToTransparent(
    rgbaOrOpaqueUrl: string,
    ctx: ActionContext,
): Promise<string> {
    const { executeAction } = await import("@/server/agent/executeAction");
    const result = await executeAction(
        "remove_background",
        { imageUrl: rgbaOrOpaqueUrl },
        ctx,
    );
    if (!result.success || result.type !== "image") {
        throw new Error(`Post-process bg-removal failed: ${result.content}`);
    }
    const metaUrl = (result.metadata as { imageUrl?: string } | undefined)?.imageUrl;
    return metaUrl ?? result.content;
}
