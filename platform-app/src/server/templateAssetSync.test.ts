import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/utils/s3-cleanup", () => ({
  extractS3KeyFromUrl: (url: string) => {
    const marker = "/acp-assets/";
    return url.includes(marker) ? url.split(marker)[1] : null;
  },
  deleteS3Objects: vi.fn(async () => ({ deleted: 1, failed: 0 })),
}));

import {
  collectTemplateImageAssetUrls,
  syncTemplateImageAssets,
} from "@/server/templateAssetSync";
import { deleteS3Objects } from "@/server/utils/s3-cleanup";

const fixedUrl = "https://storage.yandexcloud.net/acp-assets/templates/fixed.png";
const snapshotUrl = "https://storage.yandexcloud.net/acp-assets/templates/snapshot.webp";
const artboardUrl = "https://storage.yandexcloud.net/acp-assets/templates/artboard.jpg";
const paletteUrl = "https://storage.yandexcloud.net/acp-assets/templates/palette.png";
const staleUrl = "https://storage.yandexcloud.net/acp-assets/templates/stale.png";

const templateData = {
  layers: [
    { id: "l1", type: "image", src: fixedUrl, isFixedAsset: true },
    { id: "l2", type: "image", src: "https://example.com/non-fixed.png" },
  ],
  resizes: [
    {
      id: "r1",
      layerSnapshot: [
        { id: "s1", type: "image", src: snapshotUrl, isFixedAsset: true },
      ],
    },
  ],
  artboardProps: {
    fill: "#FFFFFF",
    backgroundImage: { src: artboardUrl, fit: "cover", swatchRef: "bg-image" },
  },
  palette: {
    colors: [{ id: "c1", type: "color", name: "Brand", value: "#FFCC00" }],
    backgrounds: [
      { id: "bg-solid", type: "background", name: "Solid", value: { kind: "solid", color: "#FFFFFF" } },
      {
        id: "bg-image",
        type: "background",
        name: "Palette Image",
        value: { kind: "image", src: paletteUrl, fit: "cover", focusX: 0.5, focusY: 0.5 },
      },
    ],
  },
};

describe("templateAssetSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collects fixed layers, artboard background images, and palette image swatches", () => {
    expect(new Set(collectTemplateImageAssetUrls(templateData))).toEqual(
      new Set([fixedUrl, snapshotUrl, artboardUrl, paletteUrl]),
    );
  });

  it("creates missing template Asset rows and removes stale ones", async () => {
    const asset = {
      findMany: vi.fn(async () => [
        { id: "existing-fixed", url: fixedUrl },
        { id: "stale", url: staleUrl },
      ]),
      createMany: vi.fn(async () => ({ count: 3 })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    };

    await syncTemplateImageAssets({
      prisma: { asset } as unknown as import("@prisma/client").PrismaClient,
      templateId: "tmpl-1",
      workspaceId: "ws-1",
      userId: "u-1",
      data: templateData,
    });

    expect(asset.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ url: snapshotUrl, templateId: "tmpl-1" }),
        expect.objectContaining({ url: artboardUrl, templateId: "tmpl-1" }),
        expect.objectContaining({ url: paletteUrl, templateId: "tmpl-1" }),
      ]),
    });
    expect(asset.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["stale"] } },
    });
    expect(deleteS3Objects).toHaveBeenCalledWith(["templates/stale.png"]);
  });
});
