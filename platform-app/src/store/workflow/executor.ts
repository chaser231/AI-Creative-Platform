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
    /** Generated text produced by the node, if any. */
    text?: string;
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
    /** When set, execute only this node plus its upstream ancestors. */
    targetNodeId?: string;
    /**
     * Target execution strategy. `cached-inputs` runs only the target node when
     * every required incoming port has a cached upstream result; otherwise it
     * falls back to the default ancestor run.
     */
    targetRunMode?: TargetRunMode;
    /** Last successful node results used by `cached-inputs` target runs. */
    cachedResults?: Record<string, NodeRunResult>;
    deps: ExecutorDeps;
    callbacks?: ExecutorCallbacks;
}

export interface ExecuteGraphResult {
    success: boolean;
    results: Record<string, NodeRunResult>;
    error?: { nodeId: string; message: string };
}

export interface ExecutionSlice {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    nodeIds: Set<string>;
}

export type TargetRunMode = "ancestors" | "cached-inputs";

export type ResolvedRunMode = "full" | TargetRunMode;

export interface ExecutionPlan extends ExecutionSlice {
    /** Edges used only for shaping input payloads during node execution. */
    inputEdges: WorkflowEdge[];
    /** Pre-existing upstream results available to this execution plan. */
    initialResults: Record<string, NodeRunResult>;
    /** The effective mode after cache availability/fallback is resolved. */
    mode: ResolvedRunMode;
}

