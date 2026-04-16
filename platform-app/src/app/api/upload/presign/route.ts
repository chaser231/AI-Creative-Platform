/**
 * GET /api/upload/presign — returns a presigned PUT URL for direct S3 upload.
 *
 * Query params: mimeType (optional, default image/png), projectId (optional)
 *
 * Response: { uploadUrl, publicUrl, key }
 *   - uploadUrl: presigned PUT URL (valid 10 min)
 *   - publicUrl: permanent public URL after upload
 *   - key: S3 object key
 *
 * The client uploads directly to S3, bypassing the server entirely.
 * This eliminates base64 payloads through Vercel/hosting and saves ~95% of Origin Transfer.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const mimeType = searchParams.get("mimeType") || "image/png";
    const projectId = searchParams.get("projectId") || "tmp";

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { error: `Unsupported MIME type: ${mimeType}` },
        { status: 400 },
      );
    }

    const ext = mimeType.split("/")[1]?.split(";")[0]?.replace("svg+xml", "svg") || "png";
    const filename = `${randomUUID()}.${ext}`;
    const key = `canvas-images/${projectId}/${filename}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 600 });
    const publicUrl = `${process.env.S3_ENDPOINT || "https://storage.yandexcloud.net"}/${BUCKET}/${key}`;

    return NextResponse.json({ uploadUrl, publicUrl, key });
  } catch (err) {
    console.error("Presign failed:", err);
    return NextResponse.json({ error: "Presign failed" }, { status: 500 });
  }
}
