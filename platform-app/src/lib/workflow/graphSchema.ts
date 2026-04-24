/**
 * WorkflowGraph Zod schema — shared validation between client and server.
 *
 * Phase 2 consumers:
 * - tRPC `workflowRouter.saveGraph` input validation.
 * - `useWorkflowStore.serialize()` round-trip assertion in tests.
 * - Future: client-side guard before auto-save POST.
 */

import { z } from "zod";
import type {
    WorkflowGraph,
    WorkflowNode,
    WorkflowEdge,
    WorkflowNodeType,
} from "@/server/workflow/types";

const workflowNodeTypeSchema = z.enum([
    "imageInput",
    "removeBackground",
    "addReflection",
    "mask",
    "blur",
    "preview",
    "assetOutput",
]) satisfies z.ZodType<WorkflowNodeType>;

export const workflowNodeSchema = z.object({
    id: z.string().min(1),
    type: workflowNodeTypeSchema,
    position: z.object({ x: z.number(), y: z.number() }),
    data: z.object({
        params: z.record(z.string(), z.unknown()),
    }),
}) satisfies z.ZodType<WorkflowNode>;

export const workflowEdgeSchema = z.object({
    id: z.string().min(1),
    source: z.string().min(1),
    sourceHandle: z.string().min(1),
    target: z.string().min(1),
    targetHandle: z.string().min(1),
}) satisfies z.ZodType<WorkflowEdge>;

export const workflowGraphSchema = z.object({
    version: z.literal(1),
    nodes: z.array(workflowNodeSchema),
    edges: z.array(workflowEdgeSchema),
}) satisfies z.ZodType<WorkflowGraph>;

/** Fresh empty graph — used by `saveGraph` default and "New workflow" flow. */
export function emptyWorkflowGraph(): WorkflowGraph {
    return { version: 1, nodes: [], edges: [] };
}
