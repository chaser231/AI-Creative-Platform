/**
 * tRPC Routers — Root App Router
 *
 * Merges all domain routers into a single app router.
 * Export type for client-side type inference.
 */

import { createTRPCRouter } from "../trpc";
import { authRouter } from "./auth";
import { workspaceRouter } from "./workspace";
import { projectRouter } from "./project";
import { templateRouter } from "./template";
import { assetRouter } from "./asset";
import { aiRouter } from "./ai";
import { workflowRouter } from "./workflow";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  workspace: workspaceRouter,
  project: projectRouter,
  template: templateRouter,
  asset: assetRouter,
  ai: aiRouter,
  workflow: workflowRouter,
});

export type AppRouter = typeof appRouter;
