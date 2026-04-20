/**
 * AI Router
 *
 * Manages AI sessions, messages, system prompts, and presets.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

/**
 * Ensure the caller has access to the given project (is a member of its workspace).
 * Throws NOT_FOUND for unknown projects and FORBIDDEN for outsiders.
 */
async function assertProjectAccess(
  prisma: PrismaClient,
  projectId: string,
  userId: string
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { workspaceId: true },
  });
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Проект не найден" });
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: project.workspaceId } },
    select: { role: true },
  });
  if (!membership) throw new TRPCError({ code: "FORBIDDEN" });
}

/** Ensure the caller has access to the session's project. Returns the session (with projectId). */
async function assertSessionAccess(
  prisma: PrismaClient,
  sessionId: string,
  userId: string
): Promise<{ projectId: string; userId: string }> {
  const session = await prisma.aISession.findUnique({
    where: { id: sessionId },
    select: { projectId: true, userId: true },
  });
  if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Сессия не найдена" });
  await assertProjectAccess(prisma, session.projectId, userId);
  return session;
}

export const aiRouter = createTRPCRouter({
  // ─── Sessions ────────────────────────────────────────────

  /** Create a new AI session for a project */
  createSession: protectedProcedure
    .input(z.object({ projectId: z.string(), name: z.string().max(120).optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx.prisma, input.projectId, ctx.user.id);
      const session = await ctx.prisma.aISession.create({
        data: {
          projectId: input.projectId,
          userId: ctx.user.id,
          ...(input.name && { name: input.name }),
        },
      });

      return session;
    }),

  /** List AI sessions for a project */
  listSessions: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx.prisma, input.projectId, ctx.user.id);
      const sessions = await ctx.prisma.aISession.findMany({
        where: { projectId: input.projectId },
        include: {
          _count: { select: { messages: true } },
          user: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: "desc" },
      });

      return sessions;
    }),

  /** Rename an AI session (owner-only) */
  renameSession: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.aISession.findUnique({
        where: { id: input.id },
        select: { userId: true },
      });
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      if (session.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const updated = await ctx.prisma.aISession.update({
        where: { id: input.id },
        data: { name: input.name },
      });
      return updated;
    }),

  /** Delete an AI session (owner-only) — cascades messages */
  deleteSession: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.aISession.findUnique({
        where: { id: input.id },
        select: { userId: true },
      });
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      if (session.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await ctx.prisma.aISession.delete({ where: { id: input.id } });
      return { success: true };
    }),

  // ─── Messages ────────────────────────────────────────────

  /** Add a message to a session */
  addMessage: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
        type: z.enum(["text", "image", "error", "template_choices", "canvas_action", "preset_choices", "data", "fallback_actions", "plan"]),
        model: z.string().optional(),
        costUnits: z.number().optional(),
        metadata: z.any().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertSessionAccess(ctx.prisma, input.sessionId, ctx.user.id);
      const message = await ctx.prisma.aIMessage.create({
        data: input,
      });

      // Update session timestamp
      await ctx.prisma.aISession.update({
        where: { id: input.sessionId },
        data: { updatedAt: new Date() },
      });

      return message;
    }),

  /** Get messages for a session */
  getMessages: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertSessionAccess(ctx.prisma, input.sessionId, ctx.user.id);
      const messages = await ctx.prisma.aIMessage.findMany({
        where: { sessionId: input.sessionId },
        take: input.limit + 1,
        ...(input.cursor && {
          cursor: { id: input.cursor },
          skip: 1,
        }),
        orderBy: { createdAt: "asc" },
      });

      let nextCursor: string | undefined;
      if (messages.length > input.limit) {
        const nextItem = messages.pop();
        nextCursor = nextItem?.id;
      }

      return { messages, nextCursor };
    }),

  // ─── System Prompts ──────────────────────────────────────

  /** List system prompts for a workspace */
  listSystemPrompts: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        type: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.systemPrompt.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.type && { type: input.type }),
        },
        orderBy: { name: "asc" },
      });
    }),

  /** Create/update a system prompt */
  upsertSystemPrompt: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        name: z.string(),
        type: z.string(),
        content: z.string(),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.systemPrompt.upsert({
        where: {
          workspaceId_name_type: {
            workspaceId: input.workspaceId,
            name: input.name,
            type: input.type,
          },
        },
        create: input,
        update: {
          content: input.content,
          isActive: input.isActive,
        },
      });
    }),

  // ─── AI Presets ──────────────────────────────────────────

  /** List AI presets for a workspace (workspace + own personal) */
  listPresets: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        type: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.aIPreset.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.type && { type: input.type }),
          isActive: true,
          OR: [
            { visibility: "workspace" },
            { createdById: ctx.user.id },
          ],
        },
        include: {
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      });
    }),

  /** Create an AI preset */
  createPreset: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        name: z.string(),
        description: z.string().default(""),
        type: z.string(),
        config: z.any(),
        category: z.string().default("custom"),
        thumbnailUrl: z.string().optional(),
        order: z.number().default(0),
        visibility: z.enum(["personal", "workspace"]).default("personal"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Only admins can create workspace-visible presets
      if (input.visibility === "workspace") {
        const membership = await ctx.prisma.workspaceMember.findUnique({
          where: { userId_workspaceId: { userId: ctx.user.id, workspaceId: input.workspaceId } },
          select: { role: true },
        });
        if (!membership || membership.role !== "ADMIN") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Только админы могут создавать стили для всей команды",
          });
        }
      }

      return ctx.prisma.aIPreset.create({
        data: {
          ...input,
          createdById: ctx.user.id,
        },
      });
    }),

  /** Update an AI preset */
  updatePreset: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        config: z.any().optional(),
        isActive: z.boolean().optional(),
        category: z.string().optional(),
        thumbnailUrl: z.string().optional(),
        order: z.number().optional(),
        visibility: z.enum(["personal", "workspace"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const preset = await ctx.prisma.aIPreset.findUnique({
        where: { id: input.id },
        select: { createdById: true, workspaceId: true },
      });
      if (!preset) throw new TRPCError({ code: "NOT_FOUND" });

      // Check: only author or workspace admin can edit
      const isAuthor = preset.createdById === ctx.user.id;
      const membership = await ctx.prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: ctx.user.id, workspaceId: preset.workspaceId } },
        select: { role: true },
      });
      const isWsAdmin = membership?.role === "ADMIN";

      if (!isAuthor && !isWsAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Нет прав для редактирования" });
      }

      // Non-admins can't set visibility to workspace
      if (input.visibility === "workspace" && !isWsAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Только админы могут делать стили публичными" });
      }

      const { id, ...data } = input;
      return ctx.prisma.aIPreset.update({
        where: { id },
        data,
      });
    }),

  /** Delete an AI preset */
  deletePreset: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const preset = await ctx.prisma.aIPreset.findUnique({
        where: { id: input.id },
        select: { createdById: true, workspaceId: true },
      });
      if (!preset) throw new TRPCError({ code: "NOT_FOUND" });

      // Check: only author or workspace admin can delete
      const isAuthor = preset.createdById === ctx.user.id;
      const membership = await ctx.prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: ctx.user.id, workspaceId: preset.workspaceId } },
        select: { role: true },
      });
      const isWsAdmin = membership?.role === "ADMIN";

      if (!isAuthor && !isWsAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Нет прав для удаления" });
      }

      await ctx.prisma.aIPreset.delete({ where: { id: input.id } });
      return { success: true };
    }),
});
