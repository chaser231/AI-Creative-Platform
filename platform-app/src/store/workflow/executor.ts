/**
 * Workflow executor — runs the graph node-by-node, generation by generation.
 *
 * Phase 4. Pure async module so the Zustand slice can drive it from `runAll()`
 * and tests can drive it directly with mocks. No React, no fetch globals at
 * module top level — `deps` injection keeps it test-friendly.
 */

import Graph from "graphology";
import { topologicalGenerations, hasCycle } from "graphology-dag";
import {
    NODE_REGISTRY,
    type ExecuteNodeRequest,
    type ExecuteNodeResponse,
    type ServerActionId,
    type WorkflowEdge,
    type WorkflowNode,
} from "@/server/workflow/types";
import { NODE_PARAM_SCHEMAS } from "@/lib/workflow/nodeParamSchemas";
import {
    assetOutput as assetOutputHandler,
    imageInput as imageInputHandler,
    preview as previewHandler,
    type ClientHandlerDeps,
} from "./clientHandlers";

export interface NodeRunResult {
    /** Resolved image URL produced by the node, if any. */
    url?: string;
    /** Asset id when the node persisted/picked an asset. */
    assetId?: string;
}

export interface ValidationIssue {
    nodeId: string;
    message: string;
}

export interface ExecutorCallbacks {
    onNodeStart?: (nodeId: string) => void;
    onNodeDone?: (nodeId: string, result: NodeRunResult) => void;
    onNodeError?: (nodeId: string, message: string) => void;
    onNodeBlocked?: (nodeId: string) => void;
}

export interface ExecutorDeps extends ClientHandlerDeps {
    /** POST /api/workflow/execute-node — injected so tests don't hit the network. */
    executeServerAction: (req: ExecuteNodeRequest) => Promise<ExecuteNodeResponse>;
}

export interface ExecuteGraphParams {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    workspaceId: string;
    workflowId?: string;
    deps: ExecutorDeps;
    callbacks?: ExecutorCallbacks;
}

export interface ExecuteGraphResult {
    success: boolean;
    results: Record<string, NodeRunResult>;
    error?: { nodeId: string; message: string };
}

/**
 * Build a graphology DiGraph from the workflow. Each edge becomes one
 * directed link source→target, carrying its handle ids in attributes
 * so the executor can wire upstream outputs into the right input port.
 */
export function buildGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): Graph {
    const g = new Graph({ type: "directed", multi: true });
    for (const n of nodes) g.addNode(n.id, { node: n });
    for (const e of edges) {
        if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
        g.addEdgeWithKey(e.id, e.source, e.target, {
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
        });
    }
    return g;
}

/**
 * Pre-run validation: cycles, missing required input edges, invalid params.
 * Returns an empty array iff the graph is safe to execute.
 */
export function validateBeforeRun(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const g = buildGraph(nodes, edges);

    if (hasCycle(g)) {
        issues.push({ nodeId: "", message: "Граф содержит цикл — выполнение невозможно." });
        return issues;
    }

    for (const n of nodes) {
        const def = NODE_REGISTRY[n.type];
        const schema = NODE_PARAM_SCHEMAS[n.type];

        const parsed = schema.safeParse(n.data.params);
        if (!parsed.success) {
            issues.push({
                nodeId: n.id,
                message: `«${def.displayName}»: ${parsed.error.issues[0]?.message ?? "невалидные параметры"}`,
            });
        }

        for (const port of def.inputs) {
            if (!port.required) continue;
            const hasIncoming = edges.some(
                (e) => e.target === n.id && e.targetHandle === port.id,
            );
            if (!hasIncoming) {
                issues.push({
                    nodeId: n.id,
                    message: `«${def.displayName}»: вход «${port.label}» не подключён.`,
                });
            }
        }
    }

    return issues;
}

/**
 * Run the workflow. Each generation runs its nodes in parallel; the next
 * generation starts only when the previous fully resolves. First failure
 * marks all unfinished downstream nodes as blocked and halts.
 */
