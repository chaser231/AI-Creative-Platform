import { describe, expect, it } from "vitest";
import {
    addReflectionParamsSchema,
    assetOutputParamsSchema,
    blurParamsSchema,
    imageInputParamsSchema,
    maskParamsSchema,
    NODE_PARAM_SCHEMAS,
    removeBackgroundParamsSchema,
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
    it("applies defaults (top-to-bottom 1→0)", () => {
        const r = maskParamsSchema.safeParse({});
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.direction).toBe("top-to-bottom");
            expect(r.data.start).toBe(1);
            expect(r.data.end).toBe(0);
        }
    });

    it("rejects start outside [0,1]", () => {
        expect(maskParamsSchema.safeParse({ start: -0.1 }).success).toBe(false);
        expect(maskParamsSchema.safeParse({ start: 1.5 }).success).toBe(false);
    });

    it("accepts inverted gradient (start=0 end=1)", () => {
        const r = maskParamsSchema.safeParse({ start: 0, end: 1 });
        expect(r.success).toBe(true);
    });
});

describe("blurParamsSchema", () => {
    it("applies uniform defaults", () => {
        const r = blurParamsSchema.safeParse({});
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.mode).toBe("uniform");
            expect(r.data.intensity).toBe(4);
        }
    });

    it("accepts progressive with end > start", () => {
        const r = blurParamsSchema.safeParse({
            mode: "progressive",
            start: 0,
            end: 12,
            direction: "top-to-bottom",
        });
        expect(r.success).toBe(true);
    });

    it("rejects progressive with end <= start", () => {
        const r = blurParamsSchema.safeParse({
            mode: "progressive",
            start: 8,
            end: 8,
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
                "imageInput",
                "mask",
                "removeBackground",
            ].sort(),
        );
    });
});
