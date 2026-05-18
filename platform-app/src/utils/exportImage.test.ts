import { describe, expect, it } from "vitest";

import { sanitizeExportFileName } from "./exportImage";

describe("sanitizeExportFileName", () => {
    it("removes characters that are unsafe in downloaded file names", () => {
        expect(sanitizeExportFileName("Wide / Banner: 1192*300?")).toBe("Wide-Banner-1192-300");
    });

    it("falls back to a stable default for empty names", () => {
        expect(sanitizeExportFileName("   ")).toBe("export");
    });
});
