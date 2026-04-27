import { describe, expect, it } from "vitest";
import type { Connection } from "@xyflow/react";
import { isValidConnection } from "@/lib/workflow/connectionValidator";
import type { WorkflowNode } from "@/server/workflow/types";

function node(id: string, type: WorkflowNode["type"]): WorkflowNode {
    return {
        id,
        type,
        position: { x: 0, y: 0 },
        data: { params: {} },
    };
}

function conn(
    source: string,
    sourceHandle: string,
    target: string,
    targetHandle: string,
): Connection {
    return { source, sourceHandle, target, targetHandle };
}

describe("isValidConnection", () => {
    it("accepts image-out → image-in (same type)", () => {
        const nodes = [node("a", "imageInput"), node("b", "removeBackground")];
        const ok = isValidConnection(conn("a", "image-out", "b", "image-in"), nodes);
        expect(ok).toBe(true);
    });

    it("accepts chained image-out → image-in across multiple AI nodes", () => {
        const nodes = [
            node("a", "imageInput"),
            node("b", "removeBackground"),
            node("c", "addReflection"),
        ];
        expect(isValidConnection(conn("a", "image-out", "b", "image-in"), nodes)).toBe(true);
        expect(isValidConnection(conn("b", "image-out", "c", "image-in"), nodes)).toBe(true);
    });

    it("rejects text-out → image-in because port types differ", () => {
        const nodes = [node("a", "textGeneration"), node("b", "removeBackground")];
        expect(isValidConnection(conn("a", "text-out", "b", "image-in"), nodes)).toBe(false);
    });

    it("accepts text-out → context-in for generation nodes", () => {
        const nodes = [
            node("text", "textGeneration"),
            node("image", "imageGeneration"),
            node("copy", "textGeneration"),
        ];
        expect(
            isValidConnection(conn("text", "text-out", "image", "context-in"), nodes),
        ).toBe(true);
        expect(
            isValidConnection(conn("text", "text-out", "copy", "context-in"), nodes),
        ).toBe(true);
    });

    it("accepts image-out → context-in for generation nodes", () => {
        const nodes = [
            node("image", "imageInput"),
            node("gen", "imageGeneration"),
            node("text", "textGeneration"),
        ];
        expect(
            isValidConnection(conn("image", "image-out", "gen", "context-in"), nodes),
        ).toBe(true);
        expect(
            isValidConnection(conn("image", "image-out", "text", "context-in"), nodes),
        ).toBe(true);
    });

    it("rejects when source node is missing from list", () => {
        const nodes = [node("b", "removeBackground")];
        expect(
            isValidConnection(conn("ghost", "image-out", "b", "image-in"), nodes),
        ).toBe(false);
    });

    it("rejects when target node is missing from list", () => {
        const nodes = [node("a", "imageInput")];
        expect(
            isValidConnection(conn("a", "image-out", "ghost", "image-in"), nodes),
        ).toBe(false);
    });

    it("rejects when source handle id does not exist on the node", () => {
        const nodes = [node("a", "imageInput"), node("b", "removeBackground")];
        expect(
            isValidConnection(conn("a", "bogus-out", "b", "image-in"), nodes),
        ).toBe(false);
    });

    it("rejects when target handle id does not exist on the node", () => {
        const nodes = [node("a", "imageInput"), node("b", "removeBackground")];
        expect(
            isValidConnection(conn("a", "image-out", "b", "bogus-in"), nodes),
        ).toBe(false);
    });

    it("rejects when target node has no inputs (assetOutput as source-of-edge into another node — impossible by definition)", () => {
        const nodes = [node("a", "assetOutput"), node("b", "removeBackground")];
        expect(
            isValidConnection(conn("a", "image-out", "b", "image-in"), nodes),
        ).toBe(false);
    });

    it("returns false when source/target handle ids are null (xyflow can pass null)", () => {
        const nodes = [node("a", "imageInput"), node("b", "removeBackground")];
        expect(
            isValidConnection(
                { source: "a", sourceHandle: null, target: "b", targetHandle: "image-in" },
                nodes,
            ),
        ).toBe(false);
        expect(
            isValidConnection(
                { source: "a", sourceHandle: "image-out", target: "b", targetHandle: null },
                nodes,
            ),
        ).toBe(false);
    });
});
