import { describe, expect, it } from "vitest";

import {
    computeGptImage2RequestSize,
    computePackOutpaintPlan,
    computeWizardWorkingAssetSize,
    GPT_IMAGE2_MAX_ASPECT,
    GPT_IMAGE2_MAX_EDGE,
    GPT_IMAGE2_MAX_PIXELS,
    GPT_IMAGE2_MIN_PIXELS,
    type PackOutpaintFormat,
    type PackOutpaintRect,
} from "./packOutpaintPlan";

const MASTER: PackOutpaintRect = {
    id: "master-image",
    slotId: "image-primary",
    x: 0,
    y: 0,
    width: 1192,
    height: 300,
    type: "image",
};

describe("computePackOutpaintPlan", () => {
    it("derives per-side master padding from every supported resize", () => {
        const formats: PackOutpaintFormat[] = [
            { id: "master", isMaster: true, width: 1192, height: 300 },
            {
                id: "vertical",
                width: 470,
                height: 762,
                layers: [
                    { id: "vertical-image", slotId: "image-primary", x: 0, y: 0, width: 470, height: 300 },
                ],
            },
            {
                id: "top-banner",
                width: 853,
                height: 92,
                layers: [
                    { id: "top-image", slotId: "image-primary", x: 0, y: 0, width: 853, height: 92 },
                ],
            },
        ];

        const plan = computePackOutpaintPlan({
            masterLayer: MASTER,
            masterArtboard: { width: 1192, height: 300 },
            formats,
            sourceSizePx: { width: 1192, height: 300 },
            options: { bleedPx: 32 },
        });

        expect(plan.canvasPadding).toEqual({
            left: 82,
            right: 82,
            top: 105,
            bottom: 494,
        });
        expect(plan.nextMasterRect).toEqual({
            x: -82,
            y: -105,
            width: 1356,
            height: 899,
        });
        expect(plan.outputSizePx).toEqual({ width: 1356, height: 899 });
        expect(plan.sourcePlacementPx).toEqual({ x: 82, y: 105, width: 1192, height: 300 });
    });

    it("uses different formulas for relative_size and relative_full", () => {
        const target = { id: "target-image", slotId: "image-primary", x: 50, y: 20, width: 100, height: 100 };
        const relativeSize = computePackOutpaintPlan({
            masterLayer: { ...MASTER, width: 300, height: 100 },
            masterArtboard: { width: 600, height: 400 },
            sourceSizePx: { width: 300, height: 100 },
            formats: [{
                id: "resize",
                width: 200,
                height: 200,
                layers: [target],
                layerBindings: [{
                    masterLayerId: "master-image",
                    targetLayerId: "target-image",
                    syncContent: true,
                    syncStyle: true,
                    syncSize: true,
                    syncPosition: true,
                    imageSyncMode: "relative_size",
                }],
            }],
            options: { bleedPx: 0 },
        });
        const relativeFull = computePackOutpaintPlan({
            masterLayer: { ...MASTER, width: 300, height: 100 },
            masterArtboard: { width: 600, height: 400 },
            sourceSizePx: { width: 300, height: 100 },
            formats: [{
                id: "resize",
                width: 200,
                height: 200,
                layers: [target],
                layerBindings: [{
                    masterLayerId: "master-image",
                    targetLayerId: "target-image",
                    syncContent: true,
                    syncStyle: true,
                    syncSize: true,
                    syncPosition: true,
                    imageSyncMode: "relative_full",
                }],
            }],
            options: { bleedPx: 0 },
        });

        expect(relativeSize.canvasPadding).toEqual({ left: 150, right: 150, top: 20, bottom: 80 });
        expect(relativeFull.canvasPadding).toEqual({ left: 150, right: 150, top: 40, bottom: 160 });
    });

    it("records content-only bindings without changing geometry", () => {
        const plan = computePackOutpaintPlan({
            masterLayer: { ...MASTER, width: 300, height: 100 },
            masterArtboard: { width: 600, height: 400 },
            sourceSizePx: { width: 300, height: 100 },
            formats: [{
                id: "content-resize",
                width: 200,
                height: 200,
                layers: [{ id: "target-image", slotId: "image-primary", x: 50, y: 20, width: 100, height: 100 }],
                layerBindings: [{
                    masterLayerId: "master-image",
                    targetLayerId: "target-image",
                    syncContent: true,
                    syncStyle: false,
                    syncSize: false,
                    syncPosition: false,
                    imageSyncMode: "content",
                }],
            }],
            options: { bleedPx: 0 },
        });

        expect(plan.canvasPadding).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
        expect(plan.diagnostics).toContainEqual(
            expect.objectContaining({ code: "content-sync-skipped", formatId: "content-resize" }),
        );
    });
});

describe("GPT Image 2 request and working asset budgets", () => {
    it("sizes working derivatives to actual export usage plus reserve", () => {
        const size = computeWizardWorkingAssetSize(
            { width: 4096, height: 2048 },
            { width: 1000, height: 500 },
            [{ width: 1000, height: 500 }],
        );

        expect(size).toEqual({ width: 2300, height: 1150 });
    });

    it("caps oversized working derivatives to the GPT request budget", () => {
        const size = computeWizardWorkingAssetSize(
            { width: 10000, height: 10000 },
            { width: 5000, height: 5000 },
            [{ width: 5000, height: 5000 }],
        );

        expect(size.width).toBeLessThanOrEqual(GPT_IMAGE2_MAX_EDGE);
        expect(size.height).toBeLessThanOrEqual(GPT_IMAGE2_MAX_EDGE);
        expect(size.width * size.height).toBeLessThanOrEqual(GPT_IMAGE2_MAX_PIXELS);
    });

    it("rounds request sizes to multiples of 16 and normalizes small canvases", () => {
        const { size, diagnostics } = computeGptImage2RequestSize({ width: 256, height: 256 });

        expect(size.width % 16).toBe(0);
        expect(size.height % 16).toBe(0);
        expect(size.width * size.height).toBeGreaterThanOrEqual(GPT_IMAGE2_MIN_PIXELS);
        expect(diagnostics).toEqual([
            expect.objectContaining({ code: "request-upscaled-to-min" }),
        ]);
    });

    it("keeps planned request size inside edge, area and aspect caps", () => {
        const plan = computePackOutpaintPlan({
            masterLayer: { id: "wide", x: 0, y: 0, width: 3000, height: 400 },
            masterArtboard: { width: 3000, height: 400 },
            formats: [{ id: "master", isMaster: true, width: 3000, height: 400 }],
            sourceSizePx: { width: 3000, height: 400 },
            options: { bleedPx: 0 },
        });

        expect(plan.requestSizePx.width).toBeLessThanOrEqual(GPT_IMAGE2_MAX_EDGE);
        expect(plan.requestSizePx.height).toBeLessThanOrEqual(GPT_IMAGE2_MAX_EDGE);
        expect(plan.requestSizePx.width * plan.requestSizePx.height).toBeLessThanOrEqual(GPT_IMAGE2_MAX_PIXELS);
        expect(plan.requestSizePx.width / plan.requestSizePx.height).toBeLessThanOrEqual(GPT_IMAGE2_MAX_ASPECT);
        expect(plan.diagnostics).toEqual([
            expect.objectContaining({ code: "aspect-pad-added" }),
        ]);
    });
});
