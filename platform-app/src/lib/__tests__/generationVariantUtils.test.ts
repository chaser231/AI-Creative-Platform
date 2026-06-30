import { describe, expect, it } from "vitest";
import { capLayerVariants, MAX_VARIANTS_PER_LAYER } from "../generationVariantUtils";

describe("capLayerVariants", () => {
    it("returns input when within limit", () => {
        const variants = [1, 2, 3];
        expect(capLayerVariants(variants)).toEqual(variants);
    });

    it("keeps only the most recent variants", () => {
        const variants = Array.from({ length: MAX_VARIANTS_PER_LAYER + 5 }, (_, i) => i);
        const capped = capLayerVariants(variants);
        expect(capped).toHaveLength(MAX_VARIANTS_PER_LAYER);
        expect(capped[0]).toBe(5);
        expect(capped[capped.length - 1]).toBe(MAX_VARIANTS_PER_LAYER + 4);
    });
});
