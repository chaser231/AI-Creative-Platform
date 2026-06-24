import { describe, it, expect } from "vitest";
import { deriveSourceNameFromUrl } from "./multiGenImport";

describe("deriveSourceNameFromUrl", () => {
    it("uses the last path segment", () => {
        expect(
            deriveSourceNameFromUrl("https://example.com/images/photo.png"),
        ).toBe("photo.png");
    });

    it("ignores the query string", () => {
        expect(
            deriveSourceNameFromUrl(
                "https://example.com/images/photo.jpg?size=large&v=2",
            ),
        ).toBe("photo.jpg");
    });

    it("handles avatarnica-style URLs without an extension", () => {
        expect(
            deriveSourceNameFromUrl(
                "https://avatars.mds.yandex.net/get-mpic/123456/abc/orig",
            ),
        ).toBe("orig");
    });

    it("decodes percent-encoded segments", () => {
        expect(
            deriveSourceNameFromUrl(
                "https://example.com/folder/my%20photo.png",
            ),
        ).toBe("my photo.png");
    });

    it("falls back to the host when the path is empty", () => {
        expect(deriveSourceNameFromUrl("https://example.com/")).toBe(
            "example.com",
        );
        expect(deriveSourceNameFromUrl("https://example.com")).toBe(
            "example.com",
        );
    });

    it("falls back to a trimmed tail for unparseable input", () => {
        expect(deriveSourceNameFromUrl("not a url/last-bit")).toBe("last-bit");
    });
});
