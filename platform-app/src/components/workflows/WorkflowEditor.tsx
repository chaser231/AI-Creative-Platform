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
    BackgroundVariant,
    Controls,
    PanOnScrollMode,
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
import {
    WorkflowRunControlsProvider,
    type WorkflowRunControlsContextValue,
} from "./WorkflowRunControlsContext";
import { nodeTypes } from "./nodes";
import { edgeTypes } from "./edges";

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(
        target.closest(
            "input, textarea, select, button, [contenteditable='true'], [role='textbox']",
        ),
    );
}

const LEFT_PANEL_CLEARANCE = 96;

function toRFNode(n: WorkflowNode): Node {
    return {
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data.params as Record<string, unknown>,
    };
}

function toRFEdge(
    e: WorkflowEdge,
    selectedEdgeId: string | null,
    onDetach: (edgeId: string) => void,
): Edge {
    return {
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle,
        target: e.target,
        targetHandle: e.targetHandle,
        type: "workflow",
        selected: e.id === selectedEdgeId,
        data: { onDetach },
    };
}

function toConnectableRFEdge(e: WorkflowEdge): Edge {
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
 * We mirror ThemeProvider's resolution so the canvas chrome follows the
 * global theme correctly.
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
    selectedEdgeId,
    onSelectNode,
    onSelectEdge,
    onClearSelection,
    colorMode,
    locked,
}: {
    selectedNodeId: string | null;
    selectedEdgeId: string | null;
    onSelectNode: (id: string | null) => void;
    onSelectEdge: (id: string | null) => void;
    onClearSelection: () => void;
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

    const detachEdge = useCallback(
        (edgeId: string) => {
            useWorkflowStore.getState().disconnect(edgeId);
            if (selectedEdgeId === edgeId) onSelectEdge(null);
        },
        [onSelectEdge, selectedEdgeId],
    );

    const rfNodes = useMemo(
        () =>
            nodes.map((n) => ({
                ...toRFNode(n),
                selected: n.id === selectedNodeId,
            })),
        [nodes, selectedNodeId],
    );
    const rfEdges = useMemo(
        () => edges.map((e) => toRFEdge(e, selectedEdgeId, detachEdge)),
        [detachEdge, edges, selectedEdgeId],
    );

    const onNodesChange = useCallback((changes: NodeChange[]) => {
        // Only persist changes that affect our serialized graph (position,
        // remove). React Flow also emits internal-only changes like
        // `dimensions` and `select`; if we round-tripped those through our
        // narrow WorkflowNode shape we'd strip the measurements RF needs to
        // actually paint the node, which is why nodes disappeared before.
        const state = useWorkflowStore.getState();
        let nextNodes = state.nodes;
        let mutated = false;
        const removedNodeIds: string[] = [];
        for (const ch of changes) {
            if (ch.type === "position" && ch.position) {
                nextNodes = nextNodes.map((n) =>
                    n.id === ch.id ? { ...n, position: ch.position! } : n,
                );
                mutated = true;
            } else if (ch.type === "remove") {
                removedNodeIds.push(ch.id);
            }
        }
        if (mutated) {
            useWorkflowStore.setState({ nodes: nextNodes, dirty: true });
        }
        for (const nodeId of removedNodeIds) {
            useWorkflowStore.getState().removeNode(nodeId);
        }
    }, []);

    const onEdgesChange = useCallback((changes: EdgeChange[]) => {
        // Same narrow round-trip rule as onNodesChange — only persist
        // remove/select-driven structural changes.
        for (const ch of changes) {
            if (ch.type === "remove") {
                useWorkflowStore.getState().disconnect(ch.id);
            }
        }
    }, []);

    const onConnect = useCallback((params: Connection) => {
        const state = useWorkflowStore.getState();
        const nextRF = addEdge(
            params,
            state.edges.map(toConnectableRFEdge),
        );
        if (nextRF.length === state.edges.length) return;
        const addedEdge = nextRF.find(
            (edge) => !state.edges.some((existing) => existing.id === edge.id),
        );
        if (!addedEdge?.source || !addedEdge.target) return;

        useWorkflowStore.getState().connect({
            source: addedEdge.source,
            sourceHandle: addedEdge.sourceHandle ?? "",
            target: addedEdge.target,
            targetHandle: addedEdge.targetHandle ?? "",
        });
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
            className="h-full w-full bg-bg-canvas"
            onDrop={onDrop}
            onDragOver={onDragOver}
        >
            <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                isValidConnection={isValidConn}
                onNodeClick={(_e, n) => onSelectNode(n.id)}
                onEdgeClick={(event, edge) => {
                    event.stopPropagation();
                    onSelectEdge(edge.id);
                }}
                onPaneClick={onClearSelection}
                onMove={onMove}
                defaultViewport={viewport}
                fitView
                colorMode={colorMode}
                nodesDraggable={!locked}
                nodesConnectable={!locked}
                elementsSelectable={!locked}
                deleteKeyCode={null}
                zoomOnScroll={false}
                panOnScroll
                panOnScrollMode={PanOnScrollMode.Free}
                zoomOnPinch
                zoomOnDoubleClick={false}
                className="workflow-flow"
                proOptions={{ hideAttribution: true }}
            >
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={18}
                    size={1.25}
                    color="var(--workflow-grid)"
                />
                <Controls
                    showInteractive={false}
                    position="bottom-left"
                    style={{ left: LEFT_PANEL_CLEARANCE, bottom: 16 }}
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
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    const [scenarioSettingsOpen, setScenarioSettingsOpen] = useState(false);
    const colorMode = useResolvedColorMode();
    const runError = useWorkflowStore((s) => s.runError);
    const {
        runAll,
        runNode,
        runNodeWithCachedInputs,
        isRunning,
        validationIssues,
        validationIssuesForNode,
        canRun,
    } = useWorkflowRun({
        workspaceId: currentWorkspace?.id,
        workflowId,
    });

    const selectNode = useCallback((id: string | null) => {
        setSelectedNodeId(id);
        if (id) setSelectedEdgeId(null);
    }, []);

    const selectEdge = useCallback((id: string | null) => {
        setSelectedEdgeId(id);
        if (id) setSelectedNodeId(null);
    }, []);

    const clearSelection = useCallback(() => {
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
    }, []);

    const detachEdge = useCallback((edgeId: string) => {
        useWorkflowStore.getState().disconnect(edgeId);
        setSelectedEdgeId((current) => (current === edgeId ? null : current));
    }, []);

    const createNode = useCallback((type: WorkflowNodeType) => {
        const store = useWorkflowStore.getState();
        const rightmostX =
            store.nodes.length > 0
                ? Math.max(...store.nodes.map((node) => node.position.x)) + 280
                : 120;
        const topY =
            store.nodes.length > 0
                ? Math.min(...store.nodes.map((node) => node.position.y))
                : 120;
        const id = store.addNode(type, { x: rightmostX, y: topY });
        setSelectedNodeId(id);
        setSelectedEdgeId(null);
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || isEditableTarget(event.target) || isRunning) {
                return;
            }
            if (event.key !== "Backspace" && event.key !== "Delete") return;

            if (selectedEdgeId) {
                event.preventDefault();
                detachEdge(selectedEdgeId);
                return;
            }

            if (selectedNodeId) {
                event.preventDefault();
                useWorkflowStore.getState().removeNode(selectedNodeId);
                setSelectedNodeId(null);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [detachEdge, isRunning, selectedEdgeId, selectedNodeId]);

    const runDisabledReason = !currentWorkspace?.id
        ? "Нет активного workspace"
        : validationIssues[0]?.message;
    const getNodeRunDisabledReason = useCallback(
        (nodeId: string) => {
            if (!currentWorkspace?.id) return "Нет активного workspace";
            if (isRunning) return "Workflow уже выполняется";
            return validationIssuesForNode(nodeId)[0]?.message;
        },
        [currentWorkspace?.id, isRunning, validationIssuesForNode],
    );
    const getNodeCachedRunDisabledReason = useCallback(
        (nodeId: string) => {
            if (!currentWorkspace?.id) return "Нет активного workspace";
            if (isRunning) return "Workflow уже выполняется";
            return validationIssuesForNode(nodeId, "cached-inputs")[0]?.message;
        },
        [currentWorkspace?.id, isRunning, validationIssuesForNode],
    );
    const runControls = useMemo<WorkflowRunControlsContextValue>(
        () => ({
            runNode,
            runNodeWithCachedInputs,
            getNodeRunDisabledReason,
            getNodeCachedRunDisabledReason,
            isRunning,
        }),
        [
            getNodeCachedRunDisabledReason,
            getNodeRunDisabledReason,
            isRunning,
            runNode,
            runNodeWithCachedInputs,
        ],
    );

    return (
        <div className="flex h-screen w-full flex-col overflow-hidden bg-bg-primary text-text-primary">
            <NodeTopbar
                name={name}
                onNameChange={setName}
                onSave={saveNow}
                saveStatus={status}
                onRun={runAll}
                canRun={canRun}
                isRunning={isRunning}
                runError={runError}
                runDisabledReason={runDisabledReason}
                scenarioEnabled={scenarioEnabled}
                onOpenScenarioSettings={() => setScenarioSettingsOpen(true)}
            />
            <ReactFlowProvider>
                <WorkflowRunControlsProvider value={runControls}>
                    <div className="relative min-h-0 flex-1 overflow-hidden bg-bg-canvas">
                        <div className="absolute inset-0">
                            <EditorCanvas
                                selectedNodeId={selectedNodeId}
                                selectedEdgeId={selectedEdgeId}
                                onSelectNode={selectNode}
                                onSelectEdge={selectEdge}
                                onClearSelection={clearSelection}
                                colorMode={colorMode}
                                locked={isRunning}
                            />
                        </div>
                        <NodePalette onCreateNode={createNode} />
                        <NodeInspector
                            selectedNodeId={selectedNodeId}
                            selectedEdgeId={selectedEdgeId}
                            onDetachEdge={detachEdge}
                        />
                    </div>
                </WorkflowRunControlsProvider>
            </ReactFlowProvider>
            <WorkflowScenarioSettingsModal
                open={scenarioSettingsOpen}
                onClose={() => setScenarioSettingsOpen(false)}
            />
        </div>
    );
}
