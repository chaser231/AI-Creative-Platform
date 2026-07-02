import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    ensureFontWeightsLoaded,
    findMissingFontWeights,
    ensureFontLoaded,
} from "@/lib/fontLoading";
import { registerFont } from "@/lib/customFonts";
import type { RequiredFont } from "@/utils/fontUtils";

function rf(family: string, weights: string[]): RequiredFont {
    return { family, weights, usedInLayers: [] };
}

describe("ensureFontWeightsLoaded / ensureFontLoaded", () => {
    let available: Set<string>;
    let loadSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        available = new Set<string>();
        loadSpy = vi.fn(async (spec: string) => {
            available.add(spec);
            return [];
        });
        vi.stubGlobal("window", globalThis);
        vi.stubGlobal("document", {
            fonts: {
                check: (spec: string) => available.has(spec),
                load: loadSpy,
            },
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("loads only the weights that are not already resolvable", async () => {
        available.add('400 16px "Inter"');
        await ensureFontWeightsLoaded([rf("Inter", ["400", "700"])]);
        expect(loadSpy).toHaveBeenCalledTimes(1);
        expect(loadSpy).toHaveBeenCalledWith('700 16px "Inter"');
    });

    it("defaults to weight 400 when a family lists no weights", async () => {
        await ensureFontWeightsLoaded([rf("Roboto", [])]);
        expect(loadSpy).toHaveBeenCalledWith('400 16px "Roboto"');
    });

    it("normalizes named weights (bold -> 700, normal -> 400)", async () => {
        await ensureFontWeightsLoaded([rf("Inter", ["bold", "normal"])]);
        expect(loadSpy).toHaveBeenCalledWith('700 16px "Inter"');
        expect(loadSpy).toHaveBeenCalledWith('400 16px "Inter"');
    });

    it("is a no-op without a font API", async () => {
        vi.stubGlobal("document", {});
        await expect(ensureFontWeightsLoaded([rf("Inter", ["400"])])).resolves.toBeUndefined();
    });

    it("ensureFontLoaded loads the exact (family, weight) spec", async () => {
        await ensureFontLoaded("Inter", "700");
        expect(loadSpy).toHaveBeenCalledWith('700 16px "Inter"');
    });
});

describe("findMissingFontWeights", () => {
    let available: Set<string>;

    beforeEach(() => {
        available = new Set<string>();
        vi.stubGlobal("window", globalThis);
        vi.stubGlobal("document", {
            fonts: {
                check: (spec: string) => available.has(spec),
                load: vi.fn(),
            },
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("returns the (family, weight) pairs that fail document.fonts.check", () => {
        available.add('400 16px "Inter"');
        const missing = findMissingFontWeights([
            rf("Inter", ["400", "700"]),
            rf("Roboto", ["400"]),
        ]);
        expect(missing).toEqual([
            { family: "Inter", weight: "700" },
            { family: "Roboto", weight: "400" },
        ]);
    });

    it("returns nothing when every weight is resolvable", () => {
        available.add('400 16px "Inter"');
        available.add('700 16px "Inter"');
        expect(findMissingFontWeights([rf("Inter", ["400", "700"])])).toEqual([]);
    });
});

describe("registerFont dedup", () => {
    let addSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        addSpy = vi.fn();
        class FakeFontFace {
            family: string;
            source: unknown;
            descriptors: unknown;
            constructor(family: string, source: unknown, descriptors?: unknown) {
                this.family = family;
                this.source = source;
                this.descriptors = descriptors;
            }
            load() {
                return Promise.resolve(this);
            }
        }
        vi.stubGlobal("window", globalThis);
        vi.stubGlobal("FontFace", FakeFontFace);
        vi.stubGlobal("document", {
            fonts: { add: addSpy, check: () => false, load: vi.fn() },
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("registers a weight-specific face once per (family, weight)", async () => {
        await registerFont("Dedup Alpha", "blob:1", { weight: 700 });
        await registerFont("Dedup Alpha", "blob:2", { weight: 700 });
        expect(addSpy).toHaveBeenCalledTimes(1);

        // A different weight of the same family is a distinct face.
        await registerFont("Dedup Alpha", "blob:3", { weight: 400 });
        expect(addSpy).toHaveBeenCalledTimes(2);
    });

    it("registers a whole-file face once per family", async () => {
        const buffer = new ArrayBuffer(8);
        await registerFont("Dedup Whole", buffer);
        await registerFont("Dedup Whole", buffer);
        expect(addSpy).toHaveBeenCalledTimes(1);
    });
});
