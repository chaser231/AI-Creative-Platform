import { describe, it, expect } from "vitest";
import {
    workflowGraphSchema,
    emptyWorkflowGraph,
} from "@/lib/workflow/graphSchema";

describe("workflowGraphSchema", () => {
    it("parses an empty graph", () => {
        const result = workflowGraphSchema.safeParse(emptyWorkflowGraph());
        expect(result.success).toBe(true);
    });

    it("parses a graph with one node and no edges", () => {
        const graph = {
            version: 1 as const,
            nodes: [
                {
                    id: "node-1",
                    type: "imageInput" as const,
                    position: { x: 10, y: 20 },
                    data: { params: {} },
                },
            ],
            edges: [],
        };
        const result = workflowGraphSchema.safeParse(graph);
        expect(result.success).toBe(true);
    });

    it("rejects unknown node type", () => {
        const graph = {
            version: 1,
            nodes: [
                {
                    id: "node-1",
                    type: "notARealType",
                    position: { x: 0, y: 0 },
                    data: { params: {} },
                },
            ],
            edges: [],
        };
        const result = workflowGraphSchema.safeParse(graph);
        expect(result.success).toBe(false);
    });

    it("rejects wrong version", () => {
        const result = workflowGraphSchema.safeParse({
            version: 2,
            nodes: [],
            edges: [],
        });
        expect(result.success).toBe(false);
    });

    it("rejects edge with empty handle strings", () => {
        const graph = {
            version: 1,
            nodes: [],
            edges: [
                {
                    id: "edge-1",
                    source: "a",
                    sourceHandle: "",
                    target: "b",
                    targetHandle: "in",
                },
            ],
        };
        const result = workflowGraphSchema.safeParse(graph);
        expect(result.success).toBe(false);
    });
});
