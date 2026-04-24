/**
 * tRPC Base Configuration
 *
 * Sets up the core tRPC infrastructure:
 * - Context creation (session, user, prisma)
 * - Base procedure with auth middleware
 * - Public procedure (no auth required)
 */

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { prisma } from "./db";
import { auth } from "./auth";
import { isDevAuthBypassEnabled } from "./auth/devBypass";
import { getSessionTokenFromHeaders, probeDatabaseSessionFromHeaders } from "./auth/sessionProbe";
import { logAuthDiagnostic } from "@/lib/authDiagnostics";

// ─── Context ─────────────────────────────────────────────

async function getDevUser() {
  if (!isDevAuthBypassEnabled()) return null;

  const DEV_EMAIL = "dev@acp.local";
  let user = await prisma.user.findUnique({ where: { email: DEV_EMAIL } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: DEV_EMAIL,
        name: "Dev User",
        role: "SUPER_ADMIN",
        status: "APPROVED",
      },
    });

    // Auto-join all workspaces
    const workspaces = await prisma.workspace.findMany({ select: { id: true } });
    for (const ws of workspaces) {
      await prisma.workspaceMember.upsert({
        where: { userId_workspaceId: { userId: user.id, workspaceId: ws.id } },
        update: {},
        create: { userId: user.id, workspaceId: ws.id, role: "ADMIN" },
      });
    }
  } else if (user.status !== "APPROVED") {
    // Ensure dev user is always approved
    await prisma.user.update({
      where: { id: user.id },
      data: { status: "APPROVED" },
    });
  }

  return { id: user.id, name: user.name, email: user.email, image: user.avatarUrl };
}

export async function createTRPCContext(opts: { headers: Headers }) {
  let session = await auth();
  let authSessionUnavailable = false;
  let authRecoveryStatus: string | null = null;

  if (!session?.user && getSessionTokenFromHeaders(opts.headers)) {
    try {
      const probe = await probeDatabaseSessionFromHeaders(opts.headers, prisma);
      authRecoveryStatus = probe.status;

      if (probe.status === "authenticated") {
        session = probe.session;
        logAuthDiagnostic("auth_session_recovered", {
          userId: probe.session.user.id,
        });
      }
    } catch (err) {
      authSessionUnavailable = true;
      authRecoveryStatus = "probe_failed";
      console.error("[auth] Failed to verify existing session cookie:", (err as Error)?.message);
      logAuthDiagnostic("auth_session_unavailable", {
        error: err,
      });
    }
  }
  
  // In dev mode, only use a dev user when the bypass is explicitly enabled.
  let user = session?.user ?? null;
  const devBypassEnabled = isDevAuthBypassEnabled();
  if (!user && devBypassEnabled) {
    user = await getDevUser();
  }

  logAuthDiagnostic("trpc_context_resolved", {
    hasSession: Boolean(session?.user),
    hasUser: Boolean(user),
    userId: user?.id ?? null,
    devBypassEnabled,
    devBypassUsed: !session?.user && Boolean(user),
    authSessionUnavailable,
    authRecoveryStatus,
  });

  return {
    prisma,
    session: session ?? (user ? { user, expires: "" } : null),
    user,
    authSessionUnavailable,
    authRecoveryStatus,
    ...opts,
  };
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

// ─── tRPC Init ───────────────────────────────────────────

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

// ─── Router & Procedures ─────────────────────────────────

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;

/** Public procedure — no auth required */
export const publicProcedure = t.procedure;

/** Protected procedure — requires authenticated session (any status) */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user && ctx.authSessionUnavailable) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Не удалось проверить сессию. Попробуйте ещё раз.",
    });
  }

  if (!ctx.session || !ctx.user) {
    logAuthDiagnostic("trpc_unauthorized", {
      hasSession: Boolean(ctx.session),
      hasUser: Boolean(ctx.user),
      authRecoveryStatus: ctx.authRecoveryStatus,
    });
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      // Narrowed type: session and user are guaranteed to be non-null
      session: ctx.session,
      user: ctx.user,
    },
  });
});

/**
 * Approved procedure — requires authenticated session AND approved account status.
 * Use this for all platform operations that should be restricted to approved users.
 * The basic `protectedProcedure` allows pending users (needed for `auth.me` etc.).
 */
export const approvedProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const dbUser = await prisma.user.findUnique({
    where: { id: ctx.user.id },
    select: { status: true },
  });

  if (!dbUser || dbUser.status !== "APPROVED") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Ваш аккаунт ожидает одобрения администратором",
    });
  }

  return next({ ctx });
});

/** Super-admin procedure — requires SUPER_ADMIN global role */
export const superAdminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const dbUser = await prisma.user.findUnique({
    where: { id: ctx.user.id },
    select: { role: true },
  });

  if (!dbUser || dbUser.role !== "SUPER_ADMIN") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Требуются права супер-администратора",
    });
  }

  return next({ ctx });
});
