/**
 * Workflow Store — composed Zustand state types.
 *
 * Slice breakdown (mirrors the `canvasStore` convention):
 *   - GraphSlice:    nodes, edges, dirty flag, graph CRUD, serialize/hydrate.
 *   - ViewportSlice: x, y, zoom of the React Flow canvas.
 *   - RunStateSlice: per-node run status stub (Phase 4 fills the real runtime).
 */

import type {
    WorkflowEdge,
    WorkflowGraph,
    WorkflowNode,
    WorkflowNodeType,
} from "@/server/workflow/types";
import type { WorkflowScenarioConfig } from "@/lib/workflow/scenarioConfig";

export type NodeRunStatus = "idle" | "running" | "done" | "error" | "blocked";

export interface GraphSlice {
    /** Graph nodes. Order is preserved from hydrate → client mutations. */
    nodes: WorkflowNode[];
    /** Graph edges. */
    edges: WorkflowEdge[];
    /** Workflow display name — editable in topbar. */
    name: string;
    /** Optional description — Phase 2 does not expose it in UI yet. */
    description: string;
    /** Optional scenario metadata for launching this workflow from banner/photo surfaces. */
    scenarioConfig: WorkflowScenarioConfig;
    /**
     * True when in-memory state has diverged from the last `hydrate(...)` or
     * the last confirmed save. Auto-save hook watches this flag.
     */
    dirty: boolean;

    // Actions ──────────────────────────────────────────
    setName: (name: string) => void;
    setDescription: (description: string) => void;
    setScenarioConfig: (scenarioConfig: WorkflowScenarioConfig) => void;
    addNode: (type: WorkflowNodeType, position: { x: number; y: number }) => string;
    updateNodePosition: (id: string, position: { x: number; y: number }) => void;
    updateNodeParams: (id: string, patch: Record<string, unknown>) => void;
    removeNode: (id: string) => void;
    connect: (edge: Omit<WorkflowEdge, "id">) => string;
    disconnect: (edgeId: string) => void;
    /** Convert in-memory state to the persistable graph shape. */
    serialize: () => WorkflowGraph;
    /** Replace in-memory state from a persisted graph. Clears `dirty`. */
    hydrate: (payload: {
        name?: string;
        description?: string;
        scenarioConfig?: WorkflowScenarioConfig;
        graph: WorkflowGraph;
    }) => void;
    /** Mark state as saved (called by auto-save hook on success). */
    markSaved: () => void;
}

export interface ViewportSlice {
    viewport: { x: number; y: number; zoom: number };
    setViewport: (vp: { x: number; y: number; zoom: number }) => void;
}

export interface NodeResult {
    url?: string;
    assetId?: string;
}

export interface RunStateSlice {
    runState: Record<string, NodeRunStatus>;
    /** Per-node executor result (last successful run). */
    runResults: Record<string, NodeResult>;
    /** Last user-facing error, if any. Cleared when a new run starts. */
    runError: { nodeId: string; message: string } | null;
    /** True while executor is mid-flight; UI uses this to lock interactions. */
    isRunning: boolean;
    setNodeRunStatus: (id: string, status: NodeRunStatus) => void;
    setNodeResult: (id: string, result: NodeResult) => void;
    setRunError: (err: { nodeId: string; message: string } | null) => void;
    setIsRunning: (v: boolean) => void;
    resetRunState: () => void;
}

export type WorkflowStore = GraphSlice & ViewportSlice & RunStateSlice;
