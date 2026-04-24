"use client";

/**
 * /workflows/new — создаёт новый пустой graph-workflow и редиректит
 * на /workflows/<id>. Поддерживает ?preset=X для предзаполнения графа
 * одним из системных workflow-шаблонов.
 */

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { emptyWorkflowGraph } from "@/lib/workflow/graphSchema";
import { createWorkflowPresetDraft } from "@/lib/workflow/presets";

function NewWorkflowInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { currentWorkspace, needsOnboarding } = useWorkspace();
    const creationFired = useRef(false);

    const saveGraph = trpc.workflow.saveGraph.useMutation({
        onSuccess: ({ id }) => {
            router.replace(`/workflows/${id}`);
        },
    });

    useEffect(() => {
        if (creationFired.current) return;
        if (!currentWorkspace?.id) return;
        if (needsOnboarding) return;

        const preset = createWorkflowPresetDraft(searchParams.get("preset"));

        creationFired.current = true;
        saveGraph.mutate({
            workspaceId: currentWorkspace.id,
            name: preset?.name ?? "Новый workflow",
            description: preset?.description,
            graph: preset?.graph ?? emptyWorkflowGraph(),
        });
    }, [currentWorkspace?.id, needsOnboarding, searchParams, saveGraph]);

    return (
        <div className="flex h-screen items-center justify-center">
            <div className="flex items-center gap-3 text-neutral-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>
                    {saveGraph.isError
                        ? `Ошибка создания: ${saveGraph.error.message}`
                        : "Создаём workflow…"}
                </span>
            </div>
        </div>
    );
}

export default function NewWorkflowPage() {
    return (
        <Suspense
            fallback={
                <div className="flex h-screen items-center justify-center text-neutral-500">
                    <Loader2 className="h-5 w-5 animate-spin" />
                </div>
            }
        >
            <NewWorkflowInner />
        </Suspense>
    );
}
