import { describe, expect, it, vi } from "vitest";
import {
    buildExecutionPlan,
    buildExecutionSlice,
    executeGraph,
    getAncestorNodeIds,
    validateBeforeRun,
    type ExecutorDeps,
} from "../executor";
import type { WorkflowEdge, WorkflowNode } from "@/server/workflow/types";

function n(id: string, type: WorkflowNode["type"], params: Record<string, unknown> = {}): WorkflowNode {
    return { id, type, position: { x: 0, y: 0 }, data: { params } };
}

function e(id: string, source: string, target: string): WorkflowEdge {
    return { id, source, sourceHandle: "image-out", target, targetHandle: "image-in" };
}

function makeDeps(overrides: Partial<ExecutorDeps> = {}): ExecutorDeps {
    return {
        getAssetById: vi.fn(async ({ id }) => ({ id, url: `https://s3/${id}.png` })),
        attachUrlToWorkspace: vi.fn(async ({ url }) => ({ id: `asset-${url.slice(-6)}` })),
        executeServerAction: vi.fn(async (req) => ({
            success: true as const,
            type: "image" as const,
            imageUrl: `https://s3/${req.actionId}-out.png`,
            requestId: "rid",
        })),
        ...overrides,
    };
}

const validImageInput = { source: "asset" as const, assetId: "asset-1" };
const validAssetOutput = { name: "Out" };
const validReflection = { style: "subtle" as const, intensity: 0.3 };

describe("validateBeforeRun", () => {
    it("flags cycles", () => {
        const nodes = [
            n("a", "removeBackground"),
            n("b", "addReflection", validReflection),
        ];
        const edges = [e("e1", "a", "b"), e("e2", "b", "a")];
        const issues = validateBeforeRun(nodes, edges);
        expect(issues[0]?.message).toMatch(/цикл/);
    });

    it("flags missing required input edge", () => {
        const nodes = [n("a", "removeBackground")];
        const issues = validateBeforeRun(nodes, []);
        expect(issues.some((i) => /не подключён/.test(i.message))).toBe(true);
    });

    it("flags invalid params", () => {
        const nodes = [
            n("in", "imageInput", { source: "asset" }),
            n("out", "assetOutput", validAssetOutput),
        ];
        const edges = [e("e1", "in", "out")];
        const issues = validateBeforeRun(nodes, edges);
        expect(issues.some((i) => i.nodeId === "in")).toBe(true);
    });

    it("returns empty for a valid graph", () => {
        const nodes = [
            n("in", "imageInput", validImageInput),
            n("out", "assetOutput", validAssetOutput),
        ];
        const issues = validateBeforeRun(nodes, [e("e1", "in", "out")]);
        expect(issues).toEqual([]);
    });

    it("validates only selected node ancestors when targetNodeId is provided", () => {
        const nodes = [
            n("in", "imageInput", validImageInput),
            n("rb", "removeBackground"),
            n("out", "assetOutput", validAssetOutput),
            n("bad", "imageInput", { source: "asset" }),
            n("dangling", "assetOutput", validAssetOutput),
        ];
        const edges = [e("e1", "in", "rb"), e("e2", "rb", "out")];

        expect(validateBeforeRun(nodes, edges)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ nodeId: "bad" }),
                expect.objectContaining({ nodeId: "dangling" }),
            ]),
        );
        expect(validateBeforeRun(nodes, edges, { targetNodeId: "rb" })).toEqual([]);
    });

    it("reports a missing selected node", () => {
        const issues = validateBeforeRun([], [], { targetNodeId: "missing" });
        expect(issues).toEqual([
            { nodeId: "missing", message: "Выбранная нода не найдена." },
        ]);
    });
});

