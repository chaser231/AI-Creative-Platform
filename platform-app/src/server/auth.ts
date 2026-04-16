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
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: { status: true },
          });
          session.user.status = dbUser?.status ?? "PENDING";
        } catch (err) {
          // Graceful degradation: if DB is temporarily unreachable (PgBouncer reset,
          // serverless cold-start), allow the session through with APPROVED status
          // so the user isn't locked out entirely. The approvedProcedure middleware
          // will re-check status on write operations.
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
