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
    // Fallback: Gemini 2.5 Flash via Replicate (uses `images` array param)
    if (process.env.REPLICATE_API_TOKEN) {
      return await analyzeWithGeminiFlash(images, userIntent);
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

// ─── Gemini 2.5 Flash via Replicate (per-image) ─────────

async function analyzeWithGeminiFlash(
  images: string[],
  userIntent: string
): Promise<VisionAnalysisResult> {
  const token = process.env.REPLICATE_API_TOKEN!;
  const imageDescriptions: string[] = [];

  // Process each image individually for guaranteed description coverage
  for (let i = 0; i < images.length; i++) {
    const imgUrl = images[i].startsWith("data:") ? images[i] : `data:image/jpeg;base64,${images[i]}`;
    const sizeKB = Math.round(imgUrl.length / 1024);

    console.log(`[VisionAnalyzer] Sending image ${i + 1}/${images.length} to Gemini Flash (${sizeKB} KB base64)...`);

    try {
      const createRes = await fetch(
        "https://api.replicate.com/v1/models/google/gemini-2.5-flash/predictions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            Prefer: "wait",
          },
          body: JSON.stringify({
            input: {
              prompt: `Look at this product image carefully. Describe the EXACT product shown.

Answer these questions:
1. What specific product is this? (e.g. running sneakers, electric kettle, portable Bluetooth speaker, perfume bottle)
2. What brand is visible? (read any text/logos on the product)
3. What color and material is it?
4. What is the photography style?

Respond in Russian, one detailed paragraph. Be VERY PRECISE about the product type — do not confuse a speaker with headphones, or a kettle with a bottle.`,
              images: [imgUrl],
              max_output_tokens: 300,
              temperature: 0.1,
            },
          }),
        }
      );

      if (!createRes.ok) {
        const errText = await createRes.text();
        console.error(`[VisionAnalyzer] Image ${i + 1} error: ${createRes.status} — ${errText.slice(0, 200)}`);
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
        const desc = output.trim();
        console.log(`[VisionAnalyzer] Image ${i + 1} ✓: "${desc.slice(0, 150)}"`);
        imageDescriptions.push(desc);
      }
    } catch (e) {
      console.error(`[VisionAnalyzer] Image ${i + 1} exception:`, e);
      imageDescriptions.push(`Изображение ${i + 1} (описание недоступно)`);
    }
  }

  const combinedSummary = buildCombinedSummary(imageDescriptions, userIntent);
  console.log(`[VisionAnalyzer] All ${images.length} images analyzed. Summary:\n${combinedSummary.slice(0, 400)}`);

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