describe("execution slices", () => {
    it("collects upstream ancestors without downstream or sibling branches", () => {
        const nodes = [
            n("in", "imageInput", validImageInput),
            n("rb", "removeBackground"),
            n("mask", "mask"),
            n("preview", "preview"),
            n("sibling", "assetOutput", validAssetOutput),
        ];
        const edges = [
            e("e1", "in", "rb"),
            e("e2", "rb", "mask"),
            e("e3", "mask", "preview"),
            e("e4", "rb", "sibling"),
        ];

        expect(new Set(getAncestorNodeIds("mask", nodes, edges))).toEqual(
            new Set(["in", "rb"]),
        );

        const slice = buildExecutionSlice({ targetNodeId: "mask", nodes, edges });
        expect(slice.nodes.map((node) => node.id)).toEqual(["in", "rb", "mask"]);
        expect(slice.edges.map((edge) => edge.id)).toEqual(["e1", "e2"]);
    });

    it("builds a cached-input plan when required incoming ports have cached results", () => {
        const nodes = [
            n("in", "imageInput", validImageInput),
            n("rb", "removeBackground"),
            n("mask", "mask"),
        ];
        const edges = [e("e1", "in", "rb"), e("e2", "rb", "mask")];

        const plan = buildExecutionPlan({
            targetNodeId: "mask",
            targetRunMode: "cached-inputs",
            nodes,
            edges,
            cachedResults: { rb: { url: "https://cache/rb.png" } },
        });

        expect(plan.mode).toBe("cached-inputs");
        expect(plan.nodes.map((node) => node.id)).toEqual(["mask"]);
        expect(plan.inputEdges.map((edge) => edge.id)).toEqual(["e2"]);
        expect(plan.initialResults.rb).toEqual({ url: "https://cache/rb.png" });
    });

    it("falls back to ancestors when cached inputs are missing", () => {
        const nodes = [
            n("in", "imageInput", validImageInput),
            n("rb", "removeBackground"),
            n("mask", "mask"),
        ];
        const edges = [e("e1", "in", "rb"), e("e2", "rb", "mask")];

        const plan = buildExecutionPlan({
            targetNodeId: "mask",
            targetRunMode: "cached-inputs",
            nodes,
            edges,
            cachedResults: {},
        });

        expect(plan.mode).toBe("ancestors");
        expect(plan.nodes.map((node) => node.id)).toEqual(["in", "rb", "mask"]);
        expect(plan.inputEdges.map((edge) => edge.id)).toEqual(["e1", "e2"]);
    });
});

describe("cached-input validation", () => {
    it("validates only the target node when cached incoming results are available", () => {
        const nodes = [
            n("in", "imageInput", { source: "asset" }),
            n("rb", "removeBackground"),
            n("mask", "mask"),
        ];
        const edges = [e("e1", "in", "rb"), e("e2", "rb", "mask")];

        expect(validateBeforeRun(nodes, edges, { targetNodeId: "mask" })).toEqual(
            expect.arrayContaining([expect.objectContaining({ nodeId: "in" })]),
        );
        expect(
            validateBeforeRun(nodes, edges, {
                targetNodeId: "mask",
                targetRunMode: "cached-inputs",
                cachedResults: { rb: { url: "https://cache/rb.png" } },
            }),
        ).toEqual([]);
    });
});

