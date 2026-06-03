import { describe, expect, it } from "vitest";

import {
    computeGptImage2RequestSize,
    computeGridUnionOutpaintPlan,
    computePackOutpaintPlan,
    computeWizardWorkingAssetSize,
    GPT_IMAGE2_MAX_ASPECT,
    GPT_IMAGE2_MAX_EDGE,
    GPT_IMAGE2_MAX_PIXELS,
    GPT_IMAGE2_MIN_PIXELS,
    type PackOutpaintFormat,
    type PackOutpaintRect,
} from "./packOutpaintPlan";
import { computeImageFitProps } from "./imageFitUtils";

const MASTER: PackOutpaintRect = {
    id: "master-image",
    slotId: "image-primary",
    x: 0,
    y: 0,
    width: 1192,
    height: 300,
    type: "image",
};

function mapOutputRectToArtboard(
    layerRect: { x: number; y: number; width: number; height: number },
    outputSize: { width: number; height: number },
    outputRect: { x: number; y: number; width: number; height: number },
) {
    return {
        x: layerRect.x + outputRect.x * layerRect.width / outputSize.width,
        y: layerRect.y + outputRect.y * layerRect.height / outputSize.height,
        width: outputRect.width * layerRect.width / outputSize.width,
        height: outputRect.height * layerRect.height / outputSize.height,
    };
}

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

    it("adds a wizard top reserve for tall formats with shallow hero layers", () => {
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
            options: { bleedPx: 32, tallFormatTopReserveRatio: 0.16 },
        });

        expect(plan.canvasPadding).toEqual({
            left: 82,
            right: 82,
            top: 152,
            bottom: 494,
        });
        expect(plan.nextMasterRect).toEqual({
            x: -82,
            y: -152,
            width: 1356,
            height: 946,
        });
        expect(plan.outputSizePx).toEqual({ width: 1356, height: 946 });
        expect(plan.sourcePlacementPx).toEqual({ x: 82, y: 152, width: 1192, height: 300 });
        expect(plan.sourcePlacementPx.y / plan.outputSizePx.height).toBeGreaterThanOrEqual(0.16);
    });

    it("keeps outputSizePx aspect equal to nextMasterRect aspect for the screenshot pack", () => {
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
            options: { bleedPx: 32, aspectCapStrategy: "downscale-request" },
        });

        const outputAspect = plan.outputSizePx.width / plan.outputSizePx.height;
        const rectAspect = plan.nextMasterRect.width / plan.nextMasterRect.height;
        expect(Math.abs(outputAspect - rectAspect) / Math.max(outputAspect, rectAspect)).toBeLessThan(0.005);
    });

    it("keeps outputSizePx aligned with the pack rect when the cap is breached (delivery-crop default)", () => {
        // Master 1192×300 alone has aspect 3.97:1 → after a 32px symmetric
        // bleed the pack rect is 1256×364 (3.45:1), still outside the GPT
        // 3:1 envelope. Under the legacy "pad" strategy the master rect would
        // inflate to ~1256×419 (centering the product); under the new
        // delivery-crop default the pack rect must stay 1256×364 and the cap
        // padding must live only in the GPT request canvas.
        const plan = computePackOutpaintPlan({
            masterLayer: { id: "master-image", slotId: "image-primary", x: 0, y: 0, width: 1192, height: 300 },
            masterArtboard: { width: 1192, height: 300 },
            formats: [{ id: "master", isMaster: true, width: 1192, height: 300 }],
            sourceSizePx: { width: 1192, height: 300 },
            options: { bleedPx: 32 },
        });

        // Output stays equal to the pack rect (no symmetric inflation).
        expect(plan.outputSizePx).toEqual({ width: 1256, height: 364 });
        expect(plan.nextMasterRect).toEqual({ x: -32, y: -32, width: 1256, height: 364 });
        expect(plan.canvasPadding).toEqual({ top: 32, right: 32, bottom: 32, left: 32 });
        // Source placement inside the OUTPUT canvas is unaffected by the cap.
        expect(plan.sourcePlacementPx).toEqual({ x: 32, y: 32, width: 1192, height: 300 });

        // Request canvas honours the cap (≤ 3:1 within rounding-to-16).
        const requestAspect = plan.requestSizePx.width / plan.requestSizePx.height;
        expect(requestAspect).toBeLessThanOrEqual(GPT_IMAGE2_MAX_ASPECT + 0.05);

        // Diagnostic still surfaces so observability is preserved.
        expect(plan.diagnostics.find((d) => d.code === "aspect-pad-added")).toBeDefined();

        // Source inside the REQUEST canvas is shifted down by the request-only top pad.
        expect(plan.requestSourcePlacementPx.y).toBeGreaterThan(plan.sourcePlacementPx.y);
        expect(plan.requestSourcePlacementPx.x + plan.requestSourcePlacementPx.width).toBeLessThanOrEqual(plan.requestSizePx.width);
        expect(plan.requestSourcePlacementPx.y + plan.requestSourcePlacementPx.height).toBeLessThanOrEqual(plan.requestSizePx.height);

        // Crop rect strips the top/bottom symmetric request-only pad and yields the pack aspect.
        expect(plan.requestOutputCropPx.x).toBe(0);
        expect(plan.requestOutputCropPx.y).toBeGreaterThan(0);
        expect(plan.requestOutputCropPx.width).toBe(plan.requestSizePx.width);
        expect(plan.requestOutputCropPx.height).toBeLessThan(plan.requestSizePx.height);
        const cropAspect = plan.requestOutputCropPx.width / plan.requestOutputCropPx.height;
        const outAspect = plan.outputSizePx.width / plan.outputSizePx.height;
        expect(Math.abs(cropAspect - outAspect) / outAspect).toBeLessThan(0.02);
    });

    it("keeps requestOutputCropPx as the full request when no cap padding is needed", () => {
        // Screenshot pack 1192×300 + 470×762 + 853×92 lands at 1356×899
        // (aspect 1.508) — well inside the 3:1 envelope. The crop must equal
        // the request canvas so delivery is a 1:1 copy after the GPT call.
        const plan = computePackOutpaintPlan({
            masterLayer: MASTER,
            masterArtboard: { width: 1192, height: 300 },
            formats: [
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
            ],
            sourceSizePx: { width: 1192, height: 300 },
            options: { bleedPx: 32 },
        });

        expect(plan.diagnostics.find((d) => d.code === "aspect-pad-added")).toBeUndefined();
        expect(plan.requestOutputCropPx.x).toBe(0);
        expect(plan.requestOutputCropPx.y).toBe(0);
        expect(plan.requestOutputCropPx.width).toBe(plan.requestSizePx.width);
        expect(plan.requestOutputCropPx.height).toBe(plan.requestSizePx.height);
        // Source-in-request should differ from source-in-output only by request rescaling.
        expect(plan.requestSourcePlacementPx.x).toBeCloseTo(plan.sourcePlacementPx.x, 0);
        expect(plan.requestSourcePlacementPx.y).toBeCloseTo(plan.sourcePlacementPx.y, 0);
    });

    it("keeps the asymmetric pack padding under aspectCapStrategy: downscale-request", () => {
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
        ];

        const plan = computePackOutpaintPlan({
            masterLayer: MASTER,
            masterArtboard: { width: 1192, height: 300 },
            formats,
            sourceSizePx: { width: 1192, height: 300 },
            options: { bleedPx: 32, aspectCapStrategy: "downscale-request" },
        });

        // top !== bottom → asymmetric vertical fill is preserved (not equalized).
        expect(plan.canvasPadding.top).toBeLessThan(plan.canvasPadding.bottom);
        // left === right is intentional: vertical format has equal L/R deficits.
        expect(plan.canvasPadding.left).toBe(plan.canvasPadding.right);
        expect(plan.diagnostics.find((d) => d.code === "aspect-pad-added")).toBeUndefined();
    });

    it("does not inflate the master rect with symmetric padding for an ultra-wide pack under downscale-request", () => {
        const wideMaster = { id: "wide-master", x: 0, y: 0, width: 1920, height: 400, type: "image" };

        const planPad = computePackOutpaintPlan({
            masterLayer: wideMaster,
            masterArtboard: { width: 1920, height: 400 },
            formats: [
                { id: "master", isMaster: true, width: 1920, height: 400 },
                {
                    id: "thin-strip",
                    width: 1920,
                    height: 80,
                    layers: [
                        { id: "thin-image", slotId: "image-primary", x: 0, y: 0, width: 1920, height: 80 },
                    ],
                },
            ],
            sourceSizePx: { width: 1920, height: 400 },
            options: { bleedPx: 0, aspectCapStrategy: "pad" },
        });

        const planDownscale = computePackOutpaintPlan({
            masterLayer: wideMaster,
            masterArtboard: { width: 1920, height: 400 },
            formats: [
                { id: "master", isMaster: true, width: 1920, height: 400 },
                {
                    id: "thin-strip",
                    width: 1920,
                    height: 80,
                    layers: [
                        { id: "thin-image", slotId: "image-primary", x: 0, y: 0, width: 1920, height: 80 },
                    ],
                },
            ],
            sourceSizePx: { width: 1920, height: 400 },
            options: { bleedPx: 0, aspectCapStrategy: "downscale-request" },
        });

        // pad strategy adds extra symmetric vertical padding to satisfy 3:1.
        expect(planPad.diagnostics.find((d) => d.code === "aspect-pad-added")).toBeDefined();
        expect(planPad.nextMasterRect.height).toBeGreaterThan(planDownscale.nextMasterRect.height);
        // downscale-request leaves the master rect equal to what the pack
        // actually requires, with no symmetric pad.
        expect(planDownscale.nextMasterRect.height).toBe(400);
        expect(planDownscale.diagnostics.find((d) => d.code === "aspect-pad-added")).toBeUndefined();
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

describe("computeGridUnionOutpaintPlan", () => {
    it("preserves each format's original source placement after grid-union outpaint", () => {
        const master = { ...MASTER, objectFit: "fill" as const };
        const formats: PackOutpaintFormat[] = [
            { id: "master", isMaster: true, width: 1192, height: 300 },
            {
                id: "square",
                width: 360,
                height: 360,
                layers: [
                    { id: "square-image", slotId: "image-primary", x: 80, y: 40, width: 220, height: 220, objectFit: "fill" },
                ],
            },
            {
                id: "vertical",
                width: 470,
                height: 762,
                layers: [
                    { id: "vertical-image", slotId: "image-primary", x: 0, y: 392, width: 470, height: 370, objectFit: "fill" },
                ],
            },
            {
                id: "wide-banner",
                width: 853,
                height: 92,
                layers: [
                    { id: "wide-image", slotId: "image-primary", x: 213, y: 0, width: 426, height: 92, objectFit: "fill" },
                ],
            },
        ];

        const { plan } = computeGridUnionOutpaintPlan({
            masterLayer: master,
            masterArtboard: { width: 1192, height: 300 },
            formats,
            sourceSizePx: { width: 1192, height: 300 },
            options: { bleedPx: 0 },
        });

        expect(plan).toBeTruthy();
        expect(plan?.formatLayerRects).toBeTruthy();
        for (const format of formats) {
            const target = format.isMaster ? master : format.layers?.[0];
            const rect = plan?.formatLayerRects?.[format.id];
            expect(target).toBeTruthy();
            expect(rect).toBeTruthy();
            const mappedSource = mapOutputRectToArtboard(
                rect!,
                plan!.outputSizePx,
                plan!.sourcePlacementPx,
            );
            expect(mappedSource.x).toBeCloseTo(target!.x, 2);
            expect(mappedSource.y).toBeCloseTo(target!.y, 2);
            expect(mappedSource.width).toBeCloseTo(target!.width, 2);
            expect(mappedSource.height).toBeCloseTo(target!.height, 2);
        }
    });

    it("inverts cover and contain image layouts through computeImageFitProps", () => {
        const sourceSize = { width: 1000, height: 500 };
        const master = {
            id: "master-image",
            slotId: "image-primary",
            x: 0,
            y: 0,
            width: 500,
            height: 250,
            objectFit: "fill" as const,
        };
        const coverLayer: PackOutpaintRect = {
            id: "cover-image",
            slotId: "image-primary",
            x: 100,
            y: 0,
            width: 200,
            height: 200,
            objectFit: "cover",
            focusX: 1,
            focusY: 0.5,
        };
        const containLayer: PackOutpaintRect = {
            id: "contain-image",
            slotId: "image-primary",
            x: 0,
            y: 0,
            width: 300,
            height: 300,
            objectFit: "contain",
        };
        const formats: PackOutpaintFormat[] = [
            { id: "master", isMaster: true, width: 500, height: 250 },
            { id: "cover-format", width: 400, height: 200, layers: [coverLayer] },
            { id: "contain-format", width: 400, height: 300, layers: [containLayer] },
        ];

        const { plan } = computeGridUnionOutpaintPlan({
            masterLayer: master,
            masterArtboard: { width: 500, height: 250 },
            formats,
            sourceSizePx: sourceSize,
            options: { bleedPx: 0 },
        });

        expect(plan).toBeTruthy();
        const coverFit = computeImageFitProps(
            "cover",
            sourceSize.width,
            sourceSize.height,
            coverLayer.width,
            coverLayer.height,
            { focusX: coverLayer.focusX, focusY: coverLayer.focusY },
        );
        const coverMappedCrop = mapOutputRectToArtboard(
            plan!.formatLayerRects!["cover-format"],
            plan!.outputSizePx,
            {
                x: plan!.sourcePlacementPx.x + coverFit.cropX,
                y: plan!.sourcePlacementPx.y + coverFit.cropY,
                width: coverFit.cropWidth,
                height: coverFit.cropHeight,
            },
        );
        expect(coverMappedCrop.x).toBeCloseTo(coverLayer.x, 2);
        expect(coverMappedCrop.y).toBeCloseTo(coverLayer.y, 2);
        expect(coverMappedCrop.width).toBeCloseTo(coverLayer.width, 2);
        expect(coverMappedCrop.height).toBeCloseTo(coverLayer.height, 2);

        const containFit = computeImageFitProps(
            "contain",
            sourceSize.width,
            sourceSize.height,
            containLayer.width,
            containLayer.height,
        );
        const containMappedSource = mapOutputRectToArtboard(
            plan!.formatLayerRects!["contain-format"],
            plan!.outputSizePx,
            plan!.sourcePlacementPx,
        );
        expect(containMappedSource.x).toBeCloseTo(containLayer.x + containFit.drawX, 2);
        expect(containMappedSource.y).toBeCloseTo(containLayer.y + containFit.drawY, 2);
        expect(containMappedSource.width).toBeCloseTo(containFit.drawWidth, 2);
        expect(containMappedSource.height).toBeCloseTo(containFit.drawHeight, 2);
    });

    it("falls back when a target binding is content-only", () => {
        const { plan, diagnostics } = computeGridUnionOutpaintPlan({
            masterLayer: { ...MASTER, objectFit: "fill" },
            masterArtboard: { width: 1192, height: 300 },
            formats: [{
                id: "content-resize",
                width: 360,
                height: 360,
                layers: [
                    { id: "content-image", slotId: "image-primary", x: 0, y: 0, width: 360, height: 360, objectFit: "fill" },
                ],
                layerBindings: [{
                    masterLayerId: "master-image",
                    targetLayerId: "content-image",
                    syncContent: true,
                    syncStyle: false,
                    syncSize: false,
                    syncPosition: false,
                    imageSyncMode: "content",
                }],
            }],
            sourceSizePx: { width: 1192, height: 300 },
            options: { bleedPx: 0 },
        });

        expect(plan).toBeNull();
        expect(diagnostics).toContainEqual(expect.objectContaining({ code: "content-sync-skipped" }));
        expect(diagnostics).toContainEqual(expect.objectContaining({ code: "grid-union-fallback" }));
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
