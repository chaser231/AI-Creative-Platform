import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    buildGptImage2ManualOutpaintPlan,
    buildFalOutpaintMaskPixels,
    chooseOutpaintObjectFitForRect,
    computeFalOutpaintMaskPixelAt,
    computeGptOutputCropPx,
    computeOpenAIOutpaintMaskPixelAt,
    computeSourceFeatherAlphaAt,
    computeTransparentPaddedInputAlphaAt,
    computeUniformContainRect,
    outpaintWithGptImage2PackPlan,
} from "./gptImageOutpaint";
import type { PackOutpaintPlan } from "./packOutpaintPlan";

const imageUploadMocks = vi.hoisted(() => ({
    persistImageToS3: vi.fn(),
    uploadForAI: vi.fn(),
}));

vi.mock("@/utils/imageUpload", () => imageUploadMocks);

interface DrawCall {
    canvas: FakeCanvas;
    image: unknown;
    args: unknown[];
    imageSmoothingEnabled: boolean;
}

const drawCalls: DrawCall[] = [];
const canvases: FakeCanvas[] = [];
const imageSizes = new Map<string, { width: number; height: number }>();

class FakeCanvas {
    width = 0;
    height = 0;
    readonly context = new FakeCanvasContext(this);

    getContext(type: string): FakeCanvasContext | null {
        return type === "2d" ? this.context : null;
    }

    toDataURL(): string {
        return `data:fake-canvas/${this.width}x${this.height}`;
    }
}

class FakeCanvasContext {
    imageSmoothingEnabled = false;
    imageSmoothingQuality: ImageSmoothingQuality = "low";
    filter = "none";
    globalAlpha = 1;
    globalCompositeOperation: GlobalCompositeOperation = "source-over";

    constructor(readonly canvas: FakeCanvas) {}

    drawImage(image: unknown, ...args: unknown[]) {
        drawCalls.push({
            canvas: this.canvas,
            image,
            args,
            imageSmoothingEnabled: this.imageSmoothingEnabled,
        });
    }

    createImageData(width: number, height: number): ImageData {
        return {
            width,
            height,
            colorSpace: "srgb",
            data: new Uint8ClampedArray(width * height * 4),
        } as ImageData;
    }

    putImageData() {}
    save() {}
    restore() {}
}

class FakeImage {
    crossOrigin = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 1;
    naturalHeight = 1;
    width = 1;
    height = 1;
    private currentSrc = "";

    get src(): string {
        return this.currentSrc;
    }

    set src(value: string) {
        this.currentSrc = value;
        const size = imageSizes.get(value) ?? { width: 1, height: 1 };
        this.naturalWidth = size.width;
        this.naturalHeight = size.height;
        this.width = size.width;
        this.height = size.height;
        queueMicrotask(() => this.onload?.());
    }
}

function installOutpaintDomMocks() {
    canvases.length = 0;
    drawCalls.length = 0;
    imageSizes.clear();
    imageSizes.set("source://image", { width: 40, height: 20 });
    imageSizes.set("gpt://persisted", { width: 200, height: 100 });

    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("document", {
        createElement: vi.fn((tagName: string) => {
            if (tagName !== "canvas") throw new Error(`Unexpected tag: ${tagName}`);
            const canvas = new FakeCanvas();
            canvases.push(canvas);
            return canvas;
        }),
    });
    vi.stubGlobal("window", {
        localStorage: {
            getItem: vi.fn(() => "0"),
        },
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
        json: async () => ({ content: "gpt://raw" }),
    })));

    imageUploadMocks.uploadForAI.mockImplementation(async (src: string) => `uploaded:${src}`);
    imageUploadMocks.persistImageToS3.mockImplementation(async (src: string) => {
        if (src === "gpt://raw") return "gpt://persisted";
        return `s3:${src}`;
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    canvases.length = 0;
    drawCalls.length = 0;
    imageSizes.clear();
});

describe("chooseOutpaintObjectFitForRect", () => {
    it("uses fill when bitmap and layer aspects match", () => {
        expect(
            chooseOutpaintObjectFitForRect(
                { width: 1600, height: 900 },
                { width: 800, height: 450 },
            ),
        ).toBe("fill");
    });

    it("falls back to cover when fill would stretch the result", () => {
        expect(
            chooseOutpaintObjectFitForRect(
                { width: 1600, height: 900 },
                { width: 800, height: 600 },
            ),
        ).toBe("cover");
    });
});

