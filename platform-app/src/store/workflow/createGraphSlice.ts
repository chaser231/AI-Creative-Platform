import type { StateCreator } from "zustand";
import { NODE_REGISTRY } from "@/server/workflow/types";
import type { WorkflowEdge, WorkflowNode } from "@/server/workflow/types";
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

export const createGraphSlice: StateCreator<WorkflowStore, [], [], GraphSlice> = (set, get) => ({
    nodes: [],
    edges: [],
    name: "",
    description: "",
    dirty: false,

    setName: (name) => set({ name, dirty: true }),

    setDescription: (description) => set({ description, dirty: true }),

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
            dirty: true,
        }));
    },

    removeNode: (id) => {
        set((state) => ({
            nodes: state.nodes.filter((n) => n.id !== id),
            // Cascade: drop any edge that references the removed node.
            edges: state.edges.filter((e) => e.source !== id && e.target !== id),
            dirty: true,
        }));
    },

    connect: (edge) => {
        const id = makeId("edge");
        const newEdge: WorkflowEdge = { id, ...edge };
        set((state) => ({ edges: [...state.edges, newEdge], dirty: true }));
        return id;
    },

    disconnect: (edgeId) => {
        set((state) => ({
            edges: state.edges.filter((e) => e.id !== edgeId),
            dirty: true,
        }));
    },

    serialize: () => {
        const { nodes, edges } = get();
        return { version: 1, nodes, edges };
    },

    hydrate: ({ name, description, graph }) => {
        set({
            nodes: graph.nodes,
            edges: graph.edges,
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            dirty: false,
        });
    },

    markSaved: () => set({ dirty: false }),
});
