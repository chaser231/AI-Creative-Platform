import { describe, expect, it } from "vitest";
import {
    addReflectionParamsSchema,
    assetOutputParamsSchema,
    blurParamsSchema,
    imageGenerationParamsSchema,
    imageInputParamsSchema,
    maskParamsSchema,
    NODE_PARAM_SCHEMAS,
    removeBackgroundParamsSchema,
    textGenerationParamsSchema,
} from "@/lib/workflow/nodeParamSchemas";

describe("imageInputParamsSchema", () => {
    it("accepts asset source with assetId", () => {
        const r = imageInputParamsSchema.safeParse({ source: "asset", assetId: "a-1" });
        expect(r.success).toBe(true);
    });

    it("accepts url source with sourceUrl", () => {
        const r = imageInputParamsSchema.safeParse({
            source: "url",
            sourceUrl: "https://example.com/x.png",
        });
        expect(r.success).toBe(true);
    });

    it("rejects asset source without assetId", () => {
        const r = imageInputParamsSchema.safeParse({ source: "asset" });
        expect(r.success).toBe(false);
    });

    it("rejects url source without sourceUrl", () => {
        const r = imageInputParamsSchema.safeParse({ source: "url" });
        expect(r.success).toBe(false);
    });

    it("rejects malformed url", () => {
        const r = imageInputParamsSchema.safeParse({ source: "url", sourceUrl: "not-a-url" });
        expect(r.success).toBe(false);
    });
});

describe("imageGenerationParamsSchema", () => {
    it("accepts prompt with default image generation controls", () => {
        const r = imageGenerationParamsSchema.safeParse({
            prompt: "Premium product photo on a clean studio background",
        });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.model).toBe("flux-schnell");
            expect(r.data.style).toBe("photo");
            expect(r.data.aspectRatio).toBe("1:1");
        }
    });

    it("rejects an empty prompt", () => {
        const r = imageGenerationParamsSchema.safeParse({ prompt: "" });
        expect(r.success).toBe(false);
    });
});

describe("textGenerationParamsSchema", () => {
    it("accepts prompt with default text generation controls", () => {
        const r = textGenerationParamsSchema.safeParse({
            prompt: "Заголовок для весенней распродажи",
        });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.mode).toBe("headline");
            expect(r.data.tone).toBe("bold");
        }
    });

    it("accepts subtitle and freeform modes", () => {
        expect(
            textGenerationParamsSchema.safeParse({
                prompt: "Подзаголовок для новой коллекции",
                mode: "subtitle",
                tone: "neutral",
            }).success,
        ).toBe(true);
        expect(
            textGenerationParamsSchema.safeParse({
                prompt: "Короткий текст о доставке",
                mode: "freeform",
                tone: "formal",
            }).success,
        ).toBe(true);
    });

    it("rejects an empty prompt", () => {
        const r = textGenerationParamsSchema.safeParse({ prompt: "" });
        expect(r.success).toBe(false);
    });
});

describe("removeBackgroundParamsSchema", () => {
    it("applies default model (birefnet) when omitted", () => {
        const r = removeBackgroundParamsSchema.safeParse({});
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.model).toBe("fal-birefnet");
    });

    it("accepts legacy model ids", () => {
        for (const m of ["fal-bria", "replicate-bria-cutout", "replicate-rembg"] as const) {
            const r = removeBackgroundParamsSchema.safeParse({ model: m });
            expect(r.success).toBe(true);
        }
    });

    it("rejects unknown model enum value", () => {
        const r = removeBackgroundParamsSchema.safeParse({ model: "magic-cutout" });
        expect(r.success).toBe(false);
    });
});

describe("addReflectionParamsSchema", () => {
    it("applies default model (nano-banana-2)", () => {
        const r = addReflectionParamsSchema.safeParse({});
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.model).toBe("nano-banana-2");
    });

    it("accepts each cascade model", () => {
        for (const m of ["nano-banana-2", "bria-product-shot", "flux-kontext-pro"] as const) {
            const r = addReflectionParamsSchema.safeParse({ model: m });
            expect(r.success).toBe(true);
        }
    });

    it("rejects unknown model enum value", () => {
        const r = addReflectionParamsSchema.safeParse({ model: "stable-diffusion" });
        expect(r.success).toBe(false);
    });
});

