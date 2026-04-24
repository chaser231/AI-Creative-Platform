"use client";

import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { executeGraph, fetchExecuteNode } from "@/store/workflow/executor";
import {
    normalizeWorkflowScenarioConfig,
    type WorkflowScenarioConfig,
} from "@/lib/workflow/scenarioConfig";
import type { WorkflowGraph, WorkflowNode } from "@/server/workflow/types";

export interface WorkflowScenarioRunInput {
    workflowId: string;
    workspaceId: string;
    projectId?: string;
    inputImageUrl?: string;
    inputAssetId?: string;
}

export interface WorkflowScenarioRunResult {
    workflowId: string;
    workflowName: string;
    scenarioConfig: WorkflowScenarioConfig;
    nodeId: string;
    imageUrl?: string;
    assetId?: string;
    savedAssetId?: string;
}

export function useWorkflowScenarioRun() {
    const utils = trpc.useUtils();
    const attachUrlToWorkspace = trpc.asset.attachUrlToWorkspace.useMutation();
    const attachUrlToProject = trpc.asset.attachUrlToProject.useMutation();

    const runScenario = useCallback(
        async (input: WorkflowScenarioRunInput): Promise<WorkflowScenarioRunResult> => {
            const workflow = await utils.workflow.loadGraph.fetch({ id: input.workflowId });
            if (!workflow.graph) {
                throw new Error("Этот workflow не является графовым сценарием");
            }

            const scenarioConfig = normalizeWorkflowScenarioConfig(
                workflow.scenarioConfig,
                workflow.name,
            );
            const graph = injectExternalInput(workflow.graph, {
                imageUrl: input.inputImageUrl,
                assetId: input.inputAssetId,
                inputRequired: scenarioConfig.input.required,
            });

            const result = await executeGraph({
                nodes: graph.nodes,
                edges: graph.edges,
                workspaceId: input.workspaceId,
                workflowId: input.workflowId,
                deps: {
                    getAssetById: ({ id }) =>
                        utils.asset.getById.fetch({ id }) as Promise<{
                            id: string;
                            url: string;
                        }>,
                    attachUrlToWorkspace: (payload) =>
                        attachUrlToWorkspace.mutateAsync(payload),
                    executeServerAction: fetchExecuteNode,
                },
            });

            if (!result.success) {
                throw new Error(result.error?.message ?? "Сценарий не выполнился");
            }

            const picked = pickFinalImageResult(graph, result.results);
            if (!picked?.result.url) {
                throw new Error("Сценарий не вернул изображение");
            }

            let savedAssetId = picked.result.assetId;
            if (scenarioConfig.output.behavior === "save-asset") {
                if (input.projectId) {
                    const created = await attachUrlToProject.mutateAsync({
                        projectId: input.projectId,
                        url: picked.result.url,
                        filename: scenarioConfig.title,
                        source: "workflow-scenario",
                    });
                    savedAssetId = created.id;
                } else {
                    const created = await attachUrlToWorkspace.mutateAsync({
                        workspaceId: input.workspaceId,
                        url: picked.result.url,
                        filename: scenarioConfig.title,
                        source: "workflow-scenario",
                    });
                    savedAssetId = created.id;
                }
            }

            return {
                workflowId: input.workflowId,
                workflowName: workflow.name,
                scenarioConfig,
                nodeId: picked.nodeId,
                imageUrl: picked.result.url,
                assetId: picked.result.assetId,
                savedAssetId,
            };
        },
        [attachUrlToProject, attachUrlToWorkspace, utils],
    );

    return {
        runScenario,
        isRunning:
            attachUrlToWorkspace.isPending || attachUrlToProject.isPending,
    };
}

function injectExternalInput(
    graph: WorkflowGraph,
    input: {
        imageUrl?: string;
        assetId?: string;
        inputRequired: boolean;
    },
): WorkflowGraph {
    if (!input.imageUrl && !input.assetId) {
        if (input.inputRequired) {
            throw new Error("Выберите изображение для запуска сценария");
        }
        return graph;
    }

    const imageInput = graph.nodes.find((node) => node.type === "imageInput");
    if (!imageInput) {
        throw new Error("В сценарии нет входной ноды изображения");
    }

    return {
        ...graph,
        nodes: graph.nodes.map((node): WorkflowNode => {
            if (node.id !== imageInput.id) return node;
            return {
                ...node,
                data: {
                    params: input.assetId
                        ? {
                              ...node.data.params,
                              source: "asset",
                              assetId: input.assetId,
                              sourceUrl: input.imageUrl,
                          }
                        : {
                              ...node.data.params,
                              source: "url",
                              sourceUrl: input.imageUrl,
                              assetId: undefined,
                          },
                },
            };
        }),
    };
}

function pickFinalImageResult(
    graph: WorkflowGraph,
    results: Record<string, { url?: string; assetId?: string }>,
): { nodeId: string; result: { url?: string; assetId?: string } } | null {
    const seen = new Set<string>();
    const groups = [
        graph.nodes.filter((node) => node.type === "assetOutput"),
        graph.nodes.filter((node) => node.type === "preview"),
        graph.nodes.filter(
            (node) => !graph.edges.some((edge) => edge.source === node.id),
        ),
        graph.nodes,
    ];

    for (const group of groups) {
        for (const node of [...group].reverse()) {
            if (seen.has(node.id)) continue;
            seen.add(node.id);
            const result = results[node.id];
            if (result?.url) return { nodeId: node.id, result };
        }
    }

    return null;
}
