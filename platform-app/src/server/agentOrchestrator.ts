/**
 * Agent Orchestrator V2
 *
 * Smart creative agent that:
 * 1. Interprets natural language requests
 * 2. Generates appropriate content (short headlines, subtitles, images)
 * 3. Returns canvas instructions for client-side placement
 *
 * Provider: OpenAI (primary) → Replicate Llama (fallback)
 */

import { actionsToOpenAITools, ACTIONS } from "./actionRegistry";
import type { ActionResult, ActionContext, CanvasInstruction, FallbackAction } from "./actionRegistry";

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
  /** All canvas instructions from all steps, aggregated for client execution */
  canvasActions: CanvasInstruction[];
}

// ─── Provider Detection ──────────────────────────────────

function getActiveProvider(): "openai" | "replicate" {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.REPLICATE_API_TOKEN) return "replicate";
  throw new Error("Ни OPENAI_API_KEY, ни REPLICATE_API_TOKEN не настроены.");
}

// ─── Action Executors ────────────────────────────────────

export async function executeAction(
  actionId: string,
  params: Record<string, unknown>,
  context: ActionContext
): Promise<ActionResult> {
  switch (actionId) {
    case "generate_headline": {
      const topic = params.topic as string;
      const tone = (params.tone as string) || "bold";

      const toneMap: Record<string, string> = {
        bold: "Коротко и мощно. Энергичный, призывный стиль.",
        playful: "Игривый, лёгкий тон. С юмором или каламбуром.",
        formal: "Деловой, солидный стиль.",
        urgent: "Срочность и дефицит. FOMO.",
      };

      const response = await callLLM([
        {
          role: "system",
          content: `Ты — копирайтер для рекламных баннеров. ${toneMap[tone] || toneMap.bold}

ПРАВИЛА:
- Придумай ОДИН заголовок
- Максимум 3-7 слов
- Без кавычек, без точки
- Только текст заголовка, ничего больше
- Пиши на русском`,
        },
        { role: "user", content: `Заголовок для: ${topic}` },
      ]);

      const headline = response.trim().replace(/^["«]|["»]$/g, "").replace(/\.$/, "");

      return {
        success: true,
        type: "text",
        content: headline,
        metadata: { role: "headline", tone },
      };
    }

    case "generate_subtitle": {
      const topic = params.topic as string;
      const headline = (params.headline as string) || "";

      const response = await callLLM([
        {
          role: "system",
          content: `Ты — копирайтер. Напиши подзаголовок для баннера.

ПРАВИЛА:
- Одно предложение, 10-20 слов
- Дополняет заголовок деталями или призывом к действию
- Без кавычек
- Только текст подзаголовка, ничего больше
- Пиши на русском`,
        },
        {
          role: "user",
          content: headline
            ? `Заголовок: "${headline}". Тема: ${topic}. Напиши подзаголовок.`
            : `Подзаголовок для: ${topic}`,
        },
      ]);

      const subtitle = response.trim().replace(/^["«]|["»]$/g, "");

      return {
        success: true,
        type: "text",
        content: subtitle,
        metadata: { role: "subtitle" },
      };
    }

    case "generate_image": {
      const subject = params.subject as string;
      const style = (params.style as string) || "photo";

      // Build an English prompt for the image model
      const imagePrompt = await callLLM([
        {
          role: "system",
          content: `You are an expert prompt engineer for AI image generation (Flux model).
Convert the user's request into a detailed English prompt for image generation.

RULES:
- Write in ENGLISH only
- Include style keywords: ${style}, high quality, commercial
- For photo style: "professional product photography, studio lighting"
- For illustration: "modern digital illustration, flat design"
- For 3d: "3D render, isometric, soft shadows"
- For gradient: "abstract gradient background, vibrant colors"
- Keep it under 50 words
- Return ONLY the prompt text`,
        },
        { role: "user", content: `Generate prompt for: ${subject}, style: ${style}` },
      ]);

      // Call AI provider (use specified model or default to flux-schnell)
      const selectedModel = (params.model as string) || "flux-schnell";
      const { getProvider: getAIProvider } = await import("@/lib/ai-providers");
      const imageProvider = getAIProvider(selectedModel);

      try {
        const aiResult = await imageProvider.generate({
          prompt: imagePrompt.trim(),
          type: "image",
          model: selectedModel,
        });

        return {
          success: true,
          type: "image",
          content: aiResult.content,
          metadata: { model: "flux-schnell", style, prompt: imagePrompt.trim() },
        };
      } catch (e) {
        return {
          success: false,
          type: "error",
          content: `Ошибка генерации: ${e instanceof Error ? e.message : "unknown"}`,
        };
      }
    }

    case "place_on_canvas": {
      const elementsStr = params.elements as string;
      let elements: Array<{ type: string; content: string; role: string }> = [];

      try {
        elements = JSON.parse(elementsStr);
      } catch {
        return { success: false, type: "error", content: "Невалидный JSON в параметре elements" };
      }

      const canvasActions: CanvasInstruction[] = [];
      for (const el of elements) {
        if (el.type === "text" && el.role === "headline") {
          canvasActions.push({
            action: "add_text",
            params: {
              text: el.content,
              fontSize: 64,
              fontWeight: "700",
              fill: "#FFFFFF",
              align: "center",
              x: 100,
              y: 200,
              width: 800,
              textTransform: "uppercase",
            },
          });
        } else if (el.type === "text" && el.role === "subtitle") {
          canvasActions.push({
            action: "add_text",
            params: {
              text: el.content,
              fontSize: 28,
              fontWeight: "400",
              fill: "#FFFFFF",
              align: "center",
              x: 150,
              y: 300,
              width: 700,
            },
          });
        } else if (el.type === "image") {
          canvasActions.push({
            action: "add_image",
            params: {
              src: el.content,
              width: 1024,
              height: 1024,
            },
          });
        }
      }

      return {
        success: true,
        type: "canvas_action",
        content: `Размещено ${canvasActions.length} элементов на холсте`,
        canvasActions,
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

    case "search_templates": {
      const service = (params.service as string).toLowerCase();

      // Map user-friendly names to DB search terms
      const serviceMap: Record<string, string[]> = {
        "market": ["yandex-market", "маркет", "market"],
        "маркет": ["yandex-market", "маркет", "market"],
        "food": ["yandex-food", "еда", "food"],
        "еда": ["yandex-food", "еда", "food"],
        "go": ["yandex-go", "go", "такси"],
        "lavka": ["yandex-lavka", "лавка", "lavka"],
        "лавка": ["yandex-lavka", "лавка", "lavka"],
      };

      const searchTerms = serviceMap[service] || [service];

      // Search by name, categories, or tags (deduplicated by name)
      const templates = await context.prisma.template.findMany({
        where: {
          workspaceId: context.workspaceId,
          OR: [
            { name: { contains: service, mode: "insensitive" } },
            { categories: { hasSome: searchTerms } },
          ],
        },
        select: {
          id: true,
          name: true,
          description: true,
          thumbnailUrl: true,
        },
        distinct: ["name"],
        orderBy: { popularity: "desc" },
        take: 5,
      });

      if (templates.length === 0) {
        return {
          success: true,
          type: "fallback_actions",
          content: `Шаблоны для «${service}» не найдены в библиотеке. Что хотите сделать?`,
          fallbackActions: [
            { id: "create_from_scratch", label: "Создать баннер с нуля", icon: "plus" },
            { id: "refine_query", label: "Уточнить запрос", icon: "search" },
          ],
        };
      }

      return {
        success: true,
        type: "template_choices",
        content: `Найдено ${templates.length} шаблонов. Выберите один:`,
        templateChoices: templates.map((t: any) => ({
          id: t.id,
          name: t.name,
          description: t.description || "",
          thumbnailUrl: t.thumbnailUrl,
        })),
      };
    }

    case "apply_and_fill_template": {
      const templateId = params.templateId as string;
      const topic = params.topic as string;

      // Fetch the full template
      const template = await context.prisma.template.findUnique({
        where: { id: templateId },
      });

      if (!template) {
        return { success: false, type: "error", content: "Шаблон не найден" };
      }

      const templateData = (template.data as any)?.data || template.data;

      // Scan template layers to find slots
      const slots: Array<{ id: string; type: string; slotId: string }> = [];

      function scanLayers(layers: any[]) {
        for (const node of layers) {
          const layer = node.layer || node;
          if (layer.slotId && layer.slotId !== "none") {
            slots.push({
              id: layer.id,
              type: layer.type,
              slotId: layer.slotId,
            });
          }
          if (node.children) scanLayers(node.children);
        }
      }

      // Scan both layerTree and masterComponents
      if (templateData.layerTree) scanLayers(templateData.layerTree);
      if (templateData.masterComponents) {
        for (const mc of templateData.masterComponents) {
          if (mc.slotId && mc.slotId !== "none") {
            slots.push({ id: mc.id, type: mc.type, slotId: mc.slotId });
          }
        }
      }

      const canvasActions: CanvasInstruction[] = [];

      // First: load the template
      canvasActions.push({
        action: "load_template",
        params: { templateData: template.data },
      });

      // Generate content for each slot
      for (const slot of slots) {
        if (slot.slotId === "headline" && slot.type === "text") {
          const headline = await callLLM([
            { role: "system", content: "Ты — копирайтер. Напиши ОДИН заголовок для баннера. Максимум 5 слов. Без кавычек, без точки. Только текст." },
            { role: "user", content: `Заголовок для: ${topic}` },
          ]);
          canvasActions.push({
            action: "update_layer",
            params: { slotId: "headline", updates: { text: headline.trim().replace(/^["«]|["»]$/g, "").replace(/\.$/, "") } },
          });
        } else if (slot.slotId === "subhead" && slot.type === "text") {
          const subtitle = await callLLM([
            { role: "system", content: "Ты — копирайтер. Напиши подзаголовок для баннера. 8-15 слов. Без кавычек. Только текст." },
            { role: "user", content: `Подзаголовок для: ${topic}` },
          ]);
          canvasActions.push({
            action: "update_layer",
            params: { slotId: "subhead", updates: { text: subtitle.trim().replace(/^["«]|["»]$/g, "") } },
          });
        } else if (slot.slotId === "cta" && slot.type === "text") {
          const cta = await callLLM([
            { role: "system", content: "Ты — копирайтер. Напиши текст для кнопки призыва к действию (CTA). 1-3 слова. Без кавычек. Только текст." },
            { role: "user", content: `CTA для: ${topic}` },
          ]);
          canvasActions.push({
            action: "update_layer",
            params: { slotId: "cta", updates: { text: cta.trim().replace(/^["«]|["»]$/g, "") } },
          });
        } else if ((slot.slotId === "background" || slot.slotId === "image-primary") && (slot.type === "image")) {
          // Generate image for image slots
          const imagePrompt = await callLLM([
            { role: "system", content: "You are an expert prompt engineer. Convert the request into a detailed English prompt for AI image generation. Include: high quality, commercial, professional. Max 40 words. Return ONLY the prompt." },
            { role: "user", content: `Image for banner about: ${topic}` },
          ]);

          try {
            const { getProvider: getAIProvider } = await import("@/lib/ai-providers");
            const imgProvider = getAIProvider("flux-schnell");
            const imgResult = await imgProvider.generate({
              prompt: imagePrompt.trim(),
              type: "image",
              model: "flux-schnell",
            });
            canvasActions.push({
              action: "update_layer",
              params: { slotId: slot.slotId, updates: { src: imgResult.content } },
            });
          } catch {
            // Image generation failed, skip this slot
          }
        }
      }

      const filledSlots = canvasActions.length - 1; // minus load_template
      return {
        success: true,
        type: "canvas_action",
        content: slots.length > 0
          ? `Шаблон «${template.name}» применён. Заполнено ${filledSlots} элементов.`
          : `Шаблон «${template.name}» применён. Слоты не найдены — добавляю новые элементы.`,
        canvasActions,
        metadata: { templateId, templateName: template.name, slotsFound: slots.length },
      };
    }

    default:
      return { success: false, type: "error", content: `Неизвестное действие: ${actionId}` };
  }
}

// ─── LLM Utilities ───────────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callLLM(messages: ChatMessage[]): Promise<string> {
  const provider = getActiveProvider();
  if (provider === "openai") return callOpenAI(messages);
  return callReplicateLlama(messages);
}

// ─── OpenAI ──────────────────────────────────────────────

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
      max_tokens: 1024,
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

// ─── Replicate Llama ─────────────────────────────────────

const REPLICATE_LLAMA_MODEL = "meta/meta-llama-3-70b-instruct";

async function callReplicateLlama(messages: ChatMessage[]): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN!;

  const systemMsg = messages.find((m) => m.role === "system")?.content || "";
  const convMessages = messages.filter((m) => m.role !== "system");
  const prompt = convMessages
    .map((m) => (m.role === "user" ? `User: ${m.content}` : `Assistant: ${m.content}`))
    .join("\n\n") + "\n\nAssistant:";

  const createRes = await fetch(
    `https://api.replicate.com/v1/models/${REPLICATE_LLAMA_MODEL}/predictions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: {
          prompt,
          system_prompt: systemMsg,
          max_tokens: 2048,
          temperature: 0.7,
        },
      }),
    }
  );

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Replicate API error: ${createRes.status} — ${err}`);
  }

  const prediction = await createRes.json();

  let result = prediction;
  while (result.status !== "succeeded" && result.status !== "failed") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    result = await pollRes.json();
  }

  if (result.status === "failed") {
    throw new Error(`Replicate prediction failed: ${result.error || "unknown"}`);
  }

  const output = Array.isArray(result.output) ? result.output.join("") : String(result.output || "");
  return output;
}

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

  const jsonPrompt = `\n\nОТВЕЧАЙ СТРОГО в формате JSON:
{
  "response": "Текстовый ответ пользователю",
  "actions": [
    {"action_id": "id_действия", "parameters": {"param": "value"}}
  ]
}

Доступные действия:
${actionsList}

ВАЖНО: для баннера используй generate_headline, generate_subtitle, generate_image, place_on_canvas
ОТВЕЧАЙ ТОЛЬКО JSON.`;

  const augmentedMessages = messages.map((m, i) => {
    if (m.role === "system" && i === 0) {
      return { ...m, content: m.content + jsonPrompt };
    }
    return m;
  });

  const rawResponse = await callReplicateLlama(augmentedMessages);

  try {
    let jsonStr = rawResponse.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    const braceStart = jsonStr.indexOf("{");
    const braceEnd = jsonStr.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd !== -1) jsonStr = jsonStr.slice(braceStart, braceEnd + 1);

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
    return { content: rawResponse, toolCalls: [] };
  }
}

