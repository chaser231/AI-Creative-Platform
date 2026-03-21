/**
 * Agent Orchestrator
 *
 * Uses OpenAI function calling to interpret natural language requests
 * from the user and decompose them into Action Registry actions.
 *
 * Flow:
 * 1. User sends a natural language message in the AI chat
 * 2. Orchestrator sends message + Action Registry to OpenAI
 * 3. OpenAI returns a plan (function calls)
 * 4. Orchestrator executes actions sequentially
 * 5. Results are returned as chat messages
 */

import { actionsToOpenAITools, ACTIONS } from "./actionRegistry";
import type { ActionResult, ActionContext } from "./actionRegistry";

// ─── Types ───────────────────────────────────────────────

export interface AgentStep {
  actionId: string;
  actionName: string;
  parameters: Record<string, unknown>;
  status: "pending" | "running" | "done" | "error";
  result?: ActionResult;
}

export interface AgentPlan {
  reasoning: string;
  steps: AgentStep[];
}

export interface AgentResponse {
  plan: AgentPlan;
  textResponse: string;
}

// ─── Action Executors ────────────────────────────────────

/**
 * Execute a single action by its ID.
 * This bridges the Action Registry definitions to actual API calls.
 */
async function executeAction(
  actionId: string,
  params: Record<string, unknown>,
  context: ActionContext
): Promise<ActionResult> {
  switch (actionId) {
    case "generate_text": {
      const prompt = params.prompt as string;
      const style = (params.style as string) || "marketing";
      const systemPrompt = `Ты — креативный копирайтер. Стиль: ${style}. Пиши на русском языке.`;

      const response = await callOpenAI([
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ]);

      return {
        success: true,
        type: "text",
        content: response,
        metadata: { model: "gpt-4o-mini", style },
      };
    }

    case "generate_image": {
      const prompt = params.prompt as string;
      // Call the internal AI generation API
      const res = await fetch(`${getBaseUrl()}/api/ai/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          type: "image",
          model: "flux-schnell",
        }),
      });

      if (!res.ok) {
        return { success: false, type: "error", content: "Ошибка генерации изображения" };
      }

      const data = await res.json();
      return {
        success: true,
        type: "image",
        content: data.result || data.url || "",
        metadata: { model: "flux-schnell" },
      };
    }

    case "create_project": {
      const name = (params.name as string) || "Новый проект";
      const goal = (params.goal as string) || "banner";

      const project = await context.prisma.project.create({
        data: {
          name,
          goal,
          workspaceId: context.workspaceId,
          createdById: context.userId,
        },
      });

      return {
        success: true,
        type: "data",
        content: `Проект «${name}» создан`,
        metadata: { projectId: project.id },
      };
    }

    case "apply_template": {
      const templateName = params.templateName as string;
      // Search for matching template
      const templates = await context.prisma.template.findMany({
        where: {
          workspaceId: context.workspaceId,
          name: { contains: templateName, mode: "insensitive" },
        },
        take: 1,
      });

      if (templates.length === 0) {
        return {
          success: false,
          type: "error",
          content: `Шаблон «${templateName}» не найден`,
        };
      }

      return {
        success: true,
        type: "data",
        content: `Шаблон «${templates[0].name}» найден и готов к применению`,
        metadata: { templateId: templates[0].id, templateName: templates[0].name },
      };
    }

    case "edit_image": {
      const action = params.action as string;
      return {
        success: true,
        type: "data",
        content: `Действие «${action}» запланировано. Выберите изображение в редакторе для применения.`,
        metadata: { editAction: action },
      };
    }

    case "export_project": {
      const format = (params.format as string) || "png";
      return {
        success: true,
        type: "data",
        content: `Экспорт в формате ${format.toUpperCase()} запланирован. Используйте кнопку экспорта в редакторе.`,
        metadata: { format },
      };
    }

    default:
      return { success: false, type: "error", content: `Неизвестное действие: ${actionId}` };
  }
}

// ─── OpenAI Integration ──────────────────────────────────

function getBaseUrl(): string {
  if (typeof window !== "undefined") return "";
  return process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000";
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callOpenAI(messages: ChatMessage[], tools?: any[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY не настроен");
  }

  const body: any = {
    model: "gpt-4o-mini",
    messages,
    temperature: 0.7,
    max_tokens: 2048,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || "";
}

async function callOpenAIWithTools(messages: ChatMessage[]): Promise<{
  content: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY не настроен");
  }

  const tools = actionsToOpenAITools();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.3,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  const message = data.choices[0]?.message;

  return {
    content: message?.content || null,
    toolCalls: (message?.tool_calls || []).map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    })),
  };
}

// ─── Main Orchestrator ───────────────────────────────────

const SYSTEM_PROMPT = `Ты — AI-ассистент платформы AI Creative Platform.
Ты помогаешь пользователям создавать рекламные креативы: баннеры, тексты, фото.

У тебя есть набор инструментов (actions), которые ты можешь вызывать.
Всегда анализируй запрос пользователя и вызывай нужные инструменты.

Правила:
- Если пользователь просит создать баннер — сначала сгенерируй текст, потом изображение
- Если просит написать текст — используй generate_text
- Если просит картинку — используй generate_image
- Можешь вызывать несколько инструментов для сложных запросов
- Отвечай на русском языке
- Будь кратким, но информативным в своих ответах`;

/**
 * Main entry point: interpret a natural language request and execute actions.
 */
export async function interpretAndExecute(
  userMessage: string,
  context: ActionContext,
  workspaceName?: string,
  conversationHistory?: ChatMessage[]
): Promise<AgentResponse> {
  const contextInfo = workspaceName
    ? `\n\nКонтекст: Воркспейс «${workspaceName}»`
    : "";

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT + contextInfo },
    ...(conversationHistory || []),
    { role: "user", content: userMessage },
  ];

  // Step 1: Ask OpenAI to interpret the request
  const aiResponse = await callOpenAIWithTools(messages);

  // Step 2: Build the plan from tool calls
  const steps: AgentStep[] = aiResponse.toolCalls.map((tc) => {
    const action = ACTIONS.find((a) => a.id === tc.name);
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(tc.arguments);
    } catch {
      // ignore parse errors
    }

    return {
      actionId: tc.name,
      actionName: action?.name || tc.name,
      parameters: parsedArgs,
      status: "pending" as const,
    };
  });

  // Step 3: Execute each step sequentially
  for (const step of steps) {
    step.status = "running";
    try {
      step.result = await executeAction(step.actionId, step.parameters, context);
      step.status = "done";
    } catch (e) {
      step.status = "error";
      step.result = {
        success: false,
        type: "error",
        content: e instanceof Error ? e.message : "Ошибка выполнения",
      };
    }
  }

  // Step 4: Build the response
  const textResponse =
    aiResponse.content ||
    (steps.length > 0
      ? `Выполнено ${steps.filter((s) => s.status === "done").length} из ${steps.length} действий`
      : "Я не понял запрос. Попробуйте переформулировать.");

  return {
    plan: {
      reasoning: textResponse,
      steps,
    },
    textResponse,
  };
}

/**
 * Simple text-only response (no tool calls).
 * Used for conversational messages that don't need actions.
 */
export async function chatResponse(
  userMessage: string,
  conversationHistory?: ChatMessage[]
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(conversationHistory || []),
    { role: "user", content: userMessage },
  ];

  return callOpenAI(messages);
}
