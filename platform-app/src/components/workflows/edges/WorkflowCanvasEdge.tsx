"use client";

import {
    BaseEdge,
    EdgeLabelRenderer,
    getBezierPath,
    type EdgeProps,
} from "@xyflow/react";
import { Unlink2 } from "lucide-react";

type WorkflowEdgeData = {
    onDetach?: (edgeId: string) => void;
};

export function WorkflowCanvasEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    selected,
    data,
}: EdgeProps) {
    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    });
    const edgeData = data as WorkflowEdgeData | undefined;

    return (
        <>
            <BaseEdge
                path={edgePath}
                markerEnd={markerEnd}
                interactionWidth={22}
                style={{
                    stroke: selected
                        ? "var(--workflow-edge-selected)"
                        : "var(--workflow-edge)",
                    strokeWidth: selected ? 2.75 : 1.75,
                    transition: "stroke 160ms ease, stroke-width 160ms ease",
                }}
            />
            {selected && (
                <EdgeLabelRenderer>
                    <button
                        type="button"
                        aria-label="Отключить связь"
                        title="Отключить связь"
                        className="nodrag nopan pointer-events-auto absolute flex h-9 w-9 items-center justify-center rounded-[var(--radius-full)] border border-border-primary bg-bg-surface text-text-secondary shadow-[var(--shadow-md)] transition hover:border-border-secondary hover:bg-bg-tertiary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-border-focus/50"
                        style={{
                            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                        }}
                        onClick={(event) => {
                            event.stopPropagation();
                            edgeData?.onDetach?.(id);
                        }}
                    >
                        <Unlink2 className="h-4 w-4" />
                    </button>
                </EdgeLabelRenderer>
            )}
        </>
    );
}
