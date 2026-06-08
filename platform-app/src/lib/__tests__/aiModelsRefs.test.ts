import { describe, it, expect } from "vitest";
import {
    getMaxRefs,
    getImageGenerationPickerOptions,
    resolveRefTags,
} from "@/lib/ai-models";

describe("ai-models reference helpers", () => {
    it("hides style-preview-only Flux models from picker options", () => {
        const ids = getImageGenerationPickerOptions().map((model) => model.id);
        expect(ids).not.toContain("flux-schnell");
        expect(ids).not.toContain("flux-dev");
        expect(ids).not.toContain("flux-1.1-pro");
        expect(ids).toContain("flux-2-pro");
    });

    it("exposes reference slots for flux-2-pro and flux-2-lora", () => {
        expect(getMaxRefs("flux-2-pro")).toBe(8);
        expect(getMaxRefs("flux-2-lora")).toBe(3);
    });

    it("maps @ref tags to fal-native @image tags for Flux models", () => {
        expect(resolveRefTags("@ref1 on beige cyclorama", "flux-2-pro"))
            .toBe("@image1 on beige cyclorama");
        expect(resolveRefTags("@ref2 detail", "flux-2-lora"))
            .toBe("@image2 detail");
    });
});
