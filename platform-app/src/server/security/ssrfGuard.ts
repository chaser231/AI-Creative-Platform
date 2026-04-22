/**
 * SSRF guard — validate and safely fetch external URLs from Node runtime.
 *
 * Invariants this module enforces BEFORE any bytes leave our network:
 *   1. Scheme is in an explicit allowlist (default: https only).
 *      Never file:, data:, gopher:, ftp:, javascript:, about:, blob:, ws:.
 *   2. URL carries no userinfo (`user:pass@host` is rejected outright).
 *   3. Hostname is non-empty and, if it is an IP literal, is not in any of
 *      the reserved / private / loopback / link-local / multicast ranges
 *      (IPv4 + IPv6, including IPv4-mapped IPv6 and cloud metadata).
 *   4. Port is in an allowlist (default: 443 for https, 80 only if http is
 *      explicitly enabled by the caller).
 *   5. ALL DNS records for the hostname are checked against the same IP
 *      blocklist — one tainted record is enough to reject.
 *   6. Between validation and the actual request we pin the IP on the TCP
 *      socket (custom `lookup` on an https.Agent). That closes the
 *      TOCTOU/DNS-rebind window.
 *   7. Optional HEAD (with GET Range fallback) verifies Content-Length and
 *      Content-Type BEFORE we download the body.
 *
 * Every rejection is surfaced as {@link SsrfBlockedError} with a stable
 * machine-readable `code`.
 */

import { isIP, isIPv4, isIPv6 } from "node:net";
import { promises as dnsPromises } from "node:dns";
import https from "node:https";
import http from "node:http";
import type { LookupAddress } from "node:dns";
import type { RequestOptions } from "node:https";

// ── Error ────────────────────────────────────────────────

export type SsrfErrorCode =
    | "SCHEME_NOT_ALLOWED"
    | "USERINFO_NOT_ALLOWED"
    | "PORT_NOT_ALLOWED"
    | "HOST_EMPTY"
    | "IP_BLOCKED"
    | "DNS_FAILED"
    | "HOST_NOT_ALLOWED"
    | "HEAD_FAILED"
    | "CONTENT_TOO_LARGE"
    | "MIME_NOT_ALLOWED"
    | "UPSTREAM_ERROR";

export class SsrfBlockedError extends Error {
    public readonly code: SsrfErrorCode;
    public readonly reason: string;
    public readonly url: string;

    constructor(code: SsrfErrorCode, reason: string, url: string) {
        super(`[SSRF:${code}] ${reason} (url=${url})`);
        this.name = "SsrfBlockedError";
        this.code = code;
        this.reason = reason;
        this.url = url;
    }
}

// ── Policy ───────────────────────────────────────────────

export interface SsrfPolicyOptions {
    /** Only these hosts / dot-suffixes are accepted. ".example.com" matches subdomains. */
    allowedHosts?: string[];
    /** Allowed URL schemes. Default: ["https:"]. */
    allowedSchemes?: string[];
    /** Explicit port allowlist. Default: 443 for https:, 80 for http:. */
    allowedPorts?: number[];
    /** HEAD-validation timeout, ms. Default: 5000. */
    headTimeoutMs?: number;
    /** Reject bodies larger than this, bytes. Default: 25 MB. */
    maxContentLength?: number;
    /** e.g. ["image/", "video/"]. If set, Content-Type must match one. */
    allowedMimePrefixes?: string[];
}

const DEFAULT_MAX_CONTENT_LENGTH = 25 * 1024 * 1024;
const DEFAULT_HEAD_TIMEOUT_MS = 5_000;

function resolveSchemes(opts: SsrfPolicyOptions | undefined): string[] {
    return opts?.allowedSchemes && opts.allowedSchemes.length > 0
        ? opts.allowedSchemes
        : ["https:"];
}

function resolveAllowedPorts(
    opts: SsrfPolicyOptions | undefined,
    schemes: string[],
): number[] {
    if (opts?.allowedPorts && opts.allowedPorts.length > 0) {
        return opts.allowedPorts;
    }
    const ports: number[] = [];
    if (schemes.includes("https:")) ports.push(443);
    if (schemes.includes("http:")) ports.push(80);
    return ports;
}

