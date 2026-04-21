import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// dns.promises.lookup is mocked for assertUrlIsSafe cases.
vi.mock("node:dns", async () => {
  const actual = await vi.importActual<typeof import("node:dns")>("node:dns");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      lookup: vi.fn(),
    },
  };
});

import { promises as dnsPromises } from "node:dns";
import {
  SsrfBlockedError,
  agentAddImagePolicy,
  assertUrlIsSafe,
  assertUrlShape,
  isBlockedIp,
  parseHostAllowlistEnv,
  uploadImagePolicy,
} from "../ssrfGuard";

const lookupMock = dnsPromises.lookup as unknown as ReturnType<typeof vi.fn>;

function mockLookup(addresses: Array<{ address: string; family: 4 | 6 }>) {
  lookupMock.mockResolvedValueOnce(addresses);
}

describe("isBlockedIp", () => {
  it("blocks IPv4 loopback", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("127.255.255.254")).toBe(true);
  });

  it("blocks RFC1918 ranges", () => {
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("172.31.255.255")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
  });

  it("blocks cloud metadata 169.254.169.254", () => {
    expect(isBlockedIp("169.254.169.254")).toBe(true);
  });

  it("blocks CGNAT 100.64.0.0/10", () => {
    expect(isBlockedIp("100.64.0.1")).toBe(true);
    expect(isBlockedIp("100.127.255.254")).toBe(true);
    expect(isBlockedIp("100.128.0.1")).toBe(false); // outside /10
  });

  it("allows public IPv4", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
  });

  it("blocks IPv6 loopback / ULA / link-local / multicast", () => {
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd12:3456:789a::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
    expect(isBlockedIp("ff02::1")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 when inner v4 is private", () => {
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedIp("::ffff:10.0.0.1")).toBe(true);
  });

  it("allows public IPv6", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false); // Cloudflare
  });

  it("treats malformed addresses as blocked", () => {
    expect(isBlockedIp("not.an.ip")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
  });
});

describe("assertUrlShape", () => {
  it("accepts a clean https URL on port 443", () => {
    expect(() => assertUrlShape("https://example.com/a.png")).not.toThrow();
    expect(() => assertUrlShape("https://example.com:443/a.png")).not.toThrow();
  });

  it("rejects forbidden schemes", () => {
    for (const raw of [
      "http://example.com/",
      "file:///etc/passwd",
      "data:text/html,<script>",
      "gopher://example.com/",
      "ftp://example.com/",
      "javascript:alert(1)",
      "about:blank",
      "blob:https://example.com/foo",
      "ws://example.com/",
    ]) {
      try {
        assertUrlShape(raw);
        expect.fail(`should have rejected ${raw}`);
      } catch (e) {
        expect(e).toBeInstanceOf(SsrfBlockedError);
        expect((e as SsrfBlockedError).code).toBe("SCHEME_NOT_ALLOWED");
      }
    }
  });

  it("rejects garbage input", () => {
    expect(() => assertUrlShape("not a url")).toThrow(SsrfBlockedError);
    expect(() => assertUrlShape("")).toThrow(SsrfBlockedError);
  });

  it("rejects userinfo", () => {
    try {
      assertUrlShape("https://alice:secret@example.com/");
      expect.fail();
    } catch (e) {
      expect((e as SsrfBlockedError).code).toBe("USERINFO_NOT_ALLOWED");
    }
  });

    it("rejects URLs that Node parses into the empty host", () => {
        // Inputs like "https:" or "https://" don't parse to a valid URL at all on Node 22.
        expect(() => assertUrlShape("https:")).toThrow(SsrfBlockedError);
        expect(() => assertUrlShape("https://")).toThrow(SsrfBlockedError);
    });

  it("rejects IP-literal hostnames in blocked ranges", () => {
    for (const raw of [
      "https://127.0.0.1/",
      "https://10.0.0.1/",
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/",
      "https://[fc00::1]/",
    ]) {
      try {
        assertUrlShape(raw);
        expect.fail(`should block ${raw}`);
      } catch (e) {
        expect(e).toBeInstanceOf(SsrfBlockedError);
        expect((e as SsrfBlockedError).code).toBe("IP_BLOCKED");
      }
    }
  });

  it("rejects non-443 ports by default for https", () => {
    try {
      assertUrlShape("https://example.com:8080/");
      expect.fail();
    } catch (e) {
      expect((e as SsrfBlockedError).code).toBe("PORT_NOT_ALLOWED");
    }
  });

  it("allows extra ports via allowedPorts", () => {
    expect(() =>
      assertUrlShape("https://example.com:8443/", { allowedPorts: [8443] }),
    ).not.toThrow();
  });

  it("allows http when explicitly enabled", () => {
    expect(() =>
      assertUrlShape("http://example.com/", {
        allowedSchemes: ["http:", "https:"],
      }),
    ).not.toThrow();
  });

  it("rejects cloud metadata hostnames by name", () => {
    try {
      assertUrlShape("https://metadata.google.internal/");
      expect.fail();
    } catch (e) {
      expect(e).toBeInstanceOf(SsrfBlockedError);
      expect((e as SsrfBlockedError).code).toBe("HOST_NOT_ALLOWED");
    }
  });

  it("honors allowedHosts — suffix and exact match", () => {
    expect(() =>
      assertUrlShape("https://cdn.example.com/a", {
        allowedHosts: [".example.com"],
      }),
    ).not.toThrow();
    expect(() =>
      assertUrlShape("https://example.com/a", {
        allowedHosts: [".example.com"],
      }),
    ).not.toThrow();
    try {
      assertUrlShape("https://evil.test/", {
        allowedHosts: [".example.com"],
      });
      expect.fail();
    } catch (e) {
      expect((e as SsrfBlockedError).code).toBe("HOST_NOT_ALLOWED");
    }
  });
});

