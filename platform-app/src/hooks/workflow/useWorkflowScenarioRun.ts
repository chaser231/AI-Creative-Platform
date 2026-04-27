"use client";

import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { executeGraph, fetchExecuteNode } from "@/store/workflow/executor";
import {
    normalizeWorkflowScenarioConfig,
    type WorkflowScenarioConfig,
    type WorkflowScenarioInputKind,
    type WorkflowScenarioOutputKind,
} from "@/lib/workflow/scenarioConfig";
import {
    buildScenarioExecutionGraph,
    pickScenarioResult,
    scenarioMissingOutputMessage,
} from "@/lib/workflow/scenarioRunner";

export interface WorkflowScenarioRunInput {
    workflowId: string;
    workspaceId: string;
    projectId?: string;
    inputKind?: WorkflowScenarioInputKind;
    inputImageUrl?: string;
    inputAssetId?: string;
    inputText?: string;
    selectedLayerId?: string;
}

export interface WorkflowScenarioRunResult {
    workflowId: string;
    workflowName: string;
    scenarioConfig: WorkflowScenarioConfig;
    outputKind: WorkflowScenarioOutputKind;
    nodeId: string;
    imageUrl?: string;
    text?: string;
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
            const executionGraph = buildScenarioExecutionGraph(workflow.graph, scenarioConfig, {
                kind: input.inputKind ?? scenarioConfig.input.kind,
                imageUrl: input.inputImageUrl,
                assetId: input.inputAssetId,
                text: input.inputText,
                selectedLayerId: input.selectedLayerId,
            });

            const result = await executeGraph({
                nodes: executionGraph.graph.nodes,
                edges: executionGraph.graph.edges,
                externalInputResults: executionGraph.externalInputResults,
                externalInputEdges: executionGraph.externalInputEdges,
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

            const picked = pickScenarioResult(
                executionGraph.graph,
                result.results,
                scenarioConfig,
            );
            if (!picked) {
                throw new Error(scenarioMissingOutputMessage(scenarioConfig));
            }

            let savedAssetId = picked.result.assetId;
            const shouldSaveAsset =
                scenarioConfig.output.behavior === "save-asset" ||
                scenarioConfig.output.kind === "asset";
            if (shouldSaveAsset && !savedAssetId) {
                if (!picked.result.url) {
                    throw new Error("Сценарий не вернул изображение для сохранения");
                }
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
                outputKind: picked.outputKind,
                nodeId: picked.nodeId,
                imageUrl: picked.result.url,
                text: picked.result.text,
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
