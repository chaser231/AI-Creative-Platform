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

export async function createTRPCContext(opts: { headers: Headers }) {
  const session = await auth();

  return {
    prisma,
    session,
    user: session?.user ?? null,
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

/** Protected procedure — requires authenticated session */
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
