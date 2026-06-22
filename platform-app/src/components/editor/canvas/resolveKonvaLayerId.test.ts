import { describe, expect, it } from "vitest";
import { decodeNamespacedLayerId, encodeNamespacedLayerId } from "./resolveKonvaLayerId";

describe("namespaced layer ids", () => {
    it("encodes formatId + layerId with a colon separator", () => {
        expect(encodeNamespacedLayerId("master", "layer-1")).toBe("master:layer-1");
    });

    it("decodes a namespaced id back into its parts", () => {
        expect(decodeNamespacedLayerId("master:layer-1")).toEqual({
            formatId: "master",
            layerId: "layer-1",
        });
    });

    it("round-trips uuid-style ids", () => {
        const formatId = "7f3c1a2e-0b9d-4c5e-8a1b-2c3d4e5f6a7b";
        const layerId = "1a2b3c4d-5e6f-7081-9203-a4b5c6d7e8f9";
        const encoded = encodeNamespacedLayerId(formatId, layerId);
        expect(decodeNamespacedLayerId(encoded)).toEqual({ formatId, layerId });
    });

    it("treats a plain (non-namespaced) id as layerId with null formatId", () => {
        expect(decodeNamespacedLayerId("just-a-layer-id")).toEqual({
            formatId: null,
            layerId: "just-a-layer-id",
        });
    });

    it("splits on the FIRST colon only (layer ids may not, but be defensive)", () => {
        expect(decodeNamespacedLayerId("fmt:weird:layer")).toEqual({
            formatId: "fmt",
            layerId: "weird:layer",
        });
    });

    it("empty string decodes to an empty layerId", () => {
        expect(decodeNamespacedLayerId("")).toEqual({ formatId: null, layerId: "" });
    });
});
