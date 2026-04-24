import type { StateCreator } from "zustand";
import { NODE_REGISTRY } from "@/server/workflow/types";
import type { WorkflowEdge, WorkflowNode } from "@/server/workflow/types";
import { defaultWorkflowScenarioConfig } from "@/lib/workflow/scenarioConfig";
import type { GraphSlice, WorkflowStore } from "./types";

/**
 * Generate a short collision-resistant id. We avoid `crypto.randomUUID()`
 * in tests (not always available on jsdom/node stable) and keep the format
 * compatible with React Flow's expected string ids.
 */
function makeId(prefix: "node" | "edge"): string {
    const rand = Math.random().toString(36).slice(2, 10);
    const ts = Date.now().toString(36);
    return `${prefix}-${ts}-${rand}`;
}

function collectDownstreamNodeIds(seedNodeIds: Iterable<string>, edges: WorkflowEdge[]): Set<string> {
    const visited = new Set<string>();
    const stack = Array.from(seedNodeIds);

    while (stack.length > 0) {
        const current = stack.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);

        for (const edge of edges) {
            if (edge.source === current && !visited.has(edge.target)) {
                stack.push(edge.target);
            }
        }
    }

    return visited;
}

function clearCachedRunOutputs(
    state: WorkflowStore,
    seedNodeIds: Iterable<string>,
    edges: WorkflowEdge[] = state.edges,
): Pick<WorkflowStore, "runState" | "runResults"> {
    const staleNodeIds = collectDownstreamNodeIds(seedNodeIds, edges);
    if (staleNodeIds.size === 0) {
        return { runState: state.runState, runResults: state.runResults };
    }

    const runState = { ...state.runState };
    const runResults = { ...state.runResults };

    for (const nodeId of staleNodeIds) {
        delete runResults[nodeId];
        if (runState[nodeId]) runState[nodeId] = "idle";
    }

    return { runState, runResults };
}

export const createGraphSlice: StateCreator<WorkflowStore, [], [], GraphSlice> = (set, get) => ({
    nodes: [],
    edges: [],
    name: "",
    description: "",
    scenarioConfig: defaultWorkflowScenarioConfig(),
    dirty: false,

    setName: (name) => set({ name, dirty: true }),

    setDescription: (description) => set({ description, dirty: true }),

    setScenarioConfig: (scenarioConfig) => set({ scenarioConfig, dirty: true }),

    addNode: (type, position) => {
        const definition = NODE_REGISTRY[type];
        const id = makeId("node");
        const node: WorkflowNode = {
            id,
            type,
            position,
            // Deep-copy defaultParams so mutations on one node instance can't
            // leak into the registry prototype or other nodes of the same type.
            data: { params: { ...definition.defaultParams } },
        };
        set((state) => ({ nodes: [...state.nodes, node], dirty: true }));
        return id;
    },

    updateNodePosition: (id, position) => {
        set((state) => ({
            nodes: state.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
            dirty: true,
        }));
    },

    updateNodeParams: (id, patch) => {
        set((state) => ({
            nodes: state.nodes.map((n) =>
                n.id === id ? { ...n, data: { params: { ...n.data.params, ...patch } } } : n,
            ),
            ...clearCachedRunOutputs(state, [id]),
            dirty: true,
        }));
    },

    removeNode: (id) => {
        set((state) => ({
            nodes: state.nodes.filter((n) => n.id !== id),
            // Cascade: drop any edge that references the removed node.
            edges: state.edges.filter((e) => e.source !== id && e.target !== id),
            ...clearCachedRunOutputs(state, [id]),
            dirty: true,
        }));
    },

    connect: (edge) => {
        const id = makeId("edge");
        const newEdge: WorkflowEdge = { id, ...edge };
        set((state) => {
            const nextEdges = [...state.edges, newEdge];
            return {
                edges: nextEdges,
                ...clearCachedRunOutputs(state, [edge.target], nextEdges),
                dirty: true,
            };
        });
        return id;
    },

    disconnect: (edgeId) => {
        set((state) => {
            const removedEdge = state.edges.find((e) => e.id === edgeId);
            return {
                edges: state.edges.filter((e) => e.id !== edgeId),
                ...(removedEdge
                    ? clearCachedRunOutputs(state, [removedEdge.target])
                    : {}),
                dirty: true,
            };
        });
    },

    serialize: () => {
        const { nodes, edges } = get();
        return { version: 1, nodes, edges };
    },

    hydrate: ({ name, description, scenarioConfig, graph }) => {
        set({
            nodes: graph.nodes,
            edges: graph.edges,
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            scenarioConfig:
                scenarioConfig ??
                defaultWorkflowScenarioConfig(name ?? get().name),
            runState: {},
            runResults: {},
            runError: null,
            isRunning: false,
            dirty: false,
        });
    },

    markSaved: () => set({ dirty: false }),
});
