import { describe, it, expect, beforeEach } from "vitest";
import { useWorkflowStore } from "@/store/workflow/useWorkflowStore";
import { workflowGraphSchema, emptyWorkflowGraph } from "@/lib/workflow/graphSchema";
import type { WorkflowGraph } from "@/server/workflow/types";

// Zustand v5 stores retain state across tests; reset manually at the top.
function resetStore() {
    useWorkflowStore.setState({
        nodes: [],
        edges: [],
        name: "",
        description: "",
        dirty: false,
        viewport: { x: 0, y: 0, zoom: 1 },
        runState: {},
    });
}

describe("useWorkflowStore — graph slice", () => {
    beforeEach(() => {
        resetStore();
    });

    it("addNode pushes a node with defaultParams from NODE_REGISTRY", () => {
        const id = useWorkflowStore.getState().addNode("addReflection", { x: 5, y: 10 });
        const state = useWorkflowStore.getState();

        expect(state.nodes).toHaveLength(1);
        expect(state.nodes[0].id).toBe(id);
        expect(state.nodes[0].type).toBe("addReflection");
        expect(state.nodes[0].position).toEqual({ x: 5, y: 10 });
        // defaultParams for addReflection in NODE_REGISTRY (see types.ts).
        expect(state.nodes[0].data.params).toEqual({ style: "subtle", intensity: 0.3 });
        expect(state.dirty).toBe(true);
    });

    it("connect stores an edge with the provided handles + dirty flag", () => {
        const a = useWorkflowStore.getState().addNode("imageInput", { x: 0, y: 0 });
        const b = useWorkflowStore.getState().addNode("removeBackground", { x: 100, y: 0 });
        useWorkflowStore.getState().markSaved();
        expect(useWorkflowStore.getState().dirty).toBe(false);

        const edgeId = useWorkflowStore.getState().connect({
            source: a,
            sourceHandle: "image-out",
            target: b,
            targetHandle: "image-in",
        });

        const state = useWorkflowStore.getState();
        expect(state.edges).toHaveLength(1);
        expect(state.edges[0]).toEqual({
            id: edgeId,
            source: a,
            sourceHandle: "image-out",
            target: b,
            targetHandle: "image-in",
        });
        expect(state.dirty).toBe(true);
    });

    it("removeNode cascades to edges that reference the node", () => {
        const a = useWorkflowStore.getState().addNode("imageInput", { x: 0, y: 0 });
        const b = useWorkflowStore.getState().addNode("removeBackground", { x: 100, y: 0 });
        const c = useWorkflowStore.getState().addNode("assetOutput", { x: 200, y: 0 });

        useWorkflowStore.getState().connect({
            source: a,
            sourceHandle: "image-out",
            target: b,
            targetHandle: "image-in",
        });
        useWorkflowStore.getState().connect({
            source: b,
            sourceHandle: "image-out",
            target: c,
            targetHandle: "image-in",
        });

        useWorkflowStore.getState().removeNode(b);
        const state = useWorkflowStore.getState();

        expect(state.nodes.map((n) => n.id)).toEqual([a, c]);
        // Both edges referenced `b` (one as target, one as source) → both removed.
        expect(state.edges).toHaveLength(0);
    });

    it("serialize() returns a schema-valid WorkflowGraph", () => {
        useWorkflowStore.getState().addNode("imageInput", { x: 0, y: 0 });
        const serialized = useWorkflowStore.getState().serialize();

        expect(serialized.version).toBe(1);
        const parsed = workflowGraphSchema.safeParse(serialized);
        expect(parsed.success).toBe(true);
    });

    it("hydrate replaces nodes/edges and clears dirty", () => {
        useWorkflowStore.getState().addNode("imageInput", { x: 0, y: 0 });
        expect(useWorkflowStore.getState().dirty).toBe(true);

        const graph: WorkflowGraph = {
            version: 1,
            nodes: [
                {
                    id: "n-hydrated",
                    type: "assetOutput",
                    position: { x: 99, y: 99 },
                    data: { params: {} },
                },
            ],
            edges: [],
        };
        useWorkflowStore.getState().hydrate({ name: "From DB", graph });

        const state = useWorkflowStore.getState();
        expect(state.nodes).toHaveLength(1);
        expect(state.nodes[0].id).toBe("n-hydrated");
        expect(state.name).toBe("From DB");
        expect(state.dirty).toBe(false);
    });

    it("updateNodeParams only patches requested keys", () => {
        const id = useWorkflowStore.getState().addNode("addReflection", { x: 0, y: 0 });
        useWorkflowStore.getState().updateNodeParams(id, { intensity: 0.7 });

        const node = useWorkflowStore.getState().nodes.find((n) => n.id === id);
        expect(node?.data.params).toEqual({ style: "subtle", intensity: 0.7 });
    });

    it("emptyWorkflowGraph round-trips through hydrate → serialize", () => {
        const empty = emptyWorkflowGraph();
        useWorkflowStore.getState().hydrate({ graph: empty });
        expect(useWorkflowStore.getState().serialize()).toEqual(empty);
    });
});
