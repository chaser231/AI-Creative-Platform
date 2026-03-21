/**
 * Agent Orchestrator
 *
 * Interprets natural language requests and decomposes them into
 * Action Registry actions.
 *
 * Provider strategy:
 *   1. OpenAI (gpt-4o-mini) — native function calling, preferred
 *   2. Replicate (Llama 3) — JSON prompting fallback
 *
 * Flow:
 * 1. User sends a natural language message in the AI chat
 * 2. Orchestrator sends message + Action Registry to LLM
 * 3. LLM returns a plan (function calls / JSON actions)
 * 4. Orchestrator executes actions sequentially
 * 5. Results are returned as chat messages
 */

import { actionsToOpenAITools, ACTIONS, actionsDescription } from "./actionRegistry";
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
  provider: "openai" | "replicate";
}

// ─── Provider Detection ──────────────────────────────────

function getProvider(): "openai" | "replicate" {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.REPLICATE_API_TOKEN) return "replicate";
  throw new Error("Ни OPENAI_API_KEY, ни REPLICATE_API_TOKEN не настроены. Добавьте хотя бы один API ключ.");
}

// ─── Action Executors ────────────────────────────────────

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

      // For text generation, use whichever LLM is available
      const response = await callLLM([
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ]);

      return {
        success: true,
        type: "text",
        content: response,
        metadata: { model: getProvider() === "openai" ? "gpt-4o-mini" : "llama-3", style },
      };
    }

    case "generate_image": {
      const prompt = params.prompt as string;
      const res = await fetch(`${getBaseUrl()}/api/ai/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, type: "image", model: "flux-schnell" }),
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
      const templates = await context.prisma.template.findMany({
        where: {
          workspaceId: context.workspaceId,
          name: { contains: templateName, mode: "insensitive" },
        },
        take: 1,
      });

      if (templates.length === 0) {
        return { success: false, type: "error", content: `Шаблон «${templateName}» не найден` };
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

// ─── Shared Utilities ────────────────────────────────────

function getBaseUrl(): string {
  if (typeof window !== "undefined") return "";
  return process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000";
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ─── Unified LLM Call (text-only, no tools) ──────────────

async function callLLM(messages: ChatMessage[]): Promise<string> {
  const provider = getProvider();
  if (provider === "openai") {
    return callOpenAI(messages);
  }
  return callReplicateLlama(messages);
}

// ─── OpenAI Integration ──────────────────────────────────

async function callOpenAI(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY!;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 2048,
    }),
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
  const apiKey = process.env.OPENAI_API_KEY!;
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

// ─── Replicate Llama Integration ─────────────────────────

const REPLICATE_LLAMA_MODEL = "meta/meta-llama-3-70b-instruct";

async function callReplicateLlama(messages: ChatMessage[]): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN!;

  // Format messages into a single prompt for Llama
  const prompt = messages
    .map((m) => {
      if (m.role === "system") return `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${m.content}<|eot_id|>`;
      if (m.role === "user") return `<|start_header_id|>user<|end_header_id|>\n\n${m.content}<|eot_id|>`;
      return `<|start_header_id|>assistant<|end_header_id|>\n\n${m.content}<|eot_id|>`;
    })
    .join("\n") + "\n<|start_header_id|>assistant<|end_header_id|>\n\n";

  // Create prediction
  const createRes = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: REPLICATE_LLAMA_MODEL,
      input: {
        prompt,
        max_tokens: 2048,
        temperature: 0.7,
      },
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Replicate API error: ${createRes.status} — ${err}`);
  }

  const prediction = await createRes.json();

  // Poll for completion
  let result = prediction;
  while (result.status !== "succeeded" && result.status !== "failed") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    result = await pollRes.json();
  }

  if (result.status === "failed") {
    throw new Error(`Replicate prediction failed: ${result.error || "unknown error"}`);
  }

  // Replicate returns output as array of strings
  const output = Array.isArray(result.output) ? result.output.join("") : String(result.output || "");
  return output;
}

/**
 * Replicate Llama fallback for tool calling.
 * Uses structured JSON prompting instead of native function calling.
 */
async function callReplicateWithTools(messages: ChatMessage[]): Promise<{
  content: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
}> {
  const actionsList = ACTIONS.map((a) => {
    const params = Object.entries(a.parameters)
      .map(([key, p]) => `    "${key}": "${p.description}"${p.enum ? ` (варианты: ${p.enum.join(", ")})` : ""}`)
      .join(",\n");
    return `  - ${a.id}: ${a.description}\n    Параметры: {\n${params}\n    }\n    Обязательные: [${a.required.join(", ")}]`;
  }).join("\n");

  const jsonPrompt = `\n\nВАЖНО: Проанализируй запрос пользователя и ответь СТРОГО в формате JSON:
{
  "response": "Твой текстовый ответ пользователю",
  "actions": [
    {"action_id": "id_действия", "parameters": {"param1": "value1"}}
  ]
}

Если действия не нужны — верни пустой массив actions.
Доступные действия (action_id):
${actionsList}

ОТВЕЧАЙ ТОЛЬКО ВАЛИДНЫМ JSON, без markdown-блоков, без пояснений вне JSON.`;

  // Inject JSON instruction into the last system message
  const augmentedMessages = messages.map((m, i) => {
    if (m.role === "system" && i === 0) {
      return { ...m, content: m.content + jsonPrompt };
    }
    return m;
  });

  const rawResponse = await callReplicateLlama(augmentedMessages);

  // Parse JSON from response
  try {
    // Try to extract JSON from the response (model might wrap it in ```json blocks)
    let jsonStr = rawResponse.trim();

    // Remove markdown code blocks if present
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // Try to find JSON object in the response
    const braceStart = jsonStr.indexOf("{");
    const braceEnd = jsonStr.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd !== -1) {
      jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
    }

    const parsed = JSON.parse(jsonStr);
    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];

    return {
      content: parsed.response || null,
      toolCalls: actions
        .filter((a: any) => a.action_id && ACTIONS.some((def) => def.id === a.action_id))
        .map((a: any, i: number) => ({
          id: `replicate-${i}`,
          name: a.action_id,
          arguments: JSON.stringify(a.parameters || {}),
        })),
    };
  } catch {
    // If JSON parsing fails, treat entire response as text
    return {
      content: rawResponse,
      toolCalls: [],
    };
  }
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
 * Automatically selects OpenAI (preferred) or Replicate Llama (fallback).
 */
export async function interpretAndExecute(
  userMessage: string,
  context: ActionContext,
  workspaceName?: string,
  conversationHistory?: ChatMessage[]
): Promise<AgentResponse> {
  const provider = getProvider();
  const contextInfo = workspaceName
    ? `\n\nКонтекст: Воркспейс «${workspaceName}»`
    : "";

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT + contextInfo },
    ...(conversationHistory || []),
    { role: "user", content: userMessage },
  ];

  // Step 1: Ask LLM to interpret the request
  const aiResponse = provider === "openai"
    ? await callOpenAIWithTools(messages)
    : await callReplicateWithTools(messages);

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
    provider,
  };
}

/**
 * Simple text-only response (no tool calls).
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

  return callLLM(messages);
}
