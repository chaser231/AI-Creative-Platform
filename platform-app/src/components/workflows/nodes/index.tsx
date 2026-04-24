"use client";

import type { NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";

/**
 * Phase 2 registers 4 minimal placeholder components. Phase 3 will replace
 * these with richer renderers (inspector preview, icons, error/status badges).
 * The keys here must match `WorkflowNodeType` exactly — React Flow uses
 * `node.type` to look up the component.
 */

export function ImageInputNode({ id, selected }: NodeProps) {
    return <BaseNode id={id} type="imageInput" selected={selected} />;
}

export function ImageGenerationNode({ id, selected }: NodeProps) {
    return <BaseNode id={id} type="imageGeneration" selected={selected} />;
}

export function TextGenerationNode({ id, selected }: NodeProps) {
    return <BaseNode id={id} type="textGeneration" selected={selected} />;
}

export function RemoveBackgroundNode({ id, selected }: NodeProps) {
    return <BaseNode id={id} type="removeBackground" selected={selected} />;
}

export function AddReflectionNode({ id, selected }: NodeProps) {
    return <BaseNode id={id} type="addReflection" selected={selected} />;
}

export function MaskNode({ id, selected }: NodeProps) {
    return <BaseNode id={id} type="mask" selected={selected} />;
}

export function BlurNode({ id, selected }: NodeProps) {
    return <BaseNode id={id} type="blur" selected={selected} />;
}

export function PreviewNode({ id, selected }: NodeProps) {
    return <BaseNode id={id} type="preview" selected={selected} />;
}

export function AssetOutputNode({ id, selected }: NodeProps) {
    return <BaseNode id={id} type="assetOutput" selected={selected} />;
}

export const nodeTypes = {
    imageInput: ImageInputNode,
    imageGeneration: ImageGenerationNode,
    textGeneration: TextGenerationNode,
    removeBackground: RemoveBackgroundNode,
    addReflection: AddReflectionNode,
    mask: MaskNode,
    blur: BlurNode,
    preview: PreviewNode,
    assetOutput: AssetOutputNode,
} as const;
