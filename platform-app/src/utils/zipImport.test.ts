import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
    extractImageEntriesFromZip,
    isImageEntryName,
    mimeForName,
} from "./zipImport";

function fakeImageBytes(): Uint8Array {
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
}

describe("isImageEntryName", () => {
    it("recognises raster image extensions (case-insensitive)", () => {
        expect(isImageEntryName("a.jpg")).toBe(true);
        expect(isImageEntryName("a.PNG")).toBe(true);
        expect(isImageEntryName("photo.webp")).toBe(true);
        expect(isImageEntryName("a.txt")).toBe(false);
        expect(isImageEntryName("noextension")).toBe(false);
    });
});

describe("mimeForName", () => {
    it("maps known extensions and defaults otherwise", () => {
        expect(mimeForName("a.jpg")).toBe("image/jpeg");
        expect(mimeForName("a.webp")).toBe("image/webp");
        expect(mimeForName("a.xyz")).toBe("application/octet-stream");
    });
});

describe("extractImageEntriesFromZip", () => {
    it("extracts only image files, skipping dirs, junk and non-images", async () => {
        const zip = new JSZip();
        zip.file("photos/b.png", fakeImageBytes());
        zip.file("photos/a.jpg", fakeImageBytes());
        zip.file("notes.txt", "hello");
        zip.file("__MACOSX/._a.jpg", fakeImageBytes());
        zip.file(".hidden.png", fakeImageBytes());
        zip.folder("emptydir");

        const buf = await zip.generateAsync({ type: "uint8array" });
        const entries = await extractImageEntriesFromZip(buf);

        // Sorted by path; junk + non-images excluded.
        expect(entries.map((e) => e.path)).toEqual([
            "photos/a.jpg",
            "photos/b.png",
        ]);
        expect(entries[0].name).toBe("a.jpg");
        expect(entries[0].mime).toBe("image/jpeg");
        expect(entries[0].data.byteLength).toBeGreaterThan(0);
    });

    it("returns an empty list for an archive without images", async () => {
        const zip = new JSZip();
        zip.file("readme.md", "# hi");
        const buf = await zip.generateAsync({ type: "uint8array" });
        expect(await extractImageEntriesFromZip(buf)).toEqual([]);
    });
});
