import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("file-saver", () => ({ saveAs: vi.fn() }));

import { saveAs } from "file-saver";
import {
    buildResultFileName,
    extFromUrl,
    exportBatchResultsZip,
} from "./batchExport";

beforeEach(() => {
    vi.mocked(saveAs).mockClear();
});

describe("extFromUrl", () => {
    it("reads known extensions and normalises jpeg → jpg", () => {
        expect(extFromUrl("https://x/a.png")).toBe("png");
        expect(extFromUrl("https://x/a.jpeg")).toBe("jpg");
        expect(extFromUrl("https://x/a.webp")).toBe("webp");
    });
    it("defaults to jpg for unknown or invalid urls", () => {
        expect(extFromUrl("https://x/a")).toBe("jpg");
        expect(extFromUrl("https://x/a.bin")).toBe("jpg");
        expect(extFromUrl("not a url")).toBe("jpg");
    });
});

describe("buildResultFileName", () => {
    it("uses the sanitised source name with a numeric prefix", () => {
        expect(
            buildResultFileName({
                sourceName: "Product Photo.jpg",
                itemIndex: 0,
                resultIndex: 0,
                resultsForItem: 1,
                url: "https://x/a.png",
            }),
        ).toBe("001-Product-Photo.png");
    });

    it("adds a result suffix when an input produced multiple outputs", () => {
        expect(
            buildResultFileName({
                sourceName: "a.jpg",
                itemIndex: 2,
                resultIndex: 1,
                resultsForItem: 2,
                url: "https://x/a.webp",
            }),
        ).toBe("003-a-2.webp");
    });

    it("falls back to image-N when there is no source name", () => {
        expect(
            buildResultFileName({
                sourceName: null,
                itemIndex: 4,
                resultIndex: 0,
                resultsForItem: 1,
                url: "https://x/a.png",
            }),
        ).toBe("005-image-5.png");
    });
});

describe("exportBatchResultsZip", () => {
    it("zips successful fetches and counts failures", async () => {
        const fetchImpl = vi.fn(async (url: string) => {
            if (url.includes("bad")) {
                return { ok: false, blob: async () => new Blob() };
            }
            return {
                ok: true,
                blob: async () => new Blob([new Uint8Array([1, 2, 3])]),
            };
        });

        const res = await exportBatchResultsZip(
            [
                { sourceName: "a.jpg", index: 0, resultUrls: ["https://x/a.png"] },
                {
                    sourceName: "b.jpg",
                    index: 1,
                    resultUrls: ["https://x/bad.png", "https://x/c.png"],
                },
            ],
            "out.zip",
            { fetchImpl },
        );

        expect(res.added).toBe(2);
        expect(res.failed).toBe(1);
        expect(saveAs).toHaveBeenCalledTimes(1);
    });

    it("does not trigger a download when nothing could be fetched", async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: false,
            blob: async () => new Blob(),
        }));
        const res = await exportBatchResultsZip(
            [{ sourceName: null, index: 0, resultUrls: ["https://x/a.png"] }],
            "out.zip",
            { fetchImpl },
        );
        expect(res.added).toBe(0);
        expect(res.failed).toBe(1);
        expect(saveAs).not.toHaveBeenCalled();
    });
});
