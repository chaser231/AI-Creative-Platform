/**
 * Centralized authorization guards for workspace-scoped resources.
 *
 * Every domain router procedure that accepts a resource `id` must run the
 * matching guard before touching the resource. The guards:
 *   - verify WorkspaceMember membership (with optional minimum role)
 *   - chain parent lookups (session→project→workspace, version→project,
 *     asset→workspace, template→workspace)
 *   - respect per-resource visibility metadata (Template.visibility /
 *     editPermission, Template.isOfficial)
 *
 * Every guard:
 *   - throws TRPCError NOT_FOUND when the target resource does not exist
 *   - throws TRPCError FORBIDDEN when the caller lacks required access
 *   - throws TRPCError UNAUTHORIZED when ctx has no authenticated user
 *   - returns the fetched resource row so callers do not re-query
 *
 * Framework-agnostic variants (`requireSessionAnd*`) wrap the tRPC guards
 * so that Next.js App Router handlers (which resolve the NextAuth session
 * outside of tRPC) can reuse the exact same policy.
 */

import { TRPCError } from "@trpc/server";
import type {
  AISession,
  Asset,
  PrismaClient,
  Project,
  ProjectVersion,
  Template,
  WorkspaceMember,
  WorkspaceRole,
} from "@prisma/client";
import { prisma as defaultPrisma } from "../db";

// ─── Types ───────────────────────────────────────────────

/**
 * Minimal ctx shape required by the guards. The real TRPCContext satisfies
 * this (it carries `prisma` plus `user: { id } | null`).
 */
export type AuthzCtx = {
  readonly prisma: PrismaClient;
  readonly user: { readonly id: string } | null;
};

export type AccessMode = "read" | "write";

// ─── Role hierarchy ──────────────────────────────────────

/**
 * Prisma `WorkspaceRole` ordered low → high privilege.
 * VIEWER < USER < CREATOR < ADMIN. There is no OWNER role in the schema.
 */
const ROLE_HIERARCHY = ["VIEWER", "USER", "CREATOR", "ADMIN"] as const;
type HierarchyRole = (typeof ROLE_HIERARCHY)[number];

export function roleRank(role: WorkspaceRole | string): number {
  const idx = ROLE_HIERARCHY.indexOf(role as HierarchyRole);
  return idx < 0 ? -1 : idx;
}

function minRoleForMode(mode: AccessMode): WorkspaceRole {
  return mode === "write" ? "USER" : "VIEWER";
}

// ─── Internal helpers ────────────────────────────────────

function requireUserId(ctx: AuthzCtx): string {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return ctx.user.id;
}

export async function getWorkspaceRole(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true },
  });
  return member?.role ?? null;
}

