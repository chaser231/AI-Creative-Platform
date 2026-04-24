import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  getSessionTokenFromHeaders,
  probeDatabaseSessionFromHeaders,
} from "../sessionProbe";

function makeHeaders(cookie: string) {
  return new Headers({ cookie });
}

describe("sessionProbe", () => {
  it("reads both secure and non-secure Auth.js session cookies", () => {
    expect(getSessionTokenFromHeaders(makeHeaders("authjs.session-token=plain"))).toBe("plain");
    expect(getSessionTokenFromHeaders(makeHeaders("__Secure-authjs.session-token=secure"))).toBe("secure");
  });

  it("prefers secure session cookies when duplicate cookie names are present", () => {
    expect(
      getSessionTokenFromHeaders(
        makeHeaders("authjs.session-token=stale; __Secure-authjs.session-token=secure"),
      ),
    ).toBe("secure");
    expect(
      getSessionTokenFromHeaders(
        makeHeaders(
          "authjs.session-token=stale; __Secure-authjs.session-token=secure; __Host-authjs.session-token=host",
        ),
      ),
    ).toBe("host");
  });

  it("recovers a valid database session from the session cookie", async () => {
    const expires = new Date(Date.now() + 60_000);
    const findUnique = vi.fn(async () => ({
      id: "s1",
      sessionToken: "token-1",
      userId: "u1",
      expires,
      user: {
        id: "u1",
        name: "User",
        email: "u@example.com",
        image: null,
        avatarUrl: "https://example.com/avatar.png",
        status: "APPROVED",
      },
    }));
    const prisma = { session: { findUnique } } as unknown as PrismaClient;

    const result = await probeDatabaseSessionFromHeaders(
      makeHeaders("authjs.session-token=token-1"),
      prisma,
    );

    expect(result.status).toBe("authenticated");
    expect(findUnique).toHaveBeenCalledWith({
      where: { sessionToken: "token-1" },
      include: { user: true },
    });
    if (result.status === "authenticated") {
      expect(result.session.user.id).toBe("u1");
      expect(result.session.user.image).toBe("https://example.com/avatar.png");
      expect(result.session.user.status).toBe("APPROVED");
    }
  });

  it("treats missing and expired rows as unauthenticated", async () => {
    const missingPrisma = {
      session: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaClient;

    await expect(
      probeDatabaseSessionFromHeaders(makeHeaders("authjs.session-token=missing"), missingPrisma),
    ).resolves.toEqual({ status: "unauthenticated", reason: "missing_session" });

    const expiredPrisma = {
      session: {
        findUnique: vi.fn(async () => ({
          expires: new Date(Date.now() - 1_000),
          user: {
            id: "u1",
            name: "User",
            email: "u@example.com",
            image: null,
            avatarUrl: null,
            status: "APPROVED",
          },
        })),
      },
    } as unknown as PrismaClient;

    await expect(
      probeDatabaseSessionFromHeaders(makeHeaders("authjs.session-token=expired"), expiredPrisma),
    ).resolves.toEqual({ status: "unauthenticated", reason: "expired_session" });
  });
});
