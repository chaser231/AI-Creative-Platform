import { actionsToOpenAITools, ACTIONS } from "../actionRegistry";
import type { ChatMessage } from "./types";

// ─── Network timeouts ────────────────────────────────────

/**
 * Hard timeout for any single LLM HTTP request. Without this, a hung
 * provider can tie up a Vercel function slot indefinitely. Override with
 * `LLM_FETCH_TIMEOUT_MS` if you need longer on slow networks.
 */
const LLM_FETCH_TIMEOUT_MS = Number(process.env.LLM_FETCH_TIMEOUT_MS) || 30_000;

/** Maximum number of 1s polls for Replicate predictions before giving up. */
const REPLICATE_MAX_POLLS = Number(process.env.REPLICATE_MAX_POLLS) || 120;

function llmFetchSignal(): AbortSignal {
  return AbortSignal.timeout(LLM_FETCH_TIMEOUT_MS);
}

// ─── Types ───────────────────────────────────────────────

export interface AgentToolResponse {
  content: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
}

// ─── Provider Detection ──────────────────────────────────

export type AgentProvider = "openai" | "fal" | "replicate";

/**
 * Determines the primary LLM provider for the agent.
 *
 * Explicit override via `AGENT_PROVIDER` env (values: "openai" | "fal" | "replicate" | "auto").
 * In "auto" / unset mode, picks the first available by priority: fal → openai → replicate.
 * fal.ai is preferred over OpenAI by default because OpenAI direct billing is not
 * available in all regions; fal.ai proxies OpenAI models reliably worldwide.
 */
export function getActiveProvider(): AgentProvider {
  const override = (process.env.AGENT_PROVIDER || "").toLowerCase().trim();
  if (override === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (override === "fal" && process.env.FAL_KEY) return "fal";
  if (override === "replicate" && process.env.REPLICATE_API_TOKEN) return "replicate";

  // Auto / unset: prefer fal.ai (works globally) over OpenAI direct
  if (process.env.FAL_KEY) return "fal";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.REPLICATE_API_TOKEN) return "replicate";
  throw new Error("Нужен FAL_KEY, OPENAI_API_KEY или REPLICATE_API_TOKEN в env.");
}

/** Ordered list of providers to try, starting with the active one. Used for runtime fallback. */
export function getProviderChain(): AgentProvider[] {
  const primary = getActiveProvider();
  const all: AgentProvider[] = ["fal", "openai", "replicate"];
  const available = all.filter((p) => {
    if (p === "fal") return !!process.env.FAL_KEY;
    if (p === "openai") return !!process.env.OPENAI_API_KEY;
    return !!process.env.REPLICATE_API_TOKEN;
  });
  return [primary, ...available.filter((p) => p !== primary)];
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
  if (provider === "fal") return callFalText(messages, FAL_DEFAULT_MODEL);
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
    signal: llmFetchSignal(),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || "";
}

