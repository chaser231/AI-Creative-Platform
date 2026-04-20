import { describe, expect, it } from "vitest";
import { parseFigmaUrl } from "../parseUrl";

describe("parseFigmaUrl", () => {
    it("accepts canonical /file/KEY URLs", () => {
        expect(parseFigmaUrl("https://www.figma.com/file/aBc123/My-File")).toEqual({
            fileKey: "aBc123",
        });
    });

    it("accepts /design/KEY URLs (post-DevMode rename)", () => {
        expect(parseFigmaUrl("https://www.figma.com/design/XYZ9/Brand-Kit?t=1234")).toEqual({
            fileKey: "XYZ9",
        });
    });

    it("accepts /proto/KEY URLs", () => {
        expect(parseFigmaUrl("https://figma.com/proto/KKK/demo")).toEqual({ fileKey: "KKK" });
    });

    it("extracts node-id with the legacy colon encoding", () => {
        const r = parseFigmaUrl("https://www.figma.com/file/aBc123/My-File?node-id=1%3A23");
        expect(r).toEqual({ fileKey: "aBc123", nodeId: "1:23" });
    });

    it("normalises new dash-encoded node-id to colon form", () => {
        const r = parseFigmaUrl("https://www.figma.com/design/aBc123/My-File?node-id=1-23");
        expect(r).toEqual({ fileKey: "aBc123", nodeId: "1:23" });
    });

    it("accepts a bare file key", () => {
        expect(parseFigmaUrl("aBc123DEF456")).toEqual({ fileKey: "aBc123DEF456" });
    });

    it("rejects non-Figma hosts", () => {
        expect(parseFigmaUrl("https://example.com/file/aBc123/X")).toBeNull();
    });

    it("rejects garbage input", () => {
        expect(parseFigmaUrl("")).toBeNull();
        expect(parseFigmaUrl("not a url")).toBeNull();
        expect(parseFigmaUrl("https://www.figma.com/boards/abc")).toBeNull();
    });
});
