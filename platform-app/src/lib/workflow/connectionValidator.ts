/**
 * isValidConnection — pure compatibility check between two ports.
 *
 * Used by `<ReactFlow isValidConnection={...}>` to block bad drops; xyflow
 * renders its built-in invalid-connection visual (red stroke during drag,
 * no edge created on drop).
 *
 * Rules:
 * - Both source and target nodes must exist in `nodes`.
 * - Both port ids must exist on the resolved node definitions.
 * - PortType "any" matches everything; otherwise types must equal.
 *
 * Phase 3, Wave 3 — REQ-11, D-18 in 03-CONTEXT.md.
 */

import type { Connection } from "@xyflow/react";
import type { WorkflowNode } from "@/server/workflow/types";
import { NODE_REGISTRY } from "@/server/workflow/types";

export function isValidConnection(
    connection: Connection,
    nodes: WorkflowNode[],
): boolean {
    const source = nodes.find((n) => n.id === connection.source);
    const target = nodes.find((n) => n.id === connection.target);
    if (!source || !target) return false;

    const sourcePort = NODE_REGISTRY[source.type].outputs.find(
        (p) => p.id === connection.sourceHandle,
    );
    const targetPort = NODE_REGISTRY[target.type].inputs.find(
        (p) => p.id === connection.targetHandle,
    );
    if (!sourcePort || !targetPort) return false;

    if (sourcePort.type === "any" || targetPort.type === "any") return true;
    return sourcePort.type === targetPort.type;
}
