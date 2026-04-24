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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Background,
    Controls,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    addEdge,
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
import { useThemeStore } from "@/store/themeStore";
import { useWorkflowAutoSave } from "@/hooks/workflow/useWorkflowAutoSave";
import { useWorkflowRun } from "@/hooks/workflow/useWorkflowRun";
import { isValidConnection as validateWorkflowConnection } from "@/lib/workflow/connectionValidator";
import type { WorkflowEdge, WorkflowNode, WorkflowNodeType } from "@/server/workflow/types";
import { NodePalette } from "./NodePalette";
import { NodeTopbar } from "./NodeTopbar";
import { NodeInspector } from "./NodeInspector";
import { WorkflowScenarioSettingsModal } from "./WorkflowScenarioSettingsModal";
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

/**
 * Resolves the effective light/dark mode for xyflow's `colorMode` prop.
 * The store holds 'system'|'light'|'dark'; xyflow needs a concrete value.
 * We mirror ThemeProvider's resolution so the canvas chrome (Background,
 * Controls, MiniMap) follows the global theme correctly.
 */
function useResolvedColorMode(): "light" | "dark" {
    const theme = useThemeStore((s) => s.theme);
    const [systemDark, setSystemDark] = useState(() => {
        if (typeof window === "undefined") return false;
        return window.matchMedia("(prefers-color-scheme: dark)").matches;
    });

    useEffect(() => {
        if (theme !== "system") return;
        if (typeof window === "undefined") return;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, [theme]);

    if (theme === "dark") return "dark";
    if (theme === "light") return "light";
    return systemDark ? "dark" : "light";
}

function EditorCanvas({
    selectedNodeId,
    onSelectNode,
    colorMode,
    locked,
}: {
    selectedNodeId: string | null;
    onSelectNode: (id: string | null) => void;
    colorMode: "light" | "dark";
    locked: boolean;
}) {
    const nodes = useWorkflowStore((s) => s.nodes);
    const edges = useWorkflowStore((s) => s.edges);
    const addNode = useWorkflowStore((s) => s.addNode);
    const setViewport = useWorkflowStore((s) => s.setViewport);
    const viewport = useWorkflowStore((s) => s.viewport);

    const wrapperRef = useRef<HTMLDivElement>(null);
    const { screenToFlowPosition } = useReactFlow();

    const rfNodes = useMemo(
        () =>
            nodes.map((n) => ({
                ...toRFNode(n),
                selected: n.id === selectedNodeId,
            })),
        [nodes, selectedNodeId],
    );
    const rfEdges = useMemo(() => edges.map(toRFEdge), [edges]);

    const onNodesChange = useCallback((changes: NodeChange[]) => {
        // Only persist changes that affect our serialized graph (position,
        // remove). React Flow also emits internal-only changes like
        // `dimensions` and `select`; if we round-tripped those through our
        // narrow WorkflowNode shape we'd strip the measurements RF needs to
        // actually paint the node, which is why nodes disappeared before.
        const state = useWorkflowStore.getState();
        let nextNodes = state.nodes;
        let mutated = false;
        for (const ch of changes) {
            if (ch.type === "position" && ch.position) {
                nextNodes = nextNodes.map((n) =>
                    n.id === ch.id ? { ...n, position: ch.position! } : n,
                );
                mutated = true;
            } else if (ch.type === "remove") {
                nextNodes = nextNodes.filter((n) => n.id !== ch.id);
                mutated = true;
            }
        }
        if (mutated) {
            useWorkflowStore.setState({ nodes: nextNodes, dirty: true });
        }
    }, []);

    const onEdgesChange = useCallback((changes: EdgeChange[]) => {
        // Same narrow round-trip rule as onNodesChange — only persist
        // remove/select-driven structural changes.
        const state = useWorkflowStore.getState();
        let nextEdges = state.edges;
        let mutated = false;
        for (const ch of changes) {
            if (ch.type === "remove") {
                nextEdges = nextEdges.filter((e) => e.id !== ch.id);
                mutated = true;
            }
        }
        if (mutated) {
            useWorkflowStore.setState({ edges: nextEdges, dirty: true });
        }
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

    const isValidConn = useCallback(
        (edgeOrConnection: Edge | Connection) => {
            const c: Connection = {
                source: edgeOrConnection.source,
                target: edgeOrConnection.target,
                sourceHandle: edgeOrConnection.sourceHandle ?? null,
                targetHandle: edgeOrConnection.targetHandle ?? null,
            };
            return validateWorkflowConnection(c, useWorkflowStore.getState().nodes);
        },
        [],
    );

    return (
        <div
            ref={wrapperRef}
            className="h-full w-full"
            onDrop={onDrop}
            onDragOver={onDragOver}
        >
            <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                isValidConnection={isValidConn}
                onNodeClick={(_e, n) => onSelectNode(n.id)}
                onPaneClick={() => onSelectNode(null)}
                onMove={onMove}
                defaultViewport={viewport}
                fitView
                colorMode={colorMode}
                nodesDraggable={!locked}
                nodesConnectable={!locked}
                elementsSelectable={!locked}
                proOptions={{ hideAttribution: true }}
            >
                <Background
                    gap={16}
                    color={colorMode === "dark" ? "#27282D" : "#E2E8F0"}
                />
                <Controls />
                <MiniMap
                    pannable
                    zoomable
                    maskColor={
                        colorMode === "dark"
                            ? "rgba(11,12,16,0.6)"
                            : "rgba(241,245,249,0.6)"
                    }
                    style={{
                        background: colorMode === "dark" ? "#18191E" : "#FFFFFF",
                        border: `1px solid ${colorMode === "dark" ? "#27282D" : "#E2E8F0"}`,
                    }}
                />
            </ReactFlow>
        </div>
    );
}

export function WorkflowEditor({ workflowId }: { workflowId: string }) {
    const name = useWorkflowStore((s) => s.name);
    const setName = useWorkflowStore((s) => s.setName);
    const scenarioEnabled = useWorkflowStore((s) => s.scenarioConfig.enabled);
    const { currentWorkspace } = useWorkspace();
    const { status, saveNow } = useWorkflowAutoSave({
        workflowId,
        workspaceId: currentWorkspace?.id,
    });

    // Selection lives in editor scope, not in zustand: it's purely a UI
    // concern (which inspector tab to show) and shouldn't survive serialization.
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [scenarioSettingsOpen, setScenarioSettingsOpen] = useState(false);
    const colorMode = useResolvedColorMode();
    const runError = useWorkflowStore((s) => s.runError);
    const { runAll, isRunning, validationIssues, canRun } = useWorkflowRun({
        workspaceId: currentWorkspace?.id,
        workflowId,
    });

    return (
        <div className="flex h-screen w-full flex-col bg-bg-primary text-text-primary">
            <NodeTopbar
                name={name}
                onNameChange={setName}
                onSave={saveNow}
                saveStatus={status}
                onRun={runAll}
                canRun={canRun}
                isRunning={isRunning}
                runError={runError}
                runDisabledReason={validationIssues[0]?.message}
                scenarioEnabled={scenarioEnabled}
                onOpenScenarioSettings={() => setScenarioSettingsOpen(true)}
            />
            <div className="flex min-h-0 flex-1">
                <ReactFlowProvider>
                    <NodePalette />
                    <div className="min-w-0 flex-1">
                        <EditorCanvas
                            selectedNodeId={selectedNodeId}
                            onSelectNode={setSelectedNodeId}
                            colorMode={colorMode}
                            locked={isRunning}
                        />
                    </div>
                    <NodeInspector selectedNodeId={selectedNodeId} />
                </ReactFlowProvider>
            </div>
            <WorkflowScenarioSettingsModal
                open={scenarioSettingsOpen}
                onClose={() => setScenarioSettingsOpen(false)}
            />
        </div>
    );
}