export interface ValidateBeforeRunOptions {
    /** Validate only this node plus its upstream ancestors. */
    targetNodeId?: string;
    targetRunMode?: TargetRunMode;
    cachedResults?: Record<string, NodeRunResult>;
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

export function getAncestorNodeIds(
    targetNodeId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
): string[] {
    const knownNodeIds = new Set(nodes.map((node) => node.id));
    if (!knownNodeIds.has(targetNodeId)) return [];

    const visited = new Set<string>([targetNodeId]);
    const ancestors: string[] = [];
    const stack = [targetNodeId];

    while (stack.length > 0) {
        const current = stack.pop()!;
        for (const edge of edges) {
            if (edge.target !== current) continue;
            if (!knownNodeIds.has(edge.source) || visited.has(edge.source)) continue;
            visited.add(edge.source);
            ancestors.push(edge.source);
            stack.push(edge.source);
        }
    }

    return ancestors;
}

export function buildExecutionSlice({
    targetNodeId,
    nodes,
    edges,
}: {
    targetNodeId: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
}): ExecutionSlice {
    if (!nodes.some((node) => node.id === targetNodeId)) {
        return { nodes: [], edges: [], nodeIds: new Set() };
    }

    const nodeIds = new Set([
        targetNodeId,
        ...getAncestorNodeIds(targetNodeId, nodes, edges),
    ]);
    return {
        nodes: nodes.filter((node) => nodeIds.has(node.id)),
        edges: edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
        nodeIds,
    };
}

export function buildExecutionPlan({
    targetNodeId,
    targetRunMode = "ancestors",
    nodes,
    edges,
    cachedResults = {},
}: {
    targetNodeId?: string;
    targetRunMode?: TargetRunMode;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    cachedResults?: Record<string, NodeRunResult>;
}): ExecutionPlan {
    if (!targetNodeId) {
        return {
            nodes,
            edges,
            inputEdges: edges,
            nodeIds: new Set(nodes.map((node) => node.id)),
            initialResults: {},
            mode: "full",
        };
    }

    const targetNode = nodes.find((node) => node.id === targetNodeId);
    if (!targetNode) {
        return {
            nodes: [],
            edges: [],
            inputEdges: [],
            nodeIds: new Set(),
            initialResults: {},
            mode: targetRunMode,
        };
    }

    if (targetRunMode === "cached-inputs") {
        const cachedPlan = buildCachedInputPlan({
            targetNode,
            nodes,
            edges,
            cachedResults,
        });
        if (cachedPlan) return cachedPlan;
    }

    const slice = buildExecutionSlice({ targetNodeId, nodes, edges });
    return {
        ...slice,
        inputEdges: slice.edges,
        initialResults: {},
        mode: "ancestors",
    };
}

function buildCachedInputPlan({
    targetNode,
    nodes,
    edges,
    cachedResults,
}: {
    targetNode: WorkflowNode;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    cachedResults: Record<string, NodeRunResult>;
}): ExecutionPlan | null {
    const knownNodeIds = new Set(nodes.map((node) => node.id));
    const incomingEdges = edges.filter(
        (edge) => edge.target === targetNode.id && knownNodeIds.has(edge.source),
    );
    const cachedInputEdges = incomingEdges.filter(
        (edge) => Boolean(cachedResults[edge.source]?.url || cachedResults[edge.source]?.text),
    );
    const definition = NODE_REGISTRY[targetNode.type];

    for (const port of definition.inputs) {
        if (!port.required) continue;
        const hasCachedInput = cachedInputEdges.some(
            (edge) => {
                if (edge.targetHandle !== port.id) return false;
                const cached = cachedResults[edge.source];
                if (port.type === "text") return Boolean(cached?.text);
                if (port.type === "image") return Boolean(cached?.url);
                return Boolean(cached?.url || cached?.text);
            },
        );
        if (!hasCachedInput) return null;
    }

    const initialResults: Record<string, NodeRunResult> = {};
    for (const edge of cachedInputEdges) {
        const cached = cachedResults[edge.source];
        if (cached) initialResults[edge.source] = cached;
    }

    return {
        nodes: [targetNode],
        edges: [],
        inputEdges: cachedInputEdges,
        nodeIds: new Set([targetNode.id]),
        initialResults,
        mode: "cached-inputs",
    };
}

/**
 * Pre-run validation: cycles, missing required input edges, invalid params.
 * Returns an empty array iff the graph is safe to execute.
 */
export function validateBeforeRun(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    options: ValidateBeforeRunOptions = {},
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const targetNodeId = options.targetNodeId;
    if (targetNodeId && !nodes.some((node) => node.id === targetNodeId)) {
        return [{ nodeId: targetNodeId, message: "Выбранная нода не найдена." }];
    }

    const executionPlan = buildExecutionPlan({
        targetNodeId,
        targetRunMode: options.targetRunMode,
        nodes,
        edges,
        cachedResults: options.cachedResults,
    });

    const g = buildGraph(executionPlan.nodes, executionPlan.edges);

    if (hasCycle(g)) {
        issues.push({ nodeId: "", message: "Граф содержит цикл — выполнение невозможно." });
        return issues;
    }

    for (const n of executionPlan.nodes) {
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
            const hasIncoming = executionPlan.inputEdges.some(
                (e) => e.target === n.id && e.targetHandle === port.id,
            );
            if (!hasIncoming) {
                issues.push({
                    nodeId: n.id,
                    message: `«${def.displayName}»: вход «${port.label}» не подключён.`,
                });
            }
        }

        const promptIssue = validateGenerationPromptInput(n, executionPlan.inputEdges);
        if (promptIssue) issues.push(promptIssue);
    }

    return issues;
}

function validateGenerationPromptInput(
    node: WorkflowNode,
    inputEdges: WorkflowEdge[],
): ValidationIssue | null {
    if (node.type !== "imageGeneration" && node.type !== "textGeneration") {
        return null;
    }

    const localPrompt =
        typeof node.data.params.prompt === "string"
            ? node.data.params.prompt.trim()
            : "";
    const hasLocalPrompt = localPrompt.length >= 3;
    const hasPromptInput = inputEdges.some(
        (edge) =>
            edge.target === node.id &&
            (edge.targetHandle === "prompt-in" || edge.targetHandle === "context-in"),
    );

    if (hasLocalPrompt || hasPromptInput) return null;

    const message =
        node.type === "imageGeneration"
            ? "Опишите, что нужно сгенерировать, или подключите контекст с текстом."
            : "Опишите, какой текст нужен, или подключите контекст с текстом.";

    return {
        nodeId: node.id,
        message: `«${NODE_REGISTRY[node.type].displayName}»: ${message}`,
    };
}

