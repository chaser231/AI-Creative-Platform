/**
 * Client-side source import for "Мульти-генерация".
 *
 * Turns the supported input sources — local files, a ZIP archive, a public
 * Yandex.Disk folder link and direct image URLs (one per link, e.g. Yandex
 * avatarnica) — into a uniform list of S3-backed input images
 * (`ImportedSource`) that the batch runner consumes. All uploads land in our
 * bucket so generation requests reference stable HTTPS URLs.
 */

import {
    compressImageFile,
    uploadExternalUrlToS3,
    uploadImageToS3,
} from "@/utils/imageUpload";
import {
    extractImageEntriesFromZip,
    isImageEntryName,
} from "@/utils/zipImport";

export type SourceType = "upload" | "zip" | "yadisk" | "url";

export interface ImportedSource {
    /** Permanent S3 URL of the input image. */
    sourceUrl: string;
    sourceType: SourceType;
    sourceName: string;
}

export interface ImportResult {
    sources: ImportedSource[];
    /** Count of inputs that could not be imported. */
    failed: number;
    /** Human-readable reasons (capped) for surfacing in the UI. */
    errors: string[];
}

const UPLOAD_CONCURRENCY = 5;

/** Run an async mapper over items with a fixed concurrency ceiling. */
async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;

    async function worker() {
        while (cursor < items.length) {
            const current = cursor++;
            results[current] = await mapper(items[current], current);
        }
    }

    const workers = Array.from(
        { length: Math.min(limit, items.length) },
        () => worker(),
    );
    await Promise.all(workers);
    return results;
}

function isImageFile(file: File): boolean {
    return file.type.startsWith("image/") || isImageEntryName(file.name);
}

/** Compress + upload a single image File, returning its S3 URL or null. */
async function uploadImageFile(
    file: File,
    projectId: string,
): Promise<string | null> {
    const dataUrl = await compressImageFile(file);
    return uploadImageToS3(dataUrl, projectId, file.type || "image/png");
}

/** Import dropped/selected local image files. */
export async function importFilesAsSources(
    files: File[],
    projectId: string,
): Promise<ImportResult> {
    const images = files.filter(isImageFile);
    const skipped = files.length - images.length;
    const errors: string[] = [];
    if (skipped > 0) {
        errors.push(`Пропущено не-изображений: ${skipped}`);
    }

    const uploaded = await mapWithConcurrency(
        images,
        UPLOAD_CONCURRENCY,
        async (file): Promise<ImportedSource | null> => {
            try {
                const url = await uploadImageFile(file, projectId);
                if (!url) return null;
                return {
                    sourceUrl: url,
                    sourceType: "upload",
                    sourceName: file.name,
                };
            } catch {
                return null;
            }
        },
    );

    const sources = uploaded.filter((s): s is ImportedSource => s !== null);
    const failed = images.length - sources.length + skipped;
    if (images.length - sources.length > 0) {
        errors.push(
            `Не удалось загрузить: ${images.length - sources.length}`,
        );
    }
    return { sources, failed, errors };
}

/** Import every image inside a ZIP archive. */
export async function importZipAsSources(
    file: File,
    projectId: string,
): Promise<ImportResult> {
    let entries;
    try {
        entries = await extractImageEntriesFromZip(await file.arrayBuffer());
    } catch {
        return {
            sources: [],
            failed: 0,
            errors: ["Не удалось прочитать ZIP-архив"],
        };
    }

    if (entries.length === 0) {
        return {
            sources: [],
            failed: 0,
            errors: ["В архиве нет изображений"],
        };
    }

    const uploaded = await mapWithConcurrency(
        entries,
        UPLOAD_CONCURRENCY,
        async (entry): Promise<ImportedSource | null> => {
            try {
                const blob = new Blob([entry.data as BlobPart], {
                    type: entry.mime,
                });
                const asFile = new File([blob], entry.name, {
                    type: entry.mime,
                });
                const url = await uploadImageFile(asFile, projectId);
                if (!url) return null;
                return {
                    sourceUrl: url,
                    sourceType: "zip",
                    sourceName: entry.name,
                };
            } catch {
                return null;
            }
        },
    );

    const sources = uploaded.filter((s): s is ImportedSource => s !== null);
    const failed = entries.length - sources.length;
    const errors =
        failed > 0 ? [`Не удалось импортировать из архива: ${failed}`] : [];
    return { sources, failed, errors };
}

