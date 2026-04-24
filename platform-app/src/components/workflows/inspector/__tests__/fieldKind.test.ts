import { describe, expect, it } from "vitest";
import { z } from "zod";
import { pickFieldKind } from "@/components/workflows/inspector/fieldKind";

describe("pickFieldKind", () => {
    it("classifies plain string as 'string'", () => {
        const r = pickFieldKind(z.string());
        expect(r.kind).toBe("string");
        expect(r.optional).toBe(false);
    });

    it("classifies long-max string as 'textarea'", () => {
        const r = pickFieldKind(z.string().max(500));
        expect(r.kind).toBe("textarea");
    });

    it("classifies number without bounds as 'number'", () => {
        const r = pickFieldKind(z.number());
        expect(r.kind).toBe("number");
        expect(r.min).toBeUndefined();
        expect(r.max).toBeUndefined();
    });

    it("classifies bounded number as 'slider' with bounds", () => {
        const r = pickFieldKind(z.number().min(0).max(1));
        expect(r.kind).toBe("slider");
        expect(r.min).toBe(0);
        expect(r.max).toBe(1);
    });

    it("classifies enum and exposes options", () => {
        const r = pickFieldKind(z.enum(["a", "b", "c"]));
        expect(r.kind).toBe("enum");
        expect(r.options).toEqual(["a", "b", "c"]);
    });

    it("classifies boolean as 'boolean'", () => {
        const r = pickFieldKind(z.boolean());
        expect(r.kind).toBe("boolean");
    });

    it("unwraps z.optional()", () => {
        const r = pickFieldKind(z.string().optional());
        expect(r.kind).toBe("string");
        expect(r.optional).toBe(true);
    });

    it("unwraps z.default() and marks optional", () => {
        const r = pickFieldKind(z.enum(["x", "y"]).default("x"));
        expect(r.kind).toBe("enum");
        expect(r.optional).toBe(true);
        expect(r.options).toEqual(["x", "y"]);
    });

    it("returns 'unsupported' for unknown shapes", () => {
        const r = pickFieldKind(z.object({ a: z.string() }));
        expect(r.kind).toBe("unsupported");
    });
});