describe("executeGraph", () => {
    it("runs in topological order and pipes urls downstream", async () => {
        const nodes = [
            n("in", "imageInput", validImageInput),
            n("rb", "removeBackground"),
            n("rf", "addReflection", validReflection),
            n("out", "assetOutput", validAssetOutput),
        ];
        const edges = [
            e("e1", "in", "rb"),
            e("e2", "rb", "rf"),
            e("e3", "rf", "out"),
        ];
        const deps = makeDeps();
        const order: string[] = [];

        const result = await executeGraph({
            nodes,
            edges,
            workspaceId: "ws-1",
            deps,
            callbacks: {
                onNodeDone: (id) => order.push(id),
            },
        });

        expect(result.success).toBe(true);
        expect(order).toEqual(["in", "rb", "rf", "out"]);
        expect(result.results.out?.assetId).toBeTruthy();
    });

    it("runs nodes in the same generation in parallel", async () => {
        // Two parallel branches: in1→out1 and in2→out2
        const nodes = [
            n("in1", "imageInput", { source: "asset", assetId: "a1" }),
            n("in2", "imageInput", { source: "asset", assetId: "a2" }),
            n("out1", "assetOutput", { name: "o1" }),
            n("out2", "assetOutput", { name: "o2" }),
        ];
        const edges = [e("e1", "in1", "out1"), e("e2", "in2", "out2")];

        let active = 0;
        let peak = 0;
        const deps = makeDeps({
            getAssetById: vi.fn(async ({ id }) => {
                active += 1;
                peak = Math.max(peak, active);
                await new Promise((r) => setTimeout(r, 10));
                active -= 1;
                return { id, url: `https://s3/${id}.png` };
            }),
        });

        const result = await executeGraph({ nodes, edges, workspaceId: "ws", deps });
        expect(result.success).toBe(true);
        expect(peak).toBe(2);
    });

    it("halts on first error and blocks downstream", async () => {
        const nodes = [
            n("in", "imageInput", validImageInput),
            n("rb", "removeBackground"),
            n("out", "assetOutput", validAssetOutput),
        ];
        const edges = [e("e1", "in", "rb"), e("e2", "rb", "out")];
        const blocked: string[] = [];
        const deps = makeDeps({
            executeServerAction: vi.fn(async () => ({
                success: false as const,
                type: "error" as const,
                error: "provider exploded",
                code: "PROVIDER_FAILED" as const,
                requestId: "rid",
            })),
        });

        const result = await executeGraph({
            nodes,
            edges,
            workspaceId: "ws",
            deps,
            callbacks: { onNodeBlocked: (id) => blocked.push(id) },
        });

        expect(result.success).toBe(false);
        expect(result.error?.nodeId).toBe("rb");
        expect(blocked).toContain("out");
    });

    it("runs only ancestors and the target node when targetNodeId is provided", async () => {
        const nodes = [
            n("in", "imageInput", validImageInput),
            n("rb", "removeBackground"),
            n("mask", "mask"),
            n("preview", "preview"),
            n("unrelated", "imageInput", { source: "asset", assetId: "other" }),
            n("unrelatedOut", "assetOutput", { name: "Other" }),
        ];
        const edges = [
            e("e1", "in", "rb"),
            e("e2", "rb", "mask"),
            e("e3", "mask", "preview"),
            e("e4", "unrelated", "unrelatedOut"),
        ];
        const deps = makeDeps();
        const done: string[] = [];
        const blocked: string[] = [];

        const result = await executeGraph({
            nodes,
            edges,
            workspaceId: "ws",
            targetNodeId: "mask",
            deps,
            callbacks: {
                onNodeDone: (id) => done.push(id),
                onNodeBlocked: (id) => blocked.push(id),
            },
        });

        expect(result.success).toBe(true);
        expect(done).toEqual(["in", "rb", "mask"]);
        expect(Object.keys(result.results)).toEqual(["in", "rb", "mask"]);
        expect(blocked).toEqual([]);
        expect(deps.getAssetById).toHaveBeenCalledTimes(1);
        expect(deps.getAssetById).toHaveBeenCalledWith({ id: "asset-1" });
        expect(deps.attachUrlToWorkspace).not.toHaveBeenCalled();
    });

    it("does not let invalid unrelated nodes block a selected-node run", async () => {
        const nodes = [
            n("in", "imageInput", validImageInput),
            n("rb", "removeBackground"),
            n("bad", "imageInput", { source: "asset" }),
            n("dangling", "assetOutput", validAssetOutput),
        ];
        const edges = [e("e1", "in", "rb")];

        const result = await executeGraph({
            nodes,
            edges,
            workspaceId: "ws",
            targetNodeId: "rb",
            deps: makeDeps(),
        });

        expect(result.success).toBe(true);
        expect(Object.keys(result.results)).toEqual(["in", "rb"]);
    });

    it("runs only the target node when cached inputs satisfy required ports", async () => {
        const nodes = [
            n("in", "imageInput", validImageInput),
            n("rb", "removeBackground"),
            n("mask", "mask"),
            n("preview", "preview"),
        ];
        const edges = [
            e("e1", "in", "rb"),
            e("e2", "rb", "mask"),
            e("e3", "mask", "preview"),
        ];
        const deps = makeDeps();
        const done: string[] = [];

        const result = await executeGraph({
            nodes,
            edges,
            workspaceId: "ws",
            targetNodeId: "mask",
            targetRunMode: "cached-inputs",
            cachedResults: { rb: { url: "https://cache/rb.png" } },
            deps,
            callbacks: { onNodeDone: (id) => done.push(id) },
        });

        expect(result.success).toBe(true);
        expect(done).toEqual(["mask"]);
        expect(Object.keys(result.results)).toEqual(["mask"]);
        expect(deps.getAssetById).not.toHaveBeenCalled();
        expect(deps.executeServerAction).toHaveBeenCalledTimes(1);
        expect(deps.executeServerAction).toHaveBeenCalledWith(
            expect.objectContaining({
                actionId: "apply_mask",
                inputs: { "image-in": { imageUrl: "https://cache/rb.png" } },
            }),
        );
    });

    it("falls back to running ancestors when cached inputs are unavailable", async () => {
        const nodes = [
            n("in", "imageInput", validImageInput),
            n("rb", "removeBackground"),
            n("mask", "mask"),
        ];
        const edges = [e("e1", "in", "rb"), e("e2", "rb", "mask")];
        const deps = makeDeps();
        const done: string[] = [];

        const result = await executeGraph({
            nodes,
            edges,
            workspaceId: "ws",
            targetNodeId: "mask",
            targetRunMode: "cached-inputs",
            cachedResults: {},
            deps,
            callbacks: { onNodeDone: (id) => done.push(id) },
        });

        expect(result.success).toBe(true);
        expect(done).toEqual(["in", "rb", "mask"]);
        expect(Object.keys(result.results)).toEqual(["in", "rb", "mask"]);
        expect(deps.getAssetById).toHaveBeenCalledTimes(1);
        expect(deps.executeServerAction).toHaveBeenCalledTimes(2);
    });
});
