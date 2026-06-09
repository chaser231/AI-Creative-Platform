import { describe, expect, it } from "vitest";
import type { RectangleLayer } from "@/types";
import { lockedAspectDimensions } from "../aspectRatioLock";

describe("lockedAspectDimensions", () => {
    const layer: RectangleLayer = {
        id: "r1",
        type: "rectangle",
        name: "Box",
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        rotation: 0,
        visible: true,
        locked: false,
        fill: "#000",
        stroke: "#000",
        strokeWidth: 0,
        cornerRadius: 0,
        lockAspectRatio: true,
    };

    it("uses uniform scale when aspect lock is on", () => {
        const result = lockedAspectDimensions(layer, 2, 1.2, 100, 50);
        expect(result.scaleX).toBe(2);
        expect(result.scaleY).toBe(2);
        expect(result.width).toBe(200);
        expect(result.height).toBe(100);
    });

    it("preserves independent scales when lock is off", () => {
        const unlocked = { ...layer, lockAspectRatio: false };
        const result = lockedAspectDimensions(unlocked, 2, 1.2, 100, 50);
        expect(result.width).toBe(200);
        expect(result.height).toBe(60);
    });
});
