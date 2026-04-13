/**
 * Admin Template Router — Cross-workspace template management
 *
 * All procedures require SUPER_ADMIN global role.
 * Provides CRUD, duplicate, and bulk operations for templates.
 */

import { z } from "zod";
import { createTRPCRouter, superAdminProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import {
  collectS3KeysFromTemplate,
  deleteS3Objects,
} from "../utils/s3-cleanup";

/** Extract resizes count from template JSON data */
function getResizesCount(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.resizes)) return d.resizes.length;
  return 0;
}

/** Extract resize names from template JSON data */
function getResizeNames(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.resizes)) {
    return d.resizes.map((r: any) => r.name || r.id || "—");
  }
  return [];
}

export const adminTemplateRouter = createTRPCRouter({
  /** List all templates across all workspaces */
  list: superAdminProcedure
    .input(
      z.object({
        search: z.string().optional(),
        workspaceId: z.string().optional(),
        isOfficial: z.boolean().optional(),
        templateType: z.enum(["single", "pack"]).optional(),
        limit: z.number().min(1).max(200).default(100),
        offset: z.number().min(0).default(0),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const { search, workspaceId, isOfficial, templateType, limit = 100, offset = 0 } = input || {};

      const where: Record<string, unknown> = {};
      if (workspaceId) where.workspaceId = workspaceId;
      if (isOfficial !== undefined) where.isOfficial = isOfficial;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ];
      }

      const [templates, total] = await Promise.all([
        ctx.prisma.template.findMany({
          where,
          select: {
            id: true,
            name: true,
            description: true,
            version: true,
            categories: true,
            tags: true,
            isOfficial: true,
            thumbnailUrl: true,
            popularity: true,
            createdAt: true,
            updatedAt: true,
            workspaceId: true,
            author: true,
            visibility: true,
            data: true, // needed to extract resizes count
            workspace: {
              select: { name: true, slug: true },
            },
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
          skip: offset,
        }),
        ctx.prisma.template.count({ where }),
      ]);

      // Enrich with type info and filter by templateType if needed
      const enriched = templates.map((tmpl) => {
        const formatCount = getResizesCount(tmpl.data);
        const type: "single" | "pack" = formatCount >= 2 ? "pack" : "single";
        const formatNames = getResizeNames(tmpl.data);

        // Strip heavy data field from response
        const { data, ...rest } = tmpl;

        return {
          ...rest,
          formatCount,
          templateType: type,
          formatNames,
        };
      });

      // Apply client-side templateType filter (can't do JSON-level filtering in Prisma easily)
      const filtered = templateType
        ? enriched.filter((t) => t.templateType === templateType)
        : enriched;

      return {
        templates: filtered,
        total: templateType ? filtered.length : total,
      };
    }),

  /** Get full template with data (for editing) */
  getById: superAdminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const template = await ctx.prisma.template.findUnique({
        where: { id: input.id },
        include: {
          workspace: { select: { name: true, slug: true } },
        },
      });

      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Шаблон не найден" });
      }

      return template;
    }),

  /** Update template metadata and/or data */
  update: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().optional(),
        categories: z.array(z.string()).optional(),
        tags: z.any().optional(),
        data: z.any().optional(),
        isOfficial: z.boolean().optional(),
        thumbnailUrl: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const template = await ctx.prisma.template.update({
        where: { id },
        data,
        select: { id: true, name: true, updatedAt: true },
      });

      return template;
    }),

  /** Duplicate a template (optionally to different workspace) */
  duplicate: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
        targetWorkspaceId: z.string().optional(),
        newName: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.prisma.template.findUnique({
        where: { id: input.id },
      });

      if (!source) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Шаблон не найден" });
      }

      const duplicate = await ctx.prisma.template.create({
        data: {
          name: input.newName || `${source.name} (копия)`,
          description: source.description,
          version: source.version,
          categories: source.categories,
          contentType: source.contentType,
          occasion: source.occasion,
          tags: source.tags as any,
          data: source.data as any,
          isOfficial: false,
          thumbnailUrl: source.thumbnailUrl,
          workspaceId: input.targetWorkspaceId || source.workspaceId,
          author: ctx.user.id,
        },
        select: { id: true, name: true },
      });

      return duplicate;
    }),

  /** Delete a template (with S3 storage cleanup + pack safety check) */
  delete: superAdminProcedure
    .input(z.object({
      id: z.string(),
      confirmPack: z.boolean().optional().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      // Fetch template to extract S3 URLs before deletion
      const template = await ctx.prisma.template.findUnique({
        where: { id: input.id },
        select: { name: true, data: true, thumbnailUrl: true },
      });

      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Шаблон не найден" });
      }

      // Pack safety: if template has 2+ resizes, require explicit confirmation
      const formatCount = getResizesCount(template.data);
      if (formatCount >= 2 && !input.confirmPack) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Этот шаблон является пакетом с ${formatCount} форматами. Для удаления требуется подтверждение.`,
        });
      }

      // ── S3 cleanup ──
      try {
        const s3Keys = collectS3KeysFromTemplate(template.data, template.thumbnailUrl);
        if (s3Keys.length > 0) {
          await deleteS3Objects(s3Keys);
        }
      } catch (cleanupErr) {
        console.error("[adminTemplate.delete] S3 cleanup failed:", cleanupErr);
      }

      await ctx.prisma.template.delete({
        where: { id: input.id },
      });
      return { success: true };
    }),
});
