/**
 * One-time CORS setup for S3 bucket.
 * Call POST /api/setup-cors to configure CORS on the Yandex S3 bucket.
 * This allows the browser to load images cross-origin (needed by Konva canvas).
 */
import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import {
  S3Client,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "ru-central1",
  endpoint: process.env.S3_ENDPOINT || "https://storage.yandexcloud.net",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET = process.env.S3_BUCKET || "acp-assets";

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await s3.send(
      new PutBucketCorsCommand({
        Bucket: BUCKET,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: ["*"],
              AllowedMethods: ["GET", "HEAD"],
              AllowedHeaders: ["*"],
              MaxAgeSeconds: 86400,
            },
          ],
        },
      })
    );

    return NextResponse.json({ success: true, message: "CORS configured" });
  } catch (err) {
    console.error("CORS setup failed:", err);
    return NextResponse.json(
      { error: "CORS setup failed", details: String(err) },
      { status: 500 }
    );
  }
}
