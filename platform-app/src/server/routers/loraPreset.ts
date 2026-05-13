/**
 * LoraPreset Router
 *
 * CRUD for workspace-scoped custom LoRA URLs that workspace members add to
 * the LoRA-aware fal.ai endpoints (flux-lora, flux-2-lora, qwen-image-lora,
 * qwen-image-edit-lora). Read-only system catalogue from
 * `lib/lora-catalog.ts` is merged in by the `list` query so the picker
 * shows a single unified collection.
 *
 * Visibility access mirrors the AIPreset router:
 *   - personal  → any authenticated workspace member
 *   - workspace → workspace ADMIN or SUPER_ADMIN
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { SYSTEM_LORA_CATALOG, type LoraPresetEntry } from "@/lib/lora-catalog";
import {
    assertUrlIsSafe,
    SsrfBlockedError,
    loraPathPolicy,
} from "@/server/security/ssrfGuard";

// ── helpers ───────────────────────────────────────────────

/** Resolve roles for visibility checks (mirrors getPresetRoles in ai.ts). */
async function getRoles(
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
    if (!membership && !isSuperAdmin) {
        throw new TRPCError({
            code: "FORBIDDEN",
            message: "Вы не состоите в этом воркспейсе",
        });
    }
    return { isWsAdmin, isSuperAdmin };
}

/**
 * Validate a `.safetensors` URL via the LoRA SSRF policy. Re-thrown as a
 * tRPC BAD_REQUEST so the client can show an actionable message.
 */
async function assertLoraPath(rawUrl: string): Promise<void> {
    try {
        await assertUrlIsSafe(rawUrl, loraPathPolicy());
    } catch (err) {
        if (err instanceof SsrfBlockedError) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: `URL отклонён: ${err.reason}`,
            });
        }
        throw err;
    }
}

// ── shape ─────────────────────────────────────────────────

const familyEnum = z.enum(["flux-1", "flux-2", "qwen"]);

/**
 * Unified picker entry — system catalogue and DB rows are merged into a
 * single shape so the client doesn't need to know which is which (except
 * for the `source` discriminator, used to gate edit/delete actions in
 * settings).
 */
export type LoraPickerEntry = LoraPresetEntry & {
    source: "system" | "workspace";
    /** Author display name for workspace presets; null for system. */
    authorName: string | null;
    /** True if the caller is allowed to edit/delete this entry. */
    canEdit: boolean;
};

// ── router ────────────────────────────────────────────────

