"use client";

/**
 * useWorkflowRun — the bridge between the React tree (which owns tRPC clients)
 * and the pure executor module. Returns `runAll` to wire to the Run button
 * and `validationIssues` for pre-run UI gating.
 */

import { useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useWorkflowStore } from "@/store/workflow/useWorkflowStore";
import {
    buildExecutionPlan,
    executeGraph,
    fetchExecuteNode,
    validateBeforeRun,
    type TargetRunMode,
} from "@/store/workflow/executor";
import {
    prepareFullRunSnapshot,
    prepareSliceRunSnapshot,
} from "./runState";

export interface UseWorkflowRunArgs {
    workspaceId: string | undefined;
    workflowId?: string;
}

export function useWorkflowRun({ workspaceId, workflowId }: UseWorkflowRunArgs) {
    const utils = trpc.useUtils();
    const attachUrl = trpc.asset.attachUrlToWorkspace.useMutation();

    const nodes = useWorkflowStore((s) => s.nodes);
    const edges = useWorkflowStore((s) => s.edges);
    const isRunning = useWorkflowStore((s) => s.isRunning);

    const validationIssues = useMemo(
        () => validateBeforeRun(nodes, edges),
        [nodes, edges],
    );

    const runGraph = useCallback(async (
        targetNodeId?: string,
        targetRunMode: TargetRunMode = "ancestors",
    ) => {
        if (!workspaceId) return null;
        const store = useWorkflowStore.getState();
        if (store.isRunning) return null;
        const cachedResults = store.runResults;
        const executionPlan = targetNodeId
            ? buildExecutionPlan({
                  targetNodeId,
                  targetRunMode,
                  nodes: store.nodes,
                  edges: store.edges,
                  cachedResults,
              })
            : null;

        const snapshot = targetNodeId && executionPlan
            ? prepareSliceRunSnapshot({
                  nodeIds: executionPlan.nodeIds,
                  currentRunState: store.runState,
                  currentRunResults: store.runResults,
              })
            : prepareFullRunSnapshot(store.nodes);
        useWorkflowStore.setState({
            isRunning: true,
            runState: snapshot.runState,
            runResults: snapshot.runResults,
            runError: null,
        });

        const result = await executeGraph({
            nodes: store.nodes,
            edges: store.edges,
            workspaceId,
            workflowId,
            targetNodeId,
            targetRunMode,
            cachedResults,
            deps: {
                getAssetById: ({ id }) =>
                    utils.asset.getById.fetch({ id }) as Promise<{
                        id: string;
                        url: string;
                    }>,
                attachUrlToWorkspace: (input) => attachUrl.mutateAsync(input),
                executeServerAction: fetchExecuteNode,
            },
            callbacks: {
                onNodeStart: (id) => useWorkflowStore.getState().setNodeRunStatus(id, "running"),
                onNodeDone: (id, res) => {
                    useWorkflowStore.getState().setNodeRunStatus(id, "done");
                    useWorkflowStore.getState().setNodeResult(id, res);
                },
                onNodeError: (id) => useWorkflowStore.getState().setNodeRunStatus(id, "error"),
                onNodeBlocked: (id) => useWorkflowStore.getState().setNodeRunStatus(id, "blocked"),
            },
        });

        useWorkflowStore.setState({
            isRunning: false,
            runError: result.success ? null : result.error ?? null,
        });
        return result;
    }, [workspaceId, workflowId, utils, attachUrl]);

    const runAll = useCallback(async () => {
        await runGraph();
    }, [runGraph]);

    const runNode = useCallback(
        async (nodeId: string) => {
            await runGraph(nodeId);
        },
        [runGraph],
    );

    const runNodeWithCachedInputs = useCallback(
        async (nodeId: string) => {
            await runGraph(nodeId, "cached-inputs");
        },
        [runGraph],
    );

    const validationIssuesForNode = useCallback(
        (nodeId: string, targetRunMode: TargetRunMode = "ancestors") => {
            const state = useWorkflowStore.getState();
            return validateBeforeRun(state.nodes, state.edges, {
                targetNodeId: nodeId,
                targetRunMode,
                cachedResults: state.runResults,
            });
        },
        [],
    );

    return {
        runAll,
        runNode,
        runNodeWithCachedInputs,
        isRunning,
        validationIssues,
        validationIssuesForNode,
        canRun: !!workspaceId && validationIssues.length === 0 && !isRunning,
    };
}