interface YandexDiskApiResponse {
    sources?: { url: string; name: string }[];
    failed?: number;
    error?: string;
    errors?: string[];
}

/**
 * Import a public Yandex.Disk folder link. The server lists the public folder
 * and re-uploads each image to our S3, returning permanent URLs.
 */
export async function importYandexDiskAsSources(
    publicUrl: string,
    projectId: string,
): Promise<ImportResult> {
    let res: Response;
    try {
        res = await fetch("/api/import/yandex-disk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publicKey: publicUrl.trim(), projectId }),
        });
    } catch {
        return {
            sources: [],
            failed: 0,
            errors: ["Не удалось обратиться к серверу импорта"],
        };
    }

    let data: YandexDiskApiResponse;
    try {
        data = (await res.json()) as YandexDiskApiResponse;
    } catch {
        data = {};
    }

    if (!res.ok) {
        return {
            sources: [],
            failed: 0,
            errors: [data.error || "Ошибка импорта с Яндекс.Диска"],
        };
    }

    const sources: ImportedSource[] = (data.sources ?? []).map((s) => ({
        sourceUrl: s.url,
        sourceType: "yadisk",
        sourceName: s.name,
    }));
    return {
        sources,
        failed: data.failed ?? 0,
        errors: data.errors ?? [],
    };
}

/**
 * Derive a human-readable label for a direct image URL. Yandex avatarnica
 * links often have no file extension (e.g. `.../orig`), so we fall back to the
 * last meaningful path segment and finally to the host.
 */
export function deriveSourceNameFromUrl(rawUrl: string): string {
    try {
        const u = new URL(rawUrl);
        const segments = u.pathname.split("/").filter(Boolean);
        const last = segments[segments.length - 1];
        if (last) return decodeURIComponent(last);
        return u.hostname;
    } catch {
        // Not a parseable URL — return a trimmed, query-less fallback.
        const noQuery = rawUrl.split("?")[0]?.trim() ?? rawUrl;
        const tail = noQuery.split("/").filter(Boolean).pop();
        return tail || rawUrl;
    }
}

/**
 * Import direct image URLs (one per link). Each link is re-uploaded to our S3
 * via the server proxy (`uploadExternalUrlToS3` → `/api/upload` url mode),
 * which runs the `uploadImagePolicy()` SSRF guard. Blank rows are skipped,
 * duplicates and non-HTTPS links are rejected with a reason.
 */
export async function importUrlsAsSources(
    urls: string[],
    projectId: string,
): Promise<ImportResult> {
    const errors: string[] = [];

    const seen = new Set<string>();
    const valid: string[] = [];
    let invalid = 0;
    for (const raw of urls) {
        const url = raw.trim();
        if (!url) continue;
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            invalid += 1;
            continue;
        }
        if (parsed.protocol !== "https:") {
            invalid += 1;
            continue;
        }
        if (seen.has(url)) continue;
        seen.add(url);
        valid.push(url);
    }

    if (invalid > 0) {
        errors.push(`Пропущено некорректных ссылок (нужен https): ${invalid}`);
    }

    const uploaded = await mapWithConcurrency(
        valid,
        UPLOAD_CONCURRENCY,
        async (url): Promise<ImportedSource | null> => {
            try {
                const s3Url = await uploadExternalUrlToS3(url, projectId);
                if (!s3Url) return null;
                return {
                    sourceUrl: s3Url,
                    sourceType: "url",
                    sourceName: deriveSourceNameFromUrl(url),
                };
            } catch {
                return null;
            }
        },
    );

    const sources = uploaded.filter((s): s is ImportedSource => s !== null);
    const failedUploads = valid.length - sources.length;
    if (failedUploads > 0) {
        errors.push(`Не удалось загрузить по ссылке: ${failedUploads}`);
    }
    return { sources, failed: failedUploads + invalid, errors };
}
