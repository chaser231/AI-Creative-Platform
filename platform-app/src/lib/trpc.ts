/**
 * tRPC Client Setup
 *
 * Provides the tRPC client hooks for use in React components.
 * Uses @trpc/react-query with @tanstack/react-query.
 */

"use client";

import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

export const trpc = createTRPCReact<AppRouter>();

/** Inferred output types for every router procedure (client-side typing). */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
