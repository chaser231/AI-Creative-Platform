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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";

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

/**
 * Wrap `fetch` so that when an upstream proxy (Yandex API Gateway, Vercel edge,
 * nginx, etc.) returns a non-JSON body (HTML error page, empty 502), the user
 * sees an actionable message instead of the superjson parser panic.
 *
 * Non-OK responses with `application/json` bodies are passed through untouched
 * so tRPC's own error handling (TRPCError shape) still works.
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

  const jsonError = {
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

  return new Response(JSON.stringify([jsonError]), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            refetchOnWindowFocus: false,
            retry: 2,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
          },
          mutations: {
            retry: 1,
          },
        },
      })
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
