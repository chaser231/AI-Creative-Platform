/**
 * Image Upload API — receives base64 OR external URL, uploads to S3, returns public URL.
 *
 * Two modes:
 * 1. base64 mode (existing) — receives base64-encoded image data
 * 2. url mode (NEW) — receives an external URL (e.g. Replicate/OpenAI temp URL),
 *    fetches the image server-side to avoid CORS, and uploads to S3
 *
 * Also creates an Asset DB record for the Project Asset Library.
 */
import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

const s3 = new S3Client({
  region: "ru-central1",
  endpoint: process.env.S3_ENDPOINT || "https://storage.yandexcloud.net",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET = process.env.S3_BUCKET || "acp-assets";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { base64, url, mimeType, projectId, skipAssetRecord } = body as {
      base64?: string;
      url?: string;
      mimeType?: string;
      projectId?: string;
      skipAssetRecord?: boolean;
    };

    let buffer: Buffer;
    let contentType: string = mimeType || "image/png";

    if (url && typeof url === "string") {
      // ── Mode 2: Fetch external URL and re-upload to S3 ──
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return NextResponse.json(
          { error: `Failed to fetch URL: ${response.status}` },
          { status: 502 }
        );
      }

      contentType = response.headers.get("content-type") || mimeType || "image/png";
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);

      if (buffer.length === 0) {
        return NextResponse.json({ error: "Fetched URL returned empty body" }, { status: 502 });
      }

      // Guard: Replicate/fal temp links can return HTML error pages with 200
      // when expired. Never write that into the asset bucket.
      if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
        return NextResponse.json(
          { error: `Fetched URL returned non-image content-type: ${contentType}` },
          { status: 502 }
        );
      }
    } else if (base64 && typeof base64 === "string") {
      // ── Mode 1: Decode base64 and upload ──
      const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, "");
      buffer = Buffer.from(cleanBase64, "base64");
    } else {
      return NextResponse.json({ error: "Missing base64 or url data" }, { status: 400 });
    }

    const ext = contentType.split("/")[1]?.split(";")[0] || "png";
    const filename = `${randomUUID()}.${ext}`;
    const key = `canvas-images/${projectId || "unknown"}/${filename}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );

    const publicUrl = `${process.env.S3_ENDPOINT || "https://storage.yandexcloud.net"}/${BUCKET}/${key}`;

    // ── Register asset in DB for the Asset Library ──
    // Callers that will create their own Asset record with richer metadata
    // (e.g. the photo-generation flow calling asset.saveGeneratedImage) pass
    // skipAssetRecord: true to avoid duplicate library entries.
    if (projectId && !skipAssetRecord) {
      try {
        const project = await prisma.project.findUnique({
          where: { id: projectId },
          select: { workspaceId: true },
        });

        if (project) {
          await prisma.asset.create({
            data: {
              type: "IMAGE",
              filename,
              url: publicUrl,
              mimeType: contentType,
              sizeBytes: buffer.length,
              workspaceId: project.workspaceId,
              uploadedById: session.user.id!,
              projectId,
            },
          });
        }
      } catch (dbErr) {
        // Non-critical — log but don't fail the upload
        console.warn("Asset DB record creation failed:", dbErr);
      }
    }

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error("Image upload failed:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
