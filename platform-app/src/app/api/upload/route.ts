/**
 * Image Upload API — receives base64, uploads to S3, returns public URL.
 *
 * Used by the auto-save flow to migrate inline base64 images to S3 URLs,
 * dramatically reducing canvasState JSON size.
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

    const { base64, mimeType, projectId } = await req.json();

    if (!base64 || typeof base64 !== "string") {
      return NextResponse.json({ error: "Missing base64 data" }, { status: 400 });
    }

    // Strip data URI prefix if present
    const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");

    const ext = (mimeType || "image/png").split("/")[1] || "png";
    const key = `canvas-images/${projectId || "unknown"}/${randomUUID()}.${ext}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimeType || "image/png",
      })
    );

    const publicUrl = `${process.env.S3_ENDPOINT || "https://storage.yandexcloud.net"}/${BUCKET}/${key}`;

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error("Image upload failed:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
