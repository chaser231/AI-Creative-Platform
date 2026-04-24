import type { PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";

const SESSION_COOKIE_NAMES = [
  "__Host-authjs.session-token",
  "__Secure-authjs.session-token",
  "authjs.session-token",
];

type SessionProbePrisma = Pick<PrismaClient, "session">;

export type SessionProbeResult =
  | { status: "missing_cookie" }
  | { status: "authenticated"; session: Session }
  | { status: "unauthenticated"; reason: "missing_session" | "expired_session" };

function decodeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseCookieHeader(cookieHeader: string | null) {
  const cookies = new Map<string, string>();
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const name = trimmed.slice(0, separatorIndex);
    const value = trimmed.slice(separatorIndex + 1);
    cookies.set(name, decodeCookieValue(value));
  }

  return cookies;
}

export function getSessionTokenFromHeaders(headers: Headers) {
  const cookies = parseCookieHeader(headers.get("cookie"));
  for (const cookieName of SESSION_COOKIE_NAMES) {
    const token = cookies.get(cookieName);
    if (token) return token;
  }
  return null;
}

export async function probeDatabaseSessionFromHeaders(
  headers: Headers,
  prisma: SessionProbePrisma,
): Promise<SessionProbeResult> {
  const sessionToken = getSessionTokenFromHeaders(headers);
  if (!sessionToken) return { status: "missing_cookie" };

  const row = await prisma.session.findUnique({
    where: { sessionToken },
    include: { user: true },
  });

  if (!row) {
    return { status: "unauthenticated", reason: "missing_session" };
  }

  if (row.expires.valueOf() < Date.now()) {
    return { status: "unauthenticated", reason: "expired_session" };
  }

  return {
    status: "authenticated",
    session: {
      expires: row.expires.toISOString(),
      user: {
        id: row.user.id,
        name: row.user.name,
        email: row.user.email,
        image: row.user.image ?? row.user.avatarUrl ?? null,
        status: row.user.status,
      },
    },
  };
}
