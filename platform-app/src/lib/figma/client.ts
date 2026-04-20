/**
 * Figma REST API client.
 *
 * A thin, typed wrapper around `fetch` that:
 *  - injects the user's OAuth bearer token (auto-refreshing on expiry)
 *  - retries on 429 / 5xx with exponential back-off, respecting `Retry-After`
 *  - returns strongly-typed responses via `@figma/rest-api-spec`
 *
 * We deliberately don't use a third-party wrapper (figma-api / figma-js) — they
 * are either unmaintained or missing Variables/Webhooks V2 coverage.
 *
 * Docs: https://www.figma.com/developers/api
 */

import type {
    GetFileResponse,
    GetFileNodesResponse,
    GetImagesResponse,
    GetImageFillsResponse,
} from "@figma/rest-api-spec";
import { getFigmaAccessToken } from "./oauth";

export const FIGMA_API_BASE = "https://api.figma.com";

// ─── Errors ────────────────────────────────────────────────────────────────

export class FigmaApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly body?: string,
    ) {
        super(message);
        this.name = "FigmaApiError";
    }
}

// ─── Request helpers ───────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 4;

interface FigmaRequestOpts {
    /** AbortSignal from the caller */
    signal?: AbortSignal;
    /** Override the timeout for this request (ms) */
    timeoutMs?: number;
}

/**
 * Sleep helper honouring an AbortSignal so we don't hold the event loop.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        if (signal) {
            if (signal.aborted) {
                clearTimeout(t);
                reject(signal.reason ?? new Error("aborted"));
                return;
            }
            signal.addEventListener(
                "abort",
                () => {
                    clearTimeout(t);
                    reject(signal.reason ?? new Error("aborted"));
                },
                { once: true },
            );
        }
    });
}

function computeBackoffMs(attempt: number, retryAfterHeader: string | null): number {
    // `Retry-After` may be in seconds (RFC 7231) or an HTTP-date. We only handle seconds.
    if (retryAfterHeader) {
        const asNum = Number(retryAfterHeader);
        if (Number.isFinite(asNum) && asNum >= 0) {
            return Math.min(asNum * 1000, 60_000);
        }
    }
    // Exponential back-off: 500, 1000, 2000, 4000… plus some jitter.
    const base = 500 * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(base + jitter, 15_000);
}

// ─── Client ────────────────────────────────────────────────────────────────

export interface FigmaClient {
    getMe(opts?: FigmaRequestOpts): Promise<FigmaUserInfo>;
    getFile(
        fileKey: string,
        query?: GetFileQuery,
        opts?: FigmaRequestOpts,
    ): Promise<GetFileResponse>;
    getFileNodes(
        fileKey: string,
        ids: string[],
        query?: GetFileNodesQuery,
        opts?: FigmaRequestOpts,
    ): Promise<GetFileNodesResponse>;
    getImages(
        fileKey: string,
        ids: string[],
        query?: GetImagesQuery,
        opts?: FigmaRequestOpts,
    ): Promise<GetImagesResponse>;
    /**
     * Returns a map of `imageRef` → signed URL for every IMAGE fill in the file.
     * This is the right endpoint to hydrate `fills[0].imageRef`.
     */
    getImageFills(fileKey: string, opts?: FigmaRequestOpts): Promise<GetImageFillsResponse>;
}

export interface GetFileQuery {
    /** Restrict tree depth. 1 = top-level frames only. */
    depth?: number;
    /** Comma-separated node ids — returns a subset of the document. */
    ids?: string[];
    /** Include plugin data via `plugin_data=shared` (or a specific plugin id). */
    plugin_data?: string;
    /** Include vector paths via `geometry=paths`. */
    geometry?: "paths";
    /** Branch key to retrieve instead of the main file. */
    branch_data?: boolean;
    /** Specific file version to retrieve. */
    version?: string;
}

export interface GetFileNodesQuery {
    depth?: number;
    geometry?: "paths";
    plugin_data?: string;
    version?: string;
}

export interface GetImagesQuery {
    format?: "jpg" | "png" | "svg" | "pdf";
    scale?: number;
    svg_include_id?: boolean;
    svg_simplify_stroke?: boolean;
    use_absolute_bounds?: boolean;
    version?: string;
}

export interface FigmaUserInfo {
    id: string;
    email: string;
    handle: string;
    img_url: string;
}

// ─── Low-level request ─────────────────────────────────────────────────────

