import { afterEach, describe, expect, it, vi } from "vitest";

const imageUploadMocks = vi.hoisted(() => ({
    persistImageToS3: vi.fn(),
}));

vi.mock("@/utils/imageUpload", () => ({
    persistImageToS3: imageUploadMocks.persistImageToS3,
}));

import { computeFeatherMaskData } from "@/utils/imageComposite";
import {
    buildStudioBriaImageEditBody,
    buildStudioBriaPrompts,
    compositeStudioBriaOutpaint,
    computeStudioBriaGeometryForSource,
    computeStudioBriaRequestScale,
    computeStudioBriaFeatherPx,
    computeStudioBriaGeometry,
    prepareStudioBriaOutpaintSource,
    runStudioBriaOutpaint,
    scaleStudioBriaGeometry,
    validateStudioBriaGeometry,
} from "./studioBriaOutpaint";
import type { ImageLayer } from "@/types";

interface DrawCall {
    canvas: FakeCanvas;
    args: unknown[];
}

const drawCalls: DrawCall[] = [];
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
    globalCompositeOperation: GlobalCompositeOperation = "source-over";

    constructor(readonly canvas: FakeCanvas) {}

    drawImage(_image: unknown, ...args: unknown[]) {
        drawCalls.push({ canvas: this.canvas, args });
    }

    createImageData(width: number, height: number): ImageData {
        return {
            width,
            height,
            colorSpace: "srgb",
            data: new Uint8ClampedArray(width * height * 4),
        } as ImageData;
    }

    putImageData() {
        // no-op for mask tests; draw order/geometry is asserted via drawImage.
    }
}

class FakeImage {
    crossOrigin = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 1;
    naturalHeight = 1;
    private currentSrc = "";

    get src(): string {
        return this.currentSrc;
    }

    set src(value: string) {
        this.currentSrc = value;
        const size = imageSizes.get(value) ?? { width: 1, height: 1 };
        this.naturalWidth = size.width;
        this.naturalHeight = size.height;
        queueMicrotask(() => this.onload?.());
    }
}

function installDomMocks() {
    drawCalls.length = 0;
    imageSizes.clear();
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("document", {
        createElement: vi.fn((tagName: string) => {
            if (tagName !== "canvas") throw new Error(`Unexpected tag: ${tagName}`);
            return new FakeCanvas();
        }),
    });
}

function layer(overrides: Partial<ImageLayer>): ImageLayer {
    return {
        id: "layer-1",
        type: "image",
        x: 0,
        y: 0,
        width: 800,
        height: 300,
        src: "source://image",
        objectFit: "cover",
        focusX: 0.5,
        focusY: 0.5,
        ...overrides,
    } as ImageLayer;
}

afterEach(() => {
    vi.unstubAllGlobals();
    imageUploadMocks.persistImageToS3.mockReset();
    drawCalls.length = 0;
    imageSizes.clear();
});

function registerFakeCanvasUrl(url: string, src: string) {
    const match = src.match(/data:fake-canvas\/(\d+)x(\d+)/);
    if (!match) return;
    imageSizes.set(url, {
        width: Number(match[1]),
        height: Number(match[2]),
    });
}

