/**
 * Pure Yandex.Disk public-listing traversal for "Мульти-генерация".
 *
 * The network call is injected (`YadiskFetchJson`) so this walker — pagination,
 * recursion into subfolders, image filtering and the single-file-link case —
 * is unit testable without hitting the real API. The route handler supplies a
 * `fetchJson` that talks to cloud-api.yandex.net and downloads/uploads the
 * resolved files.
 */

import { isImageEntryName } from "@/utils/zipImport";

export const YANDEX_API =
    "https://cloud-api.yandex.net/v1/disk/public/resources";
export const YADISK_PAGE_LIMIT = 200;
export const YADISK_MAX_DIR_DEPTH = 4;

const LISTING_FIELDS =
    "type,name,path,mime_type,media_type,file," +
    "_embedded.items.type,_embedded.items.name,_embedded.items.path," +
    "_embedded.items.mime_type,_embedded.items.media_type,_embedded.items.file," +
    "_embedded.total,_embedded.limit,_embedded.offset";

export interface YandexResourceItem {
    type: "dir" | "file";
    name: string;
    path: string;
    mime_type?: string;
    media_type?: string;
    file?: string;
}

export interface YandexListResponse {
    type?: "dir" | "file";
    name?: string;
    path?: string;
    mime_type?: string;
    media_type?: string;
    file?: string;
    _embedded?: {
        items: YandexResourceItem[];
        total: number;
        limit: number;
        offset: number;
    };
}

export interface CollectedFile {
    name: string;
    path: string;
    file?: string;
}

export interface YadiskFetchResult {
    ok: boolean;
    status: number;
    data: YandexListResponse;
}

export type YadiskFetchJson = (url: string) => Promise<YadiskFetchResult>;

export class YandexImportError extends Error {
    public readonly status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = "YandexImportError";
        this.status = status;
    }
}

/** True for Yandex resources that are raster images. */
export function isImageResource(item: {
    name: string;
    mime_type?: string;
    media_type?: string;
}): boolean {
    if (item.media_type === "image") return true;
    if (item.mime_type?.startsWith("image/")) return true;
    return isImageEntryName(item.name);
}

/** Build the public-resources listing URL for a page of a (sub)folder. */
export function buildListUrl(
    publicKey: string,
    path: string | undefined,
    offset: number,
    limit: number = YADISK_PAGE_LIMIT,
): string {
    const params = new URLSearchParams({
        public_key: publicKey,
        limit: String(limit),
        offset: String(offset),
        fields: LISTING_FIELDS,
    });
    if (path) params.set("path", path);
    return `${YANDEX_API}?${params.toString()}`;
}

/** Build the download-link URL for a single file within a public resource. */
export function buildDownloadUrl(
    publicKey: string,
    path: string | undefined,
): string {
    const params = new URLSearchParams({ public_key: publicKey });
    if (path) params.set("path", path);
    return `${YANDEX_API}/download?${params.toString()}`;
}

/**
 * Walk a public Yandex.Disk resource collecting image files (recursing into
 * subfolders up to YADISK_MAX_DIR_DEPTH) until `maxItems` are gathered.
 * Throws YandexImportError when the top-level resource cannot be read.
 */
export async function collectImageFiles(
    fetchJson: YadiskFetchJson,
    publicKey: string,
    maxItems: number,
): Promise<CollectedFile[]> {
    const out: CollectedFile[] = [];

    const walk = async (
        path: string | undefined,
        depth: number,
    ): Promise<void> => {
        if (out.length >= maxItems) return;

        let offset = 0;
        while (out.length < maxItems) {
            const res = await fetchJson(buildListUrl(publicKey, path, offset));
            if (!res.ok) {
                if (offset === 0 && depth === 0) {
                    throw new YandexImportError(
                        res.status === 404
                            ? "Публичная ссылка не найдена"
                            : `Яндекс.Диск вернул HTTP ${res.status}`,
                        res.status || 502,
                    );
                }
                return;
            }

            const data = res.data;

            // A link straight to a single file.
            if (data.type === "file" && data.name) {
                const name = data.name;
                if (
                    isImageResource({
                        name,
                        mime_type: data.mime_type,
                        media_type: data.media_type,
                    })
                ) {
                    out.push({ name, path: data.path ?? "", file: data.file });
                }
                return;
            }

            const items = data._embedded?.items ?? [];
            if (items.length === 0) return;

            const subDirs: string[] = [];
            for (const item of items) {
                if (out.length >= maxItems) break;
                if (item.type === "file") {
                    if (isImageResource(item)) {
                        out.push({
                            name: item.name,
                            path: item.path,
                            file: item.file,
                        });
                    }
                } else if (item.type === "dir" && depth < YADISK_MAX_DIR_DEPTH) {
                    subDirs.push(item.path);
                }
            }

            const total = data._embedded?.total ?? items.length;
            offset += YADISK_PAGE_LIMIT;

            for (const dir of subDirs) {
                if (out.length >= maxItems) break;
                await walk(dir, depth + 1);
            }

            if (offset >= total) return;
        }
    };

    await walk(undefined, 0);
    return out;
}
