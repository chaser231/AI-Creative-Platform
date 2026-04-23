"use client";

/**
 * /workflows/[id] — редактор конкретного workflow.
 *
 * Page остаётся тонким client wrapper'ом: реальный xyflow canvas
 * загружается через next/dynamic({ ssr: false }) внутри
 * WorkflowEditorShell. Без этого xyflow падает при SSR в Next 16
 * (window/ResizeObserver не определены на сервере).
 */

import { use } from "react";
import { WorkflowEditorShell } from "@/components/workflows/WorkflowEditorShell";

export default function WorkflowEditorPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = use(params);
    return <WorkflowEditorShell workflowId={id} />;
}