describe("studio Bria geometry", () => {
    it("converts manual padding into exact Bria canvas geometry", () => {
        const geometry = computeStudioBriaGeometry(
            { width: 320.4, height: 179.6 },
            { top: 20.2, right: 30.8, bottom: 40.1, left: 10.4 },
        );

        expect(geometry.sourceSize).toEqual({ width: 320, height: 180 });
        expect(geometry.pixelPadding).toEqual({ top: 20, right: 31, bottom: 40, left: 10 });
        expect(geometry.canvasSize).toEqual({ width: 361, height: 240 });
        expect(geometry.originalLocation).toEqual({ x: 10, y: 20 });
    });

    it("scales canvas padding from layer pixels into native source pixels", () => {
        const geometry = computeStudioBriaGeometryForSource(
            { width: 1600, height: 600 },
            { width: 800, height: 300 },
            { top: 10, right: 20, bottom: 30, left: 40 },
        );

        expect(geometry.sourceSize).toEqual({ width: 1600, height: 600 });
        expect(geometry.pixelPadding).toEqual({ top: 20, right: 40, bottom: 60, left: 80 });
        expect(geometry.canvasSize).toEqual({ width: 1720, height: 680 });
        expect(geometry.originalLocation).toEqual({ x: 80, y: 20 });
    });

    it("builds the image-edit body without aspectRatio and with strict fallback disabled", () => {
        const geometry = computeStudioBriaGeometry(
            { width: 320, height: 180 },
            { top: 20, right: 30, bottom: 40, left: 10 },
        );
        const prompts = buildStudioBriaPrompts("extend the marble table", {
            prompt: "Clean premium studio background, soft window light, polished marble surface, shallow depth of field, generous negative space.",
            provider: "fal-vision",
            model: "google/gemini-2.5-flash",
        });
        const body = buildStudioBriaImageEditBody({
            imageUrl: "https://storage.yandexcloud.net/acp/source.png",
            projectId: "project-1",
            geometry,
            prompts,
            seed: 77,
        });

        expect(body).toMatchObject({
            action: "outpaint",
            model: "bria-expand",
            imageBase64: "https://storage.yandexcloud.net/acp/source.png",
            canvasSize: [360, 240],
            originalSize: [320, 180],
            originalLocation: [10, 20],
            expandPadding: { top: 20, right: 30, bottom: 40, left: 10 },
            negativePrompt: "",
            seed: 77,
            disableFallback: true,
        });
        expect(String(body.prompt)).toContain("Scene prompt: Clean premium studio background");
        expect(String(body.prompt)).toContain("User context/style hint: extend the marble table");
        expect(body).not.toHaveProperty("aspectRatio");
    });

    it("downscales oversized request geometry and does not hard-stop on low source-area ratio", () => {
        const oversized = computeStudioBriaGeometry(
            { width: 4800, height: 500 },
            { top: 0, right: 400, bottom: 0, left: 0 },
        );
        expect(() => validateStudioBriaGeometry(oversized)).toThrow(/до 5000x5000px/);

        const scaled = scaleStudioBriaGeometry(
            oversized,
            computeStudioBriaRequestScale(oversized),
        );
        expect(scaled.canvasSize.width).toBeLessThanOrEqual(5000);
        expect(scaled.canvasSize.height).toBeLessThanOrEqual(5000);
        expect(() => validateStudioBriaGeometry(scaled)).not.toThrow();

        expect(() => validateStudioBriaGeometry(
            scaleStudioBriaGeometry(computeStudioBriaGeometry(
                { width: 4800, height: 500 },
                { top: 0, right: 10000, bottom: 0, left: 0 },
            ), 0.4),
        )).not.toThrow();
    });
});

describe("studio Bria prompts and feather", () => {
    it("keeps English user direction and strips non-ASCII text for Bria", () => {
        const english = buildStudioBriaPrompts("continue the wooden floor");
        expect(english.prompt).toContain("User context/style hint: continue the wooden floor");
        expect(english.negativePrompt).toBe("");

        const nonEnglish = buildStudioBriaPrompts("расширь фон ✨");
        expect(nonEnglish.prompt).not.toContain("расширь");
        expect(nonEnglish.prompt).not.toMatch(/[а-яА-ЯёЁ]/);
        expect(nonEnglish.prompt).toContain("Extend only the background");
        expect(nonEnglish.prompt).toContain("User context/style hint: Fill seamlessly");

        const enhanced = buildStudioBriaPrompts("расширь фон ✨", {
            prompt: "Soft editorial studio background, neutral wall, diffused daylight, matte surface, quiet negative space.",
            provider: "fal-vision",
            model: "google/gemini-2.5-flash",
        });
        expect(enhanced.prompt).toContain("Scene prompt: Soft editorial studio background");
        expect(enhanced.prompt).not.toMatch(/[а-яА-ЯёЁ]/);
    });

    it("uses a moderate feather and only fades sides that had padding", () => {
        const pad = { top: 40, right: 0, bottom: 0, left: 0 };
        const feather = computeStudioBriaFeatherPx({ width: 1000, height: 500 }, pad);
        expect(feather).toBeGreaterThanOrEqual(12);
        expect(feather).toBeLessThanOrEqual(24);

        const data = computeFeatherMaskData(100, 100, pad, feather);
        const alphaAt = (x: number, y: number) => data[(y * 100 + x) * 4 + 3];
        expect(alphaAt(50, 0)).toBeLessThan(10);
        expect(alphaAt(50, 50)).toBe(255);
        expect(alphaAt(0, 50)).toBe(255);
        expect(alphaAt(99, 50)).toBe(255);
    });
});

