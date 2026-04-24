import { describe, expect, it } from "vitest";
import {
    addReflectionParamsSchema,
    assetOutputParamsSchema,
    imageInputParamsSchema,
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
    it("applies default model when omitted", () => {
        const r = removeBackgroundParamsSchema.safeParse({});
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.model).toBe("fal-bria");
    });

    it("rejects unknown model enum value", () => {
        const r = removeBackgroundParamsSchema.safeParse({ model: "magic-cutout" });
        expect(r.success).toBe(false);
    });
});

describe("addReflectionParamsSchema", () => {
    it("applies defaults", () => {
        const r = addReflectionParamsSchema.safeParse({});
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.style).toBe("subtle");
            expect(r.data.intensity).toBe(0.3);
        }
    });

    it("rejects intensity > 1", () => {
        const r = addReflectionParamsSchema.safeParse({ intensity: 1.5 });
        expect(r.success).toBe(false);
    });

    it("rejects intensity < 0", () => {
        const r = addReflectionParamsSchema.safeParse({ intensity: -0.1 });
        expect(r.success).toBe(false);
    });

    it("rejects prompt over 500 chars", () => {
        const r = addReflectionParamsSchema.safeParse({ prompt: "x".repeat(501) });
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

describe("NODE_PARAM_SCHEMAS", () => {
    it("exposes a schema for every WorkflowNodeType", () => {
        expect(Object.keys(NODE_PARAM_SCHEMAS).sort()).toEqual(
            ["addReflection", "assetOutput", "imageInput", "removeBackground"].sort(),
        );
    });
});
