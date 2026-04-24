import { describe, expect, it, vi } from "vitest";
import { confirmAuthSessionMissing } from "../authClient";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("confirmAuthSessionMissing", () => {
  it("confirms redirect only when the auth probe says unauthenticated", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ status: "unauthenticated" }));

    await expect(confirmAuthSessionMissing(fetcher)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledWith("/api/auth/probe", {
      cache: "no-store",
      credentials: "same-origin",
    });
  });

  it("does not confirm redirect for authenticated or inconclusive probes", async () => {
    await expect(
      confirmAuthSessionMissing(vi.fn(async () => jsonResponse({ status: "authenticated" }))),
    ).resolves.toBe(false);
    await expect(
      confirmAuthSessionMissing(vi.fn(async () => jsonResponse({ status: "unknown" }, 503))),
    ).resolves.toBe(false);
    await expect(
      confirmAuthSessionMissing(vi.fn(async () => {
        throw new Error("network");
      })),
    ).resolves.toBe(false);
  });
});
