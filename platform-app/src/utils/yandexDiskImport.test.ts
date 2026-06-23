import { describe, it, expect, vi } from "vitest";
import {
    collectImageFiles,
    isImageResource,
    buildListUrl,
    buildDownloadUrl,
    YandexImportError,
    type YadiskFetchResult,
} from "./yandexDiskImport";

function ok(data: unknown): YadiskFetchResult {
    return { ok: true, status: 200, data: data as YadiskFetchResult["data"] };
}

describe("isImageResource", () => {
    it("detects images via media_type, mime_type or extension", () => {
        expect(isImageResource({ name: "x", media_type: "image" })).toBe(true);
        expect(isImageResource({ name: "x", mime_type: "image/png" })).toBe(true);
        expect(isImageResource({ name: "x.jpg" })).toBe(true);
        expect(isImageResource({ name: "x.txt" })).toBe(false);
    });
});

describe("url builders", () => {
    it("encodes the public_key and path", () => {
        const url = buildListUrl("https://disk.yandex.ru/d/abc", "/sub", 0);
        expect(url).toContain(
            "public_key=https%3A%2F%2Fdisk.yandex.ru%2Fd%2Fabc",
        );
        expect(url).toContain("path=%2Fsub");
        expect(url).toContain("offset=0");
        expect(buildDownloadUrl("k", "/a.jpg")).toContain("/download?");
    });
});

describe("collectImageFiles", () => {
    it("collects images, skips non-images and recurses into subfolders", async () => {
        const fetchJson = vi.fn(
            async (url: string): Promise<YadiskFetchResult> => {
                if (url.includes("path=%2Fsub")) {
                    return ok({
                        type: "dir",
                        _embedded: {
                            items: [
                                {
                                    type: "file",
                                    name: "c.png",
                                    path: "/sub/c.png",
                                    file: "http://dl/c",
                                },
                            ],
                            total: 1,
                            limit: 200,
                            offset: 0,
                        },
                    });
                }
                return ok({
                    type: "dir",
                    _embedded: {
                        items: [
                            { type: "file", name: "a.jpg", path: "/a.jpg", file: "http://dl/a" },
                            { type: "file", name: "readme.txt", path: "/readme.txt" },
                            { type: "dir", name: "sub", path: "/sub" },
                        ],
                        total: 3,
                        limit: 200,
                        offset: 0,
                    },
                });
            },
        );

        const files = await collectImageFiles(fetchJson, "k", 200);
        expect(files.map((f) => f.name).sort()).toEqual(["a.jpg", "c.png"]);
    });

    it("handles a public link that points straight at a single file", async () => {
        const fetchJson = vi.fn(
            async (): Promise<YadiskFetchResult> =>
                ok({ type: "file", name: "only.jpg", path: "", file: "http://dl/only" }),
        );
        const files = await collectImageFiles(fetchJson, "k", 200);
        expect(files).toEqual([
            { name: "only.jpg", path: "", file: "http://dl/only" },
        ]);
    });

    it("stops at maxItems", async () => {
        const fetchJson = vi.fn(
            async (): Promise<YadiskFetchResult> =>
                ok({
                    type: "dir",
                    _embedded: {
                        items: [
                            { type: "file", name: "a.jpg", path: "/a.jpg", file: "x" },
                            { type: "file", name: "b.jpg", path: "/b.jpg", file: "x" },
                            { type: "file", name: "c.jpg", path: "/c.jpg", file: "x" },
                        ],
                        total: 3,
                        limit: 200,
                        offset: 0,
                    },
                }),
        );
        const files = await collectImageFiles(fetchJson, "k", 2);
        expect(files).toHaveLength(2);
    });

    it("throws YandexImportError when the top-level resource is unreadable", async () => {
        const fetchJson = vi.fn(
            async (): Promise<YadiskFetchResult> => ({
                ok: false,
                status: 404,
                data: {},
            }),
        );
        await expect(collectImageFiles(fetchJson, "k", 200)).rejects.toBeInstanceOf(
            YandexImportError,
        );
    });
});
