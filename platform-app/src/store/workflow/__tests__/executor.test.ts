import { describe, expect, it, vi } from "vitest";
import {
    executeGraph,
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
});
