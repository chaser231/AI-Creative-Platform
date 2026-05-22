import { describe, expect, it, vi, afterEach } from "vitest";
import { hasPersistableImageSources, persistImageSourcesInObject } from "@/utils/imageUpload";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("template/canvas image source persistence", () => {
  it("detects image sources nested in resize snapshots and layer trees", () => {
    expect(hasPersistableImageSources({
      layers: [{ type: "image", src: "https://storage.yandexcloud.net/acp-assets/existing.png" }],
      resizes: [{ layerSnapshot: [{ type: "image", src: "data:image/png;base64,aGVsbG8=" }] }],
    })).toBe(true);
  });

  it("persists duplicate inline image sources before sending JSON payloads", async () => {
    const dataUrl = "data:image/png;base64,aGVsbG8tdGVtcGxhdGU=";
    const publicUrl = "https://storage.yandexcloud.net/acp-assets/canvas-images/tmp/template.png";
    const uploadUrl = "https://s3.example/upload";

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("/api/upload/presign")) {
        return new Response(JSON.stringify({ uploadUrl, publicUrl }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === uploadUrl) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const pack = {
      layers: [{ type: "image", src: dataUrl }],
      resizes: [{ layerSnapshot: [{ type: "image", src: dataUrl }] }],
      layerTree: [{ layer: { type: "image", src: dataUrl } }],
      palette: {
        backgrounds: [{ value: { kind: "image", src: dataUrl } }],
      },
    };

    const persisted = await persistImageSourcesInObject(pack, "tmp");

    expect(persisted.layers[0].src).toBe(publicUrl);
    expect(persisted.resizes[0].layerSnapshot[0].src).toBe(publicUrl);
    expect(persisted.layerTree[0].layer.src).toBe(publicUrl);
    expect(persisted.palette.backgrounds[0].value.src).toBe(publicUrl);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
