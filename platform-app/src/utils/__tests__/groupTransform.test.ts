import { describe, expect, it } from "vitest";
import { computeUnionBBox, computeUnionBBoxFromDrag, distributeGroupTransform } from "../groupTransform";
import type { TransformableLayerSnap } from "../groupTransform";

describe("groupTransform", () => {
    it("computes union bbox of multiple layers", () => {
        const bbox = computeUnionBBox([
            { id: "a", x: 0, y: 0, width: 100, height: 50, rotation: 0 },
            { id: "b", x: 200, y: 10, width: 80, height: 40, rotation: 0 },
        ]);
        expect(bbox).toEqual({ x: 0, y: 0, width: 280, height: 50 });
    });

    it("scales children relative to group center", () => {
        const initial = [
            { id: "a", x: 0, y: 0, width: 100, height: 100, rotation: 0 },
            { id: "b", x: 100, y: 0, width: 100, height: 100, rotation: 0 },
        ];
        const group = { x: 0, y: 0, width: 200, height: 100 };
        const next = { x: 0, y: 0, width: 400, height: 200 };
        const updates = distributeGroupTransform(initial, group, next);
        expect(updates.get("a")).toEqual({ x: 0, y: 0, width: 200, height: 200 });
        expect(updates.get("b")).toEqual({ x: 200, y: 0, width: 200, height: 200 });
    });

    it("computes union bbox during multi-drag", () => {
        const layers: TransformableLayerSnap[] = [
            { id: "a", x: 0, y: 0, width: 100, height: 50, rotation: 0 },
            { id: "b", x: 120, y: 10, width: 80, height: 40, rotation: 0 },
        ];
        const bbox = computeUnionBBoxFromDrag(layers, { a: { x: 0, y: 0 }, b: { x: 120, y: 10 } }, 15, 5);
        expect(bbox).toEqual({ x: 15, y: 5, width: 200, height: 50 });
    });
});
