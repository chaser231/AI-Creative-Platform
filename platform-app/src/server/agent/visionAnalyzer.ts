// ─── Vision Analyzer ─────────────────────────────────────
// Calls a VLM to describe reference images before agent planning.
// Uses GPT-4o Vision (preferred) or Gemini Flash via Replicate (fallback).

export interface VisionAnalysisResult {
  /** Per-image textual description */
  descriptions: string[];
  /** Combined summary injected into agent system context */
  combinedSummary: string;
  imageCount: number;
}

/**
 * Analyzes an array of reference images (base64 data URLs) and returns
 * structured textual descriptions that can be injected into the agent's
 * planning context so it can reason about visual content.
 *
 * @param images  - Array of base64 data URLs (e.g. "data:image/jpeg;base64,...")
 * @param userIntent - The original user message, used to focus descriptions
 */
export async function analyzeReferenceImages(
  images: string[],
  userIntent: string
): Promise<VisionAnalysisResult> {
  if (!images || images.length === 0) {
    return { descriptions: [], combinedSummary: "", imageCount: 0 };
  }

  console.log(`[VisionAnalyzer] Analyzing ${images.length} image(s) for: "${userIntent.slice(0, 80)}"`);

  try {
    // Prefer GPT-4o Vision (it handles images natively in the messages array)
    if (process.env.OPENAI_API_KEY) {
      return await analyzeWithGPT4oVision(images, userIntent);
    }
    // Fallback: Llama 3.2 90B Vision via Replicate (proven image support)
    if (process.env.REPLICATE_API_TOKEN) {
      return await analyzeWithLlamaVision(images, userIntent);
    }
    throw new Error("No VLM API key available (OPENAI_API_KEY or REPLICATE_API_TOKEN required)");
  } catch (e) {
    console.error("[VisionAnalyzer] Analysis failed:", e instanceof Error ? e.message : e);
    // Non-blocking: return a graceful empty result so agent can still try
    return {
      descriptions: images.map((_, i) => `Изображение ${i + 1} (описание недоступно)`),
      combinedSummary: `Пользователь загрузил ${images.length} референсных изображений. Используй их при генерации.`,
      imageCount: images.length,
    };
  }
}

// ─── GPT-4o Vision ───────────────────────────────────────

async function analyzeWithGPT4oVision(
  images: string[],
  userIntent: string
): Promise<VisionAnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY!;

  // Build content array: text question + all images
  const imageContent = images.map((imgB64) => ({
    type: "image_url" as const,
    image_url: {
      // GPT-4o accepts data URLs directly
      url: imgB64.startsWith("data:") ? imgB64 : `data:image/jpeg;base64,${imgB64}`,
      detail: "high" as const,
    },
  }));

  const textContent = {
    type: "text" as const,
    text: `Пользователь загрузил ${images.length} изображений для использования как референсы при генерации контента.
Намерение пользователя: "${userIntent}"

Для каждого изображения опиши:
1. Что за объект/товар изображён
2. Его ключевые визуальные характеристики (цвет, материал, форма, бренд если виден)
3. Стиль съёмки/фон

Ответь СТРОГО в формате JSON:
{
  "descriptions": [
    "Описание изображения 1...",
    "Описание изображения 2..."
  ],
  "summary": "Краткое объединённое описание: какие объекты и как их нужно использовать."
}`,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [textContent, ...imageContent],
        },
      ],
      max_tokens: 1024,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GPT-4o Vision error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  const raw = data.choices[0]?.message?.content || "{}";

  return parseVisionResponse(raw, images.length, userIntent);
}

// ─── Llama 3.2 90B Vision via Replicate ──────────────────

async function analyzeWithLlamaVision(
  images: string[],
  userIntent: string
): Promise<VisionAnalysisResult> {
  const token = process.env.REPLICATE_API_TOKEN!;
  const imageDescriptions: string[] = [];

  for (let i = 0; i < images.length; i++) {
    const imgUrl = images[i].startsWith("data:") ? images[i] : `data:image/jpeg;base64,${images[i]}`;

    console.log(`[VisionAnalyzer] Sending image ${i + 1}/${images.length} to Llama 3.2 Vision (${imgUrl.slice(0, 30)}...)`);

    const createRes = await fetch(
      "https://api.replicate.com/v1/models/meta/meta-llama-3.2-90b-vision-instruct/predictions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Prefer: "wait",
        },
        body: JSON.stringify({
          input: {
            prompt: `You are a product identification expert. Look at this image carefully.

Describe the EXACT product/object shown:
1. What is the specific product? (e.g. sneakers, kettle, speaker, phone)
2. Brand name if visible
3. Color, material, shape
4. Photography style and background

User's intent: "${userIntent}"

Respond in Russian, one concise paragraph. Be PRECISE about the product type.`,
            image: imgUrl,
            max_tokens: 300,
            temperature: 0.1,
          },
        }),
      }
    );

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error(`[VisionAnalyzer] Llama Vision error for image ${i + 1}: ${createRes.status} — ${errText.slice(0, 200)}`);
      imageDescriptions.push(`Изображение ${i + 1} (описание недоступно)`);
      continue;
    }

    let result = await createRes.json();
    while (result.status !== "succeeded" && result.status !== "failed") {
      await new Promise((r) => setTimeout(r, 1000));
      const poll = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      result = await poll.json();
    }

    if (result.status === "failed") {
      console.error(`[VisionAnalyzer] Image ${i + 1} failed:`, result.error);
      imageDescriptions.push(`Изображение ${i + 1} (описание недоступно)`);
    } else {
      const output = Array.isArray(result.output) ? result.output.join("") : String(result.output || "");
      console.log(`[VisionAnalyzer] Image ${i + 1} description: "${output.trim().slice(0, 120)}"`);
      imageDescriptions.push(output.trim());
    }
  }

  const combinedSummary = buildCombinedSummary(imageDescriptions, userIntent);
  console.log(`[VisionAnalyzer] Llama Vision analysis complete. Summary (first 200 chars): "${combinedSummary.slice(0, 200)}"`);

  return {
    descriptions: imageDescriptions,
    combinedSummary,
    imageCount: images.length,
  };
}

// ─── Helpers ─────────────────────────────────────────────

function parseVisionResponse(
  raw: string,
  imageCount: number,
  userIntent: string
): VisionAnalysisResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const descriptions: string[] = Array.isArray(parsed.descriptions)
        ? parsed.descriptions.map(String)
        : [parsed.summary || raw];
      const combinedSummary = parsed.summary || buildCombinedSummary(descriptions, userIntent);
      console.log(`[VisionAnalyzer] GPT-4o analysis complete: "${combinedSummary.slice(0, 100)}"`);
      return { descriptions, combinedSummary, imageCount };
    }
  } catch {
    // ignore parse error
  }
  // Fallback: treat entire response as single description
  return {
    descriptions: [raw.trim()],
    combinedSummary: raw.trim(),
    imageCount,
  };
}

function buildCombinedSummary(descriptions: string[], userIntent: string): string {
  const list = descriptions.map((d, i) => `${i + 1}. ${d}`).join("\n");
  return `Референсные фото (${descriptions.length} шт.):\n${list}\n\nКонтекст запроса: "${userIntent}"`;
}
