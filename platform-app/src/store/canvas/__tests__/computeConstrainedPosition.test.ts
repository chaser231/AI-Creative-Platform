import { describe, it, expect } from "vitest";
import { computeConstrainedPosition } from "@/store/canvas/helpers";

// Regression: when a parent frame collapsed to zero width/height (e.g. after a
// hug-cascade with no managed children), constraint modes that divide by
// oldWidth / oldHeight (`center`, `scale`) used to emit NaN / Infinity, which
// propagated into the store and silently broke layout. The helper must now
// fall back to a safe fixed translation in that case.

describe("computeConstrainedPosition — degenerate parent bounds", () => {
    const child = { x: 10, y: 20, width: 30, height: 40 };

    it("center constraint does not produce NaN when oldWidth=0", () => {
        const result = computeConstrainedPosition(
            { ...child, constraints: { horizontal: "center", vertical: "center" } },
            { oldX: 0, oldY: 0, oldWidth: 0, oldHeight: 100, newX: 0, newY: 0, newWidth: 200, newHeight: 100 },
        );
        expect(Number.isFinite(result.x)).toBe(true);
        expect(Number.isFinite(result.y)).toBe(true);
        expect(Number.isFinite(result.width)).toBe(true);
        expect(Number.isFinite(result.height)).toBe(true);
        expect(result.width).toBeGreaterThanOrEqual(1);
        expect(result.height).toBeGreaterThanOrEqual(1);
    });

    it("scale constraint does not produce NaN when oldHeight=0", () => {
        const result = computeConstrainedPosition(
            { ...child, constraints: { horizontal: "scale", vertical: "scale" } },
            { oldX: 5, oldY: 5, oldWidth: 100, oldHeight: 0, newX: 0, newY: 0, newWidth: 200, newHeight: 200 },
        );
        expect(Number.isFinite(result.x)).toBe(true);
        expect(Number.isFinite(result.y)).toBe(true);
        expect(Number.isFinite(result.width)).toBe(true);
        expect(Number.isFinite(result.height)).toBe(true);
    });

    it("translates child to new parent origin when both axes degenerate", () => {
        const result = computeConstrainedPosition(
            { ...child, constraints: { horizontal: "center", vertical: "center" } },
            { oldX: 100, oldY: 100, oldWidth: 0, oldHeight: 0, newX: 500, newY: 700, newWidth: 0, newHeight: 0 },
        );
        // Child was at relative offset (-90, -80) from old origin; should land at new origin + same offset
        expect(result.x).toBe(500 + (10 - 100));
        expect(result.y).toBe(700 + (20 - 100));
        expect(result.width).toBe(30);
        expect(result.height).toBe(40);
    });
});
