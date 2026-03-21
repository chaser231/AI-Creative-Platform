/**
 * AI Router
 *
 * Manages AI sessions, messages, system prompts, and presets.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";

export const aiRouter = createTRPCRouter({
  // ─── Sessions ────────────────────────────────────────────

  /** Create a new AI session for a project */
  createSession: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.aISession.create({
        data: {
          projectId: input.projectId,
          userId: ctx.user.id,
        },
      });

      return session;
    }),

  /** List AI sessions for a project */
  listSessions: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
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

  // ─── Messages ────────────────────────────────────────────

  /** Add a message to a session */
  addMessage: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
        type: z.enum(["text", "image", "error"]),
        model: z.string().optional(),
        costUnits: z.number().optional(),
        metadata: z.any().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
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

  /** List AI presets for a workspace */
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
        },
        orderBy: { name: "asc" },
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.aIPreset.create({
        data: input,
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
      })
    )
    .mutation(async ({ ctx, input }) => {
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
      await ctx.prisma.aIPreset.delete({ where: { id: input.id } });
      return { success: true };
    }),
});
