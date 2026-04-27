import { describe, expect, it } from "vitest";
import {
    buildScenarioExecutionGraph,
    pickScenarioResult,
    scenarioMissingOutputMessage,
} from "@/lib/workflow/scenarioRunner";
import { defaultWorkflowScenarioConfig } from "@/lib/workflow/scenarioConfig";
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from "@/server/workflow/types";

function node(
    id: string,
    type: WorkflowNode["type"],
    params: Record<string, unknown> = {},
): WorkflowNode {
    return { id, type, position: { x: 0, y: 0 }, data: { params } };
}

function edge(
    id: string,
    source: string,
    sourceHandle: string,
    target: string,
    targetHandle: string,
): WorkflowEdge {
    return { id, source, sourceHandle, target, targetHandle };
}

function graph(nodes: WorkflowNode[], edges: WorkflowEdge[] = []): WorkflowGraph {
    return { version: 1, nodes, edges };
}

describe("buildScenarioExecutionGraph", () => {
    it("keeps existing imageInput injection behavior for image scenarios", () => {
        const source = graph([
            node("in", "imageInput", { source: "asset", assetId: "old" }),
            node("text", "textGeneration", { prompt: "Describe this image" }),
        ]);
        const config = {
            ...defaultWorkflowScenarioConfig("Describe"),
            input: { kind: "image" as const, required: true },
            output: { kind: "text" as const, behavior: "replace-selection" as const },
        };

        const execution = buildScenarioExecutionGraph(source, config, {
            kind: "image",
            imageUrl: "https://cdn.example.com/p.png",
        });

        expect(execution.externalInputEdges).toEqual([]);
        expect(execution.externalInputResults).toEqual({});
        expect(execution.graph.nodes[0]?.data.params).toEqual(
            expect.objectContaining({
                source: "url",
                sourceUrl: "https://cdn.example.com/p.png",
                assetId: undefined,
            }),
        );
    });

    it("injects image input into generation context when no imageInput node exists", () => {
        const source = graph([
            node("text", "textGeneration", { prompt: "Describe this image" }),
        ]);
        const config = {
            ...defaultWorkflowScenarioConfig("Describe"),
            input: { kind: "image" as const, required: true },
            output: { kind: "text" as const, behavior: "replace-selection" as const },
        };

        const execution = buildScenarioExecutionGraph(source, config, {
            kind: "image",
            imageUrl: "https://cdn.example.com/p.png",
        });

        expect(execution.externalInputResults.__scenario_external_input__).toEqual({
            url: "https://cdn.example.com/p.png",
            assetId: undefined,
        });
        expect(execution.externalInputEdges).toEqual([
            expect.objectContaining({
                source: "__scenario_external_input__",
                sourceHandle: "image-out",
                target: "text",
                targetHandle: "context-in",
            }),
        ]);
    });

    it("injects text input into generation context", () => {
        const source = graph([
            node("image", "imageGeneration", { prompt: "", style: "photo" }),
        ]);
        const config = {
            ...defaultWorkflowScenarioConfig("Generate"),
            input: { kind: "text" as const, required: true },
            output: { kind: "image" as const, behavior: "create-layer" as const },
        };

        const execution = buildScenarioExecutionGraph(source, config, {
            kind: "text",
            text: "Make a premium green product render",
        });

        expect(execution.externalInputResults.__scenario_external_input__).toEqual({
            text: "Make a premium green product render",
        });
        expect(execution.externalInputEdges[0]).toEqual(
            expect.objectContaining({
                sourceHandle: "text-out",
                target: "image",
                targetHandle: "context-in",
            }),
        );
    });

    it("fails required text input when graph has no compatible target", () => {
        const source = graph([node("in", "imageInput", { source: "asset", assetId: "a" })]);
        const config = {
            ...defaultWorkflowScenarioConfig("Text"),
            input: { kind: "text" as const, required: true },
            output: { kind: "text" as const, behavior: "replace-selection" as const },
        };

        expect(() =>
            buildScenarioExecutionGraph(source, config, {
                kind: "text",
                text: "Describe",
            }),
        ).toThrow("В сценарии нет входа для текста");
    });

    it("fails non-image layer input until layer-aware nodes exist", () => {
        const source = graph([node("text", "textGeneration", { prompt: "Describe" })]);
        const config = {
            ...defaultWorkflowScenarioConfig("Layer"),
            input: { kind: "layer" as const, required: true },
            output: { kind: "text" as const, behavior: "replace-selection" as const },
        };

        expect(() =>
            buildScenarioExecutionGraph(source, config, {
                kind: "layer",
                selectedLayerId: "layer-1",
            }),
        ).toThrow("Пока поддерживаются только image-слои");
    });
});

describe("pickScenarioResult", () => {
    it("picks image results using assetOutput/preview/leaf priority", () => {
        const source = graph(
            [
                node("gen", "imageGeneration"),
                node("preview", "preview"),
                node("out", "assetOutput"),
            ],
            [
                edge("e1", "gen", "image-out", "preview", "image-in"),
                edge("e2", "preview", "image-out", "out", "image-in"),
            ],
        );
        const config = {
            ...defaultWorkflowScenarioConfig("Image"),
            output: { kind: "image" as const, behavior: "replace-selection" as const },
        };

        expect(
            pickScenarioResult(
                source,
                {
                    gen: { url: "https://cdn.example.com/gen.png" },
                    preview: { url: "https://cdn.example.com/preview.png" },
                    out: { url: "https://cdn.example.com/out.png", assetId: "asset-1" },
                },
                config,
            ),
        ).toEqual({
            nodeId: "out",
            outputKind: "image",
            result: { url: "https://cdn.example.com/out.png", assetId: "asset-1" },
        });
    });

    it("picks text result for text output scenarios", () => {
        const source = graph([node("text", "textGeneration")]);
        const config = {
            ...defaultWorkflowScenarioConfig("Text"),
            output: { kind: "text" as const, behavior: "replace-selection" as const },
        };

        expect(
            pickScenarioResult(
                source,
                { text: { text: "Short result" } },
                config,
            ),
        ).toEqual({
            nodeId: "text",
            outputKind: "text",
            result: { text: "Short result" },
        });
    });

    it("returns specific missing output copy", () => {
        expect(
            scenarioMissingOutputMessage({
                ...defaultWorkflowScenarioConfig("Text"),
                output: { kind: "text", behavior: "replace-selection" },
            }),
        ).toBe("Сценарий не вернул текст");
    });
});