// ── IP blocklist ─────────────────────────────────────────

type Ipv4Cidr = { ip: number; bits: number };

function ipv4ToInt(ip: string): number {
    const parts = ip.split(".").map((p) => Number(p));
    if (
        parts.length !== 4 ||
        parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
    ) {
        return NaN;
    }
    return (
        ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>>
        0
    );
}

function cidr4(ip: string, bits: number): Ipv4Cidr {
    return { ip: ipv4ToInt(ip), bits };
}

const IPV4_BLOCKS: readonly Ipv4Cidr[] = [
    cidr4("0.0.0.0", 8),
    cidr4("10.0.0.0", 8),
    cidr4("100.64.0.0", 10),
    cidr4("127.0.0.0", 8),
    cidr4("169.254.0.0", 16), // link-local + AWS/GCP/Azure metadata
    cidr4("172.16.0.0", 12),
    cidr4("192.0.0.0", 24),
    cidr4("192.0.2.0", 24),
    cidr4("192.168.0.0", 16),
    cidr4("198.18.0.0", 15),
    cidr4("198.51.100.0", 24),
    cidr4("203.0.113.0", 24),
    cidr4("224.0.0.0", 4), // multicast
    cidr4("240.0.0.0", 4), // reserved
    cidr4("255.255.255.255", 32),
];

function isIpv4Blocked(ip: string): boolean {
    const n = ipv4ToInt(ip);
    if (!Number.isFinite(n)) return true;
    for (const b of IPV4_BLOCKS) {
        if (!Number.isFinite(b.ip)) continue;
        if (b.bits === 0) return true;
        const mask =
            b.bits === 32 ? 0xffffffff : ((~0 << (32 - b.bits)) >>> 0);
        if ((n & mask) === (b.ip & mask)) return true;
    }
    return false;
}

function ipv6ToBytes(ip: string): Uint8Array | null {
    if (!isIPv6(ip)) return null;
    const bare = ip.split("%")[0]!;

    let expanded = bare;
    const lastColon = bare.lastIndexOf(":");
    const tail = lastColon >= 0 ? bare.slice(lastColon + 1) : "";
    if (tail.includes(".")) {
        const v4 = ipv4ToInt(tail);
        if (!Number.isFinite(v4)) return null;
        const hi = ((v4 >>> 16) & 0xffff).toString(16);
        const lo = (v4 & 0xffff).toString(16);
        expanded = `${bare.slice(0, lastColon + 1)}${hi}:${lo}`;
    }

    let head: string[];
    let rest: string[];
    if (expanded.includes("::")) {
        const [h, r] = expanded.split("::");
        head = h ? h.split(":") : [];
        rest = r ? r.split(":") : [];
        const missing = 8 - head.length - rest.length;
        if (missing < 0) return null;
        head = [...head, ...Array(missing).fill("0"), ...rest];
    } else {
        head = expanded.split(":");
    }
    if (head.length !== 8) return null;

    const bytes = new Uint8Array(16);
    for (let i = 0; i < 8; i++) {
        const n = parseInt(head[i]!, 16);
        if (Number.isNaN(n) || n < 0 || n > 0xffff) return null;
        bytes[i * 2] = (n >>> 8) & 0xff;
        bytes[i * 2 + 1] = n & 0xff;
    }
    return bytes;
}

function bytesInPrefix(
    a: Uint8Array,
    b: Uint8Array,
    bits: number,
): boolean {
    const fullBytes = Math.floor(bits / 8);
    for (let i = 0; i < fullBytes; i++) {
        if (a[i] !== b[i]) return false;
    }
    const rem = bits - fullBytes * 8;
    if (rem === 0) return true;
    const mask = (0xff << (8 - rem)) & 0xff;
    return (a[fullBytes]! & mask) === (b[fullBytes]! & mask);
}

