"use client";

/**
 * NodePalette — left sidebar listing all NODE_REGISTRY entries grouped
 * by category. Each row is HTML5-draggable. The drop handler lives in
 * WorkflowEditor and pulls the node type out of the MIME payload
 * "application/reactflow".
 */

import { NODE_REGISTRY } from "@/server/workflow/types";
import type { WorkflowNodeType, NodeDefinition } from "@/server/workflow/types";

const CATEGORY_LABELS: Record<NodeDefinition["category"], string> = {
    input: "Источники",
    ai: "AI-узлы",
    transform: "Преобразования",
    output: "Выходы",
};

const CATEGORY_ORDER: NodeDefinition["category"][] = [
    "input",
    "ai",
    "transform",
    "output",
];

function onDragStart(event: React.DragEvent, type: WorkflowNodeType) {
    event.dataTransfer.setData("application/reactflow", type);
    event.dataTransfer.effectAllowed = "move";
}

export function NodePalette() {
    const grouped = CATEGORY_ORDER.map((cat) => ({
        category: cat,
        items: Object.values(NODE_REGISTRY).filter((n) => n.category === cat),
    }));

    return (
        <aside className="flex h-full w-60 shrink-0 flex-col overflow-y-auto border-r border-border-primary bg-bg-secondary p-3">
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                Узлы
            </h2>
            {grouped.map(({ category, items }) => (
                <div key={category} className="mb-4">
                    <div className="mb-1 px-1 text-[11px] uppercase tracking-wider text-text-tertiary">
                        {CATEGORY_LABELS[category]}
                    </div>
                    <ul className="space-y-1">
                        {items.map((item) => (
                            <li key={item.type}>
                                <div
                                    draggable
                                    onDragStart={(e) => onDragStart(e, item.type)}
                                    className="cursor-grab select-none rounded-md border border-border-primary bg-bg-surface px-2.5 py-2 text-sm text-text-primary shadow-sm transition hover:border-border-secondary active:cursor-grabbing"
                                    title={item.description}
                                >
                                    <div className="font-medium">{item.displayName}</div>
                                    <div className="mt-0.5 line-clamp-2 text-[11px] text-text-secondary">
                                        {item.description}
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </aside>
    );
}
