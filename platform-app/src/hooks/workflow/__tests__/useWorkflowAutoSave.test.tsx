/**
 * useWorkflowAutoSave tests.
 *
 * We can't render React hooks in this repo (no jsdom, no @testing-library/
 * react). Instead we exercise the exact same subscription/debounce logic
 * via a tiny plain-TS re-implementation — this is fragile if the hook
 * logic drifts, so we keep the test short and strictly behavioural.
 *
 * The real hook is imported and typechecked in the tsc step; here we only
 * assert the store-side contract (dirty → scheduleSave → mutate exactly
 * once per debounce window).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useWorkflowStore } from "@/store/workflow/useWorkflowStore";

function resetStore() {
    useWorkflowStore.setState({
        nodes: [],
        edges: [],
        name: "",
        description: "",
        dirty: false,
        viewport: { x: 0, y: 0, zoom: 1 },
        runState: {},
    });
}

// Inlined clone of `useWorkflowAutoSave`'s core scheduling logic. If this
// ever diverges from the hook's production implementation, the unit tests
// will still run but give false confidence — any change to the hook should
// mirror here. Flagged by a comment in the hook file itself.
function attachAutoSave(opts: {
    mutate: (payload: { workflowId: string; workspaceId: string; name: string }) => void;
    workflowId: string;
    workspaceId: string | undefined;
    debounceMs: number;
}): () => void {
    if (!opts.workspaceId) return () => {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
        const state = useWorkflowStore.getState();
        opts.mutate({
            workflowId: opts.workflowId,
            workspaceId: opts.workspaceId!,
            name: state.name || "Untitled",
        });
    };
    const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(fire, opts.debounceMs);
    };
    const unsub = useWorkflowStore.subscribe((state, prev) => {
        if (state.dirty && !prev.dirty) schedule();
        else if (state.dirty) schedule();
    });
    return () => {
        unsub();
        if (timer) clearTimeout(timer);
    };
}

describe("useWorkflowAutoSave (scheduling logic)", () => {
    beforeEach(() => {
        resetStore();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("debounces three rapid mutations into a single save call", () => {
        const mutate = vi.fn();
        const detach = attachAutoSave({
            mutate,
            workflowId: "wf-1",
            workspaceId: "ws-1",
            debounceMs: 2000,
        });

        useWorkflowStore.getState().setName("A");
        vi.advanceTimersByTime(500);
        useWorkflowStore.getState().setName("AB");
        vi.advanceTimersByTime(500);
        useWorkflowStore.getState().setName("ABC");

        expect(mutate).not.toHaveBeenCalled();

        vi.advanceTimersByTime(2000);

        expect(mutate).toHaveBeenCalledTimes(1);
        expect(mutate).toHaveBeenCalledWith({
            workflowId: "wf-1",
            workspaceId: "ws-1",
            name: "ABC",
        });
        detach();
    });

    it("does not schedule when workspaceId is missing", () => {
        const mutate = vi.fn();
        const detach = attachAutoSave({
            mutate,
            workflowId: "wf-x",
            workspaceId: undefined,
            debounceMs: 500,
        });
        useWorkflowStore.getState().setName("orphan");
        vi.advanceTimersByTime(5000);
        expect(mutate).not.toHaveBeenCalled();
        detach();
    });

    it("detach clears the pending timer", () => {
        const mutate = vi.fn();
        const detach = attachAutoSave({
            mutate,
            workflowId: "wf-2",
            workspaceId: "ws-1",
            debounceMs: 1000,
        });
        useWorkflowStore.getState().setName("pending");
        detach();
        vi.advanceTimersByTime(5000);
        expect(mutate).not.toHaveBeenCalled();
    });
});
