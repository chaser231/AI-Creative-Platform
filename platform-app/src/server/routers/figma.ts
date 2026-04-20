/**
 * Figma Router — Phase 1 (Read-only Import).
 *
 * Procedures:
 *  - connectionStatus: is the current user linked to a Figma account?
 *  - disconnect: drop the linked account
 *  - parseFileUrl: validate + extract `fileKey` / `nodeId` from a user-pasted URL
 *  - previewFile: fetch the file name + a thumbnail before starting an import
 *  - importFile: create a FigmaImport row and kick off the background worker
 *  - getImportStatus: poll-friendly status endpoint
 *  - listRecentImports: user's recent import history
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { parseFigmaUrl } from "@/lib/figma/parseUrl";
import {
    deleteFigmaAccount,
    findFigmaAccount,
    FigmaNotConnectedError,
    isFigmaOAuthConfigured,
} from "@/lib/figma/oauth";
import { createFigmaClientForUser } from "@/lib/figma/client";
import { startFigmaImport } from "@/lib/figma/importWorker";
import type { FigmaConnectionInfo } from "@/lib/figma/types";

const ROLE_RANK: Record<string, number> = { VIEWER: 0, USER: 1, CREATOR: 2, ADMIN: 3 };

async function ensureCreator(
    prisma: { workspaceMember: { findUnique: (args: { where: { userId_workspaceId: { userId: string; workspaceId: string } } }) => Promise<{ role: string } | null> } },
    userId: string,
    workspaceId: string,
): Promise<void> {
    const m = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!m) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Вы не состоите в этом воркспейсе" });
    }
    if ((ROLE_RANK[m.role] ?? 0) < ROLE_RANK["CREATOR"]) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Нужна роль CREATOR или выше" });
    }
}

const importOptionsSchema = z
    .object({
        preserveVectorsAsImages: z.boolean().optional(),
        allowLossyText: z.boolean().optional(),
    })
    .optional();

export const figmaRouter = createTRPCRouter({
    // ─── Connection management ─────────────────────────────────────────────

    isConfigured: protectedProcedure.query(() => isFigmaOAuthConfigured()),

    connectionStatus: protectedProcedure.query(async ({ ctx }): Promise<FigmaConnectionInfo> => {
        const account = await findFigmaAccount(ctx.user.id);
        if (!account) return { connected: false };
        return {
            connected: true,
            figmaUserId: account.providerAccountId,
            expiresAt: account.expires_at ? new Date(account.expires_at * 1000) : undefined,
            scope: account.scope ?? undefined,
        };
    }),

    /** Fetch the live Figma user profile via /v1/me. Useful for UI display. */
    me: protectedProcedure.query(async ({ ctx }) => {
        try {
            const client = createFigmaClientForUser(ctx.user.id);
            const me = await client.getMe();
            return { id: String(me.id), email: me.email, handle: me.handle, imgUrl: me.img_url };
        } catch (err) {
            if (err instanceof FigmaNotConnectedError) {
                throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
            }
            throw mapFigmaError(err);
        }
    }),

    disconnect: protectedProcedure.mutation(async ({ ctx }) => {
        const deleted = await deleteFigmaAccount(ctx.user.id);
        return { deleted };
    }),

    // ─── Import-time helpers ───────────────────────────────────────────────

    parseFileUrl: protectedProcedure
        .input(z.object({ url: z.string().min(1).max(2048) }))
        .query(({ input }) => {
            const parsed = parseFigmaUrl(input.url);
            if (!parsed) {
                return { ok: false as const, error: "Не похоже на Figma-ссылку" };
            }
            return { ok: true as const, ...parsed };
        }),

    /** Returns file name + thumbnail without starting an import. */
    previewFile: protectedProcedure
        .input(z.object({ fileKey: z.string().min(1).max(64) }))
        .query(async ({ ctx, input }) => {
            try {
                const client = createFigmaClientForUser(ctx.user.id);
                // depth=1 returns only the DocumentNode + its pages (no sub-trees), so it's cheap.
                const file = await client.getFile(input.fileKey, { depth: 1 });
                const pages = file.document.children
                    .filter((c) => c.type === "CANVAS")
                    .map((c) => ({ id: c.id, name: c.name }));
                return {
                    fileKey: input.fileKey,
                    name: file.name,
                    thumbnailUrl: file.thumbnailUrl ?? null,
                    lastModified: file.lastModified,
                    editorType: file.editorType,
                    pages,
                };
            } catch (err) {
                if (err instanceof FigmaNotConnectedError) {
                    throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
                }
                throw mapFigmaError(err);
            }
        }),

    importFile: protectedProcedure
        .input(
            z.object({
                workspaceId: z.string(),
                fileKey: z.string().min(1).max(64),
                nodeId: z.string().optional(),
                projectName: z.string().max(200).optional(),
                sourceUrl: z.string().optional(),
                options: importOptionsSchema,
            }),
        )
        .mutation(async ({ ctx, input }) => {
            await ensureCreator(ctx.prisma, ctx.user.id, input.workspaceId);

            // Fail fast if the account isn't connected before we bother creating
            // a FigmaImport row the user would have to clean up manually.
            const account = await findFigmaAccount(ctx.user.id);
            if (!account) {
                throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message: "Figma не подключена. Перейдите в Настройки → Интеграции.",
                });
            }

            const record = await ctx.prisma.figmaImport.create({
                data: {
                    userId: ctx.user.id,
                    workspaceId: input.workspaceId,
                    fileKey: input.fileKey,
                    pageId: input.nodeId,
                    sourceUrl: input.sourceUrl,
                    fileName: input.projectName ?? "",
                    status: "PENDING",
                    progress: 0,
                    options: (input.options ?? {}) as unknown as Prisma.InputJsonValue,
                },
            });

            startFigmaImport({
                importId: record.id,
                userId: ctx.user.id,
                workspaceId: input.workspaceId,
                fileKey: input.fileKey,
                nodeId: input.nodeId,
                projectName: input.projectName,
                options: input.options,
            });

            return { importId: record.id };
        }),

    getImportStatus: protectedProcedure
        .input(z.object({ importId: z.string() }))
        .query(async ({ ctx, input }) => {
            const row = await ctx.prisma.figmaImport.findUnique({
                where: { id: input.importId },
            });
            if (!row) throw new TRPCError({ code: "NOT_FOUND" });
            if (row.userId !== ctx.user.id) {
                throw new TRPCError({ code: "FORBIDDEN" });
            }
            return {
                id: row.id,
                status: row.status,
                progress: row.progress,
                error: row.error,
                report: row.report,
                projectId: row.projectId,
                fileName: row.fileName,
                fileKey: row.fileKey,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
            };
        }),

    listRecentImports: protectedProcedure
        .input(z.object({ workspaceId: z.string(), limit: z.number().min(1).max(50).default(10) }))
        .query(async ({ ctx, input }) => {
            return ctx.prisma.figmaImport.findMany({
                where: { workspaceId: input.workspaceId, userId: ctx.user.id },
                orderBy: { createdAt: "desc" },
                take: input.limit,
                select: {
                    id: true,
                    status: true,
                    progress: true,
                    fileName: true,
                    fileKey: true,
                    projectId: true,
                    error: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
        }),
});

// ─── Error mapping ─────────────────────────────────────────────────────────

function mapFigmaError(err: unknown): TRPCError {
    const hasStatus = typeof err === "object" && err !== null && "status" in err;
    const status = hasStatus ? (err as { status?: number }).status : undefined;

    const message =
        (err instanceof Error ? err.message : typeof err === "string" ? err : "Figma request failed") ||
        "Figma error";

    if (status === 401 || status === 403) {
        return new TRPCError({ code: "UNAUTHORIZED", message });
    }
    if (status === 404) {
        return new TRPCError({ code: "NOT_FOUND", message: "Файл Figma не найден или нет доступа" });
    }
    if (status === 429) {
        return new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Превышен лимит Figma API. Подождите и попробуйте снова." });
    }
    return new TRPCError({ code: "BAD_GATEWAY", message });
}