function v6Prefix(
    prefix: string,
    bits: number,
): { bytes: Uint8Array; bits: number } | null {
    const bytes = ipv6ToBytes(prefix);
    if (!bytes) return null;
    return { bytes, bits };
}

const IPV6_BLOCKS: ReadonlyArray<{ bytes: Uint8Array; bits: number }> = [
    v6Prefix("::1", 128),
    v6Prefix("::", 128),
    v6Prefix("fc00::", 7),
    v6Prefix("fe80::", 10),
    v6Prefix("ff00::", 8),
    v6Prefix("2001:db8::", 32),
    v6Prefix("100::", 64),
    v6Prefix("fd00:ec2::254", 128),
].filter(
    (x): x is { bytes: Uint8Array; bits: number } => x !== null,
);

const IPV4_MAPPED_PREFIX = v6Prefix("::ffff:0:0", 96)!;

function isIpv6Blocked(ip: string): boolean {
    const bytes = ipv6ToBytes(ip);
    if (!bytes) return true;

    if (
        bytesInPrefix(bytes, IPV4_MAPPED_PREFIX.bytes, IPV4_MAPPED_PREFIX.bits)
    ) {
        const v4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
        if (isIpv4Blocked(v4)) return true;
    }

    for (const block of IPV6_BLOCKS) {
        if (bytesInPrefix(bytes, block.bytes, block.bits)) return true;
    }
    return false;
}

/** True if `ip` (IPv4 or IPv6 literal) is in any blocklisted range. */
export function isBlockedIp(ip: string): boolean {
    const family = isIP(ip);
    if (family === 4) return isIpv4Blocked(ip);
    if (family === 6) return isIpv6Blocked(ip);
    return true;
}

// ── Host allowlist ───────────────────────────────────────

function matchesHostAllowlist(
    hostname: string,
    allowed: readonly string[],
): boolean {
    const h = hostname.toLowerCase();
    for (const raw of allowed) {
        const entry = raw.toLowerCase().trim();
        if (!entry) continue;
        if (entry.startsWith(".")) {
            const bare = entry.slice(1);
            if (h === bare) return true;
            if (h.endsWith(entry)) return true;
        } else if (h === entry) {
            return true;
        }
    }
    return false;
}

/** Parse a comma-separated env list into a policy-ready host allowlist. */
export function parseHostAllowlistEnv(
    raw: string | undefined,
): string[] | undefined {
    if (!raw) return undefined;
    const list = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    return list.length > 0 ? list : undefined;
}

// ── assertUrlShape ───────────────────────────────────────

