import { describe, expect, it } from "vitest";
import { getDefaultResolution, getMaxOutputs } from "@/lib/ai-models";
import { normalizeImageOutputs } from "@/lib/ai-providers";

describe("multi-output model capabilities", () => {
    it("defaults Google-tier models to 2K resolution", () => {
        expect(getDefaultResolution("nano-banana-2")).toBe("2K");
        expect(getDefaultResolution("nano-banana-pro")).toBe("2K");
        expect(getDefaultResolution("dall-e-3")).toBe("");
    });

    it("exposes multi-output only for supported image models", () => {
        expect(getMaxOutputs("nano-banana")).toBe(4);
        expect(getMaxOutputs("nano-banana-2")).toBe(4);
        expect(getMaxOutputs("nano-banana-pro")).toBe(4);
        expect(getMaxOutputs("gpt-image-2")).toBe(4);
        expect(getMaxOutputs("seedream-5")).toBe(6);
        expect(getMaxOutputs("flux-dev")).toBe(4);
        expect(getMaxOutputs("flux-schnell")).toBe(4);
        expect(getMaxOutputs("flux-2-pro")).toBe(1);
        expect(getMaxOutputs("flux-1.1-pro")).toBe(1);
        expect(getMaxOutputs("flux-lora")).toBe(4);
        expect(getMaxOutputs("qwen-image-lora")).toBe(4);
        expect(getMaxOutputs("dall-e-3")).toBe(1);
    });

    it("normalizes provider image output shapes", () => {
        expect(normalizeImageOutputs("https://cdn.example.com/a.png")).toEqual([
            "https://cdn.example.com/a.png",
        ]);
        expect(normalizeImageOutputs([
            "https://cdn.example.com/a.png",
            { url: "https://cdn.example.com/b.png" },
            { url: null },
        ])).toEqual([
            "https://cdn.example.com/a.png",
            "https://cdn.example.com/b.png",
        ]);
    });
});