export async function callOpenAIWithTools(messages: ChatMessage[]): Promise<AgentToolResponse> {
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
    signal: llmFetchSignal(),
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

// ─── Shared JSON-Tool-Calling Prompt ─────────────────────
// Used by providers that don't support native tool calling (fal.ai, Replicate).

function buildJsonToolPrompt(): string {
  const actionsList = ACTIONS.map((a) => {
    const params = Object.entries(a.parameters)
      .map(([key, p]) => `    "${key}": "${p.description}"${p.enum ? ` (варианты: ${p.enum.join(", ")})` : ""}`)
      .join(",\n");
    return `  - ${a.id}: ${a.description}\n    Параметры: {\n${params}\n    }\n    Обязательные: [${a.required.join(", ")}]`;
  }).join("\n");

  return `\n\nОТВЕЧАЙ СТРОГО в формате JSON — ОДИН объект, без текста до или после, без markdown-кодовых блоков.

ФОРМАТ ОТВЕТА (ровно один объект):
{
  "response": "Краткий текстовый ответ пользователю по-русски",
  "actions": [
    {"action_id": "id_действия", "parameters": {"param": "value"}}
  ]
}

КРИТИЧНО:
- Верни РОВНО ОДИН JSON-объект. Без \`\`\`json блоков, без пояснений, без двух JSON подряд.
- Никакого текста вне JSON. Никаких "(ожидание...)", комментариев, preamble.
- НЕ планируй многошаговые сценарии. Выполни только ОДИН текущий шаг.

ПРИОРИТЕТ МАРШРУТИЗАЦИИ (по убыванию):
- Запрос с "Маркет/Лавка/Еда/Go" ИЛИ со словом "шаблон":
  • Если загружены фото → сначала search_style_presets.
  • Если фото нет → search_templates.
- Запрос "объедини товары / сделай композицию" + фото → search_style_presets (затем generate_image).
- "Баннер" + фото БЕЗ сервиса → задай уточнение формата в response, actions оставь пустым [].
- "Баннер" БЕЗ фото и БЕЗ сервиса → generate_headline, generate_subtitle, generate_image, place_on_canvas.
- Выбран пресет стиля ("Используй стиль: ...") → generate_image.

ПРИМЕРЫ:

Пользователь: "Создай баннеры для Еды с этими товарами" (+ 6 фото)
Ответ:
{"response":"Сейчас подберу стиль под ваши товары.","actions":[{"action_id":"search_style_presets","parameters":{"taskType":"banner"}}]}

Пользователь: "Найди шаблоны для Лавки"
Ответ:
{"response":"Ищу шаблоны Лавки.","actions":[{"action_id":"search_templates","parameters":{"service":"lavka"}}]}

Пользователь: "Используй стиль: Студийная съёмка"
Ответ:
{"response":"Генерирую изображение в студийном стиле.","actions":[{"action_id":"generate_image","parameters":{"subject":"продукты","style":"studio"}}]}

Пользователь: "Напиши заголовок для акции -30% на кофе"
Ответ:
{"response":"Готовлю заголовок.","actions":[{"action_id":"generate_headline","parameters":{"topic":"акция -30% на кофе","tone":"energetic"}}]}

Доступные действия:
${actionsList}

ОТВЕЧАЙ ТОЛЬКО JSON-ОБЪЕКТОМ.`;
}

function parseToolCallsFromJson(rawResponse: string, idPrefix: string): AgentToolResponse {
  let jsonStr = rawResponse.trim();

  // Strip markdown code fences if present
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();

  // Extract the FIRST balanced JSON object (handles multi-block or text+json)
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
      .filter((a: { action_id?: string }) => a.action_id && ACTIONS.some((def) => def.id === a.action_id))
      .map((a: { action_id: string; parameters?: Record<string, unknown> }, i: number) => ({
        id: `${idPrefix}-${i}`,
        name: a.action_id,
        arguments: JSON.stringify(a.parameters || {}),
      })),
  };
}

function augmentSystemWithJsonPrompt(messages: ChatMessage[]): ChatMessage[] {
  const jsonPrompt = buildJsonToolPrompt();
  let injected = false;
  const out = messages.map((m) => {
    if (!injected && m.role === "system") {
      injected = true;
      return { ...m, content: m.content + jsonPrompt };
    }
    return m;
  });
  if (!injected) {
    return [{ role: "system", content: jsonPrompt.trimStart() }, ...out];
  }
  return out;
}

// ─── fal.ai (openrouter/router) ──────────────────────────

const FAL_ENDPOINT = "openrouter/router";
const FAL_DEFAULT_MODEL = "openai/gpt-4o-mini";
const FAL_FALLBACK_MODEL = "anthropic/claude-haiku-4.5";

async function callFalText(messages: ChatMessage[], model: string): Promise<string> {
  const apiKey = process.env.FAL_KEY!;
  const safe = truncateHistory(messages, MAX_PROMPT_CHARS);

  const systemMsg = safe.find((m) => m.role === "system")?.content || "";
  const convMessages = safe.filter((m) => m.role !== "system");
  const prompt = convMessages
    .map((m) => (m.role === "user" ? `User: ${m.content}` : `Assistant: ${m.content}`))
    .join("\n\n") + "\n\nAssistant:";

  const totalLen = systemMsg.length + prompt.length;
  console.log(`[LLM] fal.ai ${FAL_ENDPOINT} (${model}) — system: ${systemMsg.length}, prompt: ${prompt.length}, total: ${totalLen} chars`);

  const input: Record<string, unknown> = {
    prompt,
    system_prompt: systemMsg,
    model,
    temperature: 0.2,
    max_tokens: 2048,
  };

  // Submit to fal.ai queue
  const submitRes = await fetch(`https://queue.fal.run/${FAL_ENDPOINT}`, {
    method: "POST",
    headers: {
      "Authorization": `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal: llmFetchSignal(),
  });

  if (!submitRes.ok) {
    const errBody = await submitRes.text();
    throw new Error(`fal.ai submit failed (${submitRes.status}) for ${model}: ${errBody.slice(0, 300)}`);
  }

  const submitData = await submitRes.json();
  const requestId = submitData.request_id;

  // Synchronous result (no request_id)
  if (!requestId) {
    const output = submitData.output;
    if (typeof output === "string") return output;
    throw new Error(`fal.ai ${FAL_ENDPOINT}: synchronous response had no 'output' string. Got: ${JSON.stringify(submitData).slice(0, 300)}`);
  }

  const statusUrl = submitData.status_url
    || `https://queue.fal.run/${FAL_ENDPOINT}/requests/${requestId}/status`;
  const responseUrl = submitData.response_url
    || `https://queue.fal.run/${FAL_ENDPOINT}/requests/${requestId}`;

  // Poll for completion (up to 120s — LLM text generation should be fast)
  const maxPolls = 60;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const statusRes = await fetch(statusUrl, {
        headers: { "Authorization": `Key ${apiKey}` },
        signal: llmFetchSignal(),
      });
      if (!statusRes.ok) continue;
      const status = await statusRes.json() as { status: string; error?: string };

      if (status.status === "COMPLETED") break;
      if (status.status === "FAILED") {
        throw new Error(`fal.ai ${FAL_ENDPOINT} failed (${model}): ${status.error || "unknown"}`);
      }
      // IN_QUEUE or IN_PROGRESS — keep polling
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("fal.ai")) throw err;
      console.warn(`[LLM] fal.ai poll ${i + 1} error: ${msg}`);
    }
  }

  const resultRes = await fetch(responseUrl, {
    headers: { "Authorization": `Key ${apiKey}` },
    signal: llmFetchSignal(),
  });
  if (!resultRes.ok) {
    const errBody = await resultRes.text();
    throw new Error(`fal.ai result fetch failed (${resultRes.status}): ${errBody.slice(0, 300)}`);
  }
  const result = await resultRes.json();

  const output = result.output;
  if (typeof output !== "string") {
    throw new Error(`fal.ai ${FAL_ENDPOINT}: no 'output' string in response. Got keys: ${Object.keys(result).join(", ")}`);
  }
  return output;
}