export function assertUrlShape(
    rawUrl: string,
    opts?: SsrfPolicyOptions,
): URL {
    let u: URL;
    try {
        u = new URL(rawUrl);
    } catch {
        throw new SsrfBlockedError(
            "SCHEME_NOT_ALLOWED",
            "Строка не является валидным URL",
            String(rawUrl),
        );
    }

    const schemes = resolveSchemes(opts);
    if (!schemes.includes(u.protocol)) {
        throw new SsrfBlockedError(
            "SCHEME_NOT_ALLOWED",
            `Схема ${u.protocol} запрещена (разрешено: ${schemes.join(", ")})`,
            rawUrl,
        );
    }

    // Reject degenerate "scheme:///path" forms — the URL parser happily folds
    // the first path segment into the hostname for these, which is exactly
    // the confusion SSRF filters must not allow. We check AFTER scheme so
    // that "file:///etc/passwd" is still reported as SCHEME_NOT_ALLOWED.
    if (
        typeof rawUrl === "string" &&
        /^[a-z][a-z0-9+.-]*:\/\/\//i.test(rawUrl)
    ) {
        throw new SsrfBlockedError(
            "HOST_EMPTY",
            "URL authority is empty (scheme:///... form)",
            rawUrl,
        );
    }

    if (u.username !== "" || u.password !== "") {
        throw new SsrfBlockedError(
            "USERINFO_NOT_ALLOWED",
            "URL содержит userinfo (user:pass@...) — запрещено",
            rawUrl,
        );
    }

    // URL.hostname keeps IPv6 brackets ("[::1]") — strip them so
    // node:net.isIP / isBlockedIp can parse the literal.
    const rawHost = u.hostname;
    const hostname =
        rawHost.startsWith("[") && rawHost.endsWith("]")
            ? rawHost.slice(1, -1)
            : rawHost;
    if (!hostname) {
        throw new SsrfBlockedError("HOST_EMPTY", "Пустой hostname", rawUrl);
    }

    if (isIP(hostname) !== 0 && isBlockedIp(hostname)) {
        throw new SsrfBlockedError(
            "IP_BLOCKED",
            `IP-literal ${hostname} в заблокированном диапазоне`,
            rawUrl,
        );
    }

    const lowerHost = hostname.toLowerCase();
    if (
        lowerHost === "metadata.google.internal" ||
        lowerHost === "metadata" ||
        lowerHost === "instance-data" ||
        lowerHost === "instance-data.ec2.internal"
    ) {
        throw new SsrfBlockedError(
            "HOST_NOT_ALLOWED",
            `Cloud metadata hostname ${hostname} запрещён`,
            rawUrl,
        );
    }

    const port = Number(
        u.port ||
            (u.protocol === "https:" ? 443 : u.protocol === "http:" ? 80 : 0),
    );
    const allowedPorts = resolveAllowedPorts(opts, schemes);
    if (!allowedPorts.includes(port)) {
        throw new SsrfBlockedError(
            "PORT_NOT_ALLOWED",
            `Порт ${port} запрещён (разрешено: ${allowedPorts.join(", ")})`,
            rawUrl,
        );
    }

    if (opts?.allowedHosts && opts.allowedHosts.length > 0) {
        if (!matchesHostAllowlist(hostname, opts.allowedHosts)) {
            throw new SsrfBlockedError(
                "HOST_NOT_ALLOWED",
                `Хост ${hostname} не входит в allowlist`,
                rawUrl,
            );
        }
    }

    return u;
}

// ── assertUrlIsSafe (shape + DNS) ────────────────────────

export async function assertUrlIsSafe(
    rawUrl: string,
    opts?: SsrfPolicyOptions,
): Promise<{ url: URL; resolvedIps: string[] }> {
    const url = assertUrlShape(rawUrl, opts);

    const rawHost = url.hostname;
    const hostname =
        rawHost.startsWith("[") && rawHost.endsWith("]")
            ? rawHost.slice(1, -1)
            : rawHost;

    if (isIP(hostname) !== 0) {
        return { url, resolvedIps: [hostname] };
    }

    let addresses: LookupAddress[];
    try {
        addresses = await dnsPromises.lookup(hostname, {
            all: true,
            family: 0,
        });
    } catch (err) {
        throw new SsrfBlockedError(
            "DNS_FAILED",
            `DNS lookup провалился: ${err instanceof Error ? err.message : String(err)}`,
            rawUrl,
        );
    }

    if (!addresses || addresses.length === 0) {
        throw new SsrfBlockedError(
            "DNS_FAILED",
            "DNS не вернул адресов",
            rawUrl,
        );
    }

    const resolvedIps: string[] = [];
    for (const a of addresses) {
        if (!a.address || isIP(a.address) === 0) {
            throw new SsrfBlockedError(
                "IP_BLOCKED",
                `DNS вернул невалидный адрес ${a.address}`,
                rawUrl,
            );
        }
        if (isBlockedIp(a.address)) {
            throw new SsrfBlockedError(
                "IP_BLOCKED",
                `DNS-адрес ${a.address} для ${hostname} в заблокированном диапазоне`,
                rawUrl,
            );
        }
        resolvedIps.push(a.address);
    }

    // Prefer IPv4 when both are returned. Many egress environments (dev, proxied
    // CI, Yandex Cloud serverless) don't have reliable IPv6 routing, and the
    // pinned IPv6 connect ends up timing out or throwing generic socket errors.
    // The security guarantee is the same either way — every address in the list
    // passed `isBlockedIp`, so only the connectivity order changes.
    resolvedIps.sort((a, b) => {
        const fa = isIP(a);
        const fb = isIP(b);
        if (fa === fb) return 0;
        return fa === 4 ? -1 : 1;
    });

    return { url, resolvedIps };
}

