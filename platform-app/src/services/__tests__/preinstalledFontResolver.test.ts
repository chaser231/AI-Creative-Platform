import { describe, expect, it } from "vitest";
import { preinstalledFontCandidates, resolveManifestFontFile } from "../preinstalledFontResolver";

describe("preinstalledFontResolver", () => {
    it("builds YS Text Cond Heavy filename for weight 800", () => {
        const candidates = preinstalledFontCandidates("YS Text Cond", 800, false);
        expect(candidates[0]).toBe("YS Text Cond-Heavy.ttf");
    });

    it("includes italic variant when requested", () => {
        const candidates = preinstalledFontCandidates("YS Display", 700, true);
        expect(candidates.some((c) => c.includes("Italic"))).toBe(true);
    });

    it("resolves YS Text Cond Heavy from manifest", () => {
        expect(resolveManifestFontFile("YS Text Cond", 800, false)).toBe("YS Text Cond-Heavy.ttf");
    });
});
