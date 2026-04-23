"use client";

/**
 * BaseNode — shared visual shell for placeholder node components.
 *
 * Phase 2 intentionally keeps styling minimal: a card with the display
 * name and typed handles. Phase 3 adds inspector-driven params preview,
 * icons, and category-based styling.
 */

import { Handle, Position } from "@xyflow/react";
import { NODE_REGISTRY } from "@/server/workflow/types";
import type { WorkflowNodeType } from "@/server/workflow/types";

interface BaseNodeProps {
    type: WorkflowNodeType;
    selected?: boolean;
}

const CATEGORY_ACCENT: Record<"input" | "ai" | "output", string> = {
    input: "border-l-emerald-400",
    ai: "border-l-violet-400",
    output: "border-l-amber-400",
};

export function BaseNode({ type, selected }: BaseNodeProps) {
    const definition = NODE_REGISTRY[type];
    const accent = CATEGORY_ACCENT[definition.category];

    return (
        <div
            className={[
                "min-w-[160px] rounded-md border border-neutral-300 border-l-4 bg-white px-3 py-2 shadow-sm transition",
                "dark:border-neutral-700 dark:bg-neutral-900",
                accent,
                selected ? "ring-2 ring-blue-400" : "",
            ].join(" ")}
        >
            <div className="text-[11px] uppercase tracking-wide text-neutral-400">
                {definition.category}
            </div>
            <div className="mt-0.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {definition.displayName}
            </div>

            {definition.inputs.map((port, idx) => (
                <Handle
                    key={port.id}
                    type="target"
                    position={Position.Left}
                    id={port.id}
                    // Phase 3 will read data-port-type to colour valid targets.
                    data-port-type={port.type}
                    style={{
                        top: `${30 + idx * 16}px`,
                        background: "#6366f1",
                    }}
                />
            ))}

            {definition.outputs.map((port, idx) => (
                <Handle
                    key={port.id}
                    type="source"
                    position={Position.Right}
                    id={port.id}
                    data-port-type={port.type}
                    style={{
                        top: `${30 + idx * 16}px`,
                        background: "#6366f1",
                    }}
                />
            ))}
        </div>
    );
}
