/**
 * GET /api/connect/figma/start
 *
 * Begins the Figma OAuth flow. Issues PKCE parameters and a CSRF `state`,
 * persists them in a short-lived HTTP-only cookie, and redirects the user to
 * Figma's authorize endpoint.
 *
 * This is *not* a NextAuth sign-in provider — the user must already be
 * authenticated via Yandex. Figma is attached to the current session as a
 * secondary integration.
 */

import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import {
    buildAuthorizeUrl,
    generatePkcePair,
    generateState,
    getFigmaOAuthConfig,
    isFigmaOAuthConfigured,
} from "@/lib/figma/oauth";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "figma_oauth_state";
const COOKIE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes — enough for the OAuth round-trip

export async function GET(req: Request): Promise<Response> {
    if (!isFigmaOAuthConfigured()) {
        return NextResponse.json(
            {
                error:
                    "Figma integration is not configured on this deployment. Set AUTH_FIGMA_ID / AUTH_FIGMA_SECRET / AUTH_FIGMA_REDIRECT_URI.",
            },
            { status: 501 },
        );
    }

    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const config = getFigmaOAuthConfig();
    if (!config) {
        return NextResponse.json({ error: "Figma config missing" }, { status: 501 });
    }

    const { verifier, challenge } = generatePkcePair();
    const state = generateState();

    const url = new URL(req.url);
    const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"));

    const cookiePayload = JSON.stringify({
        state,
        verifier,
        userId: session.user.id,
        returnTo,
    });

    const authorizeUrl = buildAuthorizeUrl({
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        state,
        codeChallenge: challenge,
    });

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(COOKIE_NAME, cookiePayload, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: COOKIE_MAX_AGE_SECONDS,
    });
    return response;
}

/**
 * Guard against open-redirect: only allow same-origin relative paths that
 * start with a single "/" and are not protocol-relative ("//evil.com/…").
 */
export function sanitizeReturnTo(raw: string | null | undefined): string {
    const fallback = "/settings/integrations";
    if (!raw) return fallback;
    if (typeof raw !== "string") return fallback;
    if (!raw.startsWith("/")) return fallback;
    if (raw.startsWith("//")) return fallback;
    if (raw.startsWith("/\\")) return fallback;
    return raw;
}
