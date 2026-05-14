/**
 * AI Router
 *
 * Manages AI sessions, messages, system prompts, and presets.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure, superAdminProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import {
  SYSTEM_IMAGE_PRESETS,
  SYSTEM_TEXT_PRESETS,
  isSystemPresetId,
} from "@/lib/stylePresets";
import { persistThumbnailToS3 } from "@/server/utils/persistThumbnail";

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

/**
 * Resolve preset-management roles for the caller in a given workspace.
 *
 * `isWsAdmin` is true if the user is `WorkspaceMember.role === "ADMIN"` in the
 * target workspace. `isSuperAdmin` is true if the user has the platform-level
 * `User.role === "SUPER_ADMIN"`. SUPER_ADMIN counts as workspace-admin
 * everywhere — that's the rule used by AIPreset visibility checks below.
 */
async function getPresetRoles(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
): Promise<{ isWsAdmin: boolean; isSuperAdmin: boolean }> {
  const [membership, user] = await Promise.all([
    prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { role: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    }),
  ]);

  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const isWsAdmin = membership?.role === "ADMIN" || isSuperAdmin;
  return { isWsAdmin, isSuperAdmin };
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

  /**
   * List AI presets visible to the caller for a given workspace.
   *
   * Returns:
   *  - all `workspace`-scoped presets that belong to the requested workspace,
   *  - the caller's own `personal` presets in the requested workspace,
   *  - every `global` preset (regardless of which workspace originally
   *    owned the row) — these behave like platform-wide system presets and
   *    can only be created/edited by SUPER_ADMIN.
   */
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
          ...(input.type && { type: input.type }),
          isActive: true,
          OR: [
            { workspaceId: input.workspaceId, visibility: "workspace" },
            { workspaceId: input.workspaceId, visibility: "personal", createdById: ctx.user.id },
            { visibility: "global" },
          ],
        },
        include: {
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      });
    }),

  /**
   * Create an AI preset.
   *
   * Visibility access matrix:
   *  - personal  → any authenticated workspace member
   *  - workspace → workspace ADMIN or SUPER_ADMIN
   *  - global    → SUPER_ADMIN only
   */
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
        visibility: z.enum(["personal", "workspace", "global"]).default("personal"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { isWsAdmin, isSuperAdmin } = await getPresetRoles(
        ctx.prisma,
        ctx.user.id,
        input.workspaceId,
      );

      if (input.visibility === "global" && !isSuperAdmin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Только супер-админы могут создавать стили для всех пользователей",
        });
      }

      if (input.visibility === "workspace" && !isWsAdmin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Только админы могут создавать стили для всей команды",
        });
      }

      // Guarantee any external/temporary AI provider URL gets copied into our
      // own S3 bucket before being written to the database. Otherwise the URL
      // expires after ~24-48h and the thumbnail silently disappears from the
      // UI. Helper is idempotent for already-persisted URLs and local app
      // assets, and throws TRPCError on failure (no silent fallback).
      const persistedThumbnail = await persistThumbnailToS3(
        input.thumbnailUrl,
        input.workspaceId,
      );

      return ctx.prisma.aIPreset.create({
        data: {
          ...input,
          thumbnailUrl: persistedThumbnail ?? undefined,
          createdById: ctx.user.id,
        },
      });
    }),

  /**
   * Update an AI preset.
   *
   * Edit access:    author, workspace ADMIN of the preset's workspace, or SUPER_ADMIN.
   * Visibility set: same matrix as createPreset (workspace → ws-admin/super,
   *                 global → super only).
   */
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
        visibility: z.enum(["personal", "workspace", "global"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const preset = await ctx.prisma.aIPreset.findUnique({
        where: { id: input.id },
        select: { createdById: true, workspaceId: true, visibility: true },
      });
      if (!preset) throw new TRPCError({ code: "NOT_FOUND" });

      const isAuthor = preset.createdById === ctx.user.id;
      const { isWsAdmin, isSuperAdmin } = await getPresetRoles(
        ctx.prisma,
        ctx.user.id,
        preset.workspaceId,
      );

      if (!isAuthor && !isWsAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Нет прав для редактирования" });
      }

      if (input.visibility === "workspace" && !isWsAdmin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Только админы могут делать стили доступными всей команде",
        });
      }

      if (input.visibility === "global" && !isSuperAdmin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Только супер-админы могут делать стили доступными всем пользователям",
        });
      }

      const { id, thumbnailUrl: incomingThumb, ...rest } = input;
      // Persist incoming thumbnail (if any). undefined means "no change", so
      // we only call persistThumbnailToS3 when the client actually sent a
      // value. Empty string is treated as "clear thumbnail".
      const data: typeof rest & { thumbnailUrl?: string | null } = { ...rest };
      if (incomingThumb !== undefined) {
        data.thumbnailUrl = (await persistThumbnailToS3(incomingThumb, preset.workspaceId)) ?? null;
      }

      return ctx.prisma.aIPreset.update({
        where: { id },
        data,
      });
    }),

  /**
   * Delete an AI preset.
   *
   * Delete access: author, workspace ADMIN, or SUPER_ADMIN.
   */
  deletePreset: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const preset = await ctx.prisma.aIPreset.findUnique({
        where: { id: input.id },
        select: { createdById: true, workspaceId: true },
      });
      if (!preset) throw new TRPCError({ code: "NOT_FOUND" });

      const isAuthor = preset.createdById === ctx.user.id;
      const { isWsAdmin } = await getPresetRoles(
        ctx.prisma,
        ctx.user.id,
        preset.workspaceId,
      );

      if (!isAuthor && !isWsAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Нет прав для удаления" });
      }

      await ctx.prisma.aIPreset.delete({ where: { id: input.id } });
      return { success: true };
    }),

  // ─── System Preset Overrides (SUPER_ADMIN only) ─────────────────────
  //
  // System presets (defined in `src/lib/stylePresets.ts`) are static defaults
  // baked into the codebase. To let super-admins tweak them platform-wide
  // without a deploy we let them write a row to `AIPreset` whose primary key
  // matches the system preset id. `mergeImagePresets` / `mergeTextPresets`
  // already prefer DB rows over the hardcoded defaults, so the override
  // surfaces everywhere a system preset is shown.
  //
  // We *don't* expose a custom `id` on the public `createPreset` mutation —
  // letting any user pick the row id would let them shadow another user's
  // preset (or worse, write into another tenant). System overrides therefore
  // get a dedicated procedure with a strict whitelist + `superAdminProcedure`.

  /**
   * Create or update an override for a built-in system preset.
   * Caller MUST be SUPER_ADMIN; `systemId` is whitelisted against the
   * baked-in `SYSTEM_*_PRESETS` registry.
   */
  upsertSystemPresetOverride: superAdminProcedure
    .input(
      z.object({
        systemId: z.string().min(1),
        type: z.enum(["image", "text"]),
        workspaceId: z.string(),
        name: z.string().min(1),
        description: z.string().default(""),
        config: z.any(),
        thumbnailUrl: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isSystemPresetId(input.systemId, input.type)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Системный стиль с id "${input.systemId}" не существует`,
        });
      }

      // Pull category + order from the hardcoded definition so the override
      // can't drift the preset out of its UI group / position. Super-admin
      // edits are scoped to copy + assets only by product decision.
      const systemSource =
        input.type === "image"
          ? SYSTEM_IMAGE_PRESETS.find((p) => p.id === input.systemId)
          : SYSTEM_TEXT_PRESETS.find((p) => p.id === input.systemId);
      if (!systemSource) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Системный стиль не найден в реестре",
        });
      }

      const persistedThumbnail = await persistThumbnailToS3(
        input.thumbnailUrl ?? null,
        `system-${input.systemId}`,
      );

      return ctx.prisma.aIPreset.upsert({
        where: { id: input.systemId },
        create: {
          id: input.systemId,
          workspaceId: input.workspaceId,
          type: input.type,
          name: input.name,
          description: input.description,
          config: input.config,
          category: systemSource.category,
          order: systemSource.order,
          thumbnailUrl: persistedThumbnail,
          visibility: "global",
          isSystem: true,
          isActive: true,
          createdById: ctx.user.id,
        },
        update: {
          name: input.name,
          description: input.description,
          config: input.config,
          thumbnailUrl: persistedThumbnail,
          // Re-assert the platform-level invariants in case a previous
          // out-of-band write changed them. visibility/isSystem/category
          // are not user-configurable for system overrides.
          visibility: "global",
          isSystem: true,
          isActive: true,
          category: systemSource.category,
          order: systemSource.order,
        },
      });
    }),

  /**
   * Remove the override for a system preset, restoring the hardcoded default
   * across all workspaces. SUPER_ADMIN only. No-op if no override exists.
   */
  resetSystemPresetOverride: superAdminProcedure
    .input(
      z.object({
        systemId: z.string().min(1),
        type: z.enum(["image", "text"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isSystemPresetId(input.systemId, input.type)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Системный стиль с id "${input.systemId}" не существует`,
        });
      }

      await ctx.prisma.aIPreset.deleteMany({ where: { id: input.systemId } });
      return { success: true };
    }),

  /**
   * One-shot backfill: scan every preset in the DB whose `thumbnailUrl` is
   * pointing at a temporary/external location (Replicate, fal.media, OpenAI
   * blob storage, …) and copy the bytes into our own S3 bucket so they
   * survive past the provider's TTL.
   *
   * Behaviour per row:
   *  - Skip rows whose thumbnailUrl is empty, an in-app `/style-presets/...`
   *    path, or already on `storage.yandexcloud.net`.
   *  - Otherwise call `persistThumbnailToS3`. On success, replace the URL.
   *    On failure (link already expired, 404, MIME mismatch) we set the
   *    column to `null` so the UI falls back to the icon/placeholder
   *    instead of rendering a broken <img>.
   *
   * SUPER_ADMIN only; runs synchronously and returns a summary. Safe to
   * call repeatedly — idempotent rows are skipped on subsequent runs.
   */
  backfillPresetThumbnails: superAdminProcedure
    .input(z.object({ dryRun: z.boolean().default(false) }).default({ dryRun: false }))
    .mutation(async ({ ctx, input }) => {
      const presets = await ctx.prisma.aIPreset.findMany({
        where: {
          type: "image",
          NOT: { thumbnailUrl: null },
        },
        select: { id: true, workspaceId: true, thumbnailUrl: true, name: true },
      });

      const summary = {
        scanned: presets.length,
        skipped: 0,
        repaired: [] as Array<{ id: string; name: string; oldUrl: string; newUrl: string }>,
        cleared: [] as Array<{ id: string; name: string; oldUrl: string; reason: string }>,
      };

      for (const p of presets) {
        const oldUrl = p.thumbnailUrl ?? "";
        if (!oldUrl) {
          summary.skipped++;
          continue;
        }
        // Already permanent — nothing to do.
        if (oldUrl.startsWith("/") || oldUrl.includes("storage.yandexcloud.net")) {
          summary.skipped++;
          continue;
        }

        try {
          const newUrl = await persistThumbnailToS3(oldUrl, p.workspaceId || "styles");
          if (!newUrl || newUrl === oldUrl) {
            summary.skipped++;
            continue;
          }
          if (!input.dryRun) {
            await ctx.prisma.aIPreset.update({
              where: { id: p.id },
              data: { thumbnailUrl: newUrl },
            });
          }
          summary.repaired.push({ id: p.id, name: p.name, oldUrl, newUrl });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          if (!input.dryRun) {
            await ctx.prisma.aIPreset.update({
              where: { id: p.id },
              data: { thumbnailUrl: null },
            });
          }
          summary.cleared.push({ id: p.id, name: p.name, oldUrl, reason });
        }
      }

      return summary;
    }),
});
