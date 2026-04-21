/**
 * Template Router
 *
 * CRUD operations for template packs with catalog filtering.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import {
  collectS3KeysFromTemplate,
  deleteS3Objects,
  extractS3KeyFromUrl,
} from "../utils/s3-cleanup";

/**
 * Extract only resize metadata (id, name, width, height) from template data
 * using a raw SQL query with json_array_elements. This avoids fetching
 * the full multi-MB data blob just to read the resizes array.
 *
 * Uses LEFT JOIN LATERAL so templates whose `data->'resizes'` is null,
 * missing, or not a JSON array are still included (with zero resizes)
 * instead of crashing the entire query.
 */
async function getResizesMetaByIds(
  prisma: PrismaClient,
  ids: string[]
): Promise<Map<string, Array<{ id: string; name: string; width: number; height: number }>>> {
  if (ids.length === 0) return new Map();

  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ template_id: string; resize_id: string | null; name: string | null; width: number | null; height: number | null }>
    >(
      `SELECT t.id AS template_id,
              r->>'id' AS resize_id,
              r->>'name' AS name,
              (r->>'width')::int AS width,
              (r->>'height')::int AS height
       FROM "Template" t
       LEFT JOIN LATERAL json_array_elements(
         CASE
           WHEN jsonb_typeof(t.data::jsonb->'resizes') = 'array'
           THEN (t.data::json->'resizes')
           ELSE '[]'::json
         END
       ) AS r ON true
       WHERE t.id = ANY($1)`,
      ids
    );

    const map = new Map<string, Array<{ id: string; name: string; width: number; height: number }>>();
    for (const row of rows) {
      if (!row.resize_id) continue;
      let arr = map.get(row.template_id);
      if (!arr) {
        arr = [];
        map.set(row.template_id, arr);
      }
      arr.push({
        id: row.resize_id,
        name: row.name ?? "Untitled",
        width: row.width ?? 0,
        height: row.height ?? 0,
      });
    }
    return map;
  } catch (err) {
    console.error("[getResizesMetaByIds] Raw query failed, falling back to empty:", (err as Error)?.message);
    return new Map();
  }
}

