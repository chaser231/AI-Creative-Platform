/**
 * Next.js Middleware — Route Protection
 *
 * Redirects unauthenticated users to /auth/signin.
 * The middleware only checks for the presence of a NextAuth session cookie.
 * tRPC and route handlers still validate the session server-side.
 *
 * Checks for NextAuth session cookie to avoid rendering private pages for
 * obviously anonymous requests.
 * This approach works with Prisma adapter (non-Edge) since we only check cookies.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  "/auth/signin",
  "/auth/waitlist",
  "/auth/error",
  "/api/auth",      // NextAuth API routes
  "/api/trpc",      // tRPC handles its own auth via protectedProcedure
  "/_next",         // Next.js internals
  "/favicon.ico",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Allow static assets
  if (
    pathname.includes(".") && // Has file extension
    !pathname.endsWith("/")   // Not a directory
  ) {
    return NextResponse.next();
  }

  // Check for NextAuth session cookie. NextAuth v5 can use secure/non-secure
  // cookie names depending on deployment host and protocol.
  const hasSession =
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token") ||
    request.cookies.has("__Host-authjs.session-token");

  if (!hasSession) {
    const signInUrl = new URL("/auth/signin", request.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
