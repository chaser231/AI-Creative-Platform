/**
 * ZIP image extraction for "Мульти-генерация" source import.
 *
 * Pure, environment-agnostic helpers: they take ZIP bytes and return the
 * contained images as raw byte arrays. Uploading the extracted images to S3
 * lives in `multiGenImport.ts` (browser-only) so this module stays unit
 * testable under Node/vitest.
 */

import JSZip from "jszip";

export interface ZipImageEntry {
    /** File name without directory (e.g. "product-01.jpg"). */
    name: string;
    /** Full path inside the archive (e.g. "photos/product-01.jpg"). */
    path: string;
    /** MIME type inferred from the extension. */
    mime: string;
    /** Raw image bytes. */
    data: Uint8Array;
}

const EXTENSION_MIME: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    jfif: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    avif: "image/avif",
    heic: "image/heic",
    heif: "image/heif",
    tif: "image/tiff",
    tiff: "image/tiff",
};

export const SUPPORTED_IMAGE_EXTENSIONS = Object.keys(EXTENSION_MIME);

function extensionOf(name: string): string {
    const dot = name.lastIndexOf(".");
    if (dot < 0) return "";
    return name.slice(dot + 1).toLowerCase();
}

/** True when the file name has a recognised raster image extension. */
export function isImageEntryName(name: string): boolean {
    return extensionOf(name) in EXTENSION_MIME;
}

/** MIME type for a file name, defaulting to application/octet-stream. */
export function mimeForName(name: string): string {
    return EXTENSION_MIME[extensionOf(name)] ?? "application/octet-stream";
}

function basename(path: string): string {
    const parts = path.split("/");
    return parts[parts.length - 1] || path;
}

/**
 * macOS zips embed an "__MACOSX/" tree of "._name" AppleDouble resource forks
 * that look like images by extension but are not. Skip those and dotfiles.
 */
function isJunkEntry(path: string): boolean {
    if (path.startsWith("__MACOSX/") || path.includes("/__MACOSX/")) return true;
    const base = basename(path);
    return base.startsWith(".");
}

/**
 * Extract every image file from a ZIP archive, ordered by path for a stable
 * batch sequence. Non-image entries, directories and macOS junk are skipped.
 */
export async function extractImageEntriesFromZip(
    input: ArrayBuffer | Uint8Array | Blob,
): Promise<ZipImageEntry[]> {
    const zip = await JSZip.loadAsync(input);

    const paths = Object.keys(zip.files)
        .filter((path) => {
            const entry = zip.files[path];
            if (!entry || entry.dir) return false;
            if (isJunkEntry(path)) return false;
            return isImageEntryName(path);
        })
        .sort((a, b) => a.localeCompare(b));

    const entries: ZipImageEntry[] = [];
    for (const path of paths) {
        const data = await zip.files[path].async("uint8array");
        if (data.byteLength === 0) continue;
        entries.push({
            name: basename(path),
            path,
            mime: mimeForName(path),
            data,
        });
    }
    return entries;
}
