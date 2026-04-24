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
import {
  assertAssetAccess,
  assertProjectAccess,
  assertTemplateAccess,
  assertWorkspaceAccess,
  getWorkspaceRole,
} from "../authz/guards";

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
        limit: z.number().int().min(1).max(500).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertWorkspaceAccess(ctx, input.workspaceId);
      // Hard cap: without a limit, a large workspace can dump thousands of rows
      // in a single query and OOM the node process / freeze the client.
      const take = input.limit ?? 200;
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
        take,
      });

      return assets;
    }),

  /**
   * List unique workspace assets (for the personal library / dashboard catalog).
   *
   * A single S3 object may be referenced by multiple Asset rows (one per
   * project the object was attached to via attachUrlToProject /
   * cloneAssetToProject / copyTemplateAssetsToProject). The dashboard catalog
   * shows *files*, not *project links*, so we collapse rows by `url` and
   * return one representative record per unique S3 object — the oldest one,
   * which is the "original" upload/generation.
   *
   * Source filter semantics ("photo-generation" vs "upload"):
   * If ANY row for a given url has metadata.source === filter, the file is
   * considered to match. This is because downstream clones can rewrite
   * `source` to "cloned" even though the same bytes were originally generated.
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
      await assertWorkspaceAccess(ctx, input.workspaceId);

      const where: {
        workspaceId: string;
        type?: "IMAGE" | "VIDEO" | "AUDIO" | "FONT" | "LOGO" | "OTHER";
      } = {
        workspaceId: input.workspaceId,
        ...(input.type && { type: input.type }),
      };

      // Fetch a generous window (up to 4× the limit) and collapse by url.
      // We intentionally dedupe in-memory instead of relying on a DB DISTINCT
      // because (a) JSON metadata filters + DISTINCT ON aren't portable
      // across Prisma providers, and (b) we want the *oldest* row per url,
      // which requires ordering inside each group.
      const fetchLimit = Math.min(input.limit * 4, 800);

      const rows = await ctx.prisma.asset.findMany({
        where: where as never,
        include: {
          uploadedBy: { select: { id: true, name: true } },
          project: { select: { id: true, name: true, goal: true } },
        },
        // Ascending: when we encounter a url for the first time, that's the
        // oldest Asset row → we use its id as the stable representative.
        orderBy: { createdAt: "asc" },
        take: fetchLimit,
      });

      // Group by url, keep the oldest row, but merge metadata.source so we
      // know which "kinds" of usage this file has across all projects.
      const byUrl = new Map<
        string,
        (typeof rows)[number] & { _sources: Set<string> }
      >();
      for (const r of rows) {
        const meta = (r.metadata as Record<string, unknown> | null) ?? {};
        const src = typeof meta.source === "string" ? meta.source : undefined;
        const existing = byUrl.get(r.url);
        if (!existing) {
          byUrl.set(r.url, {
            ...r,
            _sources: new Set(src ? [src] : []),
          });
        } else if (src) {
          existing._sources.add(src);
        }
      }

      let unique = Array.from(byUrl.values());

      // Apply source filter *after* dedupe so a file counted as "photo-generation"
      // in the origin project still surfaces in that filter even if another
      // project re-registered it as "upload" / "cloned".
      if (input.source) {
        unique = unique.filter((r) => r._sources.has(input.source!));
      }

      // Sort desc by createdAt for display (newest files first).
      unique.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      // Strip the helper and cap to the requested limit.
      return unique.slice(0, input.limit).map(({ _sources: _s, ...rest }) => rest);
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
      const { project } = await assertProjectAccess(ctx, input.projectId, "USER");

      // Idempotent per (projectId, url) — rapid double submits from React
      // (StrictMode, double-click, retry after network blip) must never
      // create two library entries for the same S3 object.
      const existing = await ctx.prisma.asset.findFirst({
        where: { projectId: input.projectId, url: input.url },
      });
      if (existing) return existing;

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

  /**
   * Register an existing S3 URL as a project asset.
   *
   * Idempotent — if an Asset with the same url already exists in the same
   * project (same workspace + same url), return that record instead of
   * creating a duplicate. This is the single place where "generic image used
   * in a project" (AI refs, manual uploads, pasted screenshots, …) should be
   * persisted so that the project library reliably mirrors everything the
   * project touches.
   */
  attachUrlToProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        url: z.string().url(),
        filename: z.string().optional(),
        mimeType: z.string().default("image/png"),
        sizeBytes: z.number().int().nonnegative().default(0),
        source: z.string().default("upload"),
        width: z.number().optional(),
        height: z.number().optional(),
        type: z
          .enum(["IMAGE", "VIDEO", "AUDIO", "FONT", "LOGO", "OTHER"])
          .default("IMAGE"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await assertProjectAccess(ctx, input.projectId, "USER");

      // Idempotency guard — never register the same S3 url twice per project.
      const existing = await ctx.prisma.asset.findFirst({
        where: { projectId: input.projectId, url: input.url },
        select: { id: true },
      });
      if (existing) return existing;

      const filename =
        input.filename ??
        `${input.source}-${Date.now()}.${input.mimeType.split("/")[1] ?? "bin"}`;

      return ctx.prisma.asset.create({
        data: {
          type: input.type,
          filename,
          url: input.url,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          metadata: {
            source: input.source,
            ...(input.width && { width: input.width }),
            ...(input.height && { height: input.height }),
          },
          workspaceId: project.workspaceId,
          uploadedById: ctx.user.id,
          projectId: input.projectId,
        },
        select: { id: true },
      });
    }),

  /**
   * Workspace-scoped twin of attachUrlToProject — registers an S3 URL as an
   * Asset that lives directly on the workspace (no projectId). Used by the
   * workflow executor (Phase 4) for assetOutput, since workflows are a
   * workspace-level concept and aren't tied to a single project.
   *
   * Idempotent per (workspaceId, url, no-project): repeated executor runs
   * with the same final URL must not duplicate library entries.
   */
  attachUrlToWorkspace: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        url: z.string().url(),
        filename: z.string().optional(),
        mimeType: z.string().default("image/png"),
        sizeBytes: z.number().int().nonnegative().default(0),
        source: z.string().default("workflow"),
        width: z.number().optional(),
        height: z.number().optional(),
        type: z
          .enum(["IMAGE", "VIDEO", "AUDIO", "FONT", "LOGO", "OTHER"])
          .default("IMAGE"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceAccess(ctx, input.workspaceId, "USER");

      const existing = await ctx.prisma.asset.findFirst({
        where: { workspaceId: input.workspaceId, projectId: null, url: input.url },
        select: { id: true },
      });
      if (existing) return existing;

      const filename =
        input.filename ??
        `${input.source}-${Date.now()}.${input.mimeType.split("/")[1] ?? "bin"}`;

      return ctx.prisma.asset.create({
        data: {
          type: input.type,
          filename,
          url: input.url,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          metadata: {
            source: input.source,
            ...(input.width && { width: input.width }),
            ...(input.height && { height: input.height }),
          },
          workspaceId: input.workspaceId,
          uploadedById: ctx.user.id,
          projectId: null,
        },
        select: { id: true },
      });
    }),

  /**
   * Clone an existing workspace Asset into another project.
   *
   * Used when the user takes an image that already lives in the library
   * (e.g. generated in a photo project) and turns it into a banner — the
   * banner project should show that image in its own library panel without
   * duplicating the S3 object. The clone points at the same `url` but carries
   * the new `projectId` / fresh `uploadedById`. Idempotent per (project, url).
   */
  cloneAssetToProject: protectedProcedure
    .input(
      z.object({
        assetId: z.string(),
        targetProjectId: z.string(),
        source: z.string().default("cloned"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const original = await assertAssetAccess(ctx, input.assetId, "read");
      const { project } = await assertProjectAccess(
        ctx,
        input.targetProjectId,
        "USER",
      );
      if (original.workspaceId !== project.workspaceId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Нельзя клонировать ассет между разными воркспейсами",
        });
      }

      const existing = await ctx.prisma.asset.findFirst({
        where: { projectId: input.targetProjectId, url: original.url },
        select: { id: true },
      });
      if (existing) return existing;

      const metaBase =
        (original.metadata as Record<string, unknown> | null) ?? {};
      return ctx.prisma.asset.create({
        data: {
          type: original.type,
          filename: original.filename,
          url: original.url,
          mimeType: original.mimeType,
          sizeBytes: original.sizeBytes,
          metadata: {
            ...metaBase,
            source: input.source,
            clonedFrom: original.id,
          },
          workspaceId: project.workspaceId,
          uploadedById: ctx.user.id,
          projectId: input.targetProjectId,
        },
        select: { id: true },
      });
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
      await assertProjectAccess(ctx, input.projectId);
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
      const asset = await assertAssetAccess(ctx, input.id, "read");
      return asset;
    }),

  /** List assets for a specific template (with visibility check) */
  listByTemplate: protectedProcedure
    .input(z.object({ templateId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTemplateAccess(ctx, input.templateId, "read");

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

  /**
   * Copy all template assets to a project.
   *
   * Called when materializing a template into a banner project so the project
   * library shows the template's logos, photos, etc. Idempotent: skips assets
   * whose `url` is already present in the target project — safe to call after
   * every template apply.
   */
  copyTemplateAssetsToProject: protectedProcedure
    .input(z.object({ templateId: z.string(), projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTemplateAccess(ctx, input.templateId, "read");
      const { project } = await assertProjectAccess(ctx, input.projectId, "USER");

      const templateAssets = await ctx.prisma.asset.findMany({
        where: { templateId: input.templateId },
      });
      if (templateAssets.length === 0) return { copied: 0 };

      const existingUrls = new Set(
        (
          await ctx.prisma.asset.findMany({
            where: {
              projectId: input.projectId,
              url: { in: templateAssets.map((a) => a.url) },
            },
            select: { url: true },
          })
        ).map((a) => a.url),
      );
      const toCreate = templateAssets.filter((a) => !existingUrls.has(a.url));
      if (toCreate.length === 0) return { copied: 0 };

      const created = await ctx.prisma.asset.createMany({
        data: toCreate.map((a) => ({
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
      await assertWorkspaceAccess(ctx, input.workspaceId, "USER");
      if (input.templateId) {
        await assertTemplateAccess(ctx, input.templateId, "write");
      }

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
      const asset = await assertAssetAccess(ctx, input.id, "read");

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

  /**
   * Delete a single asset.
   *
   * Because one S3 object can be referenced by multiple Asset rows (one per
   * project — see listByWorkspace for context), deleting from the workspace
   * catalog must also cascade to all sibling rows pointing at the same url.
   * Otherwise the dashboard appears to "put the file back" on the next
   * refresh when another row surfaces as the representative.
   *
   * Permission check: the caller must be allowed to delete the *originally
   * selected* row. Admins can cascade across the whole workspace; regular
   * users can only cascade to rows they uploaded themselves.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const asset = await assertAssetAccess(ctx, input.id, "write");
      const role = await getWorkspaceRole(ctx.prisma, ctx.user.id, asset.workspaceId);
      const isAdmin = role === "ADMIN";
      if (asset.uploadedById !== ctx.user.id && !isAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Удалять ассет может только загрузивший или администратор" });
      }

      // Find all sibling rows across the workspace that reference the same
      // S3 object. Admins clear the whole set; regular users only their own.
      const siblings = await ctx.prisma.asset.findMany({
        where: {
          workspaceId: asset.workspaceId,
          url: asset.url,
          ...(isAdmin ? {} : { uploadedById: ctx.user.id }),
        },
        select: { id: true },
      });

      // Delete from S3 once — the bytes are shared.
      try {
        const urlObj = new URL(asset.url);
        const key = urlObj.pathname.replace(`/${BUCKET}/`, "");
        await s3.send(
          new DeleteObjectCommand({
            Bucket: BUCKET,
            Key: key,
          })
        );
      } catch (err) {
        console.error("Failed to delete from S3:", err);
      }

      await ctx.prisma.asset.deleteMany({
        where: { id: { in: siblings.map((s) => s.id) } },
      });

      return { success: true, removedRows: siblings.length };
    }),

  /**
   * Delete multiple assets at once.
   *
   * Same cascade-by-url semantics as single delete: the selected rows define
   * the set of S3 objects to remove, and we also remove any sibling Asset
   * rows pointing at those urls (subject to the caller's permissions).
   */
  deleteMany: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const selected: { id: string; url: string; workspaceId: string; uploadedById: string }[] =
        [];
      for (const __id of input.ids) {
        const __a = await assertAssetAccess(ctx, __id, "write");
        const __r = await getWorkspaceRole(ctx.prisma, ctx.user.id, __a.workspaceId);
        if (__a.uploadedById !== ctx.user.id && __r !== "ADMIN") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Нет прав удалять один из ассетов" });
        }
        selected.push({
          id: __a.id,
          url: __a.url,
          workspaceId: __a.workspaceId,
          uploadedById: __a.uploadedById,
        });
      }

      // Group selected rows by workspace + url to collect unique S3 objects.
      const byUrl = new Map<string, { workspaceId: string; url: string }>();
      for (const s of selected) {
        byUrl.set(`${s.workspaceId}::${s.url}`, {
          workspaceId: s.workspaceId,
          url: s.url,
        });
      }

      // Delete each unique S3 object once.
      await Promise.allSettled(
        Array.from(byUrl.values()).map(async ({ url }) => {
          try {
            const urlObj = new URL(url);
            const key = urlObj.pathname.replace(`/${BUCKET}/`, "");
            await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
          } catch (err) {
            console.error(`Failed to delete ${url} from S3:`, err);
          }
        })
      );

      // Find all sibling rows (same workspace + same url) the caller can delete.
      // Admins remove every sibling; regular users only their own.
      const caller = ctx.user.id;
      const idsToDelete = new Set<string>();
      for (const { workspaceId, url } of byUrl.values()) {
        const role = await getWorkspaceRole(ctx.prisma, caller, workspaceId);
        const siblings = await ctx.prisma.asset.findMany({
          where: {
            workspaceId,
            url,
            ...(role === "ADMIN" ? {} : { uploadedById: caller }),
          },
          select: { id: true },
        });
        for (const s of siblings) idsToDelete.add(s.id);
      }

      await ctx.prisma.asset.deleteMany({
        where: { id: { in: Array.from(idsToDelete) } },
      });

      return { success: true, deleted: idsToDelete.size };
    }),
});
