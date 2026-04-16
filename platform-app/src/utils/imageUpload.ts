/**
 * Image S3 Upload Utility
 *
 * Provides functions to:
 * 1. Upload a single base64 image to S3 via presigned URL (direct, no server proxy)
 * 2. Upload an external URL (e.g. Replicate temp link) to S3 via server proxy
 * 3. Unified `persistImageToS3` — handles both base64 and URL sources
 * 4. Process all image layers in a canvas state, replacing non-permanent sources with S3 URLs
 * 5. `uploadForAI` — upload base64 before sending to AI endpoints (eliminates huge payloads)
 *
 * TRAFFIC OPTIMIZATION: base64 uploads now go directly to S3 via presigned PUT,
 * bypassing the hosting server. This reduces Origin Transfer by ~95%.
 */

// Our S3 bucket host — images with this prefix are already permanent
const S3_HOST = "storage.yandexcloud.net";

// Cache to avoid re-uploading the same image multiple times
const uploadCache = new Map<string, string>();

/**
 * Convert a base64 data URI or raw base64 string to a Blob.
 */
function base64ToBlob(base64: string, fallbackMime: string = "image/png"): Blob {
  let raw = base64;
  let mime = fallbackMime;

  if (raw.startsWith("data:")) {
    const match = raw.match(/^data:([^;]+);base64,(.*)$/);
    if (match) {
      mime = match[1];
      raw = match[2];
    } else {
      raw = raw.replace(/^data:[^;]+;base64,/, "");
    }
  }

  const bytes = atob(raw);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * Get a presigned PUT URL from the server (lightweight — only returns URL, no data transfer).
 */
async function getPresignedUrl(
  mimeType: string,
  projectId: string,
): Promise<{ uploadUrl: string; publicUrl: string } | null> {
  try {
    const params = new URLSearchParams({ mimeType, projectId });
    const res = await fetch(`/api/upload/presign?${params}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Upload a base64 image directly to S3 via presigned URL.
 * The binary data goes straight to S3, bypassing the hosting server.
 * Returns the public URL, or null on failure.
 */
export async function uploadImageToS3(
  base64: string,
  projectId: string,
  mimeType: string = "image/png"
): Promise<string | null> {
  const cacheKey = base64.slice(0, 64) + base64.length;
  const cached = uploadCache.get(cacheKey);
  if (cached) return cached;

  try {
    const presigned = await getPresignedUrl(mimeType, projectId);
    if (!presigned) return await uploadImageToS3Legacy(base64, projectId, mimeType);

    const blob = base64ToBlob(base64, mimeType);

    const putRes = await fetch(presigned.uploadUrl, {
      method: "PUT",
      body: blob,
      headers: { "Content-Type": mimeType },
    });

    if (!putRes.ok) return await uploadImageToS3Legacy(base64, projectId, mimeType);

    uploadCache.set(cacheKey, presigned.publicUrl);
    return presigned.publicUrl;
  } catch {
    return await uploadImageToS3Legacy(base64, projectId, mimeType);
  }
}

/**
 * Legacy fallback: upload via /api/upload (proxied through hosting server).
 * Used only when presigned upload fails.
 */
async function uploadImageToS3Legacy(
  base64: string,
  projectId: string,
  mimeType: string = "image/png"
): Promise<string | null> {
  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64, mimeType, projectId }),
    });
    if (!res.ok) return null;
    const { url } = await res.json();
    if (url) uploadCache.set(base64.slice(0, 64) + base64.length, url);
    return url || null;
  } catch {
    return null;
  }
}

/**
 * Upload an external URL to S3 via server-side proxy (/api/upload).
 * The server fetches the image and re-uploads to our S3 bucket.
 * Returns the permanent S3 URL, or null on failure.
 */
export async function uploadExternalUrlToS3(
  externalUrl: string,
  projectId: string,
): Promise<string | null> {
  const cacheKey = "url:" + externalUrl;
  const cached = uploadCache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: externalUrl, projectId }),
    });
    if (!res.ok) return null;
    const { url } = await res.json();
    if (url) uploadCache.set(cacheKey, url);
    return url || null;
  } catch {
    return null;
  }
}

/**
 * Upload image data for AI processing: base64 → S3 presigned → public URL.
 * Call BEFORE sending to /api/ai/generate or /api/ai/image-edit.
 * This eliminates multi-MB base64 payloads going through the hosting server.
 *
 * Returns the S3 URL, or the original base64 on failure (backward compatible).
 */
export async function uploadForAI(
  base64: string,
  projectId: string = "ai-tmp",
): Promise<string> {
  if (!base64) return base64;
  if (isPermanentUrl(base64)) return base64;
  if (base64.startsWith("http://") || base64.startsWith("https://")) return base64;

  const mimeType = base64.startsWith("data:")
    ? (base64.match(/^data:([^;]+)/)?.[1] || "image/png")
    : "image/png";

  const url = await uploadImageToS3(base64, projectId, mimeType);
  return url || base64;
}

/**
 * Upload multiple images for AI processing in parallel.
 */
export async function uploadManyForAI(
  images: string[],
  projectId: string = "ai-tmp",
): Promise<string[]> {
  return Promise.all(images.map((img) => uploadForAI(img, projectId)));
}

/**
 * Unified entry point: persist ANY image source to S3.
 * - If already an S3 URL → returns as-is (no-op)
 * - If base64/data URI → uploads via base64 mode
 * - If external URL (Replicate, OpenAI, etc.) → uploads via URL proxy mode
 *
 * Returns the permanent S3 URL or the original src on failure.
 */
export async function persistImageToS3(
  src: string,
  projectId: string,
): Promise<string> {
  if (!src) return src;

  // Already on our S3 — nothing to do
  if (isPermanentUrl(src)) return src;

  // Base64 / data URI
  if (isBase64Image(src)) {
    const mimeType = src.startsWith("data:")
      ? src.match(/^data:([^;]+)/)?.[1] || "image/png"
      : "image/png";
    const url = await uploadImageToS3(src, projectId, mimeType);
    return url || src; // fallback to original if upload fails
  }

  // External URL (Replicate, OpenAI, etc.)
  if (isExternalTempUrl(src)) {
    const url = await uploadExternalUrlToS3(src, projectId);
    return url || src; // fallback to original if upload fails
  }

  return src;
}

/**
 * Check if a string is a base64 data URI or raw base64 image.
 */
function isBase64Image(src: string): boolean {
  if (!src) return false;
  if (src.startsWith("data:image/")) return true;
  // Also match raw base64 that's > 200 chars (URLs are typically shorter)
  if (src.length > 200 && /^[A-Za-z0-9+/=]+$/.test(src.slice(0, 100))) return true;
  return false;
}

/**
 * Check if a URL is already persisted on our S3 bucket (permanent).
 */
function isPermanentUrl(src: string): boolean {
  if (!src) return false;
  if (src.startsWith("data:")) return false; // base64 is not a URL
  return src.includes(S3_HOST);
}

/**
 * Check if a URL is a temporary external URL that needs to be re-uploaded.
 * Detects Replicate delivery URLs, OpenAI blob storage, and any other
 * non-S3 HTTP URLs.
 */
function isExternalTempUrl(src: string): boolean {
  if (!src) return false;
  if (src.startsWith("data:")) return false; // base64, not a URL
  if (isPermanentUrl(src)) return false;     // already on our S3

  // Must be an HTTP(S) URL
  return src.startsWith("http://") || src.startsWith("https://");
}

/**
 * Check if an image source needs to be persisted (is not yet permanent).
 */
export function needsPersistence(src: string): boolean {
  if (!src) return false;
  return isBase64Image(src) || isExternalTempUrl(src);
}

/**
 * Process canvas state layers: upload any non-permanent image sources to S3,
 * replacing them with public URLs. Returns a map of layer ID to new S3 URL.
 *
 * This runs concurrently for all image layers to minimize latency.
 * Non-image layers are ignored.
 *
 * This is the safety-net migration that runs during auto-save.
 */
export async function migrateImagesToS3Map(
  layers: Array<{ id: string; type: string; src?: string; [key: string]: unknown }>,
  projectId: string
): Promise<Record<string, string>> {
  const urlMap: Record<string, string> = {};

  const migrationTasks = layers.map(async (layer) => {
    if (layer.type === "image" && layer.src && needsPersistence(layer.src)) {
      const permanentUrl = await persistImageToS3(layer.src, projectId);
      if (permanentUrl && permanentUrl !== layer.src) {
        urlMap[layer.id] = permanentUrl;
      }
    }
  });

  await Promise.all(migrationTasks);
  return urlMap;
}

// ── Keep the old name as re-export for backwards compatibility ──
export const migrateBase64ToS3Map = migrateImagesToS3Map;

/**
 * Validates and compresses an image file before uploading/storing it in the state.
 * Returns a significantly smaller WebP/JPEG data URL for canvas rendering, preventing 10MB JSON payloads.
 */
export async function compressImageFile(file: File, maxDim: number = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        let { width, height } = img;
        
        // Calculate dynamic scale to ensure dimensions fit inside maxDimxMaxDim box
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        
        if (!ctx) {
          // Fallback if canvas context is unavailable
          return resolve(reader.result as string);
        }

        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        
        // Use webp with 0.82 quality to radically reduce file size for fast JSON saves
        // while preserving alpha channel for PNG uploads.
        resolve(canvas.toDataURL("image/webp", 0.82));
      };
      
      // If image loading fails, output original base64
      img.onerror = () => resolve(reader.result as string);
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
