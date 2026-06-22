import { describe, expect, it } from "vitest";
import { computeSnap, computeResizeSnap, type SnapConfig, type NodeBounds } from "../snapService";

const NO_SNAP_CONFIG: SnapConfig = {
    objectSnap: false,
    gridSnap: false,
    gridSize: 8,
    pixelSnap: false,
    artboardSnap: false,
};

function node(overrides: Partial<NodeBounds>): NodeBounds {
    return { id: "n1", x: 0, y: 0, width: 50, height: 50, rotation: 0, ...overrides };
}

describe("computeSnap — layout grid snapping", () => {
    it("snaps the left edge to a vertical grid line within threshold", () => {
        const result = computeSnap(
            node({ x: 98, width: 50 }),
            [],
            NO_SNAP_CONFIG,
            undefined,
            false,
            5,
            { vertical: [100], horizontal: [] },
        );
        expect(result.x).toBe(100);
        expect(result.guides.some((g) => g.type === "grid" && g.orientation === "vertical")).toBe(true);
    });

    it("snaps the horizontal center to a horizontal grid line", () => {
        // center = y + height/2; place so center is 2px from line 200
        const result = computeSnap(
            node({ y: 173, height: 50 }), // center = 198
            [],
            NO_SNAP_CONFIG,
            undefined,
            false,
            5,
            { vertical: [], horizontal: [200] },
        );
        // center snaps to 200 => y = 200 - 25 = 175
        expect(result.y).toBe(175);
    });

    it("does not snap when beyond threshold", () => {
        const result = computeSnap(
            node({ x: 90, width: 50 }),
            [],
            NO_SNAP_CONFIG,
            undefined,
            false,
            5,
            { vertical: [100], horizontal: [] },
        );
        expect(result.x).toBeNull();
    });

    it("prefers a closer object snap over a grid line", () => {
        const config: SnapConfig = { ...NO_SNAP_CONFIG, objectSnap: true };
        const result = computeSnap(
            node({ id: "active", x: 98, width: 50 }),
            [node({ id: "other", x: 99, y: 0, width: 50, height: 50 })],
            config,
            undefined,
            false,
            5,
            { vertical: [100], horizontal: [] },
        );
        // object edge at 99 (diff 1) beats grid line at 100 (diff 2)
        expect(result.x).toBe(99);
    });
});

describe("computeResizeSnap — layout grid snapping", () => {
    it("snaps the right edge to a vertical grid line", () => {
        const result = computeResizeSnap(
            { id: "n1", x: 0, y: 0, width: 98, height: 50, rotation: 0 },
            [],
            ["right"],
            undefined,
            5,
            { vertical: [100], horizontal: [] },
        );
        expect(result.width).toBe(100);
        expect(result.guides.some((g) => g.type === "grid")).toBe(true);
    });

    it("snaps the bottom edge to a horizontal grid line", () => {
        const result = computeResizeSnap(
            { id: "n1", x: 0, y: 0, width: 50, height: 197, rotation: 0 },
            [],
            ["bottom"],
            undefined,
            5,
            { vertical: [], horizontal: [200] },
        );
        expect(result.height).toBe(200);
    });

    it("leaves dimensions untouched when no grid line is near", () => {
        const result = computeResizeSnap(
            { id: "n1", x: 0, y: 0, width: 50, height: 50, rotation: 0 },
            [],
            ["right"],
            undefined,
            5,
            { vertical: [100], horizontal: [] },
        );
        expect(result.width).toBe(50);
    });
});