export async function callFalWithTools(messages: ChatMessage[]): Promise<AgentToolResponse> {
  const augmented = augmentSystemWithJsonPrompt(messages);

  // Attempt 1: primary model (gpt-4o-mini via fal.ai openrouter)
  let rawResponse = "";
  try {
    rawResponse = await callFalText(augmented, FAL_DEFAULT_MODEL);
    return parseToolCallsFromJson(rawResponse, "fal");
  } catch (firstErr) {
    const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    console.warn(`[Agent] fal.ai primary (${FAL_DEFAULT_MODEL}) failed: ${msg.slice(0, 200)}`);
  }

  // Attempt 2: fallback model (Claude Haiku 4.5 — very strict JSON adherence)
  try {
    console.log(`[Agent] Retrying with fallback model: ${FAL_FALLBACK_MODEL}`);
    const retryMessages: ChatMessage[] = rawResponse
      ? [
          ...augmented,
          { role: "assistant", content: rawResponse },
          {
            role: "user",
            content:
              "Твой предыдущий ответ не был валидным JSON. Перепиши его СТРОГО в формате одного JSON-объекта вида {\"response\":\"...\",\"actions\":[...]}. Никакого текста до или после. Никакого markdown.",
          },
        ]
      : augmented;

    const retryRaw = await callFalText(retryMessages, FAL_FALLBACK_MODEL);
    return parseToolCallsFromJson(retryRaw, "fal-retry");
  } catch (secondErr) {
    const msg = secondErr instanceof Error ? secondErr.message : String(secondErr);
    console.error(`[Agent] fal.ai fallback (${FAL_FALLBACK_MODEL}) also failed: ${msg.slice(0, 200)}`);
    // Last resort: return whatever text we got (if any) without tool calls
    return {
      content: rawResponse || "Агент не смог составить план. Попробуйте переформулировать запрос.",
      toolCalls: [],
    };
  }
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
      signal: llmFetchSignal(),
    }
  );

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Replicate API error (${REPLICATE_TEXT_MODEL}): ${createRes.status} — ${err}`);
  }

  const prediction = await createRes.json();

  let result = prediction;
  let polls = 0;
  while (result.status !== "succeeded" && result.status !== "failed") {
    if (polls >= REPLICATE_MAX_POLLS) {
      throw new Error(
        `Replicate prediction timed out after ${REPLICATE_MAX_POLLS}s (${REPLICATE_TEXT_MODEL}, id=${result.id})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: llmFetchSignal(),
    });
    result = await pollRes.json();
    polls += 1;
  }

  if (result.status === "failed") {
    throw new Error(`Replicate prediction failed (${REPLICATE_TEXT_MODEL}): ${result.error || "unknown"}`);
  }

  const output = Array.isArray(result.output) ? result.output.join("") : String(result.output || "");
  return output;
}

export async function callReplicateWithTools(messages: ChatMessage[]): Promise<AgentToolResponse> {
  const augmented = augmentSystemWithJsonPrompt(messages);
  const rawResponse = await callReplicateText(augmented);

  try {
    return parseToolCallsFromJson(rawResponse, "replicate");
  } catch (e) {
    console.error("[Agent] Replicate JSON parse failed:", e, "Raw:", rawResponse.slice(0, 200));
    return { content: rawResponse, toolCalls: [] };
  }
}
