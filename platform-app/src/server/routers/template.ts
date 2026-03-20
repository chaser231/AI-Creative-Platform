/**
 * Template Router
 *
 * CRUD operations for template packs with catalog filtering.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";

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

      const templates = await ctx.prisma.template.findMany({
        where: {
          workspaceId,
          ...(filters.category && {
            categories: { has: filters.category },
          }),
          ...(filters.contentType && { contentType: filters.contentType }),
          ...(filters.occasion && { occasion: filters.occasion }),
          ...(filters.isOfficial !== undefined && {
            isOfficial: filters.isOfficial,
          }),
          ...(search && {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
            ],
          }),
        },
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
          thumbnailUrl: true,
          popularity: true,
          createdAt: true,
          updatedAt: true,
          author: true,
        },
        orderBy: [{ isOfficial: "desc" }, { popularity: "desc" }],
      });

      return templates;
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

  /** Update template */
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
        thumbnailUrl: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const template = await ctx.prisma.template.update({
        where: { id },
        data,
      });

      return template;
    }),

  /** Delete template */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.template.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),
});
