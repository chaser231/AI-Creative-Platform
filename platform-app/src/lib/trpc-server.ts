/**
 * Server-side tRPC Caller
 *
 * Used for server components and server-side data fetching.
 * Creates a tRPC caller with the server context.
 */

import "server-only";
import { appRouter } from "@/server/routers/_app";
import { createTRPCContext } from "@/server/trpc";
import { createCallerFactory } from "@/server/trpc";

const createCaller = createCallerFactory(appRouter);

export async function getServerCaller() {
  const context = await createTRPCContext({ headers: new Headers() });
  return createCaller(context);
}
