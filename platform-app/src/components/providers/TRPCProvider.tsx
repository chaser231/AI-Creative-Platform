/**
 * tRPC + React Query Provider
 *
 * Wraps the app with tRPC client and QueryClient provider.
 * Must be placed in the root layout.
 *
 * Link topology:
 * - `httpLink` (no batching) for long-running procedures (AI agent, template apply).
 *   Batching them with fast calls means one timeout on AI kills both, and the
 *   client sees non-JSON gateway errors it cannot parse.
 * - `httpBatchLink` for everything else (default, lowest RTT).
 *
 * A custom `fetch` wrapper normalises non-JSON gateway errors (502/504/HTML)
 * into readable messages instead of the cryptic "Unable to transform response
 * from server" that superjson throws when it meets non-JSON.
 */

"use client";

import { useState } from "react";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";
import { logAuthDiagnostic } from "@/lib/authDiagnostics";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

/**
 * Procedures that may take tens of seconds (LLM + image generation) and must
 * not be batched with fast writes. Adding a new slow procedure? Put its full
 * dotted path here.
 */
const UNBATCHED_PATHS = new Set<string>([
  "workflow.applyTemplate",
  "workflow.interpretAndExecute",
]);

function isUnauthorizedError(error: unknown) {
  if (!(error instanceof Error)) return false;

  const data = (error as { data?: { code?: string; httpStatus?: number } }).data;
  return data?.code === "UNAUTHORIZED" || data?.httpStatus === 401;
}

function redirectToSignIn() {
  if (typeof window === "undefined") return;

  const { pathname, search } = window.location;
  if (pathname.startsWith("/auth/")) return;

  const signInUrl = new URL("/auth/signin", window.location.origin);
  signInUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  window.location.assign(signInUrl.toString());
}

/**
 * Wrap `fetch` so that when an upstream proxy (Yandex API Gateway, Vercel edge,
 * nginx, etc.) returns a non-JSON body (HTML error page, empty 502), the user
 * sees an actionable message instead of the superjson parser panic.
 *
 * Non-OK responses with `application/json` bodies are passed through untouched
 * so tRPC's own error handling (TRPCError shape) still works.
 *
 * Envelope shape matters: `httpBatchLink` posts to `...?batch=1` and expects an
 * array of response objects back; `httpLink` posts without `batch=` and expects
 * a single object. Sending the wrong shape reintroduces the exact "unable to
 * transform response" error we are trying to eliminate. We detect batched mode
 * from the request URL and emit the corresponding envelope.
 */
async function friendlyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.ok) return res;

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res;

  const statusText =
    res.status === 502 || res.status === 504
      ? "Сервер не ответил вовремя (timeout). Попробуйте ещё раз."
      : res.status === 503
        ? "Сервис временно недоступен. Попробуйте через минуту."
        : `Ошибка сервера (${res.status}). Попробуйте ещё раз.`;

  const envelope = {
    error: {
      json: {
        message: statusText,
        code: -32603,
        data: {
          code: "INTERNAL_SERVER_ERROR",
          httpStatus: res.status,
        },
      },
    },
  };

  const requestUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const isBatched = /[?&]batch=/.test(requestUrl);
  const body = isBatched ? JSON.stringify([envelope]) : JSON.stringify(envelope);

  return new Response(body, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => {
      let client: QueryClient | null = null;
      let redirecting = false;

      const handleAuthFailure = (error: unknown) => {
        if (!isUnauthorizedError(error) || redirecting) return;
        redirecting = true;
        logAuthDiagnostic("unauthorized_response", {
          pathname: typeof window === "undefined" ? null : window.location.pathname,
          error,
        });
        client?.clear();
        redirectToSignIn();
      };

      client = new QueryClient({
        queryCache: new QueryCache({
          onError: handleAuthFailure,
        }),
        mutationCache: new MutationCache({
          onError: handleAuthFailure,
        }),
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) =>
              isUnauthorizedError(error) ? false : failureCount < 2,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
          },
          mutations: {
            retry: (failureCount, error) =>
              isUnauthorizedError(error) ? false : failureCount < 1,
          },
        },
      });

      return client;
    }
  );

  const [trpcClient] = useState(() => {
    const url = `${getBaseUrl()}/api/trpc`;

    return trpc.createClient({
      links: [
        splitLink({
          condition: (op) => UNBATCHED_PATHS.has(op.path),
          // Long-running: no batching, isolated HTTP request
          true: httpLink({
            url,
            transformer: superjson,
            fetch: friendlyFetch,
          }),
          // Everything else: batched
          false: httpBatchLink({
            url,
            transformer: superjson,
            fetch: friendlyFetch,
          }),
        }),
      ],
    });
  });

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
