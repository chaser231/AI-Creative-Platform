/**
 * Asset Router
 *
 * File upload/download/list/delete with Yandex Object Storage (S3-compatible).
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ─── S3 Client (Yandex Object Storage) ──────────────────

const s3 = new S3Client({
  region: "ru-central1",
  endpoint: process.env.S3_ENDPOINT || "https://storage.yandexcloud.net",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET = process.env.S3_BUCKET || "acp-assets";

export const assetRouter = createTRPCRouter({
  /** List assets in a workspace */
  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        type: z
          .enum(["IMAGE", "VIDEO", "AUDIO", "FONT", "LOGO", "OTHER"])
          .optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const assets = await ctx.prisma.asset.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.type && { type: input.type }),
        },
        include: {
          uploadedBy: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return assets;
    }),

  /** Get a presigned upload URL */
  getUploadUrl: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        filename: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number(),
        type: z.enum(["IMAGE", "VIDEO", "AUDIO", "FONT", "LOGO", "OTHER"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const key = `${input.workspaceId}/${input.type.toLowerCase()}/${Date.now()}-${input.filename}`;

      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: input.mimeType,
      });

      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
      const publicUrl = `${process.env.S3_ENDPOINT || "https://storage.yandexcloud.net"}/${BUCKET}/${key}`;

      // Create asset record in DB
      const asset = await ctx.prisma.asset.create({
        data: {
          type: input.type,
          filename: input.filename,
          url: publicUrl,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          workspaceId: input.workspaceId,
          uploadedById: ctx.user.id,
        },
      });

      return { uploadUrl, asset };
    }),

  /** Get a presigned download URL */
  getDownloadUrl: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const asset = await ctx.prisma.asset.findUnique({
        where: { id: input.id },
      });

      if (!asset) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Extract key from URL
      const urlObj = new URL(asset.url);
      const key = urlObj.pathname.replace(`/${BUCKET}/`, "");

      const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
      });

      const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

      return { downloadUrl, asset };
    }),

  /** Delete an asset */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const asset = await ctx.prisma.asset.findUnique({
        where: { id: input.id },
      });

      if (!asset) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Extract key and delete from S3
      const urlObj = new URL(asset.url);
      const key = urlObj.pathname.replace(`/${BUCKET}/`, "");

      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: BUCKET,
            Key: key,
          })
        );
      } catch (err) {
        console.error("Failed to delete from S3:", err);
        // Continue with DB deletion even if S3 fails
      }

      await ctx.prisma.asset.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),
});
