import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const sessionFindUniqueMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/auth", () => ({ auth: authMock }));
vi.mock("@/server/auth/devBypass", () => ({ isDevAuthBypassEnabled: () => false }));
vi.mock("@/server/db", () => ({
  prisma: {
    session: { findUnique: sessionFindUniqueMock },
  },
}));

import { createTRPCContext } from "../trpc";

function sessionHeaders(token = "session-token") {
  return new Headers({ cookie: `authjs.session-token=${token}` });
}

describe("createTRPCContext auth recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue(null);
  });

  it("recovers a valid database session when Auth.js returned null with a session cookie", async () => {
    const expires = new Date(Date.now() + 60_000);
    sessionFindUniqueMock.mockResolvedValue({
      id: "s1",
      sessionToken: "session-token",
      userId: "u1",
      expires,
      user: {
        id: "u1",
        name: "User",
        email: "u@example.com",
        image: null,
        avatarUrl: null,
        status: "APPROVED",
      },
    });

    const ctx = await createTRPCContext({ headers: sessionHeaders() });

    expect(ctx.user?.id).toBe("u1");
    expect(ctx.session?.user.id).toBe("u1");
    expect(ctx.authSessionUnavailable).toBe(false);
    expect(ctx.authRecoveryStatus).toBe("authenticated");
  });

  it("marks auth unavailable when the session cookie exists but the store probe fails", async () => {
    sessionFindUniqueMock.mockRejectedValue(new Error("db unavailable"));

    const ctx = await createTRPCContext({ headers: sessionHeaders() });

    expect(ctx.user).toBeNull();
    expect(ctx.session).toBeNull();
    expect(ctx.authSessionUnavailable).toBe(true);
    expect(ctx.authRecoveryStatus).toBe("probe_failed");
  });
});
