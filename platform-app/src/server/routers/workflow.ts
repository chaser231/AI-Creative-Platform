/**
 * Workflow Router
 *
 * CRUD for AI workflows + agent orchestration.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { interpretAndExecute, executeAction } from "../agent";
import { getModelById } from "@/lib/ai-models";
import type { PrismaClient } from "@prisma/client";
import type { AgentStep } from "../agent/types";

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
  /** List workflows for a workspace (user's + templates) */
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(async ({ ctx, input }) => {
      const workflows = await ctx.prisma.aIWorkflow.findMany({
        where: {
          workspaceId: input.workspaceId,
          OR: [
            { createdById: ctx.user.id },
            { isTemplate: true },
          ],
        },
        orderBy: [{ isTemplate: "desc" }, { updatedAt: "desc" }],
        select: {
          id: true,
          name: true,
          description: true,
          steps: true,
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
      await ctx.prisma.aIWorkflow.delete({
        where: { id: input.id },
      });

      return { success: true };
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

      // Track AI costs (non-blocking)
      await trackAgentCosts(
        ctx.prisma,
        ctx.user.id,
        input.projectId,
        result.plan.steps
      );

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
        lastGeneratedImageUrl: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await executeAction(
        "apply_and_fill_template",
        {
          templateId: input.templateId,
          topic: input.topic,
          ...(input.selectedImageModel ? { imageModel: input.selectedImageModel } : {}),
          ...(input.referenceImages ? { referenceImages: input.referenceImages } : {}),
          ...(input.lastGeneratedImageUrl ? { lastGeneratedImageUrl: input.lastGeneratedImageUrl } : {}),
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

      // Track AI costs (non-blocking)
      await trackAgentCosts(
        ctx.prisma,
        ctx.user.id,
        undefined, // applyTemplate doesn't have projectId directly; use workspace-level
        [templateStep]
      );

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