describe("fal GPT Image 2 outpaint request helpers", () => {
    const sourceRect = { x: 10, y: 20, width: 100, height: 80 };

    it("builds a black/white fal mask where padding is editable and source is preserved", () => {
        expect(computeFalOutpaintMaskPixelAt(0, 60, sourceRect)).toEqual({
            r: 255,
            g: 255,
            b: 255,
            a: 255,
        });
        expect(computeFalOutpaintMaskPixelAt(60, 60, sourceRect)).toEqual({
            r: 0,
            g: 0,
            b: 0,
            a: 255,
        });
    });

    it("builds an OpenAI alpha mask where padding is transparent/editable and source is opaque/preserved", () => {
        expect(computeOpenAIOutpaintMaskPixelAt(0, 60, sourceRect)).toEqual({
            r: 255,
            g: 255,
            b: 255,
            a: 0,
        });
        expect(computeOpenAIOutpaintMaskPixelAt(60, 60, sourceRect)).toEqual({
            r: 0,
            g: 0,
            b: 0,
            a: 255,
        });
    });

    it("builds fal mask pixels with the requested dimensions", () => {
        const pixels = buildFalOutpaintMaskPixels({ width: 13, height: 7 }, sourceRect);

        expect(pixels.width).toBe(13);
        expect(pixels.height).toBe(7);
        expect(pixels.data).toHaveLength(13 * 7 * 4);
    });

    it("emits a strictly binary mask — only 0 or 255 on every channel", () => {
        const pixels = buildFalOutpaintMaskPixels(
            { width: 64, height: 32 },
            { x: 12, y: 4, width: 30, height: 20 },
        );

        for (let i = 0; i < pixels.data.length; i++) {
            const v = pixels.data[i];
            expect(v === 0 || v === 255).toBe(true);
        }
    });

    it("preserves asymmetric source placement — mask reflects the requested rect, not the canvas center", () => {
        const size = { width: 200, height: 120 };
        const asymmetric = { x: 10, y: 80, width: 150, height: 30 };
        const pixels = buildFalOutpaintMaskPixels(size, asymmetric);

        const px = (x: number, y: number) => pixels.data[(y * size.width + x) * 4];
        expect(px(0, 0)).toBe(255); // top-left padding → editable
        expect(px(50, 90)).toBe(0); // inside source → preserved
        expect(px(100, 50)).toBe(255); // above the source rect → editable
        expect(px(180, 90)).toBe(255); // right of the source rect → editable
    });

    it("emits alpha-mode mask pixels for Studio/OpenAI outpaint", () => {
        const size = { width: 200, height: 120 };
        const asymmetric = { x: 10, y: 80, width: 150, height: 30 };
        const pixels = buildFalOutpaintMaskPixels(size, asymmetric, "alpha");

        const alpha = (x: number, y: number) => pixels.data[(y * size.width + x) * 4 + 3];
        expect(alpha(0, 0)).toBe(0); // top-left padding → editable
        expect(alpha(50, 90)).toBe(255); // inside source → preserved
        expect(alpha(100, 50)).toBe(0); // above the source rect → editable
        expect(alpha(180, 90)).toBe(0); // right of the source rect → editable
    });

    it("uses transparent padding for the default GPT input canvas", () => {
        expect(computeTransparentPaddedInputAlphaAt(0, 60, sourceRect)).toBe(0);
        expect(computeTransparentPaddedInputAlphaAt(60, 60, sourceRect)).toBe(255);
    });
});

