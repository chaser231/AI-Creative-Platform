/**
 * Image S3 Upload Utility
 *
 * Provides functions to:
 * 1. Upload a single base64 image to S3 and get a public URL
 * 2. Upload an external URL (e.g. Replicate temp link) to S3 via server proxy
 * 3. Unified `persistImageToS3` — handles both base64 and URL sources
 * 4. Process all image layers in a canvas state, replacing non-permanent sources with S3 URLs
 *
 * This is used by:
 * - The "upload on add" flow to persist AI-generated images immediately
 * - The auto-save flow as a safety net to catch any images that weren't persisted inline
 */

// Our S3 bucket host — images with this prefix are already permanent
const S3_HOST = "storage.yandexcloud.net";

// Cache to avoid re-uploading the same image multiple times
const uploadCache = new Map<string, string>();

/**
 * Upload a base64 image to S3 via /api/upload.
 * Returns the public URL, or null on failure.
 */
export async function uploadImageToS3(
  base64: string,
  projectId: string,
  mimeType: string = "image/png"
): Promise<string | null> {
  // Check cache first (use first 64 chars as key to avoid huge map keys)
  const cacheKey = base64.slice(0, 64) + base64.length;
  const cached = uploadCache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64, mimeType, projectId }),
    });

    if (!res.ok) return null;

    const { url } = await res.json();
    if (url) {
      uploadCache.set(cacheKey, url);
    }
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
  // Check cache
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
    if (url) {
      uploadCache.set(cacheKey, url);
    }
    return url || null;
  } catch {
    return null;
  }
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
