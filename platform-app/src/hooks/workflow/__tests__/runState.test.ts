import { describe, expect, it } from "vitest";
import type { WorkflowNode } from "@/server/workflow/types";
import {
    prepareFullRunSnapshot,
    prepareSliceRunSnapshot,
} from "../runState";

function n(id: string): WorkflowNode {
    return {
        id,
        type: "preview",
        position: { x: 0, y: 0 },
        data: { params: {} },
    };
}

describe("prepareFullRunSnapshot", () => {
    it("resets all nodes to idle and clears previous results", () => {
        expect(prepareFullRunSnapshot([n("a"), n("b")])).toEqual({
            runState: { a: "idle", b: "idle" },
            runResults: {},
        });
    });
});

describe("prepareSliceRunSnapshot", () => {
    it("resets only the execution slice and preserves unrelated results", () => {
        const snapshot = prepareSliceRunSnapshot({
            nodeIds: ["in", "target"],
            currentRunState: {
                in: "done",
                target: "error",
                unrelated: "done",
                downstream: "blocked",
            },
            currentRunResults: {
                in: { url: "https://old/input.png" },
                target: { url: "https://old/target.png" },
                unrelated: { url: "https://old/unrelated.png" },
                downstream: { url: "https://old/downstream.png" },
            },
        });

        expect(snapshot.runState).toEqual({
            in: "idle",
            target: "idle",
            unrelated: "done",
            downstream: "blocked",
        });
        expect(snapshot.runResults).toEqual({
            unrelated: { url: "https://old/unrelated.png" },
            downstream: { url: "https://old/downstream.png" },
        });
    });
});