describe("buildGptImage2ManualOutpaintPlan", () => {
    it("keeps source placement equal to user padding while request-only padding satisfies the 3:1 cap", () => {
        const plan = buildGptImage2ManualOutpaintPlan({
            sourceSizePx: { width: 1192, height: 300 },
            layerSize: { width: 1192, height: 300 },
            canvasPadding: { top: 32, right: 32, bottom: 32, left: 32 },
        });

        expect(plan.outputSizePx).toEqual({ width: 1256, height: 364 });
        expect(plan.sourcePlacementPx).toEqual({ x: 32, y: 32, width: 1192, height: 300 });
        expect(plan.nextMasterRect).toEqual({ x: -32, y: -32, width: 1256, height: 364 });
        expect(plan.requestSizePx.width / plan.requestSizePx.height).toBeLessThanOrEqual(3.05);
        expect(plan.requestSourcePlacementPx.y).toBeGreaterThan(plan.sourcePlacementPx.y);
        expect(plan.requestOutputCropPx.y).toBeGreaterThan(0);
        expect(plan.requestOutputCropPx.height).toBeLessThan(plan.requestSizePx.height);
    });

    it("does not add a request crop when manual padding is already inside the GPT aspect envelope", () => {
        const plan = buildGptImage2ManualOutpaintPlan({
            sourceSizePx: { width: 800, height: 600 },
            layerSize: { width: 400, height: 300 },
            canvasPadding: { top: 50, right: 100, bottom: 50, left: 100 },
        });

        expect(plan.outputSizePx).toEqual({ width: 1200, height: 800 });
        expect(plan.sourcePlacementPx).toEqual({ x: 200, y: 100, width: 800, height: 600 });
        expect(plan.requestOutputCropPx).toEqual({
            x: 0,
            y: 0,
            width: plan.requestSizePx.width,
            height: plan.requestSizePx.height,
        });
    });
});

describe("computeGptOutputCropPx", () => {
    it("keeps legacy crop behavior by default", () => {
        const result = computeGptOutputCropPx({
            requestSizePx: { width: 100, height: 50 },
            gptSizePx: { width: 200, height: 100 },
            requestOutputCropPx: { x: 10, y: 5, width: 80, height: 40 },
            requestSourcePlacementPx: { x: 13, y: 10, width: 49, height: 24 },
            outputSizePx: { width: 80, height: 40 },
            sourcePlacementPx: { x: 10, y: 8, width: 40, height: 20 },
        });

        expect(result.alignment).toBe("legacy");
        expect(result.crop).toEqual({ x: 20, y: 10, width: 160, height: 80 });
    });

    it("anchors the GPT crop so the request source rect maps back to the final source placement", () => {
        const result = computeGptOutputCropPx({
            cropAlignment: "source-anchor",
            requestSizePx: { width: 100, height: 50 },
            gptSizePx: { width: 200, height: 100 },
            requestOutputCropPx: { x: 10, y: 5, width: 80, height: 40 },
            requestSourcePlacementPx: { x: 13, y: 10, width: 49, height: 24 },
            outputSizePx: { width: 80, height: 40 },
            sourcePlacementPx: { x: 10, y: 8, width: 40, height: 20 },
        });

        expect(result.alignment).toBe("source-anchor");
        const sourceRectInGpt = { x: 13 * 2, y: 10 * 2, width: 49 * 2, height: 24 * 2 };
        const mapped = {
            x: (sourceRectInGpt.x - result.crop.x) * (80 / result.crop.width),
            y: (sourceRectInGpt.y - result.crop.y) * (40 / result.crop.height),
            width: sourceRectInGpt.width * (80 / result.crop.width),
            height: sourceRectInGpt.height * (40 / result.crop.height),
        };
        expect(mapped.x).toBeCloseTo(10, 0);
        expect(mapped.y).toBeCloseTo(8, 0);
        expect(mapped.width).toBeCloseTo(40, 0);
        expect(mapped.height).toBeCloseTo(20, 0);
    });

    it("falls back to legacy when source-anchor crop would exceed the GPT bitmap", () => {
        const result = computeGptOutputCropPx({
            cropAlignment: "source-anchor",
            requestSizePx: { width: 100, height: 50 },
            gptSizePx: { width: 200, height: 100 },
            requestOutputCropPx: { x: 10, y: 5, width: 80, height: 40 },
            requestSourcePlacementPx: { x: 15, y: 11, width: 50, height: 25 },
            outputSizePx: { width: 80, height: 40 },
            sourcePlacementPx: { x: 10, y: 8, width: 40, height: 20 },
        });

        expect(result.alignment).toBe("legacy");
        expect(result.crop).toEqual({ x: 20, y: 10, width: 160, height: 80 });
    });
});

