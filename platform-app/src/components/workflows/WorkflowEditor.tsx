"use client";

/**
 * WorkflowEditor — full editor: palette (left) + canvas (center) + topbar
 * (top) with auto-save wired to Zustand store.
 *
 * Wave 5 adds:
 *   - nodeTypes map so RF renders our placeholder cards.
 *   - HTML5 drag-drop from palette → canvas via application/reactflow MIME.
 *   - NodeTopbar with name editing + Save button + auto-save status.
 *   - useWorkflowAutoSave hook bound to workflowId/workspaceId.
 */

import { useCallback, useMemo, useRef } from "react";
import {
    Background,
    Controls,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    addEdge,
    applyEdgeChanges,
    applyNodeChanges,
    useReactFlow,
    type Connection,
    type Edge,
    type EdgeChange,
    type Node,
    type NodeChange,
    type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useWorkflowStore } from "@/store/workflow/useWorkflowStore";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { useWorkflowAutoSave } from "@/hooks/workflow/useWorkflowAutoSave";
import type { WorkflowEdge, WorkflowNode, WorkflowNodeType } from "@/server/workflow/types";
import { NodePalette } from "./NodePalette";
import { NodeTopbar } from "./NodeTopbar";
import { nodeTypes } from "./nodes";

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
    const addNode = useWorkflowStore((s) => s.addNode);
    const setViewport = useWorkflowStore((s) => s.setViewport);
    const viewport = useWorkflowStore((s) => s.viewport);

    const wrapperRef = useRef<HTMLDivElement>(null);
    const { screenToFlowPosition } = useReactFlow();

    const rfNodes = useMemo(() => nodes.map(toRFNode), [nodes]);
    const rfEdges = useMemo(() => edges.map(toRFEdge), [edges]);

    const onNodesChange = useCallback((changes: NodeChange[]) => {
        const state = useWorkflowStore.getState();
        const nextRF = applyNodeChanges(changes, state.nodes.map(toRFNode));
        const byId = new Map(state.nodes.map((n) => [n.id, n]));
        const nextNodes: WorkflowNode[] = nextRF
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

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
    }, []);

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();
            const raw = event.dataTransfer.getData("application/reactflow");
            if (!raw) return;
            const type = raw as WorkflowNodeType;
            const position = screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });
            addNode(type, position);
        },
        [addNode, screenToFlowPosition],
    );

    return (
        <div ref={wrapperRef} className="h-full w-full">
            <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onMove={onMove}
                onDrop={onDrop}
                onDragOver={onDragOver}
                defaultViewport={viewport}
                fitView
                proOptions={{ hideAttribution: true }}
            >
                <Background gap={16} />
                <Controls />
                <MiniMap pannable zoomable />
            </ReactFlow>
        </div>
    );
}

export function WorkflowEditor({ workflowId }: { workflowId: string }) {
    const name = useWorkflowStore((s) => s.name);
    const setName = useWorkflowStore((s) => s.setName);
    const { currentWorkspace } = useWorkspace();
    const { status, saveNow } = useWorkflowAutoSave({
        workflowId,
        workspaceId: currentWorkspace?.id,
    });

    return (
        <div className="flex h-screen w-full flex-col bg-neutral-50 dark:bg-neutral-950">
            <NodeTopbar
                name={name}
                onNameChange={setName}
                onSave={saveNow}
                saveStatus={status}
            />
            <div className="flex min-h-0 flex-1">
                <ReactFlowProvider>
                    <NodePalette />
                    <div className="min-w-0 flex-1">
                        <EditorCanvas />
                    </div>
                </ReactFlowProvider>
            </div>
        </div>
    );
}
