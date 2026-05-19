/**
 * Tests for inpaint mask export — UV projection across all object-fit modes.
 *
 * The mask exporter needs to translate brush points the user paints in
 * *screen pixels* over an image layer into the *source image's natural pixel
 * coordinates*. The math is fit-mode-specific (cover/contain/crop/fill) and
 * has been broken in the past whenever someone tweaked imageFitUtils without
 * realising the inpaint path depends on it. These tests pin the contract.
 */

import { describe, it, expect } from "vitest";
import {
    projectPointToImageSpace,
    modelRequiresAlphaMask,
    type BrushPoint,
} from "../inpaintMaskExport";
import { computeImageFitProps } from "../imageFitUtils";

function fitFor(
    mode: "cover" | "contain" | "crop" | "fill",
    naturalW: number,
    naturalH: number,
    containerW: number,
    containerH: number,
) {
    return computeImageFitProps(mode, naturalW, naturalH, containerW, containerH);
}

describe("projectPointToImageSpace", () => {
    describe("fill (no letterbox, no crop — direct stretch)", () => {
        const fit = fitFor("fill", 400, 200, 200, 200);

        it("projects centre point to source centre", () => {
            const out = projectPointToImageSpace({ x: 100, y: 100 } as BrushPoint, fit, 1);
            expect(out).not.toBeNull();
            expect(out!.x).toBeCloseTo(200, 5);
            expect(out!.y).toBeCloseTo(100, 5);
        });

        it("projects top-left to (0,0)", () => {
            const out = projectPointToImageSpace({ x: 0, y: 0 } as BrushPoint, fit, 1);
            expect(out).not.toBeNull();
            expect(out!.x).toBeCloseTo(0, 5);
            expect(out!.y).toBeCloseTo(0, 5);
        });
    });

    describe("cover (image larger than container, crop excess)", () => {
        // 400x200 source, 100x100 container → crops to 200x200 horizontally
        const fit = fitFor("cover", 400, 200, 100, 100);

        it("projects centre point to source centre", () => {
            const out = projectPointToImageSpace({ x: 50, y: 50 } as BrushPoint, fit, 1);
            expect(out).not.toBeNull();
            expect(out!.x).toBeCloseTo(200, 5);
            expect(out!.y).toBeCloseTo(100, 5);
        });

        it("projects top-left of container to crop origin", () => {
            const out = projectPointToImageSpace({ x: 0, y: 0 } as BrushPoint, fit, 1);
            expect(out).not.toBeNull();
            // cover crop on 400x200 → cropX=(400-200)/2=100
            expect(out!.x).toBeCloseTo(100, 5);
            expect(out!.y).toBeCloseTo(0, 5);
        });
    });

    describe("contain (image fits within container, letterbox)", () => {
        // 200x100 source, 100x100 container → drawW=100, drawH=50, drawY=25
        const fit = fitFor("contain", 200, 100, 100, 100);

        it("projects the centre of the image rectangle to source centre", () => {
            const out = projectPointToImageSpace({ x: 50, y: 50 } as BrushPoint, fit, 1);
            expect(out).not.toBeNull();
            expect(out!.x).toBeCloseTo(100, 5);
            expect(out!.y).toBeCloseTo(50, 5);
        });

        it("returns null for points in the letterbox region", () => {
            // top corner of container is in the letterbox area
            const out = projectPointToImageSpace({ x: 50, y: 0 } as BrushPoint, fit, 1);
            expect(out).toBeNull();
        });
    });

    describe("crop (Konva crop mode — behaves like cover with focus)", () => {
        const fit = fitFor("crop", 200, 200, 100, 100);

        it("centres map to source centre", () => {
            const out = projectPointToImageSpace({ x: 50, y: 50 } as BrushPoint, fit, 1);
            expect(out).not.toBeNull();
            expect(out!.x).toBeCloseTo(100, 5);
            expect(out!.y).toBeCloseTo(100, 5);
        });
    });

    describe("zoom > 1 (canvas scaled in)", () => {
        const fit = fitFor("fill", 400, 200, 200, 200);

        it("undoes the zoom transform", () => {
            // At zoom=2 the user paints in doubled screen pixels — point (200,200)
            // on screen is point (100,100) in layer-local space, i.e. source
            // centre under our fill geometry.
            const out = projectPointToImageSpace({ x: 200, y: 200 } as BrushPoint, fit, 2);
            expect(out).not.toBeNull();
            expect(out!.x).toBeCloseTo(200, 5);
            expect(out!.y).toBeCloseTo(100, 5);
        });
    });
});

describe("modelRequiresAlphaMask", () => {
    it("returns true for openai/* slugs", () => {
        expect(modelRequiresAlphaMask("openai/gpt-image-2")).toBe(true);
        expect(modelRequiresAlphaMask("openai/gpt-image-1/edit")).toBe(true);
    });

    it("returns false for non-openai slugs", () => {
        expect(modelRequiresAlphaMask("black-forest-labs/flux-fill-dev")).toBe(false);
        expect(modelRequiresAlphaMask("google/nano-banana-2")).toBe(false);
        expect(modelRequiresAlphaMask("fal-ai/flux-pro/v1/fill")).toBe(false);
    });

    it("returns false when slug is missing", () => {
        expect(modelRequiresAlphaMask(undefined)).toBe(false);
        expect(modelRequiresAlphaMask("")).toBe(false);
    });
});
