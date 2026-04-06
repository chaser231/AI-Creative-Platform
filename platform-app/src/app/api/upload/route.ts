/**
 * Image Upload API — receives base64 OR external URL, uploads to S3, returns public URL.
 *
 * Two modes:
 * 1. base64 mode (existing) — receives base64-encoded image data
 * 2. url mode (NEW) — receives an external URL (e.g. Replicate/OpenAI temp URL),
 *    fetches the image server-side to avoid CORS, and uploads to S3
 *
 * Used by:
 * - Auto-save flow to migrate inline base64 images to S3 URLs
 * - "Upload on Add" flow to persist temporary AI-generated URLs immediately
 */
import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
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
    const { base64, url, mimeType, projectId } = body;

    let buffer: Buffer;
    let contentType: string = mimeType || "image/png";

    if (url && typeof url === "string") {
      // ── Mode 2: Fetch external URL and re-upload to S3 ──
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30_000), // 30s timeout
      });

      if (!response.ok) {
        return NextResponse.json(
          { error: `Failed to fetch URL: ${response.status}` },
          { status: 502 }
        );
      }

      // Determine content type from response headers or URL
      contentType = response.headers.get("content-type") || mimeType || "image/png";
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);

      if (buffer.length === 0) {
        return NextResponse.json({ error: "Fetched URL returned empty body" }, { status: 502 });
      }
    } else if (base64 && typeof base64 === "string") {
      // ── Mode 1: Decode base64 and upload ──
      const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, "");
      buffer = Buffer.from(cleanBase64, "base64");
    } else {
      return NextResponse.json({ error: "Missing base64 or url data" }, { status: 400 });
    }

    const ext = contentType.split("/")[1]?.split(";")[0] || "png";
    const key = `canvas-images/${projectId || "unknown"}/${randomUUID()}.${ext}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );

    const publicUrl = `${process.env.S3_ENDPOINT || "https://storage.yandexcloud.net"}/${BUCKET}/${key}`;

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error("Image upload failed:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
