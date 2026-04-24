import type { WorkflowNode } from "@/server/workflow/types";
import type { NodeResult, NodeRunStatus } from "@/store/workflow/types";

export interface RunSnapshot {
    runState: Record<string, NodeRunStatus>;
    runResults: Record<string, NodeResult>;
}

export function prepareFullRunSnapshot(nodes: WorkflowNode[]): RunSnapshot {
    const runState: Record<string, NodeRunStatus> = {};
    for (const node of nodes) runState[node.id] = "idle";
    return { runState, runResults: {} };
}

export function prepareSliceRunSnapshot({
    nodeIds,
    currentRunState,
    currentRunResults,
}: {
    nodeIds: Iterable<string>;
    currentRunState: Record<string, NodeRunStatus>;
    currentRunResults: Record<string, NodeResult>;
}): RunSnapshot {
    const ids = new Set(nodeIds);
    const runState: Record<string, NodeRunStatus> = { ...currentRunState };
    const runResults: Record<string, NodeResult> = {};

    for (const [nodeId, result] of Object.entries(currentRunResults)) {
        if (!ids.has(nodeId)) runResults[nodeId] = result;
    }

    for (const nodeId of ids) {
        runState[nodeId] = "idle";
    }

    return { runState, runResults };
}