// ── Pinned Agent ─────────────────────────────────────────

/**
 * https.Agent whose socket-level DNS lookup is hard-wired to `pinnedIp`.
 * TLS SNI still uses the original hostname (so the cert validates), but
 * the TCP connect goes to an IP we've already cleared.
 */
function pinnedAgent(
    pinnedIp: string,
    secure: boolean,
): https.Agent | http.Agent {
    const family: 4 | 6 = isIPv4(pinnedIp) ? 4 : 6;
    const AgentCtor = secure ? https.Agent : http.Agent;
    return new AgentCtor({
        keepAlive: false,
        // Node 20+ calls the custom lookup with { all: true } via
        // `lookupAndConnectMultiple`. In that case the callback must receive an
        // array of { address, family } entries; passing (err, address, family)
        // to the happy-eyeballs path surfaces as ERR_INVALID_IP_ADDRESS
        // (node:net:1495 emitLookup). We handle both legacy and modern
        // signatures here.
        lookup: (
            _hostname: string,
            opts: unknown,
            cb: unknown,
        ) => {
            const options = (opts ?? {}) as { all?: boolean };
            const callback = cb as (
                err: NodeJS.ErrnoException | null,
                addressOrList: string | Array<{ address: string; family: number }>,
                family?: number,
            ) => void;

            if (options.all === true) {
                callback(null, [{ address: pinnedIp, family }]);
            } else {
                callback(null, pinnedIp, family);
            }
        },
    } as http.AgentOptions);
}

// ── headCheck ────────────────────────────────────────────

function requestOnce(
    method: "HEAD" | "GET",
    url: URL,
    pinnedIp: string,
    signal: AbortSignal,
    extraHeaders?: Record<string, string>,
): Promise<{
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    abort: () => void;
}> {
    return new Promise((resolve, reject) => {
        const secure = url.protocol === "https:";
        const agent = pinnedAgent(pinnedIp, secure);
        const reqOpts: RequestOptions = {
            method,
            host: url.hostname,
            port: Number(url.port) || (secure ? 443 : 80),
            path: `${url.pathname}${url.search}` || "/",
            agent,
            headers: {
                "user-agent": "acp-ssrf-guard/1.0",
                accept: "*/*",
                ...extraHeaders,
            },
            servername: url.hostname,
        };

        const req = (secure ? https : http).request(reqOpts, (res) => {
            const status = res.statusCode ?? 0;
            const hdrs = res.headers;
            res.resume();
            resolve({
                statusCode: status,
                headers: hdrs,
                abort: () => req.destroy(),
            });
        });

        const onAbort = () => req.destroy(new Error("aborted"));
        if (signal.aborted) {
            onAbort();
            reject(new Error("aborted"));
            return;
        }
        signal.addEventListener("abort", onAbort, { once: true });

        req.on("error", (err) => {
            signal.removeEventListener("abort", onAbort);
            reject(err);
        });
        req.end();
    });
}

