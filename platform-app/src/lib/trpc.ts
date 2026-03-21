/**
 * tRPC Client Setup
 *
 * Provides the tRPC client hooks for use in React components.
 * Uses @trpc/react-query with @tanstack/react-query.
 */

"use client";

import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@/server/routers/_app";

export const trpc = createTRPCReact<AppRouter>();
