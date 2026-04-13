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

// ─── Context ─────────────────────────────────────────────

/**
 * Dev mode: auto-create and use a dev user when no real auth session exists.
 * This allows all protected routes to work without OAuth configuration.
 */
async function getDevUser() {
  if (process.env.NODE_ENV !== "development") return null;

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
  const session = await auth();
  
  // In dev mode, use dev user if no real session
  let user = session?.user ?? null;
  if (!user && process.env.NODE_ENV === "development") {
    user = await getDevUser();
  }

  return {
    prisma,
    session: session ?? (user ? { user, expires: "" } : null),
    user,
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
  if (!ctx.session || !ctx.user) {
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
