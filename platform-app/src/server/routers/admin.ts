/**
 * Admin Router — Super-Admin Dashboard
 *
 * All procedures require SUPER_ADMIN global role.
 * Provides cross-workspace analytics and user management.
 */

import { z } from "zod";
import { createTRPCRouter, superAdminProcedure } from "../trpc";

export const adminRouter = createTRPCRouter({
  /** Aggregate platform statistics */
  stats: superAdminProcedure.query(async ({ ctx }) => {
    const [
      totalUsers,
      totalWorkspaces,
      totalProjects,
      totalTemplates,
      totalAISessions,
    ] = await Promise.all([
      ctx.prisma.user.count(),
      ctx.prisma.workspace.count(),
      ctx.prisma.project.count(),
      ctx.prisma.template.count(),
      ctx.prisma.aISession.count(),
    ]);

    return {
      totalUsers,
      totalWorkspaces,
      totalProjects,
      totalTemplates,
      totalAISessions,
    };
  }),

  /** List all users with computed counts */
  users: superAdminProcedure
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const { search, limit = 50, offset = 0 } = input || {};

      const where = search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {};

      const [users, total] = await Promise.all([
        ctx.prisma.user.findMany({
          where,
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
            createdAt: true,
            _count: {
              select: {
                memberships: true,
                projects: true,
                aiSessions: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }),
        ctx.prisma.user.count({ where }),
      ]);

      return { users, total };
    }),

  /** List all workspaces with computed counts */
  workspaces: superAdminProcedure.query(async ({ ctx }) => {
    const workspaces = await ctx.prisma.workspace.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        businessUnit: true,
        createdAt: true,
        _count: {
          select: {
            members: true,
            projects: true,
            templates: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return workspaces;
  }),

  /** Update user's global role */
  updateUserRole: superAdminProcedure
    .input(
      z.object({
        userId: z.string(),
        role: z.enum(["SUPER_ADMIN", "USER"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Prevent self-demotion
      if (input.userId === ctx.user.id && input.role !== "SUPER_ADMIN") {
        throw new (await import("@trpc/server")).TRPCError({
          code: "BAD_REQUEST",
          message: "Нельзя снять роль супер-администратора с самого себя",
        });
      }

      // Ensure at least one SUPER_ADMIN remains
      if (input.role === "USER") {
        const adminCount = await ctx.prisma.user.count({ where: { role: "SUPER_ADMIN" } });
        if (adminCount <= 1) {
          throw new (await import("@trpc/server")).TRPCError({
            code: "BAD_REQUEST",
            message: "Должен остаться хотя бы один супер-администратор",
          });
        }
      }

      const user = await ctx.prisma.user.update({
        where: { id: input.userId },
        data: { role: input.role },
        select: { id: true, name: true, role: true },
      });

      return user;
    }),
});