// ─── System Prompt ───────────────────────────────────────

const SYSTEM_PROMPT = `Ты — AI-ассистент платформы для создания рекламных креативов.
Ты помогаешь пользователям создавать баннеры, генерировать тексты и изображения.

КЛЮЧЕВЫЕ ПРАВИЛА:

1. БАННЕРЫ С ШАБЛОНОМ: Когда пользователь просит баннер для конкретного сервиса (Маркет, Лавка, Еда, Go):
   a) СНАЧАЛА вызови search_templates с названием сервиса
   b) Покажи найденные шаблоны пользователю для выбора
   c) КОГДА пользователь выберет шаблон — вызови apply_and_fill_template

2. БАННЕРЫ БЕЗ ШАБЛОНА: Если нет шаблонов или пользователь не уточняет сервис:
   a) generate_headline — короткий заголовок (3-7 слов)
   b) generate_subtitle — подзаголовок с деталями (10-20 слов)
   c) generate_image — фоновое изображение
   d) place_on_canvas — размести всё на холсте

   Для place_on_canvas передай elements как JSON-строку:
   [{"type":"text","content":"ЗАГОЛОВОК","role":"headline"},
    {"type":"text","content":"Подзаголовок","role":"subtitle"},
    {"type":"image","content":"URL","role":"background"}]

3. ВЫБОР ШАБЛОНА: Когда пользователь пишет "Шаблон 1", "Второй" или название шаблона — вызови apply_and_fill_template с ID шаблона из предыдущего ответа.

4. ТЕКСТЫ: Для текста вызывай generate_headline и/или generate_subtitle

5. КОНТЕКСТ СЕРВИСОВ:
   - "Лавка" / "lavka" = доставка продуктов
   - "Маркет" / "market" = маркетплейс
   - "Еда" / "food" = доставка еды
   - "Go" = такси

6. СТИЛЬ ИЗОБРАЖЕНИЙ: photo (еда, продукты), 3d/illustration (скидки), gradient (фон)

ОТВЕЧАЙ КРАТКО на русском.`;