/**
 * Run the workflow. Each generation runs its nodes in parallel; the next
 * generation starts only when the previous fully resolves. First failure
 * marks all unfinished downstream nodes as blocked and halts.
 */
export async function executeGraph(
    params: ExecuteGraphParams,
): Promise<ExecuteGraphResult> {
    const {
        workspaceId,
        workflowId,
        targetNodeId,
        targetRunMode,
        cachedResults,
        deps,
        callbacks,
    } = params;
    const executionPlan = buildExecutionPlan({
        targetNodeId,
        targetRunMode,
        nodes: params.nodes,
        edges: params.edges,
        cachedResults,
    });

    const issues = validateBeforeRun(params.nodes, params.edges, {
        targetNodeId,
        targetRunMode,
        cachedResults,
    });
    if (issues.length > 0) {
        const first = issues[0];
        return {
            success: false,
            results: {},
            error: { nodeId: first.nodeId, message: first.message },
        };
    }

    const { nodes, edges, inputEdges, initialResults, nodeIds } = executionPlan;
    const g = buildGraph(nodes, edges);
    const generations = topologicalGenerations(g) as string[][];
    const nodesById = new Map(nodes.map((n) => [n.id, n]));
    const results: Record<string, NodeRunResult> = { ...initialResults };

    for (let i = 0; i < generations.length; i += 1) {
        const gen = generations[i];

        const settled = await Promise.allSettled(
            gen.map((nodeId) =>
                runOne(
                    nodeId,
                    nodesById,
                    inputEdges,
                    results,
                    workspaceId,
                    workflowId,
                    deps,
                    callbacks,
                ),
            ),
        );

        const failedIdx = settled.findIndex((s) => s.status === "rejected");
        if (failedIdx !== -1) {
            const failed = settled[failedIdx] as PromiseRejectedResult;
            const failedNodeId = gen[failedIdx];
            const remainingGens = generations.slice(i + 1).flat();
            for (const id of remainingGens) callbacks?.onNodeBlocked?.(id);
            return {
                success: false,
                results: pickExecutedResults(results, nodeIds),
                error: {
                    nodeId: failedNodeId,
                    message: failed.reason instanceof Error ? failed.reason.message : String(failed.reason),
                },
            };
        }
    }

    return { success: true, results: pickExecutedResults(results, nodeIds) };
}

function pickExecutedResults(
    results: Record<string, NodeRunResult>,
    nodeIds: Set<string>,
): Record<string, NodeRunResult> {
    const picked: Record<string, NodeRunResult> = {};
    for (const [nodeId, result] of Object.entries(results)) {
        if (nodeIds.has(nodeId)) picked[nodeId] = result;
    }
    return picked;
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
        const inputs = collectInputs(node, edges, results);
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
            result =
                resp.type === "text"
                    ? { text: resp.text ?? "" }
                    : { url: resp.imageUrl };
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
    node: WorkflowNode,
    edges: WorkflowEdge[],
    results: Record<string, NodeRunResult>,
): ExecuteNodeRequest["inputs"] {
    const map: ExecuteNodeRequest["inputs"] = {};
    const definition = NODE_REGISTRY[node.type];
    for (const e of edges) {
        if (e.target !== node.id) continue;
        const upstream = results[e.source];
        const targetPort = definition.inputs.find((port) => port.id === e.targetHandle);
        if (targetPort?.multiple) {
            const current = map[e.targetHandle] ?? {};
            if (upstream?.url) {
                current.imageUrl ??= upstream.url;
                current.imageUrls = [...(current.imageUrls ?? []), upstream.url];
            }
            if (upstream?.text) {
                current.text ??= upstream.text;
                current.texts = [...(current.texts ?? []), upstream.text];
            }
            map[e.targetHandle] = current;
            continue;
        }

        if (upstream?.url) map[e.targetHandle] = { imageUrl: upstream.url };
        if (upstream?.text) map[e.targetHandle] = { text: upstream.text };
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