export const templateRouter = createTRPCRouter({
  /** Recently used templates for the current user's workspace */
  recent: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        limit: z.number().min(1).max(10).default(4),
      })
    )
    .query(async ({ ctx, input }) => {
      const templates = await ctx.prisma.template.findMany({
        where: {
          OR: [
            { workspaceId: input.workspaceId, visibility: "WORKSPACE" },
            { author: ctx.user.id, visibility: "PRIVATE" },
            { visibility: "PUBLIC" },
            { visibility: "SHARED", sharedWith: { some: { userId: ctx.user.id } } },
            { author: ctx.user.id, visibility: "SHARED" },
            { isOfficial: true },
          ],
        },
        select: {
          id: true,
          name: true,
          description: true,
          categories: true,
          contentType: true,
          isOfficial: true,
          thumbnailUrl: true,
          popularity: true,
          updatedAt: true,
        },
        orderBy: [{ updatedAt: "desc" }],
        take: input.limit,
      });

      // Extract resizes from data via lightweight raw query (avoids fetching multi-MB data blobs)
      const ids = templates.map(t => t.id);
      const resizesMap = await getResizesMetaByIds(ctx.prisma, ids);

      return templates.map(t => ({
        ...t,
        resizes: resizesMap.get(t.id) ?? [],
      }));
    }),

  /** List templates with optional filtering */
  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        category: z.string().optional(),
        contentType: z.string().optional(),
        occasion: z.string().optional(),
        isOfficial: z.boolean().optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { workspaceId, search, ...filters } = input;

      // Build AND conditions to safely combine multiple OR filters
      const andConditions: Record<string, unknown>[] = [];

      // Visibility-aware filtering:
      // - WORKSPACE: all workspace members see it
      // - PRIVATE: only the author sees it
      // - PUBLIC: everyone across all workspaces sees it
      // - SHARED: author + explicitly shared users (Phase 2)
      // - isOfficial: always visible (backward compat)
      if (filters.isOfficial !== undefined) {
        andConditions.push({ workspaceId, isOfficial: filters.isOfficial });
      } else {
        andConditions.push({
          OR: [
            { workspaceId, visibility: "WORKSPACE" },
            { author: ctx.user.id, visibility: "PRIVATE" },
            { visibility: "PUBLIC" },
            { visibility: "SHARED", sharedWith: { some: { userId: ctx.user.id } } },
            { author: ctx.user.id, visibility: "SHARED" },
            { isOfficial: true },
          ],
        });
      }

      // Category/content/occasion filters
      if (filters.category) andConditions.push({ categories: { has: filters.category } });
      if (filters.contentType) andConditions.push({ contentType: filters.contentType });
      if (filters.occasion) andConditions.push({ occasion: filters.occasion });

      // Search filter
      if (search) {
        andConditions.push({
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        });
      }

      const templates = await ctx.prisma.template.findMany({
        where: { AND: andConditions },
        select: {
          id: true,
          name: true,
          description: true,
          version: true,
          categories: true,
          contentType: true,
          occasion: true,
          tags: true,
          isOfficial: true,
          visibility: true,
          editPermission: true,
          thumbnailUrl: true,
          popularity: true,
          createdAt: true,
          updatedAt: true,
          author: true,
          workspaceId: true,
        },
        orderBy: [{ isOfficial: "desc" }, { popularity: "desc" }],
      });

      // Extract resizes metadata via lightweight raw query (avoids fetching multi-MB data blobs)
      const ids = templates.map(t => t.id);
      const resizesMap = await getResizesMetaByIds(ctx.prisma, ids);

      return templates.map(t => ({
        ...t,
        resizes: resizesMap.get(t.id) ?? [],
      }));
    }),

  /** Get full template with data */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const template = await ctx.prisma.template.findUnique({
        where: { id: input.id },
      });

      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Increment popularity
      await ctx.prisma.template.update({
        where: { id: input.id },
        data: { popularity: { increment: 1 } },
      });

      return template;
    }),

  /** Create a new template */
  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        name: z.string().min(1).max(200),
        description: z.string().optional(),
        categories: z.array(z.string()).default([]),
        contentType: z.string().default("visual"),
        occasion: z.string().default("default"),
        tags: z.any().default([]),
        data: z.any(), // TemplatePack JSON
        isOfficial: z.boolean().default(false),
        visibility: z.enum(["PRIVATE", "WORKSPACE", "PUBLIC", "SHARED"]).default("WORKSPACE"),
        editPermission: z.enum(["AUTHOR_ONLY", "WORKSPACE", "SPECIFIC"]).default("AUTHOR_ONLY"),
        thumbnailUrl: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const template = await ctx.prisma.template.create({
        data: {
          ...input,
          author: ctx.user.id,
        },
      });

      return template;
    }),

  /** Update template (with permission enforcement) */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().optional(),
        categories: z.array(z.string()).optional(),
        contentType: z.string().optional(),
        occasion: z.string().optional(),
        tags: z.any().optional(),
        data: z.any().optional(),
        isOfficial: z.boolean().optional(),
        visibility: z.enum(["PRIVATE", "WORKSPACE", "PUBLIC", "SHARED"]).optional(),
        editPermission: z.enum(["AUTHOR_ONLY", "WORKSPACE", "SPECIFIC"]).optional(),
        thumbnailUrl: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      // Fetch existing template to check permissions
      const existing = await ctx.prisma.template.findUnique({ where: { id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      const isAuthor = existing.author === ctx.user.id;

      // Check edit permission
      const canEdit = isAuthor
        || existing.editPermission === "WORKSPACE";
        // Phase 2: || (existing.editPermission === "SPECIFIC" && check TemplateShare)

      if (!canEdit) {
        throw new TRPCError({ code: "FORBIDDEN", message: "У вас нет прав на редактирование этого шаблона" });
      }

      // Non-authors cannot change sensitive settings
      if (!isAuthor) {
        if (data.visibility === "PRIVATE") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Только автор может сделать шаблон приватным" });
        }
        if (data.editPermission !== undefined) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Только автор может менять права редактирования" });
        }
        if (data.visibility !== undefined && data.visibility !== existing.visibility) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Только автор может менять видимость шаблона" });
        }
      }

      const template = await ctx.prisma.template.update({
        where: { id },
        data,
      });

      return template;
    }),

  /** Load template state for canvas editing */
  loadState: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const template = await ctx.prisma.template.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          name: true,
          description: true,
          data: true,
          author: true,
          visibility: true,
          editPermission: true,
          isOfficial: true,
          workspaceId: true,
        },
      });

      if (!template) throw new TRPCError({ code: "NOT_FOUND" });

      // Check visibility access
      const isAuthor = template.author === ctx.user.id;
      // TODO: check workspace membership for WORKSPACE visibility
      const canView = isAuthor
        || template.visibility === "PUBLIC"
        || template.visibility === "WORKSPACE"
        || template.isOfficial;

      if (!canView) throw new TRPCError({ code: "FORBIDDEN" });

      // Determine if current user can edit
      const canEdit = isAuthor
        || template.editPermission === "WORKSPACE";

      return {
        ...template,
        canEdit,
        isAuthor,
      };
    }),

  /** Save template state from canvas (manual save, no auto-save) */
  saveState: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: z.any(),
        thumbnailUrl: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.template.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      const isAuthor = existing.author === ctx.user.id;
      const canEdit = isAuthor || existing.editPermission === "WORKSPACE";

      if (!canEdit) {
        throw new TRPCError({ code: "FORBIDDEN", message: "У вас нет прав на редактирование этого шаблона" });
      }

      const updateData: Record<string, unknown> = { data: input.data };
      if (input.thumbnailUrl !== undefined) {
        updateData.thumbnailUrl = input.thumbnailUrl;
      }

      const template = await ctx.prisma.template.update({
        where: { id: input.id },
        data: updateData,
      });

      // Sync fixed assets: collect image URLs from layers marked isFixedAsset,
      // then reconcile with existing template Asset records.
      try {
        const dataObj = input.data as any;
        const fixedUrls = new Set<string>();

        const collectFixed = (layers: any[]) => {
          for (const l of layers) {
            if (l.isFixedAsset && l.type === "image" && l.src) {
              fixedUrls.add(l.src);
            }
          }
        };

        if (Array.isArray(dataObj?.layers)) collectFixed(dataObj.layers);
        if (Array.isArray(dataObj?.resizes)) {
          for (const r of dataObj.resizes) {
            if (Array.isArray(r.layerSnapshot)) collectFixed(r.layerSnapshot);
          }
        }

        // Artboard background image is global (shared across all formats) and
        // should be fixated to the template just like `isFixedAsset` layers.
        const artboardBgSrc: string | undefined = dataObj?.artboardProps?.backgroundImage?.src;
        if (typeof artboardBgSrc === "string" && artboardBgSrc.length > 0) {
          fixedUrls.add(artboardBgSrc);
        }

        // Background-swatches of kind="image" also live in the template and
        // their underlying S3 blobs must be tracked / cleaned up alongside it.
        const paletteBackgrounds: any[] | undefined = dataObj?.palette?.backgrounds;
        if (Array.isArray(paletteBackgrounds)) {
          for (const sw of paletteBackgrounds) {
            const v = sw?.value;
            if (v && typeof v === "object" && v.kind === "image" && typeof v.src === "string" && v.src) {
              fixedUrls.add(v.src);
            }
          }
        }

        const existingAssets = await ctx.prisma.asset.findMany({
          where: { templateId: input.id },
        });
        const existingUrls = new Set(existingAssets.map((a: { url: string }) => a.url));

        // Create new asset records for newly fixed images
        const toCreate = [...fixedUrls].filter(url => !existingUrls.has(url));
        if (toCreate.length > 0) {
          const extToMime: Record<string, string> = {
            png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
            webp: "image/webp", svg: "image/svg+xml", gif: "image/gif",
          };
          await ctx.prisma.asset.createMany({
            data: toCreate.map(url => {
              const filename = url.split("/").pop()?.split("?")[0] || "fixed-asset";
              const ext = filename.split(".").pop()?.toLowerCase() || "";
              return {
                type: "IMAGE" as const,
                filename,
                url,
                mimeType: extToMime[ext] || "image/png",
                sizeBytes: 0,
                workspaceId: existing.workspaceId,
                uploadedById: ctx.user.id,
                templateId: input.id,
              };
            }),
          });
        }

        // Remove asset records for images no longer marked as fixed.
        // Delete the underlying S3 objects too — otherwise blobs leak into the bucket
        // every time a fixed asset / palette image / artboard background is removed.
        const toRemove = existingAssets.filter((a: { url: string }) => !fixedUrls.has(a.url));
        if (toRemove.length > 0) {
          const s3Keys = toRemove
            .map((a: { url: string }) => extractS3KeyFromUrl(a.url))
            .filter((k: string | null): k is string => Boolean(k));
          if (s3Keys.length > 0) {
            try {
              await deleteS3Objects(s3Keys);
            } catch (s3Err) {
              console.error("[template.saveState] S3 cleanup failed (non-fatal):", s3Err);
            }
          }
          await ctx.prisma.asset.deleteMany({
            where: { id: { in: toRemove.map((a: { id: string }) => a.id) } },
          });
        }
      } catch (syncErr) {
        console.error("[template.saveState] Fixed asset sync failed:", syncErr);
      }

      return { success: true, updatedAt: template.updatedAt };
    }),

  /** Delete template (with S3 storage cleanup) */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Fetch template to extract S3 URLs from data/thumbnail
      const template = await ctx.prisma.template.findUnique({
        where: { id: input.id },
        select: { data: true, thumbnailUrl: true },
      });

      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // ── S3 cleanup: template data + linked Asset records ──
      try {
        const s3Keys = collectS3KeysFromTemplate(template.data, template.thumbnailUrl);

        const templateAssets = await ctx.prisma.asset.findMany({
          where: { templateId: input.id },
          select: { url: true },
        });
        for (const a of templateAssets) {
          const key = extractS3KeyFromUrl(a.url);
          if (key) s3Keys.push(key);
        }

        if (s3Keys.length > 0) {
          await deleteS3Objects(s3Keys);
        }
      } catch (cleanupErr) {
        console.error("[template.delete] S3 cleanup failed:", cleanupErr);
      }

      await ctx.prisma.template.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),
});