describe("prepareStudioBriaOutpaintSource", () => {
    it("rasterizes the visible cover crop at native visible resolution by default", async () => {
        installDomMocks();
        imageSizes.set("source://image", { width: 1600, height: 900 });

        const prepared = await prepareStudioBriaOutpaintSource(
            "source://image",
            layer({ width: 800, height: 300, objectFit: "cover", focusX: 0.75 }),
        );

        expect(prepared).toEqual({
            src: "data:fake-canvas/1600x600",
            width: 1600,
            height: 600,
            changed: true,
        });
        expect(drawCalls[0].args).toEqual([0, 150, 1600, 600, 0, 0, 1600, 600]);
    });

    it("keeps contain letterbox placement at native visible resolution by default", async () => {
        installDomMocks();
        imageSizes.set("source://image", { width: 1000, height: 500 });

        const prepared = await prepareStudioBriaOutpaintSource(
            "source://image",
            layer({ width: 500, height: 500, objectFit: "contain" }),
        );

        expect(prepared.width).toBe(1000);
        expect(prepared.height).toBe(1000);
        expect(prepared.src).toBe("data:fake-canvas/1000x1000");
        expect(drawCalls[0].args).toEqual([0, 0, 1000, 500, 0, 250, 1000, 500]);
    });

    it("supports an extra request downscale target below the visible layer size", async () => {
        installDomMocks();
        imageSizes.set("source://image", { width: 1600, height: 900 });

        const prepared = await prepareStudioBriaOutpaintSource(
            "source://image",
            layer({ width: 800, height: 300, objectFit: "cover" }),
            { width: 400, height: 150 },
        );

        expect(prepared.width).toBe(400);
        expect(prepared.height).toBe(150);
        expect(prepared.src).toBe("data:fake-canvas/400x150");
        expect(drawCalls[0].args).toEqual([0, 150, 1600, 600, 0, 0, 400, 150]);
    });
});

describe("compositeStudioBriaOutpaint", () => {
    it("upsamples Bria's downscaled canvas and overlays the native source in output geometry", async () => {
        installDomMocks();
        imageSizes.set("expanded://request-canvas", { width: 500, height: 250 });
        imageSizes.set("source://native-visible", { width: 800, height: 300 });

        const output = await compositeStudioBriaOutpaint({
            expandedSrc: "expanded://request-canvas",
            sourceSrc: "source://native-visible",
            outputGeometry: computeStudioBriaGeometry(
                { width: 800, height: 300 },
                { top: 100, right: 100, bottom: 100, left: 100 },
            ),
            expandedGeometry: computeStudioBriaGeometry(
                { width: 400, height: 150 },
                { top: 50, right: 50, bottom: 50, left: 50 },
            ),
        });

        expect(output).toBe("data:fake-canvas/1000x500");
        const finalDraws = drawCalls
            .filter((call) => call.canvas.width === 1000 && call.canvas.height === 500)
            .map((call) => call.args);
        expect(finalDraws).toContainEqual([0, 0, 1000, 500]);
        expect(finalDraws).toContainEqual([100, 100]);
    });
});

