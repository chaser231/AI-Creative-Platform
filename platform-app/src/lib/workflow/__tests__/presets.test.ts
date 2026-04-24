import { describe, expect, it } from "vitest";
import { workflowGraphSchema, emptyWorkflowGraph } from "@/lib/workflow/graphSchema";
import { NODE_PARAM_SCHEMAS } from "@/lib/workflow/nodeParamSchemas";
import {
    WORKFLOW_PRESET_CATALOG,
    WORKFLOW_PRESET_IDS,
    createWorkflowGraphForPreset,
    createWorkflowPresetDraft,
    getWorkflowPresetCreateHref,
} from "@/lib/workflow/presets";
import { validateBeforeRun } from "@/store/workflow/executor";
import type { WorkflowGraph, WorkflowNode } from "@/server/workflow/types";

describe("workflow presets", () => {
    it("exposes ordered catalog metadata and create links for UI entrypoints", () => {
        expect(WORKFLOW_PRESET_CATALOG.map((item) => item.id)).toEqual([
            ...WORKFLOW_PRESET_IDS,
        ]);
        for (const item of WORKFLOW_PRESET_CATALOG) {
            expect(item.name).toBeTruthy();
            expect(item.description).toBeTruthy();
            expect(getWorkflowPresetCreateHref(item.id)).toBe(
                `/workflows/new?preset=${item.id}`,
            );
        }
    });

    it("creates a schema-valid graph for every system preset", () => {
        for (const presetId of WORKFLOW_PRESET_IDS) {
            const draft = createWorkflowPresetDraft(presetId);

            expect(draft?.id).toBe(presetId);
            expect(draft?.name).toBeTruthy();
            expect(draft?.description).toBeTruthy();
            expect(workflowGraphSchema.safeParse(draft?.graph).success).toBe(true);
        }
    });

    it("falls back to an empty graph for unknown preset ids", () => {
        expect(createWorkflowPresetDraft("unknown")).toBeNull();
        expect(createWorkflowGraphForPreset("unknown")).toEqual(emptyWorkflowGraph());
        expect(createWorkflowGraphForPreset(null)).toEqual(emptyWorkflowGraph());
    });

    it("uses stable node and edge ids", () => {
        const graph = createWorkflowPresetDraft("product-reflection-pipeline")?.graph;
        expect(graph?.nodes.map((node) => node.id)).toEqual([
            "preset-input",
            "preset-reflection",
            "preset-cutout",
            "preset-fade",
            "preset-soften",
            "preset-preview",
        ]);
        expect(graph?.edges.map((edge) => edge.id)).toEqual([
            "preset-edge-input-reflection",
            "preset-edge-reflection-cutout",
            "preset-edge-cutout-fade",
            "preset-edge-fade-soften",
            "preset-edge-soften-preview",
        ]);
    });

    it("provides valid default params once the user supplies the required image input", () => {
        for (const presetId of WORKFLOW_PRESET_IDS) {
            const draft = createWorkflowPresetDraft(presetId);
            expect(draft).toBeTruthy();
            const graph = withUserImageInput(draft!.graph);

            for (const node of graph.nodes) {
                expect(NODE_PARAM_SCHEMAS[node.type].safeParse(node.data.params).success).toBe(true);
            }
            expect(validateBeforeRun(graph.nodes, graph.edges)).toEqual([]);
        }
    });
});

function withUserImageInput(graph: WorkflowGraph): WorkflowGraph {
    return {
        ...graph,
        nodes: graph.nodes.map((node): WorkflowNode =>
            node.type === "imageInput"
                ? {
                      ...node,
                      data: {
                          params: {
                              ...node.data.params,
                              source: "asset",
                              assetId: "asset-test",
                          },
                      },
                  }
                : node,
        ),
    };
}
