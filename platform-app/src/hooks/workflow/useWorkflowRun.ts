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
    executeGraph,
    fetchExecuteNode,
    validateBeforeRun,
} from "@/store/workflow/executor";

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

    const runAll = useCallback(async () => {
        if (!workspaceId) return;
        const store = useWorkflowStore.getState();
        if (store.isRunning) return;

        const initial: Record<string, "idle"> = {};
        for (const n of store.nodes) initial[n.id] = "idle";
        useWorkflowStore.setState({
            isRunning: true,
            runState: initial,
            runResults: {},
            runError: null,
        });

        const result = await executeGraph({
            nodes: store.nodes,
            edges: store.edges,
            workspaceId,
            workflowId,
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
    }, [workspaceId, workflowId, utils, attachUrl]);

    return {
        runAll,
        isRunning,
        validationIssues,
        canRun: !!workspaceId && validationIssues.length === 0 && !isRunning,
    };
}
