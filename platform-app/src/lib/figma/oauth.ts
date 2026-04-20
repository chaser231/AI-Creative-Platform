/**
 * Figma OAuth 2.0 — Account linking flow.
 *
 * This is NOT a NextAuth sign-in provider: Figma acts as a secondary integration
 * that we attach to the already-authenticated user. We reuse the `Account`
 * table (shared with NextAuth adapter) to persist tokens, keyed by
 * `(provider="figma", providerAccountId=<figma user id>)`.
 *
 * Docs: https://www.figma.com/developers/api#oauth2
 */

import crypto from "node:crypto";
import { prisma } from "@/server/db";

export const FIGMA_PROVIDER = "figma";

export const FIGMA_AUTH_URL = "https://www.figma.com/oauth";
export const FIGMA_TOKEN_URL = "https://api.figma.com/v1/oauth/token";
export const FIGMA_REFRESH_URL = "https://api.figma.com/v1/oauth/refresh";

// Only files:read for Phase 1. Brand Kit / Variables come in Phase 2.
export const FIGMA_SCOPES = ["files:read", "current_user:read"] as const;

// ─── Config ────────────────────────────────────────────────────────────────

export interface FigmaOAuthConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

export function getFigmaOAuthConfig(): FigmaOAuthConfig | null {
    const clientId = process.env.AUTH_FIGMA_ID;
    const clientSecret = process.env.AUTH_FIGMA_SECRET;
    const redirectUri = process.env.AUTH_FIGMA_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) return null;
    return { clientId, clientSecret, redirectUri };
}

/** True iff the integration is configured at build/deploy time. */
export function isFigmaOAuthConfigured(): boolean {
    return getFigmaOAuthConfig() !== null;
}

// ─── PKCE ──────────────────────────────────────────────────────────────────

export function generatePkcePair(): { verifier: string; challenge: string } {
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
    return { verifier, challenge };
}

export function generateState(): string {
    return base64url(crypto.randomBytes(16));
}

function base64url(buf: Buffer): string {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─── Authorization URL ─────────────────────────────────────────────────────

export function buildAuthorizeUrl(opts: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    scopes?: readonly string[];
}): string {
    const params = new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: opts.redirectUri,
        scope: (opts.scopes ?? FIGMA_SCOPES).join(" "),
        state: opts.state,
        response_type: "code",
        code_challenge: opts.codeChallenge,
        code_challenge_method: "S256",
    });
    return `${FIGMA_AUTH_URL}?${params.toString()}`;
}

// ─── Token exchange ────────────────────────────────────────────────────────

interface FigmaTokenResponse {
    user_id?: string;
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type?: string;
    scope?: string;
}

export async function exchangeCodeForToken(opts: {
    config: FigmaOAuthConfig;
    code: string;
    codeVerifier: string;
}): Promise<FigmaTokenResponse> {
    const body = new URLSearchParams({
        client_id: opts.config.clientId,
        client_secret: opts.config.clientSecret,
        redirect_uri: opts.config.redirectUri,
        code: opts.code,
        grant_type: "authorization_code",
        code_verifier: opts.codeVerifier,
    });

    const res = await fetch(FIGMA_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Figma token exchange failed (${res.status}): ${text}`);
    }

    return (await res.json()) as FigmaTokenResponse;
}

export async function refreshAccessToken(opts: {
    config: FigmaOAuthConfig;
    refreshToken: string;
}): Promise<FigmaTokenResponse> {
    const body = new URLSearchParams({
        client_id: opts.config.clientId,
        client_secret: opts.config.clientSecret,
        refresh_token: opts.refreshToken,
    });

    const res = await fetch(FIGMA_REFRESH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Figma token refresh failed (${res.status}): ${text}`);
    }

    return (await res.json()) as FigmaTokenResponse;
}

// ─── Persistence ───────────────────────────────────────────────────────────

export interface FigmaAccount {
    userId: string;
    providerAccountId: string;
    access_token: string;
    refresh_token: string | null;
    expires_at: number | null;
    scope: string | null;
}

/**
 * Persist OAuth tokens for (userId, figmaUserId). Upserts so re-connecting
 * overwrites the tokens in place without duplicating rows.
 */
export async function saveFigmaAccount(args: {
    userId: string;
    figmaUserId: string;
    tokens: FigmaTokenResponse;
}): Promise<void> {
    const { userId, figmaUserId, tokens } = args;
    const expiresAt = tokens.expires_in
        ? Math.floor(Date.now() / 1000) + tokens.expires_in
        : null;

    await prisma.account.upsert({
        where: {
            provider_providerAccountId: {
                provider: FIGMA_PROVIDER,
                providerAccountId: figmaUserId,
            },
        },
        create: {
            userId,
            type: "oauth",
            provider: FIGMA_PROVIDER,
            providerAccountId: figmaUserId,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: expiresAt,
            token_type: tokens.token_type ?? "Bearer",
            scope: tokens.scope ?? FIGMA_SCOPES.join(" "),
        },
        update: {
            // Re-link to the current user in case they reconnect via a
            // different platform account using the same Figma handle.
            userId,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token ?? undefined,
            expires_at: expiresAt,
            scope: tokens.scope ?? FIGMA_SCOPES.join(" "),
        },
    });
}

export async function findFigmaAccount(userId: string): Promise<FigmaAccount | null> {
    const account = await prisma.account.findFirst({
        where: { userId, provider: FIGMA_PROVIDER },
        select: {
            userId: true,
            providerAccountId: true,
            access_token: true,
            refresh_token: true,
            expires_at: true,
            scope: true,
        },
    });
    if (!account || !account.access_token) return null;
    return {
        userId: account.userId,
        providerAccountId: account.providerAccountId,
        access_token: account.access_token,
        refresh_token: account.refresh_token,
        expires_at: account.expires_at,
        scope: account.scope,
    };
}

export async function deleteFigmaAccount(userId: string): Promise<number> {
    const result = await prisma.account.deleteMany({
        where: { userId, provider: FIGMA_PROVIDER },
    });
    return result.count;
}

/**
 * Return a valid access token, refreshing if it's about to expire.
 * Throws if the user has no connected Figma account or if refresh fails.
 */
export async function getFigmaAccessToken(userId: string): Promise<string> {
    const account = await findFigmaAccount(userId);
    if (!account) {
        throw new FigmaNotConnectedError("Figma is not connected for this user");
    }

    const now = Math.floor(Date.now() / 1000);
    const safetyMargin = 60; // refresh 60s before hard expiry
    const needsRefresh =
        account.expires_at != null && account.expires_at - safetyMargin <= now;

    if (!needsRefresh) return account.access_token;

    if (!account.refresh_token) {
        // Without a refresh token we can only prompt the user to reconnect.
        throw new FigmaNotConnectedError("Figma token expired; please reconnect.");
    }
    const config = getFigmaOAuthConfig();
    if (!config) {
        throw new Error("Figma OAuth is not configured on this deployment");
    }

    const refreshed = await refreshAccessToken({
        config,
        refreshToken: account.refresh_token,
    });

    await saveFigmaAccount({
        userId,
        figmaUserId: account.providerAccountId,
        tokens: refreshed,
    });

    return refreshed.access_token;
}

export class FigmaNotConnectedError extends Error {
    readonly code = "FIGMA_NOT_CONNECTED";
    constructor(message = "Figma is not connected") {
        super(message);
        this.name = "FigmaNotConnectedError";
    }
}