describe("computeSourceFeatherAlphaAt", () => {
    it("keeps the source core fully opaque", () => {
        expect(computeSourceFeatherAlphaAt(
            40, 20,
            { width: 80, height: 40 },
            { top: 8, right: 30, bottom: 12, left: 10 },
            16,
        )).toBe(255);
    });

    it("fades only edges adjacent to generated padding", () => {
        const size = { width: 80, height: 40 };
        const padding = { top: 0, right: 30, bottom: 0, left: 10 };

        expect(computeSourceFeatherAlphaAt(0, 20, size, padding, 16)).toBe(0);
        expect(computeSourceFeatherAlphaAt(8, 20, size, padding, 16)).toBeGreaterThan(0);
        expect(computeSourceFeatherAlphaAt(8, 20, size, padding, 16)).toBeLessThan(255);
        expect(computeSourceFeatherAlphaAt(79, 20, size, padding, 16)).toBe(0);
    });

    it("does not fade a side with no generated padding", () => {
        expect(computeSourceFeatherAlphaAt(
            0, 20,
            { width: 80, height: 40 },
            { top: 0, right: 30, bottom: 0, left: 0 },
            16,
        )).toBe(255);
    });
});

describe("outpaintWithGptImage2PackPlan", () => {
    beforeEach(() => {
        installOutpaintDomMocks();
    });

    it("keeps pack/default behavior model-preserved unless hard-composite is requested", async () => {
        const plan: PackOutpaintPlan = {
            canvasPadding: { top: 8, right: 30, bottom: 12, left: 10 },
            nextMasterRect: { x: -10, y: -8, width: 80, height: 40 },
            outputSizePx: { width: 80, height: 40 },
            requestSizePx: { width: 100, height: 50 },
            sourcePlacementPx: { x: 10, y: 8, width: 40, height: 20 },
            requestSourcePlacementPx: { x: 15, y: 11, width: 50, height: 25 },
            requestOutputCropPx: { x: 10, y: 5, width: 80, height: 40 },
            diagnostics: [],
        };

        const result = await outpaintWithGptImage2PackPlan({
            imageSrc: "source://image",
            plan,
            projectId: "project-1",
        });

        const finalCanvas = canvases.find((canvas) => canvas.width === 80 && canvas.height === 40);
        expect(finalCanvas).toBeDefined();
        const finalDraws = drawCalls.filter((call) => call.canvas === finalCanvas);
        expect(finalDraws).toHaveLength(1);
        expect((finalDraws[0].image as FakeImage).src).toBe("gpt://persisted");
        expect(finalDraws[0].args).toEqual([
            20, 10, 160, 80,
            0, 0, 80, 40,
        ]);
        expect(finalDraws.some((call) => (call.image as FakeImage).src === "source://image")).toBe(false);
        expect(imageUploadMocks.uploadForAI.mock.calls.slice(0, 2).map(([src]) => src)).toEqual([
            "data:fake-canvas/100x50",
            "data:fake-canvas/100x50",
        ]);
        expect(result).toMatchObject({
            src: "s3:data:fake-canvas/80x40",
            outputSizePx: { width: 80, height: 40 },
        });
    });

    it("hard-composites the original source back into the Studio manual outpaint rect", async () => {
        vi.stubGlobal("window", {
            localStorage: {
                getItem: vi.fn(() => null),
            },
        });
        const plan: PackOutpaintPlan = {
            canvasPadding: { top: 8, right: 30, bottom: 12, left: 10 },
            nextMasterRect: { x: -10, y: -8, width: 80, height: 40 },
            outputSizePx: { width: 80, height: 40 },
            requestSizePx: { width: 100, height: 50 },
            sourcePlacementPx: { x: 10, y: 8, width: 40, height: 20 },
            requestSourcePlacementPx: { x: 15, y: 11, width: 50, height: 25 },
            requestOutputCropPx: { x: 10, y: 5, width: 80, height: 40 },
            diagnostics: [],
        };

        const result = await outpaintWithGptImage2PackPlan({
            imageSrc: "source://image",
            plan,
            projectId: "project-1",
            sourcePreservation: "hard-composite",
            paddingContext: "transparent",
            maskMode: "alpha",
        });

        const finalCanvas = canvases.find((canvas) => canvas.width === 80 && canvas.height === 40);
        expect(finalCanvas).toBeDefined();
        const finalDraws = drawCalls.filter((call) => call.canvas === finalCanvas);
        expect(finalDraws).toHaveLength(2);
        expect((finalDraws[0].image as FakeImage).src).toBe("gpt://persisted");
        expect(finalDraws[0].args).toEqual([
            20, 10, 160, 80,
            0, 0, 80, 40,
        ]);
        expect((finalDraws[1].image as FakeImage).src).toBe("source://image");
        expect(finalDraws[1].args).toEqual([
            0, 0, 40, 20,
            10, 8, 40, 20,
        ]);
        expect(finalDraws[1].imageSmoothingEnabled).toBe(false);

        const requestDraws = drawCalls.filter((call) => call.canvas.width === 100 && call.canvas.height === 50);
        expect(requestDraws).toHaveLength(1);
        expect((requestDraws[0].image as FakeImage).src).toBe("source://image");
        expect(imageUploadMocks.uploadForAI.mock.calls.slice(0, 2).map(([src]) => src)).toEqual([
            "data:fake-canvas/100x50",
            "data:fake-canvas/100x50",
        ]);
        expect(result).toMatchObject({
            src: "s3:data:fake-canvas/80x40",
            outputSizePx: { width: 80, height: 40 },
        });
    });

    it("uses source-anchor crop and a feathered source overlay for Studio single-pass outpaint", async () => {
        vi.stubGlobal("window", {
            localStorage: {
                getItem: vi.fn(() => null),
            },
        });
        const plan: PackOutpaintPlan = {
            canvasPadding: { top: 8, right: 30, bottom: 12, left: 10 },
            nextMasterRect: { x: -10, y: -8, width: 80, height: 40 },
            outputSizePx: { width: 80, height: 40 },
            requestSizePx: { width: 100, height: 50 },
            sourcePlacementPx: { x: 10, y: 8, width: 40, height: 20 },
            requestSourcePlacementPx: { x: 13, y: 10, width: 49, height: 24 },
            requestOutputCropPx: { x: 10, y: 5, width: 80, height: 40 },
            diagnostics: [],
        };

        const result = await outpaintWithGptImage2PackPlan({
            imageSrc: "source://image",
            plan,
            projectId: "project-1",
            sourcePreservation: "hard-composite",
            paddingContext: "transparent",
            maskMode: "alpha",
            cropAlignment: "source-anchor",
            sourceFeatherPx: 16,
        });

        expect(fetch).toHaveBeenCalledTimes(1);
        const finalCanvas = canvases.find((canvas) => canvas.width === 80 && canvas.height === 40);
        expect(finalCanvas).toBeDefined();
        const finalDraws = drawCalls.filter((call) => call.canvas === finalCanvas);
        expect(finalDraws).toHaveLength(2);
        expect((finalDraws[0].image as FakeImage).src).toBe("gpt://persisted");
        expect(finalDraws[0].args).toEqual([
            2, 1, 196, 96,
            0, 0, 80, 40,
        ]);
        expect(finalDraws[1].image).toBeInstanceOf(FakeCanvas);
        expect((finalDraws[1].image as FakeCanvas).width).toBe(40);
        expect((finalDraws[1].image as FakeCanvas).height).toBe(20);
        expect(finalDraws[1].args).toEqual([10, 8]);
        expect(result).toMatchObject({
            src: "s3:data:fake-canvas/80x40",
            outputSizePx: { width: 80, height: 40 },
        });
    });
});

describe("computeUniformContainRect", () => {
    it("centers a wider source inside a square target with horizontal letterbox", () => {
        const rect = computeUniformContainRect(
            { width: 200, height: 100 },
            { width: 300, height: 300 },
        );

        expect(rect.width).toBe(300);
        expect(rect.height).toBe(150);
        expect(rect.x).toBe(0);
        expect(rect.y).toBe(75);
    });

    it("centers a taller source inside a wider target with vertical letterbox", () => {
        const rect = computeUniformContainRect(
            { width: 100, height: 200 },
            { width: 400, height: 300 },
        );

        expect(rect.width).toBe(150);
        expect(rect.height).toBe(300);
        expect(rect.x).toBe(125);
        expect(rect.y).toBe(0);
    });

    it("preserves source aspect when source already matches target aspect", () => {
        const rect = computeUniformContainRect(
            { width: 1356, height: 899 },
            { width: 1356, height: 899 },
        );

        expect(rect).toEqual({ x: 0, y: 0, width: 1356, height: 899 });
    });
});
