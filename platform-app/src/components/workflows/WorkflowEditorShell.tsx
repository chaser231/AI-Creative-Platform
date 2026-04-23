"use client";

/**
 * WorkflowEditorShell
 *
 * Client wrapper that:
 *  1. Loads the graph via tRPC.
 *  2. Dynamically imports the xyflow-heavy editor (ssr:false) so that
 *     window/ResizeObserver refs inside @xyflow/react never run on the
 *     server — this is the SSR-safety pattern recommended by the official
 *     xyflow Next.js example and by the Next.js 15+ App Router docs.
 *  3. Seeds the Zustand store from the loaded graph, then hands control to
 *     <WorkflowEditor /> for interactive editing.
 */

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useWorkflowStore } from "@/store/workflow/useWorkflowStore";
import { emptyWorkflowGraph } from "@/lib/workflow/graphSchema";
import type { WorkflowGraph } from "@/server/workflow/types";

// Dynamic import: xyflow bundle lands only in the /workflows/* route chunk.
const WorkflowEditor = dynamic(
    () => import("./WorkflowEditor").then((m) => ({ default: m.WorkflowEditor })),
    {
        ssr: false,
        loading: () => <EditorSkeleton label="Инициализируем редактор…" />,
    },
);

function EditorSkeleton({ label }: { label: string }) {
    return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 bg-neutral-50 text-neutral-500 dark:bg-neutral-950 dark:text-neutral-400">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">{label}</span>
        </div>
    );
}

export function WorkflowEditorShell({ workflowId }: { workflowId: string }) {
    const hydrate = useWorkflowStore((s) => s.hydrate);

    const query = trpc.workflow.loadGraph.useQuery(
        { id: workflowId },
        { refetchOnWindowFocus: false },
    );

    useEffect(() => {
        if (!query.data) return;
        const graph: WorkflowGraph = query.data.graph ?? emptyWorkflowGraph();
        hydrate({
            name: query.data.name,
            description: query.data.description,
            graph,
        });
    }, [query.data, hydrate]);

    if (query.isLoading) return <EditorSkeleton label="Загружаем workflow…" />;

    if (query.error) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-300">
                    Не удалось загрузить workflow: {query.error.message}
                </div>
            </div>
        );
    }

    if (query.data && query.data.graph === null) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="max-w-md rounded-lg border border-yellow-300 bg-yellow-50 p-6 text-sm text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-900/10 dark:text-yellow-200">
                    Этот workflow создан в старом LLM-чат формате и пока не
                    поддерживается новым редактором. Откройте его в AI-чате
                    или создайте новый.
                </div>
            </div>
        );
    }

    return <WorkflowEditor workflowId={workflowId} />;
}
