/**
 * Auth Router
 *
 * Provides session info to the client.
 * Actual authentication flow is handled by NextAuth route handlers.
 */

import { createTRPCRouter, publicProcedure, protectedProcedure } from "../trpc";

export const authRouter = createTRPCRouter({
  /** Get current session info */
  getSession: publicProcedure.query(({ ctx }) => {
    return ctx.session;
  }),

  /** Get current user with workspace memberships */
  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: ctx.user.id },
      include: {
        memberships: {
          include: {
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
                businessUnit: true,
                logoUrl: true,
              },
            },
          },
        },
      },
    });

    return user;
  }),
});
