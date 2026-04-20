/**
 * Figma asset pipeline — Phase 1.
 *
 *  1. Collect `imageRef`s from the mapper output.
 *  2. Resolve them to signed Figma CDN URLs via `/v1/files/:key/images`.
 *  3. For vector/raster nodes (VECTOR/BOOLEAN_OPERATION/…), render via
 *     `/v1/images/:key?ids=…&format=svg|png&scale=2`.
 *  4. Download → re-upload to our Yandex Object Storage bucket so the resulting
 *     URL is stable and CORS-friendly (Figma URLs expire after a few hours).
 *  5. Persist an `Asset` row per uploaded file so it appears in the project's
 *     Asset Library and participates in S3-cleanup on project deletion.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { FigmaClient } from "./client";
import type { MapperFrame } from "./mapper";

const S3_ENDPOINT = process.env.S3_ENDPOINT || "https://storage.yandexcloud.net";
const S3_BUCKET = process.env.S3_BUCKET || "acp-assets";

/**
 * Whitelist of MIME types we allow to pass through the Figma asset pipeline.
 * Anything else — even if the response claims `image/...` — is rejected. This
 * prevents a compromised/misconfigured Figma CDN response (or a malicious
 * imageRef) from publishing HTML or arbitrary binaries under our S3 bucket.
 */
const ALLOWED_MIME_TYPES = new Set<string>([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
    "image/svg+xml",
]);

/** Maximum per-asset size (bytes) — safeguards against RAM exhaustion. */
const MAX_ASSET_BYTES = 50 * 1024 * 1024;

const s3 = new S3Client({
    region: "ru-central1",
    endpoint: S3_ENDPOINT,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    },
});

// ─── Public API ─────────────────────────────────────────────────────────────

export interface DownloadReport {
    imagesDownloaded: number;
    imagesFailed: number;
    /** Per-layer {layerId → S3 URL}. Callers patch the mapper output with these. */
    layerUrls: Record<string, string>;
}

export interface DownloadParams {
    client: FigmaClient;
    prisma: PrismaClient;
    fileKey: string;
    frames: MapperFrame[];
    workspaceId: string;
    projectId: string;
    uploadedById: string;
    signal?: AbortSignal;
}

/**
 * Orchestrates imageRef hydration + node rendering + S3 upload for a list of
 * mapper frames. Mutates the caller's layer array via the returned `layerUrls`
 * map (to keep this function framework-agnostic).
 */
