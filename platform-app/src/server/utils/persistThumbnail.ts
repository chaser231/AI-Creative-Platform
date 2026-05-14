/**
 * persistThumbnailToS3 — server-side guarantee that any thumbnail URL we
 * store in the database is a permanent, hostable asset.
 *
 * Why this exists:
 *   AI-generated thumbnails come back from Replicate / fal.ai / OpenAI as
 *   ephemeral CDN URLs that expire 1–48h after generation. Client-side
 *   persistence (`persistImageToS3` in `utils/imageUpload.ts`) silently
 *   falls back to the original URL when the proxy upload fails (SSRF
 *   timeout, CORS, transient network) — so the temp URL ends up in the
 *   `AIPreset.thumbnailUrl` column and breaks a day later.
 *
 *   This module re-runs the same persistence on the server, *atomically*
 *   with the DB write, and refuses to save anything that is neither a
 *   local app asset (`/style-presets/...`) nor an S3-hosted URL. Failure
 *   surfaces as a TRPCError so the frontend can show a real error instead
 *   of "saving" a thumbnail that will rot.
 *
 *   By design the helper is idempotent: re-uploading an already-permanent
 *   URL returns it unchanged.
 */

import { TRPCError } from "@trpc/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { safeFetch, uploadImagePolicy, SsrfBlockedError } from "@/server/security/ssrfGuard";

const s3 = new S3Client({
    region: "ru-central1",
    endpoint: process.env.S3_ENDPOINT || "https://storage.yandexcloud.net",
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    },
});

const BUCKET = process.env.S3_BUCKET || "acp-assets";
const S3_HOST = "storage.yandexcloud.net";

/** True if `url` is already hosted on our S3 bucket (idempotent case). */
export function isS3Hosted(url: string): boolean {
    if (!url) return false;
    if (url.startsWith("data:")) return false;
    return url.includes(S3_HOST);
}

/** True if `url` is a local app asset (e.g. `/style-presets/product.jpg`). */
function isLocalAppAsset(url: string): boolean {
    if (!url) return false;
    return url.startsWith("/") && !url.startsWith("//");
}

/** True if `url` is an HTTP(S) URL that must be re-uploaded to S3. */
function isExternalHttpUrl(url: string): boolean {
    return url.startsWith("http://") || url.startsWith("https://");
}

/** True if `url` is a base64 data URI we should persist server-side. */
function isBase64DataUri(url: string): boolean {
    return url.startsWith("data:image/");
}

/**
 * Persist a thumbnail URL to our S3 bucket and return the public URL.
 *
 * @param rawUrl   The URL or base64 data the caller wants to save.
 * @param ownerKey A scoping segment for the S3 key — usually the workspace
 *                 id, system preset id, or "styles" for shared assets. Only
 *                 used to organize objects in the bucket; not part of the
 *                 public URL semantics.
 *
 * Returns:
 *   - the same string for empty / S3-hosted / local app assets,
 *   - a fresh `storage.yandexcloud.net/...` URL for external URLs and
 *     base64 inputs.
 *
 * Throws TRPCError with code BAD_REQUEST if persistence is required but
 * fails — callers should let this bubble up to the client unchanged so the
 * user sees a real error instead of silently saving a temp URL.
 */
export async function persistThumbnailToS3(
    rawUrl: string | null | undefined,
    ownerKey: string,
): Promise<string | null> {
    if (!rawUrl) return null;
    const url = rawUrl.trim();
    if (!url) return null;

    if (isS3Hosted(url)) return url;
    if (isLocalAppAsset(url)) return url;

    if (isBase64DataUri(url)) {
        return await uploadBase64ToS3(url, ownerKey);
    }

    if (isExternalHttpUrl(url)) {
        return await downloadAndUploadToS3(url, ownerKey);
    }

    // Anything else (raw text, weird schemes) is rejected — we don't want
    // to silently accept a non-image string into a column the UI renders
    // as <img src>.
    throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Thumbnail URL отклонён: неподдерживаемый формат "${url.slice(0, 80)}"`,
    });
}

/** Fetch an external URL via SSRF-guarded safeFetch and store the bytes in S3. */
async function downloadAndUploadToS3(externalUrl: string, ownerKey: string): Promise<string> {
    let response: Response;
    try {
        response = await safeFetch(
            externalUrl,
            { signal: AbortSignal.timeout(30_000) },
            uploadImagePolicy(),
        );
    } catch (err) {
        if (err instanceof SsrfBlockedError) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Не удалось сохранить миниатюру: ${err.reason}`,
            });
        }
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Сетевая ошибка при загрузке миниатюры: ${err instanceof Error ? err.message : String(err)}`,
        });
    }

    if (!response.ok) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Upstream вернул HTTP ${response.status} при загрузке миниатюры`,
        });
    }

    const contentType = (response.headers.get("content-type") || "image/png").split(";")[0].trim();
    if (!contentType.startsWith("image/")) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Источник вернул не-изображение (${contentType}). Возможно, ссылка уже истекла.`,
        });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Источник вернул пустое тело — ссылка, вероятно, протухла",
        });
    }

    return await putToS3(buffer, contentType, ownerKey);
}

/** Decode a base64 data URI and store the bytes in S3. */
async function uploadBase64ToS3(dataUri: string, ownerKey: string): Promise<string> {
    const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Невалидный base64 data URI для миниатюры",
        });
    }
    const contentType = match[1];
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length === 0) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Пустой base64 для миниатюры",
        });
    }
    return await putToS3(buffer, contentType, ownerKey);
}

/** Common S3 put + URL synthesis. */
async function putToS3(buffer: Buffer, contentType: string, ownerKey: string): Promise<string> {
    const ext = contentType.split("/")[1]?.split("+")[0] || "png";
    const safeOwner = ownerKey.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64) || "styles";
    const key = `canvas-images/style-thumbnails/${safeOwner}/${randomUUID()}.${ext}`;

    try {
        await s3.send(
            new PutObjectCommand({
                Bucket: BUCKET,
                Key: key,
                Body: buffer,
                ContentType: contentType,
            }),
        );
    } catch (err) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Не удалось сохранить миниатюру в хранилище: ${err instanceof Error ? err.message : String(err)}`,
        });
    }

    return `${process.env.S3_ENDPOINT || `https://${S3_HOST}`}/${BUCKET}/${key}`;
}
