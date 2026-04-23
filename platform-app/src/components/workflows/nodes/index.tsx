"use client";

import type { NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

/**
 * Phase 2 registers 4 minimal placeholder components. Phase 3 will replace
 * these with richer renderers (inspector preview, icons, error/status badges).
 * The keys here must match `WorkflowNodeType` exactly — React Flow uses
 * `node.type` to look up the component.
 */

export function ImageInputNode({ selected }: NodeProps) {
    return <BaseNode type="imageInput" selected={selected} />;
}

export function RemoveBackgroundNode({ selected }: NodeProps) {
    return <BaseNode type="removeBackground" selected={selected} />;
}

export function AddReflectionNode({ selected }: NodeProps) {
    return <BaseNode type="addReflection" selected={selected} />;
}

export function AssetOutputNode({ selected }: NodeProps) {
    return <BaseNode type="assetOutput" selected={selected} />;
}

export const nodeTypes = {
    imageInput: ImageInputNode,
    removeBackground: RemoveBackgroundNode,
    addReflection: AddReflectionNode,
    assetOutput: AssetOutputNode,
} as const;