export async function downloadAssetsForFrames(
    params: DownloadParams,
): Promise<DownloadReport> {
    const { client, prisma, fileKey, frames, workspaceId, projectId, uploadedById, signal } = params;
    const report: DownloadReport = {
        imagesDownloaded: 0,
        imagesFailed: 0,
        layerUrls: {},
    };

    // ── 1. Collect unique imageRefs across every frame ──────────────────────
    const imageRefToLayers = new Map<string, string[]>();
    for (const frame of frames) {
        for (const ref of frame.imageRefs) {
            const list = imageRefToLayers.get(ref.imageRef) ?? [];
            list.push(ref.targetLayerId);
            imageRefToLayers.set(ref.imageRef, list);
        }
    }

    if (imageRefToLayers.size > 0) {
        let refToUrl: Record<string, string> = {};
        try {
            const fills = await client.getImageFills(fileKey, { signal });
            refToUrl = fills.meta.images;
            } catch (err) {
                console.error("[figma/assets] getImageFills failed:", err);
            }

        for (const [imageRef, layerIds] of imageRefToLayers) {
            const url = refToUrl[imageRef];
            if (!url) {
                report.imagesFailed++;
                continue;
            }
            try {
                const s3Url = await downloadAndUpload({
                    prisma,
                    sourceUrl: url,
                    keyPrefix: `figma-imports/${projectId}/fills`,
                    filename: `${imageRef}`,
                    workspaceId,
                    projectId,
                    uploadedById,
                    metadata: { figmaImageRef: imageRef, figmaFileKey: fileKey },
                    signal,
                });
                report.imagesDownloaded++;
                for (const layerId of layerIds) {
                    report.layerUrls[layerId] = s3Url;
                }
            } catch (err) {
                console.error(`[figma/assets] imageRef ${imageRef} upload failed:`, err);
                report.imagesFailed++;
            }
        }
    }

    // ── 2. Render vector / raster nodes via /v1/images ──────────────────────
    // Group by format so we get the best coverage per round-trip.
    const renderGroups = new Map<string, Array<{ nodeId: string; targetLayerId: string }>>();
    for (const frame of frames) {
        for (const req of frame.nodesToRender) {
            const list = renderGroups.get(req.format) ?? [];
            list.push({ nodeId: req.nodeId, targetLayerId: req.targetLayerId });
            renderGroups.set(req.format, list);
        }
    }

    for (const [format, items] of renderGroups) {
        if (items.length === 0) continue;

        const ids = items.map((i) => i.nodeId);
        let rendered: Record<string, string | null> = {};
        try {
            const res = await client.getImages(
                fileKey,
                ids,
                { format: format as "svg" | "png", scale: format === "svg" ? 1 : 2 },
                { signal },
            );
            rendered = res.images;
        } catch (err) {
            console.error("[figma/assets] getImages failed:", err);
            report.imagesFailed += items.length;
            continue;
        }

        for (const item of items) {
            const url = rendered[item.nodeId];
            if (!url) {
                report.imagesFailed++;
                continue;
            }
            try {
                const s3Url = await downloadAndUpload({
                    prisma,
                    sourceUrl: url,
                    keyPrefix: `figma-imports/${projectId}/renders`,
                    filename: `${item.nodeId.replace(/:/g, "_")}.${format}`,
                    workspaceId,
                    projectId,
                    uploadedById,
                    metadata: { figmaNodeId: item.nodeId, figmaFileKey: fileKey },
                    signal,
                });
                report.imagesDownloaded++;
                report.layerUrls[item.targetLayerId] = s3Url;
            } catch (err) {
                console.error(`[figma/assets] render ${item.nodeId} upload failed:`, err);
                report.imagesFailed++;
            }
        }
    }

    return report;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

async function downloadAndUpload(args: {
    prisma: PrismaClient;
    sourceUrl: string;
    keyPrefix: string;
    filename: string;
    workspaceId: string;
    projectId: string;
    uploadedById: string;
    metadata: Record<string, string>;
    signal?: AbortSignal;
}): Promise<string> {
    const resp = await fetch(args.sourceUrl, { signal: args.signal });
    if (!resp.ok) {
        throw new Error(`Source fetch failed (${resp.status})`);
    }

    // Normalise the MIME so `image/jpeg; charset=binary` still matches the
    // whitelist, then reject anything unexpected outright.
    const rawContentType = resp.headers.get("content-type") || guessMimeFromName(args.filename);
    const contentType = rawContentType.split(";")[0]!.trim().toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
        throw new Error(
            `Refusing unsupported content-type "${rawContentType}" for Figma asset ${args.filename}`,
        );
    }

    // Reject oversize bodies using the advertised Content-Length if present,
    // and again after buffering. The post-buffer check is the authoritative
    // one — Content-Length can be missing or lie — but checking up-front
    // avoids allocating a huge ArrayBuffer for no reason.
    const advertisedLength = Number(resp.headers.get("content-length"));
    if (Number.isFinite(advertisedLength) && advertisedLength > MAX_ASSET_BYTES) {
        throw new Error(
            `Asset ${args.filename} exceeds ${MAX_ASSET_BYTES} bytes (${advertisedLength})`,
        );
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.length === 0) {
        throw new Error("Source returned empty body");
    }
    if (buffer.length > MAX_ASSET_BYTES) {
        throw new Error(
            `Asset ${args.filename} exceeds ${MAX_ASSET_BYTES} bytes (${buffer.length})`,
        );
    }

    const ext = extFromName(args.filename) || extFromContentType(contentType) || "bin";
    const safeBase = args.filename.replace(/\.[^.]+$/, "") || randomUUID();
    const key = `${args.keyPrefix}/${Date.now()}-${randomUUID()}-${sanitize(safeBase)}.${ext}`;

    await s3.send(
        new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: buffer,
            ContentType: contentType,
        }),
    );

    const publicUrl = `${S3_ENDPOINT}/${S3_BUCKET}/${key}`;

    const data: Prisma.AssetUncheckedCreateInput = {
        type: "IMAGE",
        filename: `${safeBase}.${ext}`,
        url: publicUrl,
        mimeType: contentType,
        sizeBytes: buffer.length,
        metadata: args.metadata,
        workspaceId: args.workspaceId,
        uploadedById: args.uploadedById,
        projectId: args.projectId,
    };
    try {
        await args.prisma.asset.create({ data });
    } catch (err) {
        // Non-fatal: the URL is still usable, the asset just won't show in the library.
        console.error("[figma/assets] Asset row creation failed:", err);
    }

    return publicUrl;
}

function sanitize(name: string): string {
    return name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64);
}

function extFromName(name: string): string | null {
    const m = /\.([A-Za-z0-9]+)$/.exec(name);
    return m ? m[1].toLowerCase() : null;
}

function extFromContentType(ct: string): string | null {
    if (ct.includes("svg")) return "svg";
    if (ct.includes("png")) return "png";
    if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
    if (ct.includes("gif")) return "gif";
    if (ct.includes("webp")) return "webp";
    return null;
}

function guessMimeFromName(name: string): string {
    const ext = extFromName(name);
    switch (ext) {
        case "svg":
            return "image/svg+xml";
        case "png":
            return "image/png";
        case "jpg":
        case "jpeg":
            return "image/jpeg";
        case "webp":
            return "image/webp";
        default:
            return "application/octet-stream";
    }
}
