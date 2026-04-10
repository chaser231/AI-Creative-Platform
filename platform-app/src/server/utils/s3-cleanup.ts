/**
 * S3 Cleanup Utilities
 *
 * Shared helpers for deleting objects from Yandex Object Storage (S3-compatible)
 * when projects or templates are removed. This module extracts S3 URLs from
 * various data structures (Asset records, canvasState JSON, template data JSON)
 * and deletes the corresponding objects from the bucket.
 *
 * Used by: project.delete, template.delete, adminTemplate.delete
 */

import {
  S3Client,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

// ─── Shared S3 Client ────────────────────────────────────────────────────────

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

// ─── Key Extraction ──────────────────────────────────────────────────────────

/**
 * Extract S3 key from a full public URL.
 * Example: "https://storage.yandexcloud.net/acp-assets/canvas-images/proj123/img.png"
 *       → "canvas-images/proj123/img.png"
 *
 * Returns null if the URL is not from our S3 bucket.
 */
export function extractS3KeyFromUrl(url: string): string | null {
  if (!url || !url.includes(S3_HOST)) return null;

  try {
    const urlObj = new URL(url);
    // Path format: /{bucket}/{key}
    const path = urlObj.pathname;
    const bucketPrefix = `/${BUCKET}/`;
    if (path.startsWith(bucketPrefix)) {
      return path.slice(bucketPrefix.length);
    }
    return null;
  } catch {
    return null;
  }
}

// ─── S3 Object Deletion ─────────────────────────────────────────────────────

/**
 * Delete multiple S3 objects by key. Non-blocking — logs errors but doesn't throw.
 * Uses Promise.allSettled to ensure all deletions are attempted even if some fail.
 */
export async function deleteS3Objects(keys: string[]): Promise<{ deleted: number; failed: number }> {
  if (keys.length === 0) return { deleted: 0, failed: 0 };

  // Deduplicate
  const uniqueKeys = [...new Set(keys)];

  console.log(`[S3 Cleanup] Deleting ${uniqueKeys.length} object(s)...`);

  const results = await Promise.allSettled(
    uniqueKeys.map(async (key) => {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    })
  );

  const deleted = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  if (failed > 0) {
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason);
    console.error(`[S3 Cleanup] ${failed} deletion(s) failed:`, errors);
  }

  console.log(`[S3 Cleanup] Done: ${deleted} deleted, ${failed} failed`);
  return { deleted, failed };
}

// ─── URL Collection from Data Structures ─────────────────────────────────────

/**
 * Recursively scan a JSON structure and collect all S3 URLs found in string values.
 * Works with any shape of data (canvasState, template data, etc.).
 */
function collectS3UrlsFromJson(data: unknown): string[] {
  const urls: string[] = [];

  if (typeof data === "string") {
    if (data.includes(S3_HOST)) {
      urls.push(data);
    }
  } else if (Array.isArray(data)) {
    for (const item of data) {
      urls.push(...collectS3UrlsFromJson(item));
    }
  } else if (data !== null && typeof data === "object") {
    for (const value of Object.values(data as Record<string, unknown>)) {
      urls.push(...collectS3UrlsFromJson(value));
    }
  }

  return urls;
}

/**
 * Collect all S3 keys from a project's canvas state JSON.
 * Scans all string values recursively to find S3 URLs (image layers, thumbnails, etc.).
 */
export function collectS3KeysFromCanvasState(canvasState: unknown): string[] {
  const urls = collectS3UrlsFromJson(canvasState);
  return urls
    .map(extractS3KeyFromUrl)
    .filter((key): key is string => key !== null);
}

/**
 * Collect all S3 keys from a template's data JSON + thumbnailUrl.
 * Template data contains masterComponents and resizes with image references.
 */
export function collectS3KeysFromTemplate(
  data: unknown,
  thumbnailUrl: string | null | undefined,
): string[] {
  const keys: string[] = [];

  // Thumbnail
  if (thumbnailUrl) {
    const key = extractS3KeyFromUrl(thumbnailUrl);
    if (key) keys.push(key);
  }

  // Scan template data JSON recursively
  const dataKeys = collectS3UrlsFromJson(data)
    .map(extractS3KeyFromUrl)
    .filter((key): key is string => key !== null);

  keys.push(...dataKeys);
  return keys;
}

/**
 * Collect S3 keys from Asset DB records (url field).
 */
export function collectS3KeysFromAssets(
  assets: Array<{ url: string }>,
): string[] {
  return assets
    .map((a) => extractS3KeyFromUrl(a.url))
    .filter((key): key is string => key !== null);
}
