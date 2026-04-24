import type { PrismaClient } from "@prisma/client";
import { deleteS3Objects, extractS3KeyFromUrl } from "@/server/utils/s3-cleanup";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function addUrl(urls: Set<string>, value: unknown) {
  if (typeof value === "string" && value.length > 0) {
    urls.add(value);
  }
}

function collectFixedLayerUrls(layers: unknown, urls: Set<string>) {
  if (!Array.isArray(layers)) return;
  for (const item of layers) {
    const layer = asRecord(item);
    if (!layer) continue;
    if (layer.isFixedAsset === true && layer.type === "image") {
      addUrl(urls, layer.src);
    }
  }
}

/**
 * Images that are part of template structure must have template Asset rows so
 * they can be copied into projects and cleaned up when removed.
 */
export function collectTemplateImageAssetUrls(data: unknown): string[] {
  const urls = new Set<string>();
  const root = asRecord(data);
  if (!root) return [];

  collectFixedLayerUrls(root.layers, urls);

  if (Array.isArray(root.resizes)) {
    for (const resize of root.resizes) {
      collectFixedLayerUrls(asRecord(resize)?.layerSnapshot, urls);
    }
  }

  const artboardProps = asRecord(root.artboardProps);
  const backgroundImage = asRecord(artboardProps?.backgroundImage);
  addUrl(urls, backgroundImage?.src);

  const palette = asRecord(root.palette);
  const backgrounds = palette?.backgrounds;
  if (Array.isArray(backgrounds)) {
    for (const swatch of backgrounds) {
      const value = asRecord(asRecord(swatch)?.value);
      if (value?.kind === "image") {
        addUrl(urls, value.src);
      }
    }
  }

  return [...urls];
}

export async function syncTemplateImageAssets({
  prisma,
  templateId,
  workspaceId,
  userId,
  data,
}: {
  prisma: PrismaClient;
  templateId: string;
  workspaceId: string;
  userId: string;
  data: unknown;
}) {
  const fixedUrls = new Set(collectTemplateImageAssetUrls(data));

  const existingAssets = await prisma.asset.findMany({
    where: { templateId },
  });
  const existingUrls = new Set(existingAssets.map((a: { url: string }) => a.url));

  const toCreate = [...fixedUrls].filter((url) => !existingUrls.has(url));
  if (toCreate.length > 0) {
    const extToMime: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      svg: "image/svg+xml",
      gif: "image/gif",
    };
    await prisma.asset.createMany({
      data: toCreate.map((url) => {
        const filename = url.split("/").pop()?.split("?")[0] || "template-asset";
        const ext = filename.split(".").pop()?.toLowerCase() || "";
        return {
          type: "IMAGE" as const,
          filename,
          url,
          mimeType: extToMime[ext] || "image/png",
          sizeBytes: 0,
          workspaceId,
          uploadedById: userId,
          templateId,
        };
      }),
    });
  }

  const toRemove = existingAssets.filter((a: { url: string }) => !fixedUrls.has(a.url));
  if (toRemove.length > 0) {
    const s3Keys = toRemove
      .map((a: { url: string }) => extractS3KeyFromUrl(a.url))
      .filter((key: string | null): key is string => Boolean(key));
    if (s3Keys.length > 0) {
      await deleteS3Objects(s3Keys);
    }
    await prisma.asset.deleteMany({
      where: { id: { in: toRemove.map((a: { id: string }) => a.id) } },
    });
  }
}