describe("assetOutputParamsSchema", () => {
    it("applies default name", () => {
        const r = assetOutputParamsSchema.safeParse({});
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.name).toBe("Workflow output");
    });

    it("rejects empty name", () => {
        const r = assetOutputParamsSchema.safeParse({ name: "" });
        expect(r.success).toBe(false);
    });

    it("rejects name > 120 chars", () => {
        const r = assetOutputParamsSchema.safeParse({ name: "x".repeat(121) });
        expect(r.success).toBe(false);
    });
});

describe("maskParamsSchema", () => {
    it("applies Figma-style defaults (bottom-to-top band 0→50%, alpha 0→1)", () => {
        const r = maskParamsSchema.safeParse({});
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.direction).toBe("bottom-to-top");
            expect(r.data.startPos).toBe(0);
            expect(r.data.endPos).toBe(0.5);
            expect(r.data.startAlpha).toBe(0);
            expect(r.data.endAlpha).toBe(1);
        }
    });

    it("rejects position outside [0,1]", () => {
        expect(maskParamsSchema.safeParse({ startPos: -0.1 }).success).toBe(false);
        expect(maskParamsSchema.safeParse({ endPos: 1.5 }).success).toBe(false);
    });

    it("rejects alpha outside [0,1]", () => {
        expect(maskParamsSchema.safeParse({ startAlpha: -0.1 }).success).toBe(false);
        expect(maskParamsSchema.safeParse({ endAlpha: 1.5 }).success).toBe(false);
    });

    it("rejects degenerate band (endPos <= startPos)", () => {
        expect(
            maskParamsSchema.safeParse({ startPos: 0.5, endPos: 0.5 }).success,
        ).toBe(false);
        expect(
            maskParamsSchema.safeParse({ startPos: 0.7, endPos: 0.3 }).success,
        ).toBe(false);
    });

    it("accepts custom band + inverted alpha (startAlpha=1 endAlpha=0)", () => {
        const r = maskParamsSchema.safeParse({
            startPos: 0.2,
            endPos: 0.8,
            startAlpha: 1,
            endAlpha: 0,
        });
        expect(r.success).toBe(true);
    });
});

describe("blurParamsSchema", () => {
    it("applies progressive Figma-style defaults", () => {
        const r = blurParamsSchema.safeParse({});
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.mode).toBe("progressive");
            expect(r.data.direction).toBe("bottom-to-top");
            expect(r.data.startPos).toBe(0);
            expect(r.data.endPos).toBe(0.5);
            expect(r.data.startIntensity).toBe(16);
            expect(r.data.endIntensity).toBe(0);
        }
    });

    it("accepts progressive with valid band + non-zero intensity", () => {
        const r = blurParamsSchema.safeParse({
            mode: "progressive",
            startPos: 0.2,
            endPos: 0.8,
            startIntensity: 0,
            endIntensity: 12,
            direction: "top-to-bottom",
        });
        expect(r.success).toBe(true);
    });

    it("rejects progressive with degenerate band", () => {
        const r = blurParamsSchema.safeParse({
            mode: "progressive",
            startPos: 0.5,
            endPos: 0.5,
            startIntensity: 0,
            endIntensity: 12,
        });
        expect(r.success).toBe(false);
    });

    it("rejects progressive with zero intensity on both ends", () => {
        const r = blurParamsSchema.safeParse({
            mode: "progressive",
            startPos: 0,
            endPos: 0.5,
            startIntensity: 0,
            endIntensity: 0,
        });
        expect(r.success).toBe(false);
    });

    it("rejects uniform with intensity 0", () => {
        const r = blurParamsSchema.safeParse({ mode: "uniform", intensity: 0 });
        expect(r.success).toBe(false);
    });
});

describe("NODE_PARAM_SCHEMAS", () => {
    it("exposes a schema for every WorkflowNodeType", () => {
        expect(Object.keys(NODE_PARAM_SCHEMAS).sort()).toEqual(
            [
                "addReflection",
                "assetOutput",
                "blur",
                "imageGeneration",
                "imageInput",
                "mask",
                "preview",
                "removeBackground",
                "textGeneration",
            ].sort(),
        );
    });
});
