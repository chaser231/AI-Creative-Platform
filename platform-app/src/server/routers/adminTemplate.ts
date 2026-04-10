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

export const adminTemplateRouter = createTRPCRouter({
  /** List all templates across all workspaces */
  list: superAdminProcedure
    .input(
      z.object({
        search: z.string().optional(),
        workspaceId: z.string().optional(),
        isOfficial: z.boolean().optional(),
        limit: z.number().min(1).max(200).default(100),
        offset: z.number().min(0).default(0),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const { search, workspaceId, isOfficial, limit = 100, offset = 0 } = input || {};

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

      return { templates, total };
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

  /** Delete a template (with S3 storage cleanup) */
  delete: superAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Fetch template to extract S3 URLs before deletion
      const template = await ctx.prisma.template.findUnique({
        where: { id: input.id },
        select: { data: true, thumbnailUrl: true },
      });

      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Шаблон не найден" });
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