describe("assertUrlIsSafe (mocked DNS)", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  afterEach(() => {
    lookupMock.mockReset();
  });

  it("passes when all resolved addresses are public", async () => {
    mockLookup([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1::1", family: 6 },
    ]);
    const res = await assertUrlIsSafe("https://example.com/x.png");
    expect(res.url.hostname).toBe("example.com");
    expect(res.resolvedIps).toEqual(["93.184.216.34", "2606:2800:220:1::1"]);
  });

  it("rejects when ANY resolved address is in a blocked range", async () => {
    mockLookup([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(assertUrlIsSafe("https://example.com/")).rejects.toMatchObject({
      code: "IP_BLOCKED",
    });
  });

  it("specifically blocks AWS metadata on DNS rebind", async () => {
    mockLookup([{ address: "169.254.169.254", family: 4 }]);
    await expect(
      assertUrlIsSafe("https://evil-rebind.example.com/"),
    ).rejects.toMatchObject({ code: "IP_BLOCKED" });
  });

  it("blocks IPv4-mapped IPv6 pointing at a private v4", async () => {
    mockLookup([{ address: "::ffff:10.0.0.1", family: 6 }]);
    await expect(assertUrlIsSafe("https://foo.example.com/")).rejects.toMatchObject({
      code: "IP_BLOCKED",
    });
  });

  it("bypasses DNS entirely for IP-literal hostnames (still validated)", async () => {
    // A public IP literal — no DNS call should happen.
    const res = await assertUrlIsSafe("https://93.184.216.34/");
    expect(res.resolvedIps).toEqual(["93.184.216.34"]);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("surfaces DNS_FAILED when lookup throws", async () => {
    lookupMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(assertUrlIsSafe("https://nope.example.com/")).rejects.toMatchObject({
      code: "DNS_FAILED",
    });
  });

  it("surfaces DNS_FAILED when lookup returns an empty array", async () => {
    mockLookup([]);
    await expect(assertUrlIsSafe("https://example.com/")).rejects.toMatchObject({
      code: "DNS_FAILED",
    });
  });
});

describe("parseHostAllowlistEnv", () => {
  it("returns undefined for empty/undefined input", () => {
    expect(parseHostAllowlistEnv(undefined)).toBeUndefined();
    expect(parseHostAllowlistEnv("")).toBeUndefined();
    expect(parseHostAllowlistEnv("   ,, ")).toBeUndefined();
  });

  it("splits, trims and filters", () => {
    expect(parseHostAllowlistEnv(" a.com , .b.com ,,c.com")).toEqual([
      "a.com",
      ".b.com",
      "c.com",
    ]);
  });
});

describe("presets", () => {
  it("uploadImagePolicy: https only, image/video MIME, 25MB cap", () => {
    const p = uploadImagePolicy();
    expect(p.allowedSchemes).toEqual(["https:"]);
    expect(p.allowedPorts).toEqual([443]);
    expect(p.allowedMimePrefixes).toEqual(["image/", "video/"]);
    expect(p.maxContentLength).toBe(25 * 1024 * 1024);
  });

  it("agentAddImagePolicy: images only, allowlist from ENV", () => {
    const saved = process.env.AGENT_IMAGE_URL_ALLOWLIST;
    process.env.AGENT_IMAGE_URL_ALLOWLIST = "replicate.delivery, .fal.media";
    try {
      const p = agentAddImagePolicy();
      expect(p.allowedMimePrefixes).toEqual(["image/"]);
      expect(p.allowedHosts).toEqual(["replicate.delivery", ".fal.media"]);
    } finally {
      if (saved === undefined) delete process.env.AGENT_IMAGE_URL_ALLOWLIST;
      else process.env.AGENT_IMAGE_URL_ALLOWLIST = saved;
    }
  });

  it("agentAddImagePolicy: without ENV — no host restriction", () => {
    const saved = process.env.AGENT_IMAGE_URL_ALLOWLIST;
    delete process.env.AGENT_IMAGE_URL_ALLOWLIST;
    try {
      const p = agentAddImagePolicy();
      expect(p.allowedHosts).toBeUndefined();
    } finally {
      if (saved !== undefined) process.env.AGENT_IMAGE_URL_ALLOWLIST = saved;
    }
  });
});