async function doRequest<T>(
    tokenProvider: () => Promise<string>,
    path: string,
    query: Record<string, unknown> | undefined,
    opts: FigmaRequestOpts | undefined,
): Promise<T> {
    const url = new URL(path, FIGMA_API_BASE);
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (v == null) continue;
            if (Array.isArray(v)) {
                if (v.length === 0) continue;
                url.searchParams.set(k, v.join(","));
            } else if (typeof v === "boolean") {
                url.searchParams.set(k, v ? "true" : "false");
            } else {
                url.searchParams.set(k, String(v));
            }
        }
    }

    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        // `timedOut` lets us distinguish an internal per-attempt timeout abort
        // from an external user abort (opts.signal). User aborts must NOT be
        // retried; timeouts should, so we can recover from a slow Figma response.
        let timedOut = false;
        const timeoutHandle = setTimeout(() => {
            timedOut = true;
            controller.abort("timeout");
        }, timeoutMs);
        const onUserAbort = () => controller.abort(opts?.signal?.reason ?? "aborted");
        if (opts?.signal) {
            if (opts.signal.aborted) {
                clearTimeout(timeoutHandle);
                throw opts.signal.reason ?? new Error("aborted");
            }
            opts.signal.addEventListener("abort", onUserAbort, { once: true });
        }

        let response: Response;
        try {
            const token = await tokenProvider();
            response = await fetch(url.toString(), {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/json",
                    "User-Agent": "AI-Creative-Platform/1.0 (+figma-integration)",
                },
                signal: controller.signal,
            });
        } catch (err) {
            clearTimeout(timeoutHandle);
            opts?.signal?.removeEventListener("abort", onUserAbort);
            lastError = err;
            const isAbort = isAbortError(err);
            const userAborted = opts?.signal?.aborted === true;
            // Retry if it's a plain network error OR our internal timeout
            // fired. Never retry once the caller's AbortSignal fires — that
            // indicates an intentional cancel/unmount.
            const shouldRetry =
                attempt < MAX_ATTEMPTS - 1 && !userAborted && (!isAbort || timedOut);
            if (shouldRetry) {
                await sleep(computeBackoffMs(attempt, null), opts?.signal);
                continue;
            }
            throw err;
        } finally {
            clearTimeout(timeoutHandle);
            opts?.signal?.removeEventListener("abort", onUserAbort);
        }

        // Retryable statuses: 429, 502, 503, 504 (and 500 transient).
        if (
            response.status === 429 ||
            response.status === 500 ||
            response.status === 502 ||
            response.status === 503 ||
            response.status === 504
        ) {
            if (attempt < MAX_ATTEMPTS - 1) {
                const wait = computeBackoffMs(attempt, response.headers.get("retry-after"));
                await sleep(wait, opts?.signal);
                continue;
            }
        }

        if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new FigmaApiError(
                `Figma API ${response.status} on ${path}`,
                response.status,
                body,
            );
        }

        return (await response.json()) as T;
    }

    throw lastError instanceof Error ? lastError : new Error("Figma request failed");
}

function isAbortError(err: unknown): boolean {
    if (!err) return false;
    if (err instanceof DOMException) return err.name === "AbortError";
    if (typeof err === "object" && err && "name" in err) {
        return (err as { name: unknown }).name === "AbortError";
    }
    return false;
}

// ─── Factories ─────────────────────────────────────────────────────────────

/**
 * Build a per-user client that refreshes the OAuth token on demand.
 */
export function createFigmaClientForUser(userId: string): FigmaClient {
    const tokenProvider = () => getFigmaAccessToken(userId);
    return createFigmaClientWithToken(tokenProvider);
}

/**
 * Lower-level factory that takes an arbitrary token provider. Useful for tests
 * (return a static string) or for server-to-server tooling with PATs.
 */
export function createFigmaClientWithToken(
    tokenProvider: string | (() => string | Promise<string>),
): FigmaClient {
    const provider: () => Promise<string> =
        typeof tokenProvider === "string"
            ? async () => tokenProvider
            : async () => await tokenProvider();

    return {
        getMe: (opts) => doRequest<FigmaUserInfo>(provider, "/v1/me", undefined, opts),

        getFile: (fileKey, query, opts) =>
            doRequest<GetFileResponse>(
                provider,
                `/v1/files/${encodeURIComponent(fileKey)}`,
                query as Record<string, unknown> | undefined,
                opts,
            ),

        getFileNodes: (fileKey, ids, query, opts) =>
            doRequest<GetFileNodesResponse>(
                provider,
                `/v1/files/${encodeURIComponent(fileKey)}/nodes`,
                { ids, ...(query as Record<string, unknown> | undefined) },
                opts,
            ),

        getImages: (fileKey, ids, query, opts) =>
            doRequest<GetImagesResponse>(
                provider,
                `/v1/images/${encodeURIComponent(fileKey)}`,
                { ids, ...(query as Record<string, unknown> | undefined) },
                opts,
            ),

        getImageFills: (fileKey, opts) =>
            doRequest<GetImageFillsResponse>(
                provider,
                `/v1/files/${encodeURIComponent(fileKey)}/images`,
                undefined,
                opts,
            ),
    };
}
