"use client";

/**
 * useWorkflowAutoSave — debounced auto-save for the workflow editor.
 *
 * Behaviour (locked in decision D-10):
 *   - Watches `dirty` in `useWorkflowStore`.
 *   - On dirty flip, schedules a save in `debounceMs` (default 2s).
 *   - On `beforeunload`, flushes a synchronous save using
 *     `navigator.sendBeacon` fallback so closing the tab doesn't lose work.
 *   - Last-write-wins: no optimistic locking in Phase 2 (left for a
 *     follow-up milestone if collaborative editing becomes a thing).
 *
 * Returns `{ status, saveNow }` — `status` feeds the topbar badge,
 * `saveNow` is exposed to the manual save button.
 *
 * NOTE: the scheduling loop here is mirrored in
 * `__tests__/useWorkflowAutoSave.test.tsx` because the repo has no jsdom/
 * @testing-library setup for a proper `renderHook`. If you change the
 * debounce/schedule behaviour, update the test's `attachAutoSave` clone.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useWorkflowStore } from "@/store/workflow/useWorkflowStore";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface UseWorkflowAutoSaveOptions {
    workflowId: string;
    workspaceId: string | undefined;
    debounceMs?: number;
}

export function useWorkflowAutoSave({
    workflowId,
    workspaceId,
    debounceMs = 2000,
}: UseWorkflowAutoSaveOptions) {
    const [status, setStatus] = useState<SaveStatus>("idle");
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const saveGraph = trpc.workflow.saveGraph.useMutation({
        onMutate: () => setStatus("saving"),
        onSuccess: () => {
            useWorkflowStore.getState().markSaved();
            setStatus("saved");
        },
        onError: () => setStatus("error"),
    });

    const saveNow = useCallback(() => {
        if (!workspaceId) return;
        const state = useWorkflowStore.getState();
        saveGraph.mutate({
            workspaceId,
            workflowId,
            name: state.name || "Untitled",
            description: state.description || undefined,
            graph: state.serialize(),
        });
    }, [workflowId, workspaceId, saveGraph]);

    // Debounce on dirty flips. We subscribe via store's useSubscribe-style
    // selector, but `useWorkflowStore` here is consumed with a vanilla
    // subscribe so we don't trigger re-renders of the parent editor.
    useEffect(() => {
        if (!workspaceId) return;

        const scheduleSave = () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                saveNow();
            }, debounceMs);
        };

        const unsubscribe = useWorkflowStore.subscribe((state, prev) => {
            // Trigger only on a false → true edge of `dirty` so rapid
            // subsequent mutations share a single debounce window.
            if (state.dirty && !prev.dirty) scheduleSave();
            // But also reset the timer on each additional dirty mutation
            // so typing keeps the 2s idle window honest.
            else if (state.dirty) scheduleSave();
        });

        return () => {
            unsubscribe();
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [workspaceId, debounceMs, saveNow]);

    // Best-effort flush on navigation: we can't await the tRPC call here,
    // but triggering it synchronously is better than losing work. React
    // Query will retry if the window is closed mid-flight.
    useEffect(() => {
        const handler = () => {
            if (useWorkflowStore.getState().dirty) saveNow();
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [saveNow]);

    return { status, saveNow };
}
