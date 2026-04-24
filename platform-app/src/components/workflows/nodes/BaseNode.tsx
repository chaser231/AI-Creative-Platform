"use client";

/**
 * BaseNode — visual shell for the four node types. Pulls run-state from the
 * workflow store so the canvas reflects executor progress live (Phase 4).
 */

import { Handle, Position } from "@xyflow/react";
import { AlertCircle, Check, Loader2, MinusCircle } from "lucide-react";
import { NODE_REGISTRY, type WorkflowNodeType } from "@/server/workflow/types";
import { useWorkflowStore } from "@/store/workflow/useWorkflowStore";
import type { NodeRunStatus } from "@/store/workflow/types";

interface BaseNodeProps {
    id: string;
    type: WorkflowNodeType;
    selected?: boolean;
}

const CATEGORY_ACCENT: Record<"input" | "ai" | "transform" | "output", string> = {
    input: "border-l-emerald-400",
    ai: "border-l-violet-400",
    transform: "border-l-sky-400",
    output: "border-l-amber-400",
};

const STATUS_RING: Record<NodeRunStatus, string> = {
    idle: "",
    running: "ring-2 ring-status-progress",
    done: "ring-2 ring-status-published",
    error: "ring-2 ring-red-500",
    blocked: "ring-2 ring-text-tertiary opacity-60",
};

function StatusBadge({ status }: { status: NodeRunStatus }) {
    if (status === "running")
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-status-progress" />;
    if (status === "done")
        return <Check className="h-3.5 w-3.5 text-status-published" />;
    if (status === "error")
        return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
    if (status === "blocked")
        return <MinusCircle className="h-3.5 w-3.5 text-text-tertiary" />;
    return null;
}

export function BaseNode({ id, type, selected }: BaseNodeProps) {
    const definition = NODE_REGISTRY[type];
    const accent = CATEGORY_ACCENT[definition.category];
    const status = useWorkflowStore((s) => s.runState[id] ?? "idle");
    const result = useWorkflowStore((s) => s.runResults[id]);
    const runError = useWorkflowStore((s) => s.runError);
    const errorMessage = runError?.nodeId === id ? runError.message : undefined;

    return (
        <div
            className={[
                "min-w-[180px] rounded-md border border-border-primary border-l-4 bg-bg-surface px-3 py-2 text-text-primary shadow-sm transition",
                accent,
                STATUS_RING[status],
                selected && status === "idle" ? "ring-2 ring-border-focus" : "",
            ].join(" ")}
            title={errorMessage}
        >
            <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] uppercase tracking-wide text-text-tertiary">
                    {definition.category}
                </div>
                <StatusBadge status={status} />
            </div>
            <div className="mt-0.5 text-sm font-medium">
                {definition.displayName}
            </div>

            {result?.url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                    src={result.url}
                    alt=""
                    className="mt-2 h-12 w-full rounded border border-border-primary object-cover"
                />
            )}

            {definition.inputs.map((port, idx) => (
                <Handle
                    key={port.id}
                    type="target"
                    position={Position.Left}
                    id={port.id}
                    data-port-type={port.type}
                    style={{ top: `${30 + idx * 16}px`, background: "#6366f1" }}
                />
            ))}

            {definition.outputs.map((port, idx) => (
                <Handle
                    key={port.id}
                    type="source"
                    position={Position.Right}
                    id={port.id}
                    data-port-type={port.type}
                    style={{ top: `${30 + idx * 16}px`, background: "#6366f1" }}
                />
            ))}
        </div>
    );
}
