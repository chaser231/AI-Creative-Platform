/**
 * Workflow Router
 *
 * CRUD for AI workflows + agent orchestration.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { interpretAndExecute, executeAction } from "../agent";

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
      })
    )
    .mutation(async ({ ctx, input }) => {
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
        }
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await executeAction(
        "apply_and_fill_template",
        {
          templateId: input.templateId,
          topic: input.topic,
          ...(input.selectedImageModel ? { imageModel: input.selectedImageModel } : {}),
        },
        {
          userId: ctx.user.id,
          workspaceId: input.workspaceId,
          prisma: ctx.prisma,
        }
      );

      return {
        plan: {
          reasoning: result.content,
          steps: [{
            actionId: "apply_and_fill_template",
            actionName: "Применение и заполнение шаблона",
            parameters: { templateId: input.templateId, topic: input.topic },
            status: result.success ? "done" as const : "error" as const,
            result,
          }],
        },
        textResponse: result.content,
        provider: "direct" as const,
        canvasActions: result.canvasActions || [],
        metadata: result.metadata || null,
      };
    }),
});
