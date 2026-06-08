import { describe, expect, it } from "vitest";
import { inferConstraints, resolveConstraints, type Box } from "@/utils/constraintInference";

const artboard: Box = { x: 0, y: 0, width: 100, height: 100 };

describe("inferConstraints", () => {
    it("pins a small top-left element to left/top", () => {
        expect(inferConstraints({ x: 5, y: 5, width: 10, height: 10 }, artboard, "rectangle"))
            .toEqual({ horizontal: "left", vertical: "top" });
    });

    it("pins a small bottom-right element to right/bottom", () => {
        expect(inferConstraints({ x: 85, y: 85, width: 10, height: 10 }, artboard, "rectangle"))
            .toEqual({ horizontal: "right", vertical: "bottom" });
    });

    it("keeps a centered element centered", () => {
        expect(inferConstraints({ x: 40, y: 40, width: 20, height: 20 }, artboard, "rectangle"))
            .toEqual({ horizontal: "center", vertical: "center" });
    });

    it("stretches a full-bleed rectangle on both axes", () => {
        expect(inferConstraints({ x: 0, y: 0, width: 100, height: 100 }, artboard, "rectangle"))
            .toEqual({ horizontal: "stretch", vertical: "stretch" });
    });

    it("scales (not stretches) a full-bleed image to avoid distortion", () => {
        expect(inferConstraints({ x: 0, y: 0, width: 100, height: 100 }, artboard, "image"))
            .toEqual({ horizontal: "scale", vertical: "scale" });
    });

    it("stretches horizontally but pins vertically for a full-width top bar", () => {
        expect(inferConstraints({ x: 5, y: 0, width: 90, height: 10 }, artboard, "rectangle"))
            .toEqual({ horizontal: "stretch", vertical: "top" });
    });
});

describe("resolveConstraints", () => {
    it("returns explicit constraints unchanged", () => {
        const layer = {
            x: 0, y: 0, width: 100, height: 100, type: "rectangle" as const,
            constraints: { horizontal: "right" as const, vertical: "bottom" as const },
        };
        expect(resolveConstraints(layer, artboard)).toEqual({ horizontal: "right", vertical: "bottom" });
    });

    it("falls back to inferred constraints when unset", () => {
        const layer = { x: 85, y: 85, width: 10, height: 10, type: "rectangle" as const };
        expect(resolveConstraints(layer, artboard)).toEqual({ horizontal: "right", vertical: "bottom" });
    });
});