export const loraPresetRouter = createTRPCRouter({
    /**
     * List LoRA presets visible to the caller in `workspaceId`, optionally
     * filtered by `family`. Returns SYSTEM_LORA_CATALOG concat'd with the
     * caller's accessible DB rows (workspace-visible + own personal).
     */
    list: protectedProcedure
        .input(
            z.object({
                workspaceId: z.string(),
                family: familyEnum.optional(),
            }),
        )
        .query(async ({ ctx, input }): Promise<LoraPickerEntry[]> => {
            // System catalogue — always visible, flagged read-only.
            const system: LoraPickerEntry[] = SYSTEM_LORA_CATALOG
                .filter((p) => !input.family || p.family === input.family)
                .map((p) => ({ ...p, source: "system", authorName: null, canEdit: false }));

            // Workspace + personal DB rows.
            const rows = await ctx.prisma.loraPreset.findMany({
                where: {
                    ...(input.family && { family: input.family }),
                    OR: [
                        { workspaceId: input.workspaceId, visibility: "workspace" },
                        {
                            workspaceId: input.workspaceId,
                            visibility: "personal",
                            createdById: ctx.user.id,
                        },
                    ],
                },
                include: { createdBy: { select: { id: true, name: true } } },
                orderBy: [{ createdAt: "desc" }],
            });

            const isWsAdmin = await ctx.prisma.workspaceMember
                .findUnique({
                    where: {
                        userId_workspaceId: {
                            userId: ctx.user.id,
                            workspaceId: input.workspaceId,
                        },
                    },
                    select: { role: true },
                })
                .then((m) => m?.role === "ADMIN");
            const isSuperAdmin = await ctx.prisma.user
                .findUnique({ where: { id: ctx.user.id }, select: { role: true } })
                .then((u) => u?.role === "SUPER_ADMIN");

            const dbEntries: LoraPickerEntry[] = rows.map((r) => ({
                id: r.id,
                name: r.name,
                description: r.description,
                previewUrl: r.previewUrl ?? "",
                family: r.family as LoraPickerEntry["family"],
                path: r.path,
                defaultScale: r.defaultScale,
                triggerWords: r.triggerWords,
                tags: [],
                source: "workspace",
                authorName: r.createdBy?.name ?? null,
                canEdit:
                    r.createdById === ctx.user.id || isWsAdmin || isSuperAdmin,
            }));

            return [...system, ...dbEntries];
        }),

    /** Create a custom LoRA preset in the workspace. */
    create: protectedProcedure
        .input(
            z.object({
                workspaceId: z.string(),
                name: z.string().min(1).max(120),
                description: z.string().max(500).default(""),
                path: z.string().url(),
                family: familyEnum,
                defaultScale: z.number().min(0).max(2).default(1.0),
                previewUrl: z.string().url().optional(),
                triggerWords: z.array(z.string().max(60)).max(10).default([]),
                visibility: z.enum(["personal", "workspace"]).default("personal"),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const { isWsAdmin } = await getRoles(
                ctx.prisma,
                ctx.user.id,
                input.workspaceId,
            );
            if (input.visibility === "workspace" && !isWsAdmin) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message:
                        "Только админы могут публиковать LoRA для всей команды",
                });
            }

            await assertLoraPath(input.path);

            return ctx.prisma.loraPreset.create({
                data: {
                    workspaceId: input.workspaceId,
                    name: input.name,
                    description: input.description,
                    path: input.path,
                    family: input.family,
                    defaultScale: input.defaultScale,
                    previewUrl: input.previewUrl,
                    triggerWords: input.triggerWords,
                    visibility: input.visibility,
                    createdById: ctx.user.id,
                },
            });
        }),

    /** Update an existing custom LoRA preset (author or admin). */
    update: protectedProcedure
        .input(
            z.object({
                id: z.string(),
                name: z.string().min(1).max(120).optional(),
                description: z.string().max(500).optional(),
                path: z.string().url().optional(),
                defaultScale: z.number().min(0).max(2).optional(),
                previewUrl: z.string().url().nullable().optional(),
                triggerWords: z.array(z.string().max(60)).max(10).optional(),
                visibility: z.enum(["personal", "workspace"]).optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const preset = await ctx.prisma.loraPreset.findUnique({
                where: { id: input.id },
                select: { createdById: true, workspaceId: true },
            });
            if (!preset) throw new TRPCError({ code: "NOT_FOUND" });

            const isAuthor = preset.createdById === ctx.user.id;
            const { isWsAdmin } = await getRoles(
                ctx.prisma,
                ctx.user.id,
                preset.workspaceId,
            );
            if (!isAuthor && !isWsAdmin) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Нет прав для редактирования",
                });
            }

            if (input.visibility === "workspace" && !isWsAdmin) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message:
                        "Только админы могут публиковать LoRA для всей команды",
                });
            }

            if (input.path) await assertLoraPath(input.path);

            const { id, ...data } = input;
            return ctx.prisma.loraPreset.update({ where: { id }, data });
        }),

    /** Delete a custom LoRA preset (author or admin). */
    delete: protectedProcedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const preset = await ctx.prisma.loraPreset.findUnique({
                where: { id: input.id },
                select: { createdById: true, workspaceId: true },
            });
            if (!preset) throw new TRPCError({ code: "NOT_FOUND" });

            const isAuthor = preset.createdById === ctx.user.id;
            const { isWsAdmin } = await getRoles(
                ctx.prisma,
                ctx.user.id,
                preset.workspaceId,
            );
            if (!isAuthor && !isWsAdmin) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Нет прав для удаления",
                });
            }

            await ctx.prisma.loraPreset.delete({ where: { id: input.id } });
            return { success: true };
        }),
});
