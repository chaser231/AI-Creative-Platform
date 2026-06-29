import { describe, expect, it } from "vitest";
import type { Layer } from "@/types";
import {
    getLayerSizeModeConfig,
    layoutSizingOptions,
    resolveLayoutSizingUpdate,
    resolveManualSizeUpdate,
} from "../layerSizing";

const asLayer = (partial: Record<string, unknown>) => partial as unknown as Layer;

describe("layoutSizingOptions (English labels)", () => {
    it("offers Fixed / Fill for non-hug layers", () => {
        const opts = layoutSizingOptions(asLayer({ type: "image" }));
        expect(opts.map((o) => o.value)).toEqual(["fixed", "fill"]);
        expect(opts.map((o) => o.label)).toEqual(["Fixed", "Fill"]);
    });

    it("adds Hug for frame and text layers", () => {
        expect(layoutSizingOptions(asLayer({ type: "frame" })).map((o) => o.label))
            .toEqual(["Fixed", "Fill", "Hug"]);
        expect(layoutSizingOptions(asLayer({ type: "text" })).map((o) => o.label))
            .toEqual(["Fixed", "Fill", "Hug"]);
    });
});

describe("getLayerSizeModeConfig — auto-layout child", () => {
    const child = asLayer({ type: "text", layoutSizingWidth: "fill", layoutSizingHeight: "hug" });

    it("reads the current per-axis sizing value", () => {
        expect(getLayerSizeModeConfig(child, "width", true)?.value).toBe("fill");
        expect(getLayerSizeModeConfig(child, "height", true)?.value).toBe("hug");
    });

    it("the SegmentedControl onChange resolves through resolveLayoutSizingUpdate", () => {
        const cfg = getLayerSizeModeConfig(child, "width", true)!;
        // SizeModeRow calls cfg.toUpdates(value) — must equal the raw resolver.
        expect(cfg.toUpdates("fill")).toEqual(resolveLayoutSizingUpdate(child, "width", "fill"));
        expect(cfg.toUpdates("fill")).toEqual({ layoutSizingWidth: "fill" });
        const hcfg = getLayerSizeModeConfig(child, "height", true)!;
        expect(hcfg.toUpdates("hug")).toEqual({ layoutSizingHeight: "hug" });
    });
});

describe("getLayerSizeModeConfig — layout frame (own auto-layout)", () => {
    const frame = asLayer({
        type: "frame",
        layoutMode: "horizontal",
        primaryAxisSizingMode: "fixed",
        counterAxisSizingMode: "auto",
    });

    it("maps axis sizing to Fixed/Hug options", () => {
        const w = getLayerSizeModeConfig(frame, "width", false)!; // primary axis (horizontal)
        expect(w.options.map((o) => o.label)).toEqual(["Fixed", "Hug"]);
        expect(w.value).toBe("fixed");
        const h = getLayerSizeModeConfig(frame, "height", false)!; // counter axis
        expect(h.value).toBe("hug");
    });

    it("toUpdates writes the matching axis sizing mode", () => {
        const w = getLayerSizeModeConfig(frame, "width", false)!;
        expect(w.toUpdates("hug")).toEqual({ primaryAxisSizingMode: "auto" });
        expect(w.toUpdates("fixed")).toEqual({ primaryAxisSizingMode: "fixed" });
        const h = getLayerSizeModeConfig(frame, "height", false)!;
        expect(h.toUpdates("hug")).toEqual({ counterAxisSizingMode: "auto" });
    });

    it("returns undefined for a plain layer with no layout context", () => {
        expect(getLayerSizeModeConfig(asLayer({ type: "image" }), "width", false)).toBeUndefined();
        expect(getLayerSizeModeConfig(asLayer({ type: "frame", layoutMode: "none" }), "width", false)).toBeUndefined();
    });
});

describe("resolveManualSizeUpdate", () => {
    it("text writes raw intent only (store normalizes textAdjust)", () => {
        const text = asLayer({ type: "text" });
        expect(resolveManualSizeUpdate(text, "width", 120)).toEqual({ width: 120 });
    });

    it("non-text with a non-fixed mode is forced back to fixed", () => {
        const child = asLayer({ type: "image", layoutSizingWidth: "fill" });
        const cfg = getLayerSizeModeConfig(child, "width", true)!;
        expect(resolveManualSizeUpdate(child, "width", 200, cfg)).toEqual({
            width: 200,
            layoutSizingWidth: "fixed",
        });
    });
});

describe("resolveLayoutSizingUpdate", () => {
    it("targets the correct axis property", () => {
        const layer = asLayer({ type: "text" });
        expect(resolveLayoutSizingUpdate(layer, "width", "fill")).toEqual({ layoutSizingWidth: "fill" });
        expect(resolveLayoutSizingUpdate(layer, "height", "hug")).toEqual({ layoutSizingHeight: "hug" });
    });
});
