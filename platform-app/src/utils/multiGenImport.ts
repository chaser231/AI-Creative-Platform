/**
 * Client-side source import for "Мульти-генерация".
 *
 * Turns the three supported input sources — local files, a ZIP archive and a
 * public Yandex.Disk folder link — into a uniform list of S3-backed input
 * images (`ImportedSource`) that the batch runner consumes. All uploads land
 * in our bucket so generation requests reference stable HTTPS URLs.
 */

import { compressImageFile, uploadImageToS3 } from "@/utils/imageUpload";
import {
    extractImageEntriesFromZip,
    isImageEntryName,
} from "@/utils/zipImport";

export type SourceType = "upload" | "zip" | "yadisk";

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
