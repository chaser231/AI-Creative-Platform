/**
 * GET /api/connect/figma/callback
 *
 * Completes the Figma OAuth flow. Validates the CSRF `state`, exchanges the
 * authorization code for tokens, fetches the Figma user id, and persists a
 * `Account` row keyed by (provider="figma", providerAccountId=<figmaUserId>).
 * Redirects back to `returnTo` (typically `/settings/integrations`).
 */

import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import {
    exchangeCodeForToken,
    getFigmaOAuthConfig,
    isFigmaOAuthConfigured,
    saveFigmaAccount,
} from "@/lib/figma/oauth";
import { createFigmaClientWithToken } from "@/lib/figma/client";
import { sanitizeReturnTo } from "../start/route";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "figma_oauth_state";

export async function GET(req: Request): Promise<Response> {
    if (!isFigmaOAuthConfigured()) {
        return NextResponse.json({ error: "Figma not configured" }, { status: 501 });
    }

    const config = getFigmaOAuthConfig();
    if (!config) {
        return NextResponse.json({ error: "Figma config missing" }, { status: 501 });
    }

    const session = await auth();
    if (!session?.user) {
        return redirectWithStatus("/settings/integrations", "figma=unauthenticated");
    }

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
        return redirectWithStatus("/settings/integrations", `figma=${encodeURIComponent(error)}`);
    }
    if (!code || !state) {
        return redirectWithStatus("/settings/integrations", "figma=missing_code");
    }

    // Validate CSRF state + retrieve PKCE verifier from cookie
    const cookieValue = getCookie(req, COOKIE_NAME);
    if (!cookieValue) {
        return redirectWithStatus("/settings/integrations", "figma=missing_state");
    }
    let parsed: { state: string; verifier: string; userId: string; returnTo?: string };
    try {
        parsed = JSON.parse(cookieValue);
    } catch {
        return redirectWithStatus("/settings/integrations", "figma=bad_state");
    }
    if (parsed.state !== state) {
        return redirectWithStatus("/settings/integrations", "figma=state_mismatch");
    }
    if (parsed.userId !== session.user.id) {
        return redirectWithStatus("/settings/integrations", "figma=user_mismatch");
    }
    parsed.returnTo = sanitizeReturnTo(parsed.returnTo);

    let tokenResponse: Awaited<ReturnType<typeof exchangeCodeForToken>>;
    try {
        tokenResponse = await exchangeCodeForToken({
            config,
            code,
            codeVerifier: parsed.verifier,
        });
    } catch (err) {
        console.error("[figma/oauth/callback] token exchange failed:", err);
        return redirectWithStatus("/settings/integrations", "figma=token_exchange_failed");
    }

    // Figma returns `user_id` in the token response, but we still fetch /v1/me
    // to learn the handle/email so they can be surfaced in the UI. If that
    // fails we fall back to the token's user_id.
    let figmaUserId = tokenResponse.user_id ?? "";
    try {
        const me = await createFigmaClientWithToken(tokenResponse.access_token).getMe();
        figmaUserId = String(me.id);
    } catch (err) {
        console.warn("[figma/oauth/callback] /v1/me failed, using token user_id:", err);
    }
    if (!figmaUserId) {
        return redirectWithStatus("/settings/integrations", "figma=missing_user_id");
    }

    try {
        await saveFigmaAccount({
            userId: session.user.id,
            figmaUserId,
            tokens: tokenResponse,
        });
    } catch (err) {
        console.error("[figma/oauth/callback] save failed:", err);
        return redirectWithStatus("/settings/integrations", "figma=save_failed");
    }

    const response = redirectWithStatus(parsed.returnTo, "figma=connected");
    response.cookies.delete(COOKIE_NAME);
    return response;
}

function redirectWithStatus(path: string | undefined | null, query: string): NextResponse {
    // Re-sanitize every redirect target. `path` can originate from a cookie or
    // from an internal fallback — in both cases we force it to a safe,
    // same-origin relative URL to prevent open-redirect attacks.
    const safePath = sanitizeReturnTo(path ?? null);
    const sep = safePath.includes("?") ? "&" : "?";
    const url = `${safePath}${sep}${query}`;
    return NextResponse.redirect(new URL(url, resolveBaseUrl()));
}

function resolveBaseUrl(): string {
    return (
        process.env.AUTH_URL ||
        process.env.NEXTAUTH_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "http://localhost:3000"
    );
}

function getCookie(req: Request, name: string): string | null {
    const header = req.headers.get("cookie");
    if (!header) return null;
    for (const part of header.split(";")) {
        const [k, ...rest] = part.trim().split("=");
        if (k === name) return decodeURIComponent(rest.join("="));
    }
    return null;
}
