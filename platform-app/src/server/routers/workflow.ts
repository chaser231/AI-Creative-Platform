/**
 * Workflow Router
 *
 * CRUD for AI workflows + agent orchestration.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { interpretAndExecute, executeAction } from "../agent";
import { analyzeReferenceImages } from "../agent/visionAnalyzer";
import { getModelById } from "@/lib/ai-models";
import type { PrismaClient } from "@prisma/client";
import type { AgentStep } from "../agent/types";
import { assertProjectAccess, assertTemplateAccess, assertWorkspaceAccess } from "../authz/guards";
import { workflowGraphSchema } from "@/lib/workflow/graphSchema";
import type { WorkflowGraph } from "@/server/workflow/types";

/**
 * Record AI cost entries for completed agent steps.
 * Non-blocking — errors are caught and logged.
 */
async function trackAgentCosts(
  prisma: PrismaClient,
  userId: string,
  projectId: string | undefined,
  steps: AgentStep[]
) {
  if (!projectId || steps.length === 0) return;
  try {
    // Find or create session for this user/project
    let session = await prisma.aISession.findFirst({
      where: { projectId, userId },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (!session) {
      session = await prisma.aISession.create({
        data: { projectId, userId },
      });
    }

    // Record one AIMessage per completed step that used a model
    for (const step of steps) {
      if (step.status !== "done" || !step.result?.success) continue;

      const modelId = step.parameters?.model as string | undefined;
      const modelEntry = modelId ? getModelById(modelId) : undefined;
      const cost = modelEntry?.costPerRun ?? 0;

      // Only track steps that actually cost money (image gen, template fill, etc.)
      if (cost > 0 || step.actionId === "generate_image" || step.actionId === "apply_and_fill_template") {
        await prisma.aIMessage.create({
          data: {
            sessionId: session.id,
            role: "assistant",
            content: step.result.content.slice(0, 200),
            type: step.result.type === "image" ? "image" : "text",
            model: modelId || "unknown",
            costUnits: cost,
          },
        });
      }
    }
  } catch (err) {
    console.error("[trackAgentCosts] Failed:", err);
  }
}

export const workflowRouter = createTRPCRouter({
  /**
   * List workflows for a workspace (user's + templates).
   *
   * Phase 2: default filter `graph IS NOT NULL` hides legacy chat-LLM workflows
   * from the `/workflows` page. Callers that need legacy records (the old
   * AI chat UI that still reads `steps`) must pass `includeLegacy: true`.
   */
  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        includeLegacy: z.boolean().optional().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertWorkspaceAccess(ctx, input.workspaceId);
      const workflows = await ctx.prisma.aIWorkflow.findMany({
        where: {
          workspaceId: input.workspaceId,
          OR: [
            { createdById: ctx.user.id },
            { isTemplate: true },
          ],
          ...(input.includeLegacy
            ? {}
            : // Only graph-mode workflows: `graph` column is non-null JSONB.
              { graph: { not: Prisma.DbNull } }),
        },
        orderBy: [{ isTemplate: "desc" }, { updatedAt: "desc" }],
        select: {
          id: true,
          name: true,
          description: true,
          steps: true,
          graph: true,
          isTemplate: true,
          createdAt: true,
          updatedAt: true,
          createdBy: {
            select: { id: true, name: true },
          },
        },
      });

      return workflows;
    }),

  /** Get single workflow */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const workflow = await ctx.prisma.aIWorkflow.findUnique({
        where: { id: input.id },
        include: {
          createdBy: { select: { id: true, name: true } },
        },
      });

      if (!workflow) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      await assertWorkspaceAccess(ctx, workflow.workspaceId);

      return workflow;
    }),

  /** Create a new workflow */
  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        name: z.string().min(1).max(200),
        description: z.string().optional(),
        steps: z.any(), // AIStep[]
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceAccess(ctx, input.workspaceId, "CREATOR");
      const workflow = await ctx.prisma.aIWorkflow.create({
        data: {
          name: input.name,
          description: input.description || "",
          steps: input.steps,
          workspaceId: input.workspaceId,
          createdById: ctx.user.id,
        },
      });

      return workflow;
    }),

  /** Update workflow */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().optional(),
        steps: z.any().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const existing = await ctx.prisma.aIWorkflow.findUnique({ where: { id } });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await assertWorkspaceAccess(ctx, existing.workspaceId, "CREATOR");
      const workflow = await ctx.prisma.aIWorkflow.update({
        where: { id },
        data,
      });

      return workflow;
    }),

  /** Delete workflow */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.aIWorkflow.findUnique({ where: { id: input.id } });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await assertWorkspaceAccess(ctx, existing.workspaceId, "CREATOR");
      await ctx.prisma.aIWorkflow.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  /**
   * Save (create or update) a graph-mode workflow.
   *
   * Phase 2: primary persistence entry point for the node editor.
   * - Without `workflowId` → creates a new row with `graph` non-null and
   *   legacy `steps: []` (existing column is required by the schema).
   * - With `workflowId` → updates the owning row. 404 if missing.
   * Authz: CREATOR role on the workspace (workflow is a write).
   */
  saveGraph: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string(),
        workflowId: z.string().optional(),
        name: z.string().min(1).max(200),
        description: z.string().optional(),
        graph: workflowGraphSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceAccess(ctx, input.workspaceId, "CREATOR");

      if (input.workflowId) {
        const existing = await ctx.prisma.aIWorkflow.findUnique({
          where: { id: input.workflowId },
          select: { id: true, workspaceId: true },
        });
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Workflow не найден" });
        }
        if (existing.workspaceId !== input.workspaceId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Workflow принадлежит другому workspace" });
        }
        const updated = await ctx.prisma.aIWorkflow.update({
          where: { id: input.workflowId },
          data: {
            name: input.name,
            description: input.description ?? "",
            graph: input.graph as unknown as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        return { id: updated.id };
      }

      const created = await ctx.prisma.aIWorkflow.create({
        data: {
          name: input.name,
          description: input.description ?? "",
          steps: [] as unknown as Prisma.InputJsonValue,
          graph: input.graph as unknown as Prisma.InputJsonValue,
          workspaceId: input.workspaceId,
          createdById: ctx.user.id,
        },
        select: { id: true },
      });
      return { id: created.id };
    }),

  /**
   * Load a workflow by id with its graph field.
   *
   * Phase 2: editor page entrypoint. Returns `graph: null` for legacy chat
   * workflows instead of throwing — the UI can show a dedicated "this is a
   * legacy workflow" state instead of a generic 404.
   */
  loadGraph: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const workflow = await ctx.prisma.aIWorkflow.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          name: true,
          description: true,
          graph: true,
          isTemplate: true,
          updatedAt: true,
          workspaceId: true,
        },
      });
      if (!workflow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workflow не найден" });
      }
      await assertWorkspaceAccess(ctx, workflow.workspaceId, "USER");

      return {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        graph: (workflow.graph as WorkflowGraph | null) ?? null,
        isTemplate: workflow.isTemplate,
        updatedAt: workflow.updatedAt,
        workspaceId: workflow.workspaceId,
      };
    }),

  /**
   * 🧠 AI Agent: Interpret natural language and execute actions
   *
   * This is the main agent endpoint. The user sends a message,
   * the agent interprets it, builds a plan, and executes it.
   */
  interpretAndExecute: protectedProcedure
    .input(
      z.object({
        message: z.string().min(1),
        workspaceId: z.string(),
        projectId: z.string().optional(),
        /** Previous conversation messages for context */
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant", "system"]),
              content: z.string(),
            })
          )
          .optional(),
        selectedTextModel: z.string().optional(),
        selectedImageModel: z.string().optional(),
        /** Reference images to pass to image generation (base64) */
        referenceImages: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceAccess(ctx, input.workspaceId, "USER");
      if (input.projectId) {
        const { project } = await assertProjectAccess(ctx, input.projectId, "USER");
        if (project.workspaceId !== input.workspaceId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Проект не принадлежит этому воркспейсу" });
        }
      }

      // ▶ STAGE 1: tRPC entry point
      if (input.referenceImages && input.referenceImages.length > 0) {
        console.log(`[Pipeline ▶1 tRPC] referenceImages: ${input.referenceImages.length} image(s), first ~60 chars: ${input.referenceImages[0].slice(0, 60)}...`);
      } else {
        console.log(`[Pipeline ▶1 tRPC] No referenceImages attached`);
      }

      // Get workspace name for context
      const workspace = await ctx.prisma.workspace.findUnique({
        where: { id: input.workspaceId },
        select: { name: true },
      });

      const result = await interpretAndExecute(
        input.message,
        {
          userId: ctx.user.id,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          prisma: ctx.prisma,
        },
        workspace?.name,
        input.history as any,
        {
          textModel: input.selectedTextModel,
          imageModel: input.selectedImageModel,
          referenceImages: input.referenceImages,
        }
      );

      // Fire-and-forget: cost tracking must never delay the response path
      // or trigger a gateway timeout. `trackAgentCosts` already has internal
      // try/catch; the outer .catch is a last-resort guard.
      void trackAgentCosts(
        ctx.prisma,
        ctx.user.id,
        input.projectId,
        result.plan.steps
      ).catch((err) => console.error("[trackAgentCosts] async error:", err));

      return result;
    }),

  /**
   * 🎨 Apply template directly (bypasses LLM interpretation)
   *
   * Called when user clicks a template card.
   */
  applyTemplate: protectedProcedure
    .input(
      z.object({
        templateId: z.string(),
        topic: z.string(),
        workspaceId: z.string(),
        selectedImageModel: z.string().optional(),
        referenceImages: z.array(z.string()).optional(),
        // Accept either an absolute URL (e.g. https://s3…/image.jpg) or a
        // data URL (e.g. data:image/jpeg;base64,…). executeAction still
        // runs assertUrlIsSafe() for absolute URLs as a second guard.
        lastGeneratedImageUrl: z
          .string()
          .refine(
            (v) => /^data:image\//i.test(v) || /^https?:\/\//i.test(v),
            { message: "Must be an http(s) URL or data:image/… blob" },
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceAccess(ctx, input.workspaceId, "USER");
      await assertTemplateAccess(ctx, input.templateId, "read");

      // ── VLM Vision Pre-step ───────────────────────────────────────
      // Mirror the behavior that `interpretAndExecute` already has: when
      // the user attached reference images, run a VLM so the copywriter
      // downstream can ground its text in what is actually depicted.
      // Without this, apply_and_fill_template fills slots from the raw
      // user `topic` (a meta-request like "Сгенерируй баннеры для Маркета")
      // and produces text that doesn't match the generated banner at all.
      let visionContext: string | undefined;
      if (input.referenceImages && input.referenceImages.length > 0) {
        try {
          const vision = await analyzeReferenceImages(
            input.referenceImages,
            input.topic,
          );
          if (vision.imageCount > 0 && vision.combinedSummary) {
            visionContext = `\n\n⚠️ ВИЗУАЛЬНЫЙ КОНТЕКСТ (загруженные референсы):\n${vision.combinedSummary}\n\nИнструкция: Используй эти описания при составлении текстов. Описывай товары конкретно.`;
          }
        } catch (err) {
          // Non-blocking: copywriting will fall back to topic-based text.
          console.warn("[applyTemplate] VLM analysis failed:", err);
        }
      }

      const result = await executeAction(
        "apply_and_fill_template",
        {
          templateId: input.templateId,
          topic: input.topic,
          ...(input.selectedImageModel ? { imageModel: input.selectedImageModel } : {}),
          ...(input.referenceImages ? { referenceImages: input.referenceImages } : {}),
          ...(input.lastGeneratedImageUrl ? { lastGeneratedImageUrl: input.lastGeneratedImageUrl } : {}),
          ...(visionContext ? { visionContext } : {}),
        },
        {
          userId: ctx.user.id,
          workspaceId: input.workspaceId,
          prisma: ctx.prisma,
        }
      );
      const templateStep: AgentStep = {
        actionId: "apply_and_fill_template",
        actionName: "Применение и заполнение шаблона",
        parameters: {
          templateId: input.templateId,
          topic: input.topic,
          model: input.selectedImageModel,
        },
        status: result.success ? "done" as const : "error" as const,
        result,
      };

      // Fire-and-forget: do not block the response (applyTemplate is already
      // the slowest procedure in the app; one extra DB round-trip inflates
      // the chance of a gateway 502).
      void trackAgentCosts(
        ctx.prisma,
        ctx.user.id,
        undefined, // applyTemplate doesn't have projectId directly; use workspace-level
        [templateStep]
      ).catch((err) => console.error("[trackAgentCosts] async error:", err));

      return {
        plan: {
          reasoning: result.content,
          steps: [templateStep],
        },
        textResponse: result.content,
        provider: "direct" as const,
        canvasActions: result.canvasActions || [],
        metadata: result.metadata || null,
      };
    }),
});