export async function headCheck(
    url: URL,
    resolvedIps: string[],
    opts?: SsrfPolicyOptions,
): Promise<{ contentLength: number | null; contentType: string | null; pinnedIp: string }> {
    if (resolvedIps.length === 0) {
        throw new SsrfBlockedError(
            "HEAD_FAILED",
            "Нет pinned IP для проверки",
            url.toString(),
        );
    }
    const timeoutMs = opts?.headTimeoutMs ?? DEFAULT_HEAD_TIMEOUT_MS;
    const maxLen = opts?.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;

    let statusCode = 0;
    let headers: http.IncomingHttpHeaders = {};
    let lastError: unknown = null;
    let usedIp: string | null = null;

    // Try each resolved IP in turn. CDNs usually publish several A/AAAA records
    // and only a subset of them are reachable from any given egress network.
    for (const candidateIp of resolvedIps) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeoutMs);
        try {
            const head = await requestOnce("HEAD", url, candidateIp, ac.signal);
            statusCode = head.statusCode;
            headers = head.headers;

            if (statusCode === 405 || statusCode === 403 || statusCode === 501) {
                const got = await requestOnce("GET", url, candidateIp, ac.signal, {
                    range: "bytes=0-0",
                });
                statusCode = got.statusCode;
                headers = got.headers;
                got.abort();
            }
            usedIp = candidateIp;
            clearTimeout(timer);
            break;
        } catch (err) {
            lastError = err;
            clearTimeout(timer);
        }
    }

    if (usedIp === null) {
        throw new SsrfBlockedError(
            "HEAD_FAILED",
            `HEAD/Range провалился для всех ${resolvedIps.length} IP: ${
                lastError instanceof Error ? lastError.message : String(lastError)
            }`,
            url.toString(),
        );
    }

    if (statusCode >= 400 && statusCode !== 206 && statusCode !== 200) {
        throw new SsrfBlockedError(
            "HEAD_FAILED",
            `Upstream вернул HTTP ${statusCode}`,
            url.toString(),
        );
    }

    const clHeader = headers["content-length"];
    let contentLength: number | null = null;
    if (typeof clHeader === "string" && clHeader.length > 0) {
        const cr = headers["content-range"];
        if (typeof cr === "string" && /\/\d+$/.test(cr)) {
            const total = Number(cr.split("/").pop());
            if (Number.isFinite(total)) contentLength = total;
        }
        if (contentLength === null) {
            const n = Number(clHeader);
            if (Number.isFinite(n)) contentLength = n;
        }
    }

    if (contentLength !== null && contentLength > maxLen) {
        throw new SsrfBlockedError(
            "CONTENT_TOO_LARGE",
            `Content-Length ${contentLength} превышает лимит ${maxLen}`,
            url.toString(),
        );
    }

    const ctRaw = headers["content-type"];
    const contentType =
        typeof ctRaw === "string"
            ? ctRaw.split(";")[0]!.trim().toLowerCase()
            : null;

    if (opts?.allowedMimePrefixes && opts.allowedMimePrefixes.length > 0) {
        if (!contentType) {
            throw new SsrfBlockedError(
                "MIME_NOT_ALLOWED",
                "Сервер не вернул Content-Type, а политика требует проверки MIME",
                url.toString(),
            );
        }
        const ok = opts.allowedMimePrefixes.some((p) =>
            contentType.startsWith(p.toLowerCase()),
        );
        if (!ok) {
            throw new SsrfBlockedError(
                "MIME_NOT_ALLOWED",
                `Content-Type ${contentType} не в allowlist (${opts.allowedMimePrefixes.join(", ")})`,
                url.toString(),
            );
        }
    }

    return { contentLength, contentType, pinnedIp: usedIp };
}

// ── validateExternalUrl ──────────────────────────────────

export async function validateExternalUrl(
    rawUrl: string,
    opts?: SsrfPolicyOptions,
): Promise<{
    url: URL;
    resolvedIps: string[];
    contentType: string | null;
    contentLength: number | null;
    pinnedIp: string;
}> {
    const { url, resolvedIps } = await assertUrlIsSafe(rawUrl, opts);
    const { contentType, contentLength, pinnedIp } = await headCheck(
        url,
        resolvedIps,
        opts,
    );
    return { url, resolvedIps, contentType, contentLength, pinnedIp };
}

// ── safeFetch ────────────────────────────────────────────

/**
 * Stream-safe fetch bound to a pinned IP. Does validateExternalUrl first,
 * then makes the actual request against node:https / node:http with a
 * connection-pinned Agent, and returns a standard web `Response`.
 *
 * Implementation note: Node 22's global `fetch` does not accept an agent;
 * it is undici-backed, and undici is not installed as a direct dep of this
 * repo. Rather than add a dependency, we implement the pinned path against
 * the native modules and adapt IncomingMessage → ReadableStream → Response.
 */
