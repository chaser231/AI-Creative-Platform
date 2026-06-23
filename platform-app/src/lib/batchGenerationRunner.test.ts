import { describe, it, expect, vi } from "vitest";
import {
    buildGenerateRequest,
    extractResultUrls,
    processBatchItem,
    type BatchGenerationConfig,
    type ProcessItemDeps,
} from "./batchGenerationRunner";

const baseConfig: BatchGenerationConfig = {
    projectId: "p1",
    mode: "img2img",
    model: "m1",
    prompt: "hello",
    countPerItem: 1,
};

describe("buildGenerateRequest", () => {
    it("img2img targets image-edit with the source as the base image", () => {
        const req = buildGenerateRequest(baseConfig, "https://s3/x.jpg");
        expect(req.endpoint).toBe("/api/ai/image-edit");
        expect(req.body).toMatchObject({
            action: "text-edit",
            imageBase64: "https://s3/x.jpg",
            model: "m1",
            prompt: "hello",
            recordMessage: false,
        });
    });

    it("t2i targets generate with the source as a reference image", () => {
        const req = buildGenerateRequest(
            { ...baseConfig, mode: "t2i", aspectRatio: "1:1", scale: "1024", countPerItem: 2 },
            "https://s3/x.jpg",
        );
        expect(req.endpoint).toBe("/api/ai/generate");
        expect(req.body).toMatchObject({
            type: "image",
            referenceImages: ["https://s3/x.jpg"],
            count: 2,
            aspectRatio: "1:1",
        });
    });

    it("forwards lora fields verbatim", () => {
        const req = buildGenerateRequest(
            { ...baseConfig, loraFields: { loras: [{ path: "x", scale: 1 }] } },
            "u",
        );
        expect((req.body as Record<string, unknown>).loras).toEqual([
            { path: "x", scale: 1 },
        ]);
    });
});

describe("extractResultUrls", () => {
    it("img2img returns the single content", () => {
        expect(extractResultUrls({ content: "a" }, "img2img")).toEqual(["a"]);
    });
    it("t2i deduplicates the contents array", () => {
        expect(
            extractResultUrls({ contents: ["a", "a", "b"], content: "a" }, "t2i"),
        ).toEqual(["a", "b"]);
    });
    it("t2i falls back to content when contents is empty", () => {
        expect(extractResultUrls({ content: "a" }, "t2i")).toEqual(["a"]);
    });
});

function makeDeps(overrides: Partial<ProcessItemDeps> = {}) {
    const updates: Array<Record<string, unknown>> = [];
    const deps: ProcessItemDeps = {
        fetchJson: vi.fn(async () => ({
            content: "https://prov/r.png",
            model: "m1",
        })),
        persist: vi.fn(async () => "https://storage.yandexcloud.net/b/r.png"),
        saveAsset: vi.fn(async () => {}),
        updateItem: vi.fn(async (a) => {
            updates.push(a as Record<string, unknown>);
        }),
        costForModel: () => 2,
        ...overrides,
    };
    return { deps, updates };
}

describe("processBatchItem", () => {
    it("transitions RUNNING → COMPLETED on success and records cost + asset", async () => {
        const { deps, updates } = makeDeps();
        await processBatchItem(deps, { id: "i1", sourceUrl: "https://s3/x.jpg" }, baseConfig);

        expect(updates[0]).toMatchObject({ itemId: "i1", status: "RUNNING" });
        const last = updates[updates.length - 1];
        expect(last).toMatchObject({ itemId: "i1", status: "COMPLETED" });
        expect(last.resultUrls).toEqual(["https://storage.yandexcloud.net/b/r.png"]);
        expect(last.costUnits).toBe(2);
        expect(deps.saveAsset).toHaveBeenCalledTimes(1);
    });

    it("transitions RUNNING → FAILED and rethrows when the model errors", async () => {
        const { deps, updates } = makeDeps({
            fetchJson: vi.fn(async () => ({ error: "boom" })),
        });
        await expect(
            processBatchItem(deps, { id: "i2", sourceUrl: "u" }, baseConfig),
        ).rejects.toThrow();
        expect(updates[0]).toMatchObject({ status: "RUNNING" });
        expect(updates.some((u) => u.status === "FAILED")).toBe(true);
    });

    it("fails when no result persists to S3", async () => {
        const { deps, updates } = makeDeps({ persist: vi.fn(async () => "") });
        await expect(
            processBatchItem(deps, { id: "i3", sourceUrl: "u" }, baseConfig),
        ).rejects.toThrow();
        expect(updates.some((u) => u.status === "FAILED")).toBe(true);
        expect(deps.saveAsset).not.toHaveBeenCalled();
    });

    it("skips generation entirely when the batch was cancelled", async () => {
        const { deps, updates } = makeDeps({ isCancelled: () => true });
        await processBatchItem(deps, { id: "i4", sourceUrl: "u" }, baseConfig);
        expect(updates).toEqual([{ itemId: "i4", status: "SKIPPED" }]);
        expect(deps.fetchJson).not.toHaveBeenCalled();
    });
});