async function requireWorkspaceMembership(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
  minRole: WorkspaceRole,
): Promise<WorkspaceMember> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Вы не являетесь участником этого воркспейса",
    });
  }
  if (roleRank(membership.role) < roleRank(minRole)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Требуется роль ${minRole} или выше`,
    });
  }
  return membership;
}

// ─── Workspace / Project ─────────────────────────────────

/**
 * Assert the caller is a member of `workspaceId` with at least `minRole`.
 * Returns the membership row (incl. role) so callers can branch on it.
 */
export async function assertWorkspaceAccess(
  ctx: AuthzCtx,
  workspaceId: string,
  minRole: WorkspaceRole = "VIEWER",
): Promise<WorkspaceMember> {
  const userId = requireUserId(ctx);
  return requireWorkspaceMembership(ctx.prisma, userId, workspaceId, minRole);
}

/**
 * Resolve `projectId` → its workspace and assert membership.
 *
 * NOTE: The Project model has no `public` / `visibility` flag in the
 * current schema; access is strictly gated by workspace membership.
 * If a visibility column is added later, extend this guard — do not
 * add bypass logic at the call site.
 */
export async function assertProjectAccess(
  ctx: AuthzCtx,
  projectId: string,
  minRole: WorkspaceRole = "VIEWER",
): Promise<{ project: Project; membership: WorkspaceMember }> {
  const userId = requireUserId(ctx);
  const project = await ctx.prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Проект не найден" });
  }
  const membership = await requireWorkspaceMembership(
    ctx.prisma,
    userId,
    project.workspaceId,
    minRole,
  );
  return { project, membership };
}

// ─── Template ────────────────────────────────────────────

/**
 * Access policy for Template — extracted from templateRouter.list /
 * loadState / update / saveState so all call sites share one source of truth.
 *
 *   READ allowed when:
 *     - template.isOfficial
 *     - visibility = PUBLIC
 *     - visibility = WORKSPACE AND caller is a member of template.workspaceId
 *     - visibility = PRIVATE AND caller is author
 *     - visibility = SHARED AND (caller is author OR row exists in TemplateShare)
 *
 *   WRITE allowed when:
 *     - caller is author
 *     - editPermission = WORKSPACE AND caller is member of template.workspaceId
 *       with at least USER role
 *     (editPermission = SPECIFIC is reserved for Phase 2 and currently
 *     treated as author-only.)
 */
export async function assertTemplateAccess(
  ctx: AuthzCtx,
  templateId: string,
  mode: AccessMode,
): Promise<Template> {
  const userId = requireUserId(ctx);
  const template = await ctx.prisma.template.findUnique({
    where: { id: templateId },
  });
  if (!template) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Шаблон не найден" });
  }

  const isAuthor = template.author === userId;

  if (mode === "write") {
    if (isAuthor) return template;
    if (template.editPermission === "WORKSPACE") {
      await requireWorkspaceMembership(
        ctx.prisma,
        userId,
        template.workspaceId,
        "USER",
      );
      return template;
    }
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "У вас нет прав на редактирование этого шаблона",
    });
  }

  if (template.isOfficial) return template;
  if (template.visibility === "PUBLIC") return template;
  if (isAuthor) return template;

  if (template.visibility === "WORKSPACE") {
    const role = await getWorkspaceRole(
      ctx.prisma,
      userId,
      template.workspaceId,
    );
    if (role) return template;
  } else if (template.visibility === "SHARED") {
    const share = await ctx.prisma.templateShare.findUnique({
      where: { templateId_userId: { templateId: template.id, userId } },
      select: { id: true },
    });
    if (share) return template;
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Нет доступа к шаблону",
  });
}

// ─── Asset ───────────────────────────────────────────────

/**
 * Assets are always workspace-scoped (Asset.workspaceId is required).
 * Access is normally granted through that workspace membership. When the
 * asset is additionally linked to a Template, a read may alternatively be
 * granted through that template's visibility — this keeps fonts/images
 * shipped with PUBLIC or official templates reachable by non-members of
 * the template's home workspace.
 */
export async function assertAssetAccess(
  ctx: AuthzCtx,
  assetId: string,
  mode: AccessMode,
): Promise<Asset> {
  const userId = requireUserId(ctx);
  const asset = await ctx.prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Ассет не найден" });
  }

  const role = await getWorkspaceRole(ctx.prisma, userId, asset.workspaceId);
  if (role && roleRank(role) >= roleRank(minRoleForMode(mode))) {
    return asset;
  }

  if (mode === "read" && asset.templateId) {
    const tpl = await ctx.prisma.template.findUnique({
      where: { id: asset.templateId },
      select: { visibility: true, isOfficial: true, author: true },
    });
    if (
      tpl &&
      (tpl.isOfficial ||
        tpl.visibility === "PUBLIC" ||
        tpl.author === userId)
    ) {
      return asset;
    }
  }

  throw new TRPCError({ code: "FORBIDDEN", message: "Нет доступа к ассету" });
}

// ─── AISession ───────────────────────────────────────────

/**
 * Chain AISession → Project → Workspace membership.
 *
 * The session's own `userId` is NOT enforced here because several flows
 * (shared canvas inspection, admin debugging) legitimately read messages
 * authored by another member. Procedures that require ownership
 * (rename / delete) must additionally check
 * `session.userId === ctx.user.id` after calling this guard — the returned
 * row exposes that field.
 */
export async function assertSessionAccess(
  ctx: AuthzCtx,
  sessionId: string,
  mode: AccessMode,
): Promise<AISession> {
  const userId = requireUserId(ctx);
  const session = await ctx.prisma.aISession.findUnique({
    where: { id: sessionId },
  });
  if (!session) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Сессия не найдена" });
  }
  const project = await ctx.prisma.project.findUnique({
    where: { id: session.projectId },
    select: { workspaceId: true },
  });
  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Проект сессии не найден",
    });
  }
  await requireWorkspaceMembership(
    ctx.prisma,
    userId,
    project.workspaceId,
    minRoleForMode(mode),
  );
  return session;
}

// ─── ProjectVersion ──────────────────────────────────────

/**
 * Chain ProjectVersion → Project → Workspace membership.
 *
 * Callers that pass both `projectId` and `versionId` (e.g. restoreVersion)
 * must additionally assert `version.projectId === input.projectId` to
 * prevent cross-project version restoration.
 */
export async function assertVersionAccess(
  ctx: AuthzCtx,
  versionId: string,
  mode: AccessMode,
): Promise<ProjectVersion> {
  const userId = requireUserId(ctx);
  const version = await ctx.prisma.projectVersion.findUnique({
    where: { id: versionId },
  });
  if (!version) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Версия не найдена" });
  }
  const project = await ctx.prisma.project.findUnique({
    where: { id: version.projectId },
    select: { workspaceId: true },
  });
  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Проект версии не найден",
    });
  }
  await requireWorkspaceMembership(
    ctx.prisma,
    userId,
    project.workspaceId,
    minRoleForMode(mode),
  );
  return version;
}

// ─── Framework-agnostic variants (App Router handlers) ───

function ctxFor(userId: string): AuthzCtx {
  return { prisma: defaultPrisma, user: { id: userId } };
}

/** Project access variant for Next.js route handlers. */
export async function requireSessionAndProjectAccess(
  userId: string,
  projectId: string,
  mode: AccessMode,
): Promise<{ project: Project; membership: WorkspaceMember }> {
  return assertProjectAccess(ctxFor(userId), projectId, minRoleForMode(mode));
}

/** Template access variant for Next.js route handlers. */
export async function requireSessionAndTemplateAccess(
  userId: string,
  templateId: string,
  mode: AccessMode,
): Promise<Template> {
  return assertTemplateAccess(ctxFor(userId), templateId, mode);
}

/** Workspace access variant for Next.js route handlers. */
export async function requireSessionAndWorkspaceAccess(
  userId: string,
  workspaceId: string,
  minRole: WorkspaceRole = "VIEWER",
): Promise<WorkspaceMember> {
  return assertWorkspaceAccess(ctxFor(userId), workspaceId, minRole);
}