// ─── Main Orchestrator ───────────────────────────────────

export async function interpretAndExecute(
  userMessage: string,
  context: ActionContext,
  workspaceName?: string,
  conversationHistory?: ChatMessage[]
): Promise<AgentResponse> {
  const provider = getActiveProvider();
  const contextInfo = workspaceName
    ? `\n\nВоркспейс: «${workspaceName}»`
    : "";

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT + contextInfo },
    ...(conversationHistory || []),
    { role: "user", content: userMessage },
  ];

  // Step 1: Interpret via LLM
  const aiResponse = provider === "openai"
    ? await callOpenAIWithTools(messages)
    : await callReplicateWithTools(messages);

  // Step 2: Build plan
  const steps: AgentStep[] = aiResponse.toolCalls.map((tc) => {
    const action = ACTIONS.find((a) => a.id === tc.name);
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(tc.arguments);
    } catch {
      // ignore
    }

    return {
      actionId: tc.name,
      actionName: action?.name || tc.name,
      parameters: parsedArgs,
      status: "pending" as const,
    };
  });

  // Step 3: Execute sequentially, passing results between steps
  const allCanvasActions: CanvasInstruction[] = [];
  const generatedContent: Record<string, string> = {};

  for (const step of steps) {
    step.status = "running";

    try {
      // Inject content from previous steps into place_on_canvas
      if (step.actionId === "place_on_canvas") {
        const elements: Array<{ type: string; content: string; role: string }> = [];

        if (generatedContent.headline) {
          elements.push({ type: "text", content: generatedContent.headline, role: "headline" });
        }
        if (generatedContent.subtitle) {
          elements.push({ type: "text", content: generatedContent.subtitle, role: "subtitle" });
        }
        if (generatedContent.image) {
          elements.push({ type: "image", content: generatedContent.image, role: "background" });
        }

        step.parameters = { elements: JSON.stringify(elements) };
      }

      step.result = await executeAction(step.actionId, step.parameters, context);
      step.status = "done";

      // Track generated content for later steps
      if (step.result.success) {
        if (step.result.metadata?.role === "headline") {
          generatedContent.headline = step.result.content;
        } else if (step.result.metadata?.role === "subtitle") {
          generatedContent.subtitle = step.result.content;
        } else if (step.result.type === "image") {
          generatedContent.image = step.result.content;
        }

        // Collect canvas actions
        if (step.result.canvasActions) {
          allCanvasActions.push(...step.result.canvasActions);
        }
      }
    } catch (e) {
      step.status = "error";
      step.result = {
        success: false,
        type: "error",
        content: e instanceof Error ? e.message : "Ошибка выполнения",
      };
    }
  }

  // Step 4: Response
  const textResponse =
    aiResponse.content ||
    (steps.length > 0
      ? `Выполнено ${steps.filter((s) => s.status === "done").length} из ${steps.length} действий`
      : "Я не понял запрос. Попробуйте переформулировать.");

  return {
    plan: { reasoning: textResponse, steps },
    textResponse,
    provider,
    canvasActions: allCanvasActions,
  };
}

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
