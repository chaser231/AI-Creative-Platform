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
import { loraPresetRouter } from "./loraPreset";
import { workflowRouter } from "./workflow";
import { adminRouter } from "./admin";
import { adminTemplateRouter } from "./adminTemplate";
import { figmaRouter } from "./figma";
import { videoRouter } from "./video";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  workspace: workspaceRouter,
  project: projectRouter,
  template: templateRouter,
  asset: assetRouter,
  ai: aiRouter,
  loraPreset: loraPresetRouter,
  workflow: workflowRouter,
  admin: adminRouter,
  adminTemplate: adminTemplateRouter,
  figma: figmaRouter,
  video: videoRouter,
});

export type AppRouter = typeof appRouter;
