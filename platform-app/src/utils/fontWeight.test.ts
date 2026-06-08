import { describe, it, expect } from "vitest";
import { weightLabel } from "@/utils/fontWeight";

describe("weightLabel", () => {
    it("maps standard numeric weights to names", () => {
        expect(weightLabel("400")).toBe("Regular");
        expect(weightLabel("700")).toBe("Bold");
        expect(weightLabel(300)).toBe("Light");
        expect(weightLabel("600")).toBe("Semi Bold");
        expect(weightLabel("900")).toBe("Black");
    });

    it("maps keyword weights", () => {
        expect(weightLabel("normal")).toBe("Regular");
        expect(weightLabel("bold")).toBe("Bold");
    });

    it("falls back to the raw value for non-standard weights", () => {
        expect(weightLabel("450")).toBe("450");
    });

    it("defaults empty/undefined to Regular", () => {
        expect(weightLabel(undefined)).toBe("Regular");
        expect(weightLabel("")).toBe("Regular");
    });
});
