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

  /**
   * List assets across the entire workspace (for personal library panels).
   * Supports filtering by type and metadata.source to distinguish photo-generated
   * assets from manual uploads.
   */
  listByWorkspace: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        type: z
          .enum(["IMAGE", "VIDEO", "AUDIO", "FONT", "LOGO", "OTHER"])
          .optional(),
        source: z.string().optional(), // e.g. "photo-generation", "upload"
        limit: z.number().min(1).max(200).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      // Must be at least VIEWER in this workspace
      const membership = await ctx.prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: ctx.user.id, workspaceId: input.workspaceId } },
      });
      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Вы не являетесь участником этого воркспейса" });
      }

      const where: {
        workspaceId: string;
        type?: "IMAGE" | "VIDEO" | "AUDIO" | "FONT" | "LOGO" | "OTHER";
        metadata?: { path: string[]; equals: string };
      } = {
        workspaceId: input.workspaceId,
        ...(input.type && { type: input.type }),
      };
      if (input.source) {
        // JSON field path filter on metadata.source
        where.metadata = { path: ["source"], equals: input.source };
      }

      const assets = await ctx.prisma.asset.findMany({
        where: where as never,
        include: {
          uploadedBy: { select: { id: true, name: true } },
          project: { select: { id: true, name: true, goal: true } },
        },
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });

      return assets;
    }),

  /**
   * Persist an already-uploaded image URL (S3) as an Asset record.
   * Used by the photo-generation flow after client-side persistImageToS3.
   * The source tag in metadata lets the library UI filter generated vs uploaded.
   */
  saveGeneratedImage: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        url: z.string().url(),
        prompt: z.string().optional(),
        model: z.string().optional(),
        source: z.string().default("photo-generation"),
        mimeType: z.string().default("image/png"),
        sizeBytes: z.number().default(0),
        width: z.number().optional(),
        height: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: input.projectId },
        select: { workspaceId: true },
      });
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const membership = await ctx.prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: ctx.user.id, workspaceId: project.workspaceId } },
      });
      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Нет доступа к воркспейсу проекта" });
      }

      const filename = `${input.source}-${Date.now()}.${input.mimeType.split("/")[1] ?? "png"}`;

      const asset = await ctx.prisma.asset.create({
        data: {
          type: "IMAGE",
          filename,
          url: input.url,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          metadata: {
            source: input.source,
            ...(input.prompt && { prompt: input.prompt.slice(0, 2000) }),
            ...(input.model && { model: input.model }),
            ...(input.width && { width: input.width }),
            ...(input.height && { height: input.height }),
          },
          workspaceId: project.workspaceId,
          uploadedById: ctx.user.id,
          projectId: input.projectId,
        },
      });

      return asset;
    }),

  /** List assets for a specific project */
  listByProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        search: z.string().optional(),
        sortBy: z.enum(["createdAt", "filename", "sizeBytes"]).default("createdAt"),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
      })
    )
    .query(async ({ ctx, input }) => {
      const assets = await ctx.prisma.asset.findMany({
        where: {
          projectId: input.projectId,
          ...(input.search && {
            filename: { contains: input.search, mode: "insensitive" as const },
          }),
        },
        include: {
          uploadedBy: {
            select: { id: true, name: true },
          },
        },
        orderBy: { [input.sortBy]: input.sortOrder },
      });

      return assets;
    }),

  /** Fetch a single asset by id (checks workspace membership) */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const asset = await ctx.prisma.asset.findUnique({
        where: { id: input.id },
      });
      if (!asset) throw new TRPCError({ code: "NOT_FOUND" });

      const membership = await ctx.prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: {
            userId: ctx.user.id,
            workspaceId: asset.workspaceId,
          },
        },
      });
      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Нет доступа к ассету",
        });
      }
      return asset;
    }),

  /** List assets for a specific template (with visibility check) */
  listByTemplate: protectedProcedure
    .input(z.object({ templateId: z.string() }))
    .query(async ({ ctx, input }) => {
      const template = await ctx.prisma.template.findUnique({
        where: { id: input.templateId },
        select: { author: true, visibility: true, isOfficial: true, workspaceId: true },
      });
      if (!template) throw new TRPCError({ code: "NOT_FOUND" });

      const canView = template.author === ctx.user.id
        || template.visibility === "PUBLIC"
        || template.visibility === "WORKSPACE"
        || template.isOfficial;
      if (!canView) throw new TRPCError({ code: "FORBIDDEN" });

      return ctx.prisma.asset.findMany({
        where: { templateId: input.templateId },
        include: {
          uploadedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  /** List all font assets from official/public templates (globally available) */
  listTemplateFonts: protectedProcedure
    .query(async ({ ctx }) => {
      return ctx.prisma.asset.findMany({
        where: {
          type: "FONT",
          template: {
            OR: [
              { isOfficial: true },
              { visibility: "PUBLIC" },
            ],
          },
        },
        select: {
          id: true,
          filename: true,
          url: true,
          metadata: true,
          templateId: true,
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  /** Copy all template assets to a project (used when creating a project from template) */
  copyTemplateAssetsToProject: protectedProcedure
    .input(z.object({ templateId: z.string(), projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const template = await ctx.prisma.template.findUnique({
        where: { id: input.templateId },
        select: { author: true, visibility: true, isOfficial: true },
      });
      if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });

      const canView = template.author === ctx.user.id
        || template.visibility === "PUBLIC"
        || template.visibility === "WORKSPACE"
        || template.isOfficial;
      if (!canView) throw new TRPCError({ code: "FORBIDDEN" });

      const project = await ctx.prisma.project.findUnique({
        where: { id: input.projectId },
        select: { workspaceId: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

      const templateAssets = await ctx.prisma.asset.findMany({
        where: { templateId: input.templateId },
      });
      if (templateAssets.length === 0) return { copied: 0 };

      const created = await ctx.prisma.asset.createMany({
        data: templateAssets.map((a) => ({
          type: a.type,
          filename: a.filename,
          url: a.url,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          metadata: a.metadata ?? undefined,
          workspaceId: project.workspaceId,
          uploadedById: ctx.user.id,
          projectId: input.projectId,
        })),
      });

      return { copied: created.count };
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
        metadata: z.record(z.string(), z.unknown()).optional(),
        templateId: z.string().optional(),
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

      const asset = await ctx.prisma.asset.create({
        data: {
          type: input.type,
          filename: input.filename,
          url: publicUrl,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          metadata: input.metadata as Record<string, string> | undefined,
          workspaceId: input.workspaceId,
          uploadedById: ctx.user.id,
          ...(input.templateId && { templateId: input.templateId }),
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

  /** Delete a single asset */
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
      }

      await ctx.prisma.asset.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  /** Delete multiple assets at once */
  deleteMany: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const assets = await ctx.prisma.asset.findMany({
        where: { id: { in: input.ids } },
      });

      // Delete from S3 concurrently
      await Promise.allSettled(
        assets.map(async (asset) => {
          try {
            const urlObj = new URL(asset.url);
            const key = urlObj.pathname.replace(`/${BUCKET}/`, "");
            await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
          } catch (err) {
            console.error(`Failed to delete ${asset.id} from S3:`, err);
          }
        })
      );

      // Delete from DB
      await ctx.prisma.asset.deleteMany({
        where: { id: { in: input.ids } },
      });

      return { success: true, deleted: assets.length };
    }),
});