export async function executeGraph(
    params: ExecuteGraphParams,
): Promise<ExecuteGraphResult> {
    const { nodes, edges, workspaceId, workflowId, deps, callbacks } = params;

    const issues = validateBeforeRun(nodes, edges);
    if (issues.length > 0) {
        const first = issues[0];
        return {
            success: false,
            results: {},
            error: { nodeId: first.nodeId, message: first.message },
        };
    }

    const g = buildGraph(nodes, edges);
    const generations = topologicalGenerations(g) as string[][];
    const nodesById = new Map(nodes.map((n) => [n.id, n]));
    const results: Record<string, NodeRunResult> = {};

    for (let i = 0; i < generations.length; i += 1) {
        const gen = generations[i];

        const settled = await Promise.allSettled(
            gen.map((nodeId) => runOne(nodeId, nodesById, edges, results, workspaceId, workflowId, deps, callbacks)),
        );

        const failedIdx = settled.findIndex((s) => s.status === "rejected");
        if (failedIdx !== -1) {
            const failed = settled[failedIdx] as PromiseRejectedResult;
            const failedNodeId = gen[failedIdx];
            const remainingGens = generations.slice(i + 1).flat();
            for (const id of remainingGens) callbacks?.onNodeBlocked?.(id);
            return {
                success: false,
                results,
                error: {
                    nodeId: failedNodeId,
                    message: failed.reason instanceof Error ? failed.reason.message : String(failed.reason),
                },
            };
        }
    }

    return { success: true, results };
}

async function runOne(
    nodeId: string,
    nodesById: Map<string, WorkflowNode>,
    edges: WorkflowEdge[],
    results: Record<string, NodeRunResult>,
    workspaceId: string,
    workflowId: string | undefined,
    deps: ExecutorDeps,
    callbacks: ExecutorCallbacks | undefined,
): Promise<void> {
    const node = nodesById.get(nodeId);
    if (!node) return;
    const def = NODE_REGISTRY[node.type];

    callbacks?.onNodeStart?.(nodeId);

    try {
        const inputs = collectInputs(nodeId, edges, results);
        let result: NodeRunResult;

        if (def.execute.kind === "client") {
            if (def.execute.handler === "imageInput") {
                const out = await imageInputHandler(node.data.params, deps);
                result = { url: out.url, assetId: out.assetId ?? undefined };
            } else if (def.execute.handler === "preview") {
                const upstream = inputs["image-in"]?.imageUrl;
                if (!upstream) throw new Error("preview: нет входного изображения");
                const out = await previewHandler(node.data.params, upstream);
                result = { url: out.url };
            } else {
                // assetOutput — needs the upstream image url
                const upstream = inputs["image-in"]?.imageUrl;
                if (!upstream) throw new Error("assetOutput: нет входного изображения");
                const out = await assetOutputHandler(node.data.params, upstream, workspaceId, deps);
                result = { url: out.url, assetId: out.assetId };
            }
        } else {
            const resp = await deps.executeServerAction({
                actionId: def.execute.actionId as ServerActionId,
                params: node.data.params,
                inputs,
                workspaceId,
                workflowId,
            });
            if (!resp.success) throw new Error(resp.error);
            result = { url: resp.imageUrl };
        }

        results[nodeId] = result;
        callbacks?.onNodeDone?.(nodeId, result);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        callbacks?.onNodeError?.(nodeId, message);
        throw err;
    }
}

/**
 * Walk inbound edges and shape their producers' outputs into the
 * `inputs[portId] = { imageUrl }` map that server actions and downstream
 * client handlers expect.
 */
function collectInputs(
    nodeId: string,
    edges: WorkflowEdge[],
    results: Record<string, NodeRunResult>,
): Record<string, { imageUrl: string }> {
    const map: Record<string, { imageUrl: string }> = {};
    for (const e of edges) {
        if (e.target !== nodeId) continue;
        const upstream = results[e.source];
        if (upstream?.url) map[e.targetHandle] = { imageUrl: upstream.url };
    }
    return map;
}

/**
 * Default server-action dispatcher. Exposed so the slice can pass it as
 * the executor's `deps.executeServerAction` without re-implementing fetch.
 */
export async function fetchExecuteNode(
    req: ExecuteNodeRequest,
): Promise<ExecuteNodeResponse> {
    const res = await fetch("/api/workflow/execute-node", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
    });
    return (await res.json()) as ExecuteNodeResponse;
}
