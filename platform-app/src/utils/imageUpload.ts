/**
 * Image S3 Upload Utility
 *
 * Provides functions to:
 * 1. Upload a single base64 image to S3 and get a public URL
 * 2. Process all image layers in a canvas state, replacing base64 with S3 URLs
 *
 * This is used by the auto-save flow to keep canvasState JSON compact.
 */

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
 * Process canvas state layers: upload any base64 image sources to S3,
 * replacing them with public URLs. Returns a map of layer ID to new S3 URL.
 *
 * This runs concurrently for all image layers to minimize latency.
 * Non-image layers are ignored.
 */
export async function migrateBase64ToS3Map(
  layers: Array<{ id: string; type: string; src?: string; [key: string]: unknown }>,
  projectId: string
): Promise<Record<string, string>> {
  const urlMap: Record<string, string> = {};

  const migrationTasks = layers.map(async (layer) => {
    if (layer.type === "image" && layer.src && isBase64Image(layer.src)) {
      const mimeType = layer.src.startsWith("data:")
        ? layer.src.match(/^data:([^;]+)/)?.[1] || "image/png"
        : "image/png";

      const url = await uploadImageToS3(layer.src, projectId, mimeType);
      if (url) {
        urlMap[layer.id] = url;
      }
    }
  });

  await Promise.all(migrationTasks);
  return urlMap;
}

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