describe("runStudioBriaOutpaint", () => {
    it("downscales only the Bria request and persists a native-size composite", async () => {
        installDomMocks();
        imageUploadMocks.persistImageToS3.mockImplementation(async (src: string) => {
            if (src === "source://image") {
                const url = "https://storage.yandexcloud.net/acp/source.png";
                imageSizes.set(url, { width: 1000, height: 500 });
                return url;
            }
            if (src === "https://fal.media/expanded.png") {
                const url = "https://storage.yandexcloud.net/acp/expanded.png";
                imageSizes.set(url, { width: 4998, height: 357 });
                return url;
            }
            if (src.startsWith("data:fake-canvas/")) {
                const url = `https://storage.yandexcloud.net/acp/${src.replace(/[^\d+x]/g, "")}.png`;
                registerFakeCanvasUrl(url, src);
                return url;
            }
            return src;
        });

        let requestBody: Record<string, unknown> | null = null;
        const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
            if (url === "/api/ai/studio-bria-prompt-enhance") {
                return {
                    ok: true,
                    json: async () => ({
                        enhancement: {
                            prompt: "Clean white commercial studio background, soft diffused light, matte surface, shallow depth of field.",
                            provider: "fal-vision",
                            model: "google/gemini-2.5-flash",
                        },
                    }),
                } as Response;
            }
            requestBody = JSON.parse(init.body as string);
            return {
                ok: true,
                json: async () => ({
                    content: "https://fal.media/expanded.png",
                    model: "bria-expand",
                    seed: 123,
                }),
            } as Response;
        });
        vi.stubGlobal("fetch", fetchMock);

        const result = await runStudioBriaOutpaint({
            imageSrc: "source://image",
            layer: layer({ width: 1000, height: 500, objectFit: "cover" }),
            canvasPadding: { top: 0, right: 3000, bottom: 0, left: 3000 },
            projectId: "project-1",
        });

        expect(requestBody).not.toBeNull();
        const imageEditBody = requestBody as unknown as Record<string, unknown>;
        expect(imageEditBody).toMatchObject({
            canvasSize: [4998, 357],
            originalSize: [714, 357],
            originalLocation: [2142, 0],
            expandPadding: { top: 0, right: 2142, bottom: 0, left: 2142 },
            negativePrompt: "",
            disableFallback: true,
        });
        expect(String(imageEditBody.prompt)).toContain("Scene prompt: Clean white commercial studio background");
        expect(String(imageEditBody.prompt)).toContain("User context/style hint: Fill seamlessly");
        expect(result.sourceSize).toEqual({ width: 1000, height: 500 });
        expect(result.canvasSize).toEqual({ width: 7000, height: 500 });
        expect(result.src).toBe("https://storage.yandexcloud.net/acp/7000x500.png");
        expect(result.seed).toBe(123);
        expect(result.promptEnhancement).toEqual({
            prompt: "Clean white commercial studio background, soft diffused light, matte surface, shallow depth of field.",
            provider: "fal-vision",
            model: "google/gemini-2.5-flash",
        });

        const finalDraws = drawCalls
            .filter((call) => call.canvas.width === 7000 && call.canvas.height === 500)
            .map((call) => call.args);
        expect(finalDraws).toContainEqual([0, 0, 7000, 500]);
        expect(finalDraws).toContainEqual([3000, 0]);
    });

    it("retries expanded fal result rehosting before drawing the composite", async () => {
        installDomMocks();
        let expandedPersistAttempts = 0;
        imageUploadMocks.persistImageToS3.mockImplementation(async (src: string) => {
            if (src === "source://image") {
                const url = "https://storage.yandexcloud.net/acp/source.png";
                imageSizes.set(url, { width: 1000, height: 500 });
                return url;
            }
            if (src === "https://fal.media/expanded.png") {
                expandedPersistAttempts += 1;
                if (expandedPersistAttempts === 1) return src;
                const url = "https://storage.yandexcloud.net/acp/expanded-retry.png";
                imageSizes.set(url, { width: 1200, height: 500 });
                return url;
            }
            if (src.startsWith("data:fake-canvas/")) {
                const url = `https://storage.yandexcloud.net/acp/${src.replace(/[^\d+x]/g, "")}.png`;
                registerFakeCanvasUrl(url, src);
                return url;
            }
            return src;
        });
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            if (url === "/api/ai/studio-bria-prompt-enhance") {
                return {
                    ok: true,
                    json: async () => ({
                        enhancement: {
                            prompt: "Soft neutral studio wall, natural side light, smooth surface, shallow focus.",
                            provider: "fal-vision",
                            model: "google/gemini-2.5-flash",
                        },
                    }),
                } as Response;
            }
            return {
                ok: true,
                json: async () => ({
                    content: "https://fal.media/expanded.png",
                    model: "bria-expand",
                }),
            } as Response;
        }));

        const result = await runStudioBriaOutpaint({
            imageSrc: "source://image",
            layer: layer({ width: 1000, height: 500, objectFit: "cover" }),
            canvasPadding: { top: 0, right: 100, bottom: 0, left: 100 },
            projectId: "project-1",
        });

        expect(expandedPersistAttempts).toBe(2);
        expect(result.src).toBe("https://storage.yandexcloud.net/acp/1200x500.png");
        const finalDraws = drawCalls
            .filter((call) => call.canvas.width === 1200 && call.canvas.height === 500)
            .map((call) => call.args);
        expect(finalDraws).toContainEqual([0, 0, 1200, 500]);
        expect(finalDraws).toContainEqual([100, 0]);
    });

    it("reuses a supplied enhanced prompt snapshot without calling the enhancer route", async () => {
        installDomMocks();
        imageUploadMocks.persistImageToS3.mockImplementation(async (src: string) => {
            if (src === "source://image") {
                const url = "https://storage.yandexcloud.net/acp/source.png";
                imageSizes.set(url, { width: 1000, height: 500 });
                return url;
            }
            if (src === "https://fal.media/expanded.png") {
                const url = "https://storage.yandexcloud.net/acp/expanded.png";
                imageSizes.set(url, { width: 1200, height: 500 });
                return url;
            }
            if (src.startsWith("data:fake-canvas/")) {
                const url = `https://storage.yandexcloud.net/acp/${src.replace(/[^\d+x]/g, "")}.png`;
                registerFakeCanvasUrl(url, src);
                return url;
            }
            return src;
        });

        let requestBody: Record<string, unknown> | null = null;
        const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
            if (url === "/api/ai/studio-bria-prompt-enhance") {
                throw new Error("enhancer route should not be called for retry snapshots");
            }
            requestBody = JSON.parse(init.body as string);
            return {
                ok: true,
                json: async () => ({
                    content: "https://fal.media/expanded.png",
                    model: "bria-expand",
                }),
            } as Response;
        });
        vi.stubGlobal("fetch", fetchMock);

        const result = await runStudioBriaOutpaint({
            imageSrc: "source://image",
            layer: layer({ width: 1000, height: 500, objectFit: "cover" }),
            canvasPadding: { top: 0, right: 100, bottom: 0, left: 100 },
            prompt: "continue the premium tabletop",
            promptEnhancement: {
                prompt: "Premium tabletop scene, warm softbox lighting, matte wall, polished surface, shallow depth of field.",
                provider: "fal-vision",
                model: "google/gemini-2.5-flash",
            },
            projectId: "project-1",
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(requestBody).not.toBeNull();
        const imageEditBody = requestBody as unknown as Record<string, unknown>;
        expect(String(imageEditBody.prompt)).toContain("Scene prompt: Premium tabletop scene");
        expect(String(imageEditBody.prompt)).toContain("User context/style hint: continue the premium tabletop");
        expect(result.promptEnhancement.provider).toBe("fal-vision");
    });
});
