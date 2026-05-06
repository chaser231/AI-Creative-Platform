/**
 * NextAuth.js Configuration
 *
 * Uses Prisma adapter for session/account storage.
 * Configured for Yandex OAuth provider.
 */

import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  trustHost: true,
  debug: process.env.NODE_ENV === "development",
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  logger: {
    error(code, ...message) {
      console.error("[AUTH ERROR]", code, JSON.stringify(message, null, 2));
    },
    warn(code) {
      console.warn("[AUTH WARN]", code);
    },
    debug(code, ...message) {
      if (process.env.AUTH_DEBUG === "true") {
        console.log("[AUTH DEBUG]", code, ...message);
      }
    },
  },
  providers: [
    // Yandex OAuth — requires YANDEX_CLIENT_ID and YANDEX_CLIENT_SECRET
    {
      id: "yandex",
      name: "Yandex",
      type: "oauth",
      clientId: process.env.YANDEX_CLIENT_ID,
      clientSecret: process.env.YANDEX_CLIENT_SECRET,
      authorization: {
        url: "https://oauth.yandex.ru/authorize",
        params: { scope: "login:email login:info login:avatar" },
      },
      token: "https://oauth.yandex.ru/token",
      userinfo: {
        url: "https://login.yandex.ru/info?format=json",
      },
      profile(profile: Record<string, string>) {
        return {
          id: profile.id,
          name: profile.display_name || profile.real_name || profile.login || profile.default_email || "User",
          email: profile.default_email,
          image: profile.default_avatar_id
            ? `https://avatars.yandex.net/get-yapic/${profile.default_avatar_id}/islands-200`
            : null,
        };
      },
    },
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        // Hard cap on the DB lookup. The session callback runs on EVERY
        // /api/auth/session call (which used to fire on every tab focus —
        // see useIdleSessionRefresh and the SessionProvider config in
        // app/layout.tsx). A slow Postgres response here would stall the
        // /api/auth/session endpoint, the client would see the request hang,
        // and useSession().status would flicker through "loading" — exactly
        // the symptom that made WaitlistGuard remount the editor and lose
        // unsaved canvas edits. 1.5s is plenty for a single primary-key
        // SELECT against managed PG; anything slower is degraded and we
        // prefer to let the user through with the safe "APPROVED" default
        // (write ops re-check via approvedProcedure anyway).
        const STATUS_LOOKUP_TIMEOUT_MS = 1_500;
        try {
          const lookup = prisma.user.findUnique({
            where: { id: user.id },
            select: { status: true },
          });
          const timeout = new Promise<{ status: never }>((_, reject) =>
            setTimeout(
              () => reject(new Error("user-status lookup timed out")),
              STATUS_LOOKUP_TIMEOUT_MS,
            ),
          );
          const dbUser = await Promise.race([lookup, timeout]);
          session.user.status = dbUser?.status ?? "PENDING";
        } catch (err) {
          // Graceful degradation: if DB is temporarily unreachable (PgBouncer reset,
          // serverless cold-start, > timeout) allow the session through with
          // APPROVED status so the user isn't locked out entirely. The
          // approvedProcedure middleware will re-check status on write operations.
          console.error("[AUTH] Failed to fetch user status, defaulting to APPROVED:", (err as Error)?.message);
          session.user.status = "APPROVED";
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/signin", // Redirect errors to sign-in page instead of default error page
  },
});
