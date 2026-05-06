import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { TRPCProvider } from "@/components/providers/TRPCProvider";
import { WorkspaceProvider } from "@/providers/WorkspaceProvider";
import { WaitlistGuard } from "@/components/auth/WaitlistGuard";
import { SessionProvider } from "next-auth/react";
import "./globals.css";
import "./fonts.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "AI Creative Platform",
  description:
    "AI-powered creative content platform for Yandex — create on-brand banners, copy, and video with professional tools and AI automation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className={`${plusJakarta.variable} font-sans antialiased`} suppressHydrationWarning>
        {/*
         * SessionProvider configuration:
         * - refetchOnWindowFocus={false}: NextAuth's default refetches the session
         *   on every tab focus. With Prisma DB sessions, that's a Postgres round-trip
         *   inside the `session()` callback. While in flight, `useSession().status`
         *   flickers through `loading`, which makes WaitlistGuard remount the entire
         *   children tree (visually identical to a page refresh). This was the root
         *   cause of "page randomly refreshes when switching browser tabs".
         * - refetchInterval={0}: no polling; session freshness is enforced via
         *   `useIdleSessionRefresh` (only after >10min of inactivity) and the
         *   tRPC 401 → /api/auth/probe → redirect path that already exists.
         * - refetchWhenOffline={false}: avoid futile retries when offline.
         */}
        <SessionProvider
          refetchOnWindowFocus={false}
          refetchInterval={0}
          refetchWhenOffline={false}
        >
          <TRPCProvider>
            <WaitlistGuard>
              <WorkspaceProvider>
                <ThemeProvider>{children}</ThemeProvider>
              </WorkspaceProvider>
            </WaitlistGuard>
          </TRPCProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
