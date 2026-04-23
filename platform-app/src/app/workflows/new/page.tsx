"use client";

/**
 * /workflows/new — создаёт новый пустой graph-workflow и редиректит
 * на /workflows/<id>. Phase 5 будет поддерживать ?preset=X для
 * предзаполнения графа; Phase 2 только логирует запрошенный preset.
 */

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { emptyWorkflowGraph } from "@/lib/workflow/graphSchema";

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

        const presetId = searchParams.get("preset");
        if (presetId) {
            // Phase 5 will resolve this to a pre-built graph. For now keep the
            // route reachable so future preset links don't 404.
            // eslint-disable-next-line no-console
            console.warn("[workflows/new] preset requested (Phase 5):", presetId);
        }

        creationFired.current = true;
        saveGraph.mutate({
            workspaceId: currentWorkspace.id,
            name: "Новый workflow",
            graph: emptyWorkflowGraph(),
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
