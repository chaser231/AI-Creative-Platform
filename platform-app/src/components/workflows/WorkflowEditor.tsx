"use client";

/**
 * WorkflowEditor — xyflow canvas + (Phase 5) palette + (Phase 5) topbar.
 *
 * Wave 4 deliverable: canvas shell with Background/Controls/MiniMap.
 * Wave 5 adds NodePalette, NodeTopbar, nodeTypes map and onDrop wiring.
 */

import { useCallback, useMemo } from "react";
import {
    Background,
    Controls,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    addEdge,
    applyEdgeChanges,
    applyNodeChanges,
    type Connection,
    type Edge,
    type EdgeChange,
    type Node,
    type NodeChange,
    type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useWorkflowStore } from "@/store/workflow/useWorkflowStore";
import type { WorkflowEdge, WorkflowNode } from "@/server/workflow/types";

function toRFNode(n: WorkflowNode): Node {
    return {
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data.params as Record<string, unknown>,
    };
}

function toRFEdge(e: WorkflowEdge): Edge {
    return {
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle,
        target: e.target,
        targetHandle: e.targetHandle,
    };
}

function EditorCanvas() {
    const nodes = useWorkflowStore((s) => s.nodes);
    const edges = useWorkflowStore((s) => s.edges);
    const setViewport = useWorkflowStore((s) => s.setViewport);
    const viewport = useWorkflowStore((s) => s.viewport);

    // We intentionally keep React Flow as a controlled-ish component: it owns
    // transient drag/selection state, but node positions and edges persist in
    // our Zustand store so auto-save can snapshot them.
    const rfNodes = useMemo(() => nodes.map(toRFNode), [nodes]);
    const rfEdges = useMemo(() => edges.map(toRFEdge), [edges]);

    const onNodesChange = useCallback((changes: NodeChange[]) => {
        const state = useWorkflowStore.getState();
        const nextRFNodes = applyNodeChanges(changes, state.nodes.map(toRFNode));
        // Reconcile back into our WorkflowNode shape.
        const byId = new Map(state.nodes.map((n) => [n.id, n]));
        const nextNodes: WorkflowNode[] = nextRFNodes
            .map((rf) => {
                const orig = byId.get(rf.id);
                if (!orig) return null;
                return { ...orig, position: rf.position };
            })
            .filter((n): n is WorkflowNode => n !== null);
        useWorkflowStore.setState({ nodes: nextNodes, dirty: true });
    }, []);

    const onEdgesChange = useCallback((changes: EdgeChange[]) => {
        const state = useWorkflowStore.getState();
        const nextRF = applyEdgeChanges(changes, state.edges.map(toRFEdge));
        const nextEdges: WorkflowEdge[] = nextRF.map((e) => ({
            id: e.id,
            source: e.source,
            sourceHandle: e.sourceHandle ?? "",
            target: e.target,
            targetHandle: e.targetHandle ?? "",
        }));
        useWorkflowStore.setState({ edges: nextEdges, dirty: true });
    }, []);

    const onConnect = useCallback((params: Connection) => {
        const nextRF = addEdge(params, useWorkflowStore.getState().edges.map(toRFEdge));
        const nextEdges: WorkflowEdge[] = nextRF.map((e) => ({
            id: e.id,
            source: e.source,
            sourceHandle: e.sourceHandle ?? "",
            target: e.target,
            targetHandle: e.targetHandle ?? "",
        }));
        useWorkflowStore.setState({ edges: nextEdges, dirty: true });
    }, []);

    const onMove = useCallback(
        (_e: MouseEvent | TouchEvent | null, vp: Viewport) => setViewport(vp),
        [setViewport],
    );

    return (
        <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onMove={onMove}
            defaultViewport={viewport}
            fitView
            proOptions={{ hideAttribution: true }}
        >
            <Background gap={16} />
            <Controls />
            <MiniMap pannable zoomable />
        </ReactFlow>
    );
}

export function WorkflowEditor({ workflowId: _workflowId }: { workflowId: string }) {
    // workflowId is intentionally unused at this wave — it plumbs through to
    // the auto-save hook (Wave 5). Keeping the prop signature stable here
    // avoids churn in the shell component later.
    return (
        <div className="h-screen w-full">
            <ReactFlowProvider>
                <EditorCanvas />
            </ReactFlowProvider>
        </div>
    );
}
