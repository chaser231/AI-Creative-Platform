/**
 * Template Router
 *
 * CRUD operations for template packs with catalog filtering.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import {
  collectS3KeysFromTemplate,
  deleteS3Objects,
} from "../utils/s3-cleanup";

export const templateRouter = createTRPCRouter({
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
          data: true, // Fetch data to extract resizes
        },
        orderBy: [{ isOfficial: "desc" }, { popularity: "desc" }],
      });

      // Extract resizes from data JSON, then remove heavy masterComponents
      return templates.map((t: any) => {
        const { data, ...rest } = t;
        const dataObj = data as any;
        return {
          ...rest,
          resizes: dataObj?.resizes || [],
        };
      });
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
      // Check edit permission
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

      // ── S3 cleanup ──
      try {
        const s3Keys = collectS3KeysFromTemplate(template.data, template.thumbnailUrl);
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
