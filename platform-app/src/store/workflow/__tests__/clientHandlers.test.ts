import { describe, expect, it, vi } from "vitest";
import {
    assetOutput,
    imageInput,
    type ClientHandlerDeps,
} from "@/store/workflow/clientHandlers";

function makeDeps(overrides: Partial<ClientHandlerDeps> = {}): ClientHandlerDeps {
    return {
        getAssetById: vi.fn(async ({ id }) => ({ id, url: `https://s3/${id}.png` })),
        attachUrlToWorkspace: vi.fn(async () => ({ id: "asset-new" })),
        ...overrides,
    };
}

describe("imageInput handler", () => {
    it("resolves library pick via getAssetById", async () => {
        const deps = makeDeps();
        const r = await imageInput({ source: "asset", assetId: "a-1" }, deps);
        expect(r).toEqual({ url: "https://s3/a-1.png", assetId: "a-1" });
        expect(deps.getAssetById).toHaveBeenCalledWith({ id: "a-1" });
    });

    it("resolves URL source without hitting tRPC", async () => {
        const deps = makeDeps();
        const r = await imageInput(
            { source: "url", sourceUrl: "https://example.com/x.png" },
            deps,
        );
        expect(r).toEqual({ url: "https://example.com/x.png", assetId: null });
        expect(deps.getAssetById).not.toHaveBeenCalled();
    });

    it("resolves upload source as a URL (assetId stays null)", async () => {
        const deps = makeDeps();
        const r = await imageInput(
            { source: "upload", sourceUrl: "https://s3/uploaded.png" },
            deps,
        );
        expect(r.url).toBe("https://s3/uploaded.png");
        expect(r.assetId).toBeNull();
    });

    it("throws on invalid params (missing assetId)", async () => {
        const deps = makeDeps();
        await expect(imageInput({ source: "asset" }, deps)).rejects.toThrow(
            /imageInput: invalid params/,
        );
    });

    it("throws on malformed URL", async () => {
        const deps = makeDeps();
        await expect(
            imageInput({ source: "url", sourceUrl: "not-a-url" }, deps),
        ).rejects.toThrow(/imageInput: invalid params/);
    });
});

describe("assetOutput handler", () => {
    it("calls attachUrlToWorkspace and returns the new assetId", async () => {
        const deps = makeDeps();
        const r = await assetOutput(
            { name: "Final" },
            "https://s3/out.png",
            "ws-1",
            deps,
        );
        expect(deps.attachUrlToWorkspace).toHaveBeenCalledWith({
            workspaceId: "ws-1",
            url: "https://s3/out.png",
            filename: "Final",
        });
        expect(r).toEqual({
            assetId: "asset-new",
            url: "https://s3/out.png",
            name: "Final",
        });
    });

    it("uses the schema default name when params are empty", async () => {
        const deps = makeDeps();
        const r = await assetOutput({}, "https://s3/x.png", "ws-1", deps);
        expect(r.name).toBe("Workflow output");
        expect(deps.attachUrlToWorkspace).toHaveBeenCalledWith({
            workspaceId: "ws-1",
            url: "https://s3/x.png",
            filename: "Workflow output",
        });
    });

    it("throws on invalid params (empty name)", async () => {
        const deps = makeDeps();
        await expect(
            assetOutput({ name: "" }, "https://s3/x.png", "ws-1", deps),
        ).rejects.toThrow(/assetOutput: invalid params/);
    });

    it("propagates a tRPC failure from attachUrlToWorkspace", async () => {
        const deps = makeDeps({
            attachUrlToWorkspace: vi.fn(async () => {
                throw new Error("FORBIDDEN");
            }),
        });
        await expect(
            assetOutput({ name: "x" }, "https://s3/x.png", "ws-1", deps),
        ).rejects.toThrow(/FORBIDDEN/);
    });
});