export async function safeFetch(
    rawUrl: string,
    init?: RequestInit,
    opts?: SsrfPolicyOptions,
): Promise<Response> {
    const { url, pinnedIp } = await validateExternalUrl(rawUrl, opts);

    const timeoutMs = opts?.headTimeoutMs ?? DEFAULT_HEAD_TIMEOUT_MS;
    const timeoutSignal = AbortSignal.timeout(timeoutMs * 6);

    const signal: AbortSignal = init?.signal
        ? (AbortSignal.any?.([init.signal, timeoutSignal]) ?? timeoutSignal)
        : timeoutSignal;

    const method = ((init?.method ?? "GET") as string).toUpperCase();

    const extraHeaders: Record<string, string> = {};
    if (init?.headers) {
        if (init.headers instanceof Headers) {
            init.headers.forEach((v, k) => {
                extraHeaders[k] = v;
            });
        } else if (Array.isArray(init.headers)) {
            for (const [k, v] of init.headers) {
                extraHeaders[String(k).toLowerCase()] = String(v);
            }
        } else {
            for (const [k, v] of Object.entries(
                init.headers as Record<string, string>,
            )) {
                extraHeaders[k.toLowerCase()] = v;
            }
        }
    }

    const secure = url.protocol === "https:";
    const agent = pinnedAgent(pinnedIp, secure);
    const reqOpts: RequestOptions = {
        method,
        host: url.hostname,
        port: Number(url.port) || (secure ? 443 : 80),
        path: `${url.pathname}${url.search}` || "/",
        agent,
        headers: {
            "user-agent": "acp-ssrf-guard/1.0",
            accept: "*/*",
            ...extraHeaders,
        },
        servername: url.hostname,
    };

    return new Promise<Response>((resolve, reject) => {
        const req = (secure ? https : http).request(reqOpts, (res) => {
            const status = res.statusCode ?? 0;
            const headers = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
                if (v === undefined) continue;
                if (Array.isArray(v)) {
                    for (const one of v) headers.append(k, one);
                } else {
                    headers.set(k, String(v));
                }
            }
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    res.on("data", (chunk: Buffer) =>
                        controller.enqueue(new Uint8Array(chunk)),
                    );
                    res.on("end", () => controller.close());
                    res.on("error", (e) => controller.error(e));
                },
                cancel() {
                    res.destroy();
                },
            });
            resolve(new Response(stream, { status, headers }));
        });

        const onAbort = () => req.destroy(new Error("aborted"));
        if (signal.aborted) {
            onAbort();
            reject(
                new SsrfBlockedError("UPSTREAM_ERROR", "request aborted", rawUrl),
            );
            return;
        }
        signal.addEventListener("abort", onAbort, { once: true });

        req.on("error", (err) => {
            signal.removeEventListener("abort", onAbort);
            reject(
                new SsrfBlockedError(
                    "UPSTREAM_ERROR",
                    `safeFetch failed: ${err instanceof Error ? err.message : String(err)}`,
                    rawUrl,
                ),
            );
        });

        if (init?.body && method !== "GET" && method !== "HEAD") {
            const b = init.body as unknown;
            if (typeof b === "string") {
                req.write(b);
            } else if (b instanceof Uint8Array) {
                req.write(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
            }
            // Streams / FormData are intentionally not supported by this minimal path.
        }
        req.end();
    });
}

// ── Presets ──────────────────────────────────────────────

export function uploadImagePolicy(): SsrfPolicyOptions {
    return {
        allowedSchemes: ["https:"],
        allowedPorts: [443],
        allowedMimePrefixes: ["image/", "video/"],
        maxContentLength: 25 * 1024 * 1024,
        headTimeoutMs: 5_000,
    };
}

export function agentAddImagePolicy(): SsrfPolicyOptions {
    const envList = parseHostAllowlistEnv(process.env.AGENT_IMAGE_URL_ALLOWLIST);
    const base: SsrfPolicyOptions = {
        allowedSchemes: ["https:"],
        allowedPorts: [443],
        allowedMimePrefixes: ["image/"],
        maxContentLength: 25 * 1024 * 1024,
        headTimeoutMs: 5_000,
    };
    if (envList) base.allowedHosts = envList;
    return base;
}
