/**
 * NextAuth.js Configuration
 *
 * Uses Prisma adapter for session/account storage.
 * Configured for Yandex OAuth provider.
 */

import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthConfig } from "next-auth";
import { prisma } from "./db";

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  providers: [
    // Yandex OAuth — requires YANDEX_CLIENT_ID and YANDEX_CLIENT_SECRET
    {
      id: "yandex",
      name: "Yandex",
      type: "oidc",
      issuer: "https://oauth.yandex.ru",
      clientId: process.env.YANDEX_CLIENT_ID,
      clientSecret: process.env.YANDEX_CLIENT_SECRET,
      authorization: {
        url: "https://oauth.yandex.ru/authorize",
        params: { scope: "login:email login:info login:avatar" },
      },
      token: "https://oauth.yandex.ru/token",
      userinfo: "https://login.yandex.ru/info?format=json",
      profile(profile) {
        return {
          id: profile.id,
          name: profile.display_name || profile.real_name || profile.login,
          email: profile.default_email,
          image: profile.default_avatar_id
            ? `https://avatars.yandex.net/get-yapic/${profile.default_avatar_id}/islands-200`
            : null,
        };
      },
    },
  ],
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
