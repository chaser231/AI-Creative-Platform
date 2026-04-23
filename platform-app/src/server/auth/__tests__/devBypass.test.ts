import { describe, expect, it } from "vitest";
import { isDevAuthBypassEnabled } from "../devBypass";

describe("isDevAuthBypassEnabled", () => {
  it("requires development mode and an explicit opt-in flag", () => {
    expect(
      isDevAuthBypassEnabled({
        NODE_ENV: "development",
        AUTH_DEV_BYPASS: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("stays disabled in development unless AUTH_DEV_BYPASS is true", () => {
    expect(
      isDevAuthBypassEnabled({
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("stays disabled outside development even when the flag is set", () => {
    expect(
      isDevAuthBypassEnabled({
        NODE_ENV: "production",
        AUTH_DEV_BYPASS: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});
