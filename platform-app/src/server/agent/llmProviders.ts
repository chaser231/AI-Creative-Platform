import { actionsToOpenAITools, ACTIONS } from "../actionRegistry";
import type { ChatMessage } from "./types";

// ─── Provider Detection ──────────────────────────────────

export function getActiveProvider(): "openai" | "replicate" {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.REPLICATE_API_TOKEN) return "replicate";
  throw new Error("Ни OPENAI_API_KEY, ни REPLICATE_API_TOKEN не настроены.");
}

// ─── Prompt Size Safety ──────────────────────────────────

const MAX_PROMPT_CHARS = 60_000;

function truncateHistory(messages: ChatMessage[], maxChars: number): ChatMessage[] {
  const system = messages.filter(m => m.role === "system");
  const rest = messages.filter(m => m.role !== "system");

  let budget = maxChars;
  for (const s of system) budget -= s.content.length;

  const kept: ChatMessage[] = [];
  for (let i = rest.length - 1; i >= 0 && budget > 0; i--) {
    if (rest[i].content.length <= budget) {
      kept.unshift(rest[i]);
      budget -= rest[i].content.length;
    } else {
      kept.unshift({ ...rest[i], content: rest[i].content.slice(0, budget) });
      budget = 0;
    }
  }
  return [...system, ...kept];
}

// ─── Unified LLM call ────────────────────────────────────

export async function callLLM(messages: ChatMessage[]): Promise<string> {
  const provider = getActiveProvider();
  if (provider === "openai") return callOpenAI(messages);
  return callReplicateText(messages);
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

export async function callOpenAIWithTools(messages: ChatMessage[]): Promise<{
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
    toolCalls: (message?.tool_calls || []).map((tc: { id: string; function: { name: string; arguments: string } }) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    })),
  };
}

// ─── Replicate Text LLM ──────────────────────────────────

const REPLICATE_TEXT_MODEL = "deepseek-ai/deepseek-v3";

async function callReplicateText(messages: ChatMessage[]): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN!;
  const safe = truncateHistory(messages, MAX_PROMPT_CHARS);

  const systemMsg = safe.find((m) => m.role === "system")?.content || "";
  const convMessages = safe.filter((m) => m.role !== "system");
  const prompt = convMessages
    .map((m) => (m.role === "user" ? `User: ${m.content}` : `Assistant: ${m.content}`))
    .join("\n\n") + "\n\nAssistant:";

  const totalLen = systemMsg.length + prompt.length;
  console.log(`[LLM] Calling ${REPLICATE_TEXT_MODEL} — system: ${systemMsg.length}, prompt: ${prompt.length}, total: ${totalLen} chars`);

  const createRes = await fetch(
    `https://api.replicate.com/v1/models/${REPLICATE_TEXT_MODEL}/predictions`,
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
    throw new Error(`Replicate API error (${REPLICATE_TEXT_MODEL}): ${createRes.status} — ${err}`);
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
    throw new Error(`Replicate prediction failed (${REPLICATE_TEXT_MODEL}): ${result.error || "unknown"}`);
  }

  const output = Array.isArray(result.output) ? result.output.join("") : String(result.output || "");
  return output;
}

export async function callReplicateWithTools(messages: ChatMessage[]): Promise<{
  content: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
}> {
  const actionsList = ACTIONS.map((a) => {
    const params = Object.entries(a.parameters)
      .map(([key, p]) => `    "${key}": "${p.description}"${p.enum ? ` (варианты: ${p.enum.join(", ")})` : ""}`)
      .join(",\n");
    return `  - ${a.id}: ${a.description}\n    Параметры: {\n${params}\n    }\n    Обязательные: [${a.required.join(", ")}]`;
  }).join("\n");

  const jsonPrompt = `\n\nОТВЕЧАЙ СТРОГО в формате JSON — ОДИН объект, без комментариев до или после:
{
  "response": "Текстовый ответ пользователю",
  "actions": [
    {"action_id": "id_действия", "parameters": {"param": "value"}}
  ]
}

КРИТИЧНО:
- Верни РОВНО ОДИН JSON-объект. НЕ пиши несколько JSON-блоков.
- НЕ планируй многошаговые сценарии. Выполни только ТЕКУЩИЙ шаг.
- НЕ пиши текст вне JSON (никаких "(ожидание...)", пояснений и т.д.)

ПРИОРИТЕТ МАРШРУТИЗАЦИИ:
- Если в запросе есть Маркет/Лавка/Еда/Go или слово «шаблон» → верни ТОЛЬКО search_templates.
- Если пользователь просит «баннер» + загрузил фото, но НЕ упоминает сервис → спроси формат (в response), НЕ вызывай actions.
- Если пользователь просит «объедини товары» → верни generate_image + place_on_canvas.
- Перед generate_image можно вызвать search_style_presets, чтобы предложить стили.

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

  const rawResponse = await callReplicateText(augmentedMessages);

  try {
    let jsonStr = rawResponse.trim();

    // Strip markdown code fences
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    // Extract the FIRST balanced JSON object (handles multi-block responses)
    const firstBrace = jsonStr.indexOf("{");
    if (firstBrace !== -1) {
      let depth = 0;
      let end = -1;
      for (let i = firstBrace; i < jsonStr.length; i++) {
        if (jsonStr[i] === "{") depth++;
        else if (jsonStr[i] === "}") {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
      if (end !== -1) jsonStr = jsonStr.slice(firstBrace, end + 1);
    }

    const parsed = JSON.parse(jsonStr);
    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];

    return {
      content: parsed.response || null,
      toolCalls: actions
        .filter((a: { action_id?: string; parameters?: Record<string, unknown> }) => a.action_id && ACTIONS.some((def) => def.id === a.action_id))
        .map((a: { action_id: string; parameters?: Record<string, unknown> }, i: number) => ({
          id: `replicate-${i}`,
          name: a.action_id,
          arguments: JSON.stringify(a.parameters || {}),
        })),
    };
  } catch (e) {
    console.error("[Agent] JSON parse failed:", e, "Raw:", rawResponse.slice(0, 200));
    return { content: rawResponse, toolCalls: [] };
  }
}
